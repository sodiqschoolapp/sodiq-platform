import { randomUUID } from 'node:crypto';
import {
  ASSISTANT_MAX_STEPS,
  type AssistantPreviewLesson,
  type AssistantReadGroup,
  type AssistantRole,
  type AssistantStepState,
} from '@sodiq/shared';
import {
  STEP_ID,
  type AssistantChangeLine,
  type StepValue,
} from '../access/assistant-change-routes.js';
import type { SessionPass } from '../../http/session-cookie.js';
import { fingerprintOf, findRecord, idsIn } from './canonical.js';
import type { AssistantDispatcher, ReadOutcome } from './dispatcher.js';
import { filterRead, filterWords } from './field-filter.js';
import {
  BODY_ARGUMENT,
  changeBodySchemaOf,
  generatedOf,
  SUMMARY_ARGUMENT,
  urlOf,
  valueFault,
  type GeneratedTool,
  type RoleLines,
} from './tools.js';

/** The longest sentence of the model kept for a step. */
export const SUMMARY_MAX_LENGTH = 300;
/** At most this many lessons of a preview are kept for the panel. */
export const PREVIEW_LESSONS_SHOWN = 60;
/** A preview given back to the model is cut at this many characters. */
const PREVIEW_MAX_CHARACTERS = 12_000;

/** What a step was proposed on, as stored (task 11.13, plan "Basis of a step"). */
export type StoredBasis =
  | { kind: 'own' }
  | { kind: 'create' }
  | {
      kind: 'read';
      url: string;
      pick: { key: string; value: string } | null;
      clockKeys: string[];
      fingerprint: string;
    };

/** One step of a proposal, as stored in `assistant_proposals.steps`. */
export interface StoredStep {
  id: string;
  seq: number;
  /** `<METHOD> /api/<path>` as listed. */
  route: string;
  method: string;
  /** The path with its values; a change takes no query. */
  url: string;
  /** The exact body sent at Confirm, or `null` for none. */
  body: unknown;
  action: string;
  group: AssistantReadGroup;
  summary: string;
  /** The records it changes (one record, one step) and the ids its basis read answered. */
  records: string[];
  basisIds: string[];
  basis: StoredBasis;
  preview: { url: string; body: unknown; fingerprint: string } | null;
  shown: {
    recordName: string | null;
    fields: { name: string; value: string }[];
    previewLessons: AssistantPreviewLesson[];
    previewMore: number;
  };
}

export interface ProposingAs {
  pass: SessionPass;
  branchId: string;
  role: AssistantRole;
  lines: RoleLines;
}

/** What a proposed call gives back: the step, and what the model is told. */
export type Drafted = { step: StoredStep; given: unknown } | { step?: undefined; given: unknown };

function valueOf(
  value: StepValue,
  pathArgs: Readonly<Record<string, unknown>>,
  body: Readonly<Record<string, unknown>>,
): string | undefined {
  const [where, name] = value.split(':', 2) as ['path' | 'body', string];
  const found = where === 'path' ? pathArgs[name] : body[name];
  return typeof found === 'string' ? found : undefined;
}

/** The URL of a route from values of the step (a basis read, a preview). */
function urlFor(
  route: string,
  args: Readonly<Record<string, StepValue>> | undefined,
  pathArgs: Readonly<Record<string, unknown>>,
  body: Readonly<Record<string, unknown>>,
): { url: string } | { fault: string } {
  const tool = generatedOf(route);
  const given: Record<string, unknown> = {};
  if (args === undefined) {
    for (const parameter of tool.parameters) {
      if (parameter.in === 'path') given[parameter.name] = pathArgs[parameter.name];
    }
  } else {
    for (const [name, value] of Object.entries(args)) {
      given[name] = valueOf(value, pathArgs, body);
    }
  }
  return urlOf(tool, given);
}

function withStepId(value: unknown, id: string | undefined): unknown {
  if (value === STEP_ID) return id;
  if (Array.isArray(value)) return value.map((item) => withStepId(item, id));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, withStepId(item, id)]),
    );
  }
  return value;
}

/** The refusal a read or a preview answered, as the model is given it (no message, the code). */
function refusalOf(outcome: ReadOutcome): { status: number; error: string } | undefined {
  if ('failure' in outcome && outcome.failure !== undefined) {
    return { status: 0, error: `read_${outcome.failure}` };
  }
  if (outcome.status >= 400) {
    const body = bodyOf(outcome) as { error?: { code?: unknown } } | null;
    const code = body?.error?.code;
    return { status: outcome.status, error: typeof code === 'string' ? code : 'refused' };
  }
  return undefined;
}

/** The body of an answer, `null` when nothing came back. */
function bodyOf(outcome: ReadOutcome): unknown {
  return 'body' in outcome ? outcome.body : null;
}

