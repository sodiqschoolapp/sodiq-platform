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
import { journalOf, refusedUnlessOwnJournal } from './own-journal.js';
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
/**
 * Every lesson of a preview is kept for the panel (review of the code, finding 2: "names every
 * lesson"); the route's own limits bound how many a preview can name.
 */
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
    recordNames: { uz: string; ru: string; en: string } | null;
    fields: { name: string; value: string }[];
    previewLessons: AssistantPreviewLesson[];
    previewMore: number;
    previewIssues: { kind: 'warning' | 'blocked'; code: string }[];
    previewCounts: { list: string; count: number }[];
  };
}

export interface ProposingAs {
  pass: SessionPass;
  branchId: string;
  role: AssistantRole;
  lines: RoleLines;
  /** The date and class of a dated lesson of the branch, to name it in the panel (a one-day change). */
  lessonDateOf?: (lessonId: string) => Promise<{ date: string; classId: string } | undefined>;
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

/** The values of a read's parameters, from the step (the journal of a base read). */
function readArgsOf(
  args: Readonly<Record<string, StepValue>>,
  pathArgs: Readonly<Record<string, unknown>>,
  body: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([name, value]) => [name, valueOf(value, pathArgs, body)]),
  );
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
  return namesOfRecord(record)?.en ?? null;
}

/** A record's names in the three languages (a subject), or `null`. */
function namesOfRecord(
  record: Record<string, unknown> | undefined,
): { uz: string; ru: string; en: string } | null {
  const names = record?.names as Record<string, unknown> | undefined;
  return names !== undefined &&
    names !== null &&
    typeof names.uz === 'string' &&
    typeof names.ru === 'string' &&
    typeof names.en === 'string'
    ? { uz: names.uz, ru: names.ru, en: names.en }
    : null;
}

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value is an id or a list of ids only: the panel names records otherwise. */
function idsOnly(value: unknown): boolean {
  if (typeof value === 'string') return UUID_TEXT.test(value);
  return Array.isArray(value) && value.length > 0 && value.every(idsOnly);
}

/**
 * The warnings and blocks a check or preview names (`warnings`, `blocked`, `problems` …), by
 * code, so that a step that accepts them shows them (plan decision 6, review correction 2).
 */
export function issuesOfPreview(value: unknown): { kind: 'warning' | 'blocked'; code: string }[] {
  const found = new Map<string, { kind: 'warning' | 'blocked'; code: string }>();
  const walk = (item: unknown, kind: 'warning' | 'blocked' | null): void => {
    if (typeof item === 'string' && kind !== null && /^[a-z_]+$/.test(item)) {
      found.set(`${kind}:${item}`, { kind, code: item });
      return;
    }
    if (Array.isArray(item)) {
      for (const each of item) walk(each, kind);
      return;
    }
    if (item === null || typeof item !== 'object') return;
    const record = item as Record<string, unknown>;
    if (kind !== null && typeof record.code === 'string') {
      found.set(`${kind}:${record.code}`, { kind, code: record.code });
    }
    for (const [key, each] of Object.entries(record)) {
      const next = /warning/i.test(key)
        ? 'warning'
        : /block|conflict|problem|refus/i.test(key)
          ? 'blocked'
          : kind;
      walk(each, next);
    }
  };
  walk(value, null);
  return [...found.values()];
}

/** How many entries each list at the top of a preview holds. */
function countsOfPreview(value: unknown): { list: string; count: number }[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([list, each]) =>
    Array.isArray(each) ? [{ list, count: each.length }] : [],
  );
}

/** The fields of a body as text, for the panel (the platform's own words, decision 5). */
/**
 * The body as the panel shows it (task 11.14): without the field the server read (the base of a
 * plan save, the stored values), and with the values of a plan item (the new topic, works) named
 * one by one, so the person reads the change in plain words.
 */
function shownBodyOf(
  body: Readonly<Record<string, unknown>>,
  line: AssistantChangeLine,
): Record<string, unknown> {
  const server = line.serverBase;
  const spread = server?.against ?? (line.group === 'plans' ? 'values' : undefined);
  if (spread === undefined) return { ...body };
  const shown: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === server?.field) continue;
    if (key === spread && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(shown, value);
      continue;
    }
    shown[key] = value;
  }
  return shown;
}

