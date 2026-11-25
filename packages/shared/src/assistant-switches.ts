import { z } from 'zod';
import { assistantRoleSchema } from './assistant.js';

/**
 * Task 11.20 (`02`, Assistant, "Switches" and "Personal data and the model"): the Super Admin's
 * switches of the assistant's actions, per role, area and action, and of the personal-data
 * groups that may reach the model.
 */

/** What a route is to the assistant (`routeKindOf` of the API). */
export const ASSISTANT_ACTION_KINDS = [
  'read',
  'change',
  'preview',
  'export',
  'file',
  'download',
] as const;

export type AssistantActionKind = (typeof ASSISTANT_ACTION_KINDS)[number];

/**
 * The kinds the model is given no tool of their own for (task 11.20, plan decision 7); since task
 * 11.22 an import upload and an export run through the tools of files (`import_attachment`,
 * `export_file`), and the other routes of these kinds have none.
 */
export const ASSISTANT_KINDS_WITHOUT_TOOL: readonly AssistantActionKind[] = [
  'export',
  'file',
  'download',
];

/**
 * `02`, Switches: "Everything is on at the start except these, which start off: publishing or
 * withdrawing a timetable version, closing a quarter or a year and starting a year,
 * recalculating closed results, force delete and restoring what it removed, accounts (password
 * resets, the second step, sessions, printed slips), roles and appointments, and integration
 * keys." The areas whose actions start off (reads stay on: the list names actions that change).
 */
export const HEAVY_AREAS: readonly string[] = [
  'quarter_closing',
  'results_recalculation',
  'forced_deletes',
  // The accounts, their roles (staff roles and their subjects, Head Teacher appointments) and
  // the first passwords of an account made from a staff record.
  'accounts',
  // Password resets, the second step, locks and sessions.
  'account_access',
  // Printed slips and parents' password resets.
  'parent_accounts',
  'integration_keys',
];

/** The routes of other areas that start off (plan decision 3, review correction 2). */
export const HEAVY_ROUTES: readonly string[] = [
  'POST /api/timetable/versions/:id/publish',
  'POST /api/timetable/versions/:id/withdraw',
  'POST /api/setup/academic-years/:id/start',
  // Appointments: a class's Tutor and an acting teacher.
  'POST /api/classes/:id/tutors',
  'POST /api/classes/:id/tutors/:tutorId/end',
  'POST /api/classes/:id/tutors/preview',
  'POST /api/timetable/acting-teachers',
  'POST /api/timetable/acting-teachers/:id/end',
  'POST /api/timetable/acting-teachers/check',
  // It gives out first-password slips.
  'POST /api/people/staff/imports/:id/confirm',
];

/** Whether an action is on when the Super Admin has set nothing for it. */
export function assistantDefaultOn(
  area: string,
  route: string,
  kind: AssistantActionKind,
): boolean {
  if (kind === 'read') {
    return true;
  }
  return !HEAVY_AREAS.includes(area) && !HEAVY_ROUTES.includes(route);
}

/** One action of a role on the Assistant settings page. */
export const assistantActionSchema = z.object({
  /** `<METHOD> /api/<path>`. */
  route: z.string(),
  /** The operation id: the label is `assistant.actions.<operation>` in the locale files. */
  operation: z.string(),
  kind: z.enum(ASSISTANT_ACTION_KINDS),
  on: z.boolean(),
  defaultOn: z.boolean(),
  /** False for an export, a file or a download: no tool until task 11.22 (plan decision 7). */
  hasTool: z.boolean(),
});

export type AssistantAction = z.infer<typeof assistantActionSchema>;

/** One area of a role: its switch and its actions. */
export const assistantAreaSchema = z.object({
  /** The area of the permission table: the label is `assistant.areas.<area>`. */
  area: z.string(),
  on: z.boolean(),
  actions: z.array(assistantActionSchema),
});

export type AssistantArea = z.infer<typeof assistantAreaSchema>;

/** `GET /api/assistant/actions`: every action of each of the three roles, by area. */
export const assistantActionsSchema = z.object({
  roles: z.array(z.object({ role: assistantRoleSchema, areas: z.array(assistantAreaSchema) })),
});

export type AssistantActions = z.infer<typeof assistantActionsSchema>;

/** The most changes one save sends (a whole role switched at once, about 520 actions). */
export const ASSISTANT_SWITCH_CHANGES_MAX = 1200;

/**
 * One change of `PUT /api/assistant/actions`: an action (`route`) or a whole area (no `route`:
 * the area and every action of it take the value).
 */
export const assistantSwitchChangeSchema = z.strictObject({
  role: assistantRoleSchema,
  area: z.string().min(1).max(60),
  route: z.string().min(1).max(200).optional(),
  on: z.boolean(),
});

export type AssistantSwitchChange = z.infer<typeof assistantSwitchChangeSchema>;

export const assistantSwitchChangesSchema = z.strictObject({
  changes: z.array(assistantSwitchChangeSchema).min(1).max(ASSISTANT_SWITCH_CHANGES_MAX),
});

export type AssistantSwitchChanges = z.infer<typeof assistantSwitchChangesSchema>;