/** A record's name as its read gives it, for the panel. */
function nameOfRecord(record: Record<string, unknown> | undefined): string | null {
  if (record === undefined) return null;
  for (const key of ['name', 'fullName', 'title', 'displayName', 'personName']) {
    const value = record[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  const names = record.names;
  if (names !== null && typeof names === 'object') {
    const en = (names as Record<string, unknown>).en;
    if (typeof en === 'string') return en;
  }
  return null;
}

/** The fields of a body as text, for the panel (the platform's own words, decision 5). */
function fieldsOf(body: unknown): { name: string; value: string }[] {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return [];
  return Object.entries(body as Record<string, unknown>).map(([name, value]) => ({
    name,
    value: (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 400),
  }));
}

/**
 * The lessons a preview names (`dayLessonSchema` and its kin: a date, a start, a class or group,
 * a subject), with the list each is in, so that the panel names every lesson, class, date and
 * slot in plain words (`edge/people-roles-accounts`, first row of The assistant).
 */
export function lessonsOfPreview(value: unknown): AssistantPreviewLesson[] {
  const found: AssistantPreviewLesson[] = [];
  const walk = (item: unknown, list: string): void => {
    if (Array.isArray(item)) {
      for (const each of item) walk(each, list);
      return;
    }
    if (item === null || typeof item !== 'object') return;
    const record = item as Record<string, unknown>;
    const unit = record.unit as { name?: unknown } | undefined;
    if (
      typeof record.date === 'string' &&
      typeof record.start === 'number' &&
      typeof unit?.name === 'string'
    ) {
      const subject = record.subject as { names?: Record<string, unknown> } | undefined;
      const names = subject?.names;
      const teacher = record.teacher as { name?: unknown } | null | undefined;
      const room = record.room as { name?: unknown } | null | undefined;
      found.push({
        list,
        date: record.date,
        start: record.start,
        unitName: unit.name,
        subjectNames:
          names !== undefined &&
          typeof names.uz === 'string' &&
          typeof names.ru === 'string' &&
          typeof names.en === 'string'
            ? { uz: names.uz, ru: names.ru, en: names.en }
            : null,
        teacherName: typeof teacher?.name === 'string' ? teacher.name : null,
        roomName: typeof room?.name === 'string' ? room.name : null,
      });
      return;
    }
    for (const [key, each] of Object.entries(record)) {
      walk(each, Array.isArray(each) ? key : list);
    }
  };
  walk(value, 'preview');
  return found;
}

function cut(value: unknown): unknown {
  const text = JSON.stringify(value);
  return text.length <= PREVIEW_MAX_CHARACTERS
    ? value
    : { truncated: true, dataText: text.slice(0, PREVIEW_MAX_CHARACTERS) };
}

/**
 * Drafts one step from a `propose_*` call of the model (task 11.13; `02`, Reading and
 * proposing). Nothing changes here: the basis read and the preview are reads and previews
 * through the platform's own routes as the person; the change itself is only stored.
 */
export async function draftStep(
  dispatcher: AssistantDispatcher,
  as: ProposingAs,
  call: {
    route: string;
    tool: GeneratedTool;
    line: AssistantChangeLine;
    args: Record<string, unknown>;
  },
  prior: readonly StoredStep[],
): Promise<Drafted> {
  const { route, tool, line, args } = call;
  if (prior.length >= ASSISTANT_MAX_STEPS) {
    return { given: { error: 'too_many_steps', max: ASSISTANT_MAX_STEPS } };
  }
  const pathArgs: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(args)) {
    if (name !== BODY_ARGUMENT && name !== SUMMARY_ARGUMENT) pathArgs[name] = value;
  }
  const url = urlOf(tool, pathArgs);
  if ('fault' in url) {
    return { given: { error: 'invalid_arguments', detail: url.fault } };
  }
  const summary = args[SUMMARY_ARGUMENT];
  if (typeof summary !== 'string' || summary.trim() === '') {
    return { given: { error: 'invalid_arguments', detail: 'summary is required' } };
  }
  const schema = changeBodySchemaOf(route, line);
  const given = args[BODY_ARGUMENT];
  if (schema === undefined && given !== undefined) {
    return { given: { error: 'invalid_arguments', detail: 'this change takes no body' } };
  }
  if (schema !== undefined) {
    const fault = valueFault(given ?? null, schema);
    if (fault !== undefined) {
      return { given: { error: 'invalid_arguments', detail: `body ${fault}` } };
    }
  }
  const body: Record<string, unknown> =
    given !== null && typeof given === 'object' ? { ...(given as Record<string, unknown>) } : {};

  const records = (line.records ?? ['path:id'])
    .map((value) => valueOf(value, pathArgs, body)?.toLowerCase())
    .filter((value): value is string => value !== undefined);

  // The basis.
  let basis: StoredBasis;
  let picked: Record<string, unknown> | undefined;
  let basisIds: string[] = [];
  if (line.basis.kind === 'read') {
    const basisUrl = urlFor(line.basis.route, line.basis.args, pathArgs, body);
    if ('fault' in basisUrl) {
      return { given: { error: 'invalid_arguments', detail: basisUrl.fault } };
    }
    const outcome = await dispatcher.read(basisUrl.url, as);
    const refused = refusalOf(outcome);
    if (refused !== undefined) {
      return { given: refused };
    }
    const pickValue =
      line.basis.pick === undefined ? undefined : valueOf(line.basis.pick.value, pathArgs, body);
    const pickKey = line.basis.pick?.key ?? 'id';
    if (line.basis.pick !== undefined) {
      picked =
        pickValue === undefined ? undefined : findRecord(bodyOf(outcome), pickKey, pickValue);
      if (picked === undefined) {
        return { given: { status: 404, error: 'not_found' } };
      }
    } else if (bodyOf(outcome) !== null && typeof bodyOf(outcome) === 'object') {
      picked = bodyOf(outcome) as Record<string, unknown>;
    }
    const clockKeys = [...(line.basis.clockKeys ?? [])];
    basis = {
      kind: 'read',
      url: basisUrl.url,
      pick: pickValue === undefined ? null : { key: pickKey, value: pickValue },
      clockKeys,
      fingerprint: fingerprintOf(picked ?? bodyOf(outcome), clockKeys),
    };
    basisIds = [...idsIn(picked ?? bodyOf(outcome))];
    for (const field of line.fromBasis ?? []) {
      if (picked?.[field] === undefined) {
        return { given: { error: 'basis_field_missing', field } };
      }
      body[field] = picked[field];
    }
  } else {
    basis = { kind: line.basis.kind };
  }

  // One record, one step (plan review must fix 2): no two steps on one record, nor a step on a
  // record that another step's basis read answers.
  const mine = new Set([...records, ...basisIds]);
  for (const step of prior) {
    const theirs = new Set([...step.records, ...step.basisIds]);
    if (
      records.some((record) => theirs.has(record)) ||
      step.records.some((record) => mine.has(record))
    ) {
      return { given: { error: 'assistant_step_same_record', otherStep: step.seq } };
    }
  }

  // The preview, with the same body (a calendar or template change, a bulk cancel, an exam).
  let preview: StoredStep['preview'] = null;
  let previewLessons: AssistantPreviewLesson[] = [];
  let previewGiven: unknown;
  if (line.preview !== undefined) {
    const previewUrl = urlFor(line.preview.route, line.preview.args, pathArgs, body);
    if ('fault' in previewUrl) {
      return { given: { error: 'invalid_arguments', detail: previewUrl.fault } };
    }
    const previewBody = withStepId(
      line.preview.body === undefined ? body : line.preview.body(body),
      typeof pathArgs.id === 'string' ? pathArgs.id : undefined,
    );
    const outcome = await dispatcher.send('POST', previewUrl.url, previewBody, as);
    const refused = refusalOf(outcome);
    if (refused !== undefined) {
      // A preview refused adds no step (decision 7): "today cannot become a day off".
      return { given: refused };
    }
    preview = {
      url: previewUrl.url,
      body: previewBody,
      fingerprint: fingerprintOf(bodyOf(outcome)),
    };
    const filtered = filterRead(bodyOf(outcome));
    previewLessons = lessonsOfPreview(filtered);
    previewGiven = cut(filtered);
  }

  const step: StoredStep = {
    id: randomUUID(),
    seq: prior.length + 1,
    route,
    method: tool.method,
    url: url.url,
    body: tool.body === undefined ? null : body,
    action: tool.name,
    group: line.group,
    summary: filterWords(summary).trim().slice(0, SUMMARY_MAX_LENGTH),
    records,
    basisIds,
    basis,
    preview,
    shown: {
      recordName: nameOfRecord(picked),
      fields: fieldsOf(tool.body === undefined ? null : body),
      previewLessons: previewLessons.slice(0, PREVIEW_LESSONS_SHOWN),
      previewMore: Math.max(0, previewLessons.length - PREVIEW_LESSONS_SHOWN),
    },
  };
  return {
    step,
    given: {
      proposed: true,
      step: step.seq,
      note: 'Proposed only: nothing has changed. The person sees it and confirms or declines.',
      ...(previewGiven === undefined ? {} : { preview: previewGiven }),
    },
  };
}

/** A step's outcome at Confirm, and the codes of its route that mean "changed since". */
export function stateOfOutcome(
  outcome: ReadOutcome,
  outdatedCodes: readonly string[],
): { state: AssistantStepState; status: number; code: string | null } {
  const refused = refusalOf(outcome);
  if (refused === undefined) {
    return { state: 'done', status: outcome.status, code: null };
  }
  return {
    state: outdatedCodes.includes(refused.error) ? 'outdated' : 'refused',
    status: refused.status,
    code: refused.error,
  };
}

/** Whether the basis read again still gives the fingerprint the step was proposed on. */
export function basisStill(
  basis: Extract<StoredBasis, { kind: 'read' }>,
  outcome: ReadOutcome,
): boolean {
  if (refusalOf(outcome) !== undefined) return false;
  const record =
    basis.pick === null
      ? bodyOf(outcome)
      : findRecord(bodyOf(outcome), basis.pick.key, basis.pick.value);
  return record !== undefined && fingerprintOf(record, basis.clockKeys) === basis.fingerprint;
}

export { refusalOf };