function fieldsOf(body: unknown): { name: string; value: string }[] {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return [];
  // Ids are not shown: the record, the lessons and the preview name what they stand for.
  return Object.entries(body as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined && !idsOnly(value))
    .filter(([, value]) => !Array.isArray(value) || value.length > 0)
    .map(([name, value]) => ({
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
  // The lessons that hold data, named by id in a list of their own (`withData`).
  const withData = new Set<string>();
  const collect = (item: unknown, inData: boolean): void => {
    if (Array.isArray(item)) {
      for (const each of item) collect(each, inData);
      return;
    }
    if (item === null || typeof item !== 'object') return;
    for (const [key, each] of Object.entries(item as Record<string, unknown>)) {
      if (inData && key === 'lessonId' && typeof each === 'string') withData.add(each);
      collect(each, inData || key === 'withData');
    }
  };
  collect(value, false);
  const walk = (
    item: unknown,
    list: string,
    blockId: string | null = null,
    chosenOnly: ReadonlySet<string> = new Set(),
    top = true,
  ): void => {
    if (Array.isArray(item)) {
      for (const each of item) walk(each, list, blockId, chosenOnly, top);
      return;
    }
    if (item === null || typeof item !== 'object') return;
    const record = item as Record<string, unknown>;
    const inBlock = typeof record.blockId === 'string' ? record.blockId : blockId;
    // A shared block's lessons fed by the chosen classes alone (`chosenOnly`): a "keep" of the
    // block still cancels them (`bulkCancelSharedSchema`; review of the code, round 2).
    const only = Array.isArray(record.chosenOnly)
      ? new Set(record.chosenOnly.filter((one): one is string => typeof one === 'string'))
      : chosenOnly;
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
        hasData: typeof record.id === 'string' && withData.has(record.id),
        choice: null,
        ...(typeof record.id === 'string' ? { lessonId: record.id } : {}),
        ...(inBlock === null ? {} : { blockId: inBlock }),
        ...(typeof record.id === 'string' && only.has(record.id) ? { chosenOnly: true } : {}),
      });
      return;
    }
    // A lesson is named by the preview's own list it is in (`cancel`, `shared`, `held` …), the
    // key at the top of the preview, never a list inside it (a shared block's `lessons`).
    for (const [key, each] of Object.entries(record)) {
      walk(each, top && Array.isArray(each) ? key : list, inBlock, only, false);
    }
  };
  walk(value, 'preview');
  return found;
}

/** A lesson of a preview with the ids its choice is matched by. */
type InternalLesson = AssistantPreviewLesson & {
  lessonId?: string;
  blockId?: string;
  /** Fed by the chosen classes alone: cancelled whatever the block's choice. */
  chosenOnly?: boolean;
};

/**
 * The choice the step's body sends for each lesson (review of the code, finding 1): a bulk
 * cancel's `dataChoices` by lesson ("keep as held" or "cancel") and its `blocks` by shared block,
 * so the person reads, lesson by lesson, what Confirm will do with lessons that hold data.
 */
