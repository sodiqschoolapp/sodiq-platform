import { Injectable } from '@nestjs/common';
import {
  ASSISTANT_KINDS_WITHOUT_TOOL,
  ASSISTANT_ROLES,
  assistantDefaultOn,
  type AssistantActions,
  type AssistantArea,
  type AssistantRole,
  type AssistantSwitchChange,
} from '@sodiq/shared';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { AssistantRoutes } from '../access/assistant-routes.check.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { generatedOf } from './tools.js';

/** What the Super Admin set: `<role> <area>` and `<role> <route>` to on or off. */
export interface SwitchRows {
  areas: ReadonlyMap<string, boolean>;
  actions: ReadonlyMap<string, boolean>;
}

/**
 * The Super Admin's switches of the assistant's actions (task 11.20; `02`, Assistant, Switches:
 * "switches each action, or a whole area, on or off; the assistant uses only what is switched
 * on, and a proposal waiting on an action switched off since is refused at Confirm … Each change
 * of a switch is in the audit log"). Read from the two tables of 0183 on every request, never
 * kept between requests: a missing row is the default of `assistantDefaultOn` (plan decision 6).
 * An action is on when its area is on and the action is on.
 */
@Injectable()
export class AssistantSwitches {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly routes: AssistantRoutes,
  ) {}

  async rowsIn(transaction: Transaction): Promise<SwitchRows> {
    const areas = await transaction
      .selectFrom('assistant_area_switches')
      .select(['role', 'area', 'is_on'])
      .execute();
    const actions = await transaction
      .selectFrom('assistant_action_switches')
      .select(['role', 'route', 'is_on'])
      .execute();
    return {
      areas: new Map(areas.map((row) => [`${row.role} ${row.area}`, row.is_on])),
      actions: new Map(actions.map((row) => [`${row.role} ${row.route}`, row.is_on])),
    };
  }

  /** The switches as they are now, in a transaction of their own (school-wide tables). */
  async rows(): Promise<SwitchRows> {
    return this.transactions.run([], (transaction) => this.rowsIn(transaction));
  }

  /** Whether the area of a role is on. */
  areaOn(rows: SwitchRows, role: AssistantRole, area: string): boolean {
    return rows.areas.get(`${role} ${area}`) ?? true;
  }

  /** Whether one route of the role's list is on; a route not on the list never is. */
  isOn(rows: SwitchRows, role: AssistantRole, route: string): boolean {
    const facts = this.routes.factsOf(route);
    if (facts === undefined || this.routes.linesOf(role)[route] === undefined) {
      return false;
    }
    if (!this.areaOn(rows, role, facts.area)) {
      return false;
    }
    return (
      rows.actions.get(`${role} ${route}`) ?? assistantDefaultOn(facts.area, route, facts.kind)
    );
  }

  /** The routes of the role's list that are on now. */
  onRoutes(rows: SwitchRows, role: AssistantRole): Set<string> {
    return new Set(
      Object.keys(this.routes.linesOf(role)).filter((route) => this.isOn(rows, role, route)),
    );
  }

  /** `GET /api/assistant/actions`: every action of each role, by area, with its state. */
  async catalogue(): Promise<AssistantActions> {
    const rows = await this.rows();
    return {
      roles: ASSISTANT_ROLES.map((role) => ({ role, areas: this.areasOf(rows, role) })),
    };
  }

  private areasOf(rows: SwitchRows, role: AssistantRole): AssistantArea[] {
    const byArea = new Map<string, AssistantArea>();
    for (const route of Object.keys(this.routes.linesOf(role)).sort()) {
      const facts = this.routes.factsOf(route);
      if (facts === undefined) continue;
      let area = byArea.get(facts.area);
      if (area === undefined) {
        area = { area: facts.area, on: this.areaOn(rows, role, facts.area), actions: [] };
        byArea.set(facts.area, area);
      }
      area.actions.push({
        route,
        operation: generatedOf(route).name,
        kind: facts.kind,
        on: this.isOn(rows, role, route),
        defaultOn: assistantDefaultOn(facts.area, route, facts.kind),
        hasTool: !ASSISTANT_KINDS_WITHOUT_TOOL.includes(facts.kind),
      });
    }
    return [...byArea.values()].sort((a, b) => a.area.localeCompare(b.area));
  }

  /**
   * `PUT /api/assistant/actions`: each change written and audited in one transaction. A change
   * without a route sets the area and every action of it (one click per area, `02`). A route or
   * area not on that role's list is refused (400 `assistant_action_unknown`) before anything is
   * written.
   */
  async change(
    access: Access,
    changes: readonly AssistantSwitchChange[],
    requestId: string,
  ): Promise<AssistantActions> {
    for (const change of changes) {
      const lines = this.routes.linesOf(change.role);
      const known =
        change.route === undefined
          ? Object.keys(lines).some((route) => this.routes.factsOf(route)?.area === change.area)
          : lines[change.route] !== undefined &&
            this.routes.factsOf(change.route)?.area === change.area;
      if (!known) {
        throw new ApiException('assistant_action_unknown', 400, undefined, [
          {
            path: 'changes',
            code: 'assistant_action_unknown',
            message: `${change.role} ${change.area} ${change.route ?? '(the whole area)'}`,
          },
        ]);
      }
    }
    await this.transactions.run([], async (transaction) => {
      const now = await transactionMoment(transaction);
      // One change at a time over the switches: the settings row is the school's lock.
      await transaction
        .selectFrom('assistant_settings')
        .select('id')
        .forUpdate()
        .executeTakeFirstOrThrow();
      const before = await this.rowsIn(transaction);
      for (const change of changes) {
        const routes =
          change.route === undefined
            ? Object.keys(this.routes.linesOf(change.role)).filter(
                (route) => this.routes.factsOf(route)?.area === change.area,
              )
            : [change.route];
        const wasOn =
          change.route === undefined
            ? this.areaOn(before, change.role, change.area)
            : this.isOn(before, change.role, change.route);
        if (change.route === undefined) {
          await transaction
            .insertInto('assistant_area_switches')
            .values({
              role: change.role,
              area: change.area,
              is_on: change.on,
              changed_at: now,
              changed_by: access.accountId,
            })
            .onConflict((conflict) =>
              conflict.columns(['role', 'area']).doUpdateSet({
                is_on: change.on,
                changed_at: now,
                changed_by: access.accountId,
              }),
            )
            .execute();
        }
        for (const route of routes) {
          await transaction
            .insertInto('assistant_action_switches')
            .values({
              role: change.role,
              route,
              is_on: change.on,
              changed_at: now,
              changed_by: access.accountId,
            })
            .onConflict((conflict) =>
              conflict.columns(['role', 'route']).doUpdateSet({
                is_on: change.on,
                changed_at: now,
                changed_by: access.accountId,
              }),
            )
            .execute();
        }
        if (wasOn !== change.on || change.route === undefined) {
          await this.audit.record(transaction, {
            branchId: null,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'assistant_switch.change',
            oldValue: {
              role: change.role,
              area: change.area,
              route: change.route ?? null,
              on: wasOn,
            },
            newValue: {
              role: change.role,
              area: change.area,
              route: change.route ?? null,
              on: change.on,
            },
            requestId,
          });
        }
      }
    });
    return this.catalogue();
  }
}