function withChoices(
  lessons: readonly InternalLesson[],
  body: Readonly<Record<string, unknown>>,
): InternalLesson[] {
  const byLesson = new Map<string, 'keep' | 'cancel'>();
  const byBlock = new Map<string, 'keep' | 'cancel'>();
  const read = (
    value: unknown,
    key: 'lessonId' | 'blockId',
    into: Map<string, 'keep' | 'cancel'>,
  ) => {
    if (!Array.isArray(value)) return;
    for (const one of value) {
      const record = one as Record<string, unknown> | null;
      const id = record?.[key];
      const choice = record?.choice;
      if (typeof id === 'string' && (choice === 'keep' || choice === 'cancel'))
        into.set(id, choice);
    }
  };
  read(body.dataChoices, 'lessonId', byLesson);
  read(body.blocks, 'blockId', byBlock);
  return lessons.map((lesson) => {
    // The lesson's own data choice first; then what its shared block's choice does to it.
    const own = lesson.lessonId === undefined ? undefined : byLesson.get(lesson.lessonId);
    const block = lesson.blockId === undefined ? undefined : byBlock.get(lesson.blockId);
    const choice: AssistantPreviewLesson['choice'] =
      own ??
      (block === undefined
        ? null
        : block === 'cancel' || lesson.chosenOnly === true
          ? 'cancel'
          : 'held');
    return { ...lesson, choice };
  });
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

  // Task 11.14 (plan decision 9): a field read by the server from the person's own read, never
  // the model's (the base of a plan item save). The tool's own fields find the record and are
  // removed; values equal to the stored record save nothing and add no step.
  if (line.serverBase !== undefined) {
    const server = line.serverBase;
    const readUrl = urlFor(server.route, server.args, pathArgs, body);
    const readArgs = readArgsOf(server.args, pathArgs, body);
    for (const name of Object.keys(server.toolFields)) {
      delete body[name];
    }
    if ('fault' in readUrl) {
      return { given: { error: 'invalid_arguments', detail: readUrl.fault } };
    }
    let outcome = await dispatcher.read(readUrl.url, as);
    // Task 11.14 (review of the code, finding 1): the base read is narrowed as the plan read is,
    // so a colleague's item is refused here and never stored or given to the model.
    const own = as.lines[server.route];
    if (
      own !== undefined &&
      (own.kind === undefined || own.kind === 'read') &&
      own.ownJournal !== undefined &&
      refusalOf(outcome) === undefined
    ) {
      outcome =
        (await refusedUnlessOwnJournal(
          dispatcher,
          as,
          journalOf(own.ownJournal, readArgs, outcome),
        )) ?? outcome;
    }
    const refused = refusalOf(outcome);
    if (refused !== undefined) {
      return { given: refused };
    }
    const wanted = valueOf(server.pick, pathArgs, body);
    const record = wanted === undefined ? undefined : findRecord(bodyOf(outcome), 'id', wanted);
    if (record === undefined) {
      return { given: { status: 404, error: 'not_found' } };
    }
    const stored = Object.fromEntries(server.keys.map((key) => [key, record[key]]));
    const against = body[server.against];
    if (
      against !== null &&
      typeof against === 'object' &&
      server.keys.every(
        (key) =>
          fingerprintOf((against as Record<string, unknown>)[key]) === fingerprintOf(stored[key]),
      )
    ) {
      return { given: { error: 'assistant_nothing_to_change' } };
    }
    body[server.field] = stored;
  }

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
  let previewIssues: { kind: 'warning' | 'blocked'; code: string }[] = [];
  let previewCounts: { list: string; count: number }[] = [];
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
    previewLessons = withChoices(lessonsOfPreview(filtered), body);
    previewIssues = issuesOfPreview(filtered);
    previewCounts = countsOfPreview(filtered);
    previewGiven = cut(filtered);
  }

  // A one-day change of one lesson: the lesson as the day's timetable names it (class, date,
  // slot, subject), read through the person's own route, for the panel only.
  if (
    previewLessons.length === 0 &&
    tool.path.startsWith('/api/timetable/lessons/:id') &&
    typeof pathArgs.id === 'string' &&
    as.lessonDateOf !== undefined
  ) {
    const at = await as.lessonDateOf(pathArgs.id);
    if (at !== undefined) {
      const day = await dispatcher.read(
        `/api/timetable/day?date=${at.date}&classId=${at.classId}`,
        as,
      );
      const lesson = findRecord(bodyOf(day), 'id', pathArgs.id);
      previewLessons = lessonsOfPreview(lesson === undefined ? [] : [filterRead(lesson)]).map(
        (one) => ({ ...one, list: 'lesson' }),
      );
    }
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
      recordNames: namesOfRecord(picked),
      fields: fieldsOf(tool.body === undefined ? null : shownBodyOf(body, line)),
      // Only the panel's fields: the ids that matched a choice are not kept.
      previewLessons: previewLessons.map((lesson: InternalLesson) => {
        const shown: InternalLesson = { ...lesson };
        delete shown.lessonId;
        delete shown.blockId;
        delete shown.chosenOnly;
        return shown;
      }),
      previewMore: 0,
      previewIssues,
      previewCounts,
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
  // No answer came (a timeout, a lost connection, an answer too large): the route may still have
  // made the change, so the step is not known, never refused (review of the code, finding 3).
  if ('failure' in outcome && outcome.failure !== undefined) {
    return { state: 'unknown', status: 0, code: `read_${outcome.failure}` };
  }
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
