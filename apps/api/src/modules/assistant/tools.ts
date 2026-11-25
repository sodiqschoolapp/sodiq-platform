import { WARNING_FLAGS, type AssistantChangeLine } from '../access/assistant-change-routes.js';
import type { AssistantRouteLine } from '../access/assistant-routes.js';
import { ASSISTANT_KINDS_WITHOUT_TOOL, type Language } from '@sodiq/shared';
import { kindOfLine } from '../access/assistant-routes.js';
import type { ModelFilter } from './field-filter.js';
import { PLATFORM_MAP } from './platform-map.js';
import type { ModelTool, ToolArgumentsSchema, ToolParameterSchema } from './model.js';
import { GENERATED_TOOLS } from './tools.generated.js';

/** The lines open to the chosen role, by route name (`AssistantRoutes.linesOf`). */
export type RoleLines = Readonly<Record<string, AssistantRouteLine>>;

/** One parameter of a route as the OpenAPI document gives it. */
export interface GeneratedParameter {
  name: string;
  in: 'path' | 'query';
  required: boolean;
  /** The parameter's JSON schema from the OpenAPI document. */
  schema: unknown;
}

/** A route of a list, as `pnpm api:client` writes it into `tools.generated.ts`. */
export interface GeneratedTool {
  /** The tool's name: the operation id, `[A-Za-z0-9_]`, at most 64 characters. */
  name: string;
  method: string;
  /** Express's path, `/api/classes/:id`. */
  path: string;
  parameters: GeneratedParameter[];
  /** Task 11.13: the JSON body of a change or a preview (OpenAPI 3.0). */
  body?: unknown;
}

/** The prefix of a change's tool: the model proposes, it never runs a change (task 11.13). */
export const PROPOSE = 'propose_';

/** The tool argument that holds a change's body, and the model's one line about it. */
export const BODY_ARGUMENT = 'body';
export const SUMMARY_ARGUMENT = 'summary';

/**
 * Task 11.19: the three tools of the map of the platform (`platform-map.ts`), open to the three
 * roles with no switch; they read only the map, never data, and link only a page the role opens.
 * `link_place` replaces the menu-only `suggest_page` of 11.12 (plan decision 6).
 */
export const FIND_IN_PLATFORM = 'find_in_platform';
export const EXPLAIN_PLACE = 'explain_place';
export const LINK_PLACE = 'link_place';

export const MAP_TOOLS: readonly string[] = [FIND_IN_PLATFORM, EXPLAIN_PLACE, LINK_PLACE];

/**
 * Task 11.20 (plan decision 10): the search of the role's switched-on actions. With about 500
 * actions the model is not given every declaration in each call: it finds the ones it needs, and
 * they are declared from its next call of the same question.
 */
export const FIND_ACTIONS = 'find_actions';

/** The most actions one search answers. */
export const FIND_ACTIONS_LIMIT = 12;

/** The most action declarations one call of the model carries (plan review 13). */
export const MAX_DECLARED_ACTIONS = 64;

export const FIND_ACTIONS_DEFINITION: ModelTool = {
  name: FIND_ACTIONS,
  description:
    'Searches the actions open to you for this person: every read and every change their role has on the screens and the Super Admin switched on, with what each does. Give English words (or the person\u2019s), such as "attendance of a lesson", "exemption", "move a student to another class". The actions found become tools you can call from your next step; call find_actions before you say you cannot do something.',
  parameters: {
    type: 'object',
    properties: {
      words: { type: 'string', description: 'What to do or read, in a few words.' },
    },
    required: ['words'],
  },
};

const NAME_VALUE: ToolParameterSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: { name: { type: 'string' }, value: { type: 'string' } },
    required: ['name', 'value'],
  },
};

/** The map's tools, as the model is given them. */
export const MAP_TOOL_DEFINITIONS: readonly ModelTool[] = [
  {
    name: FIND_IN_PLATFORM,
    description:
      'Searches the map of the platform: every page and each tab, panel, button, field and column on it, with its name on the screen in the person\u2019s language, what it does, the roles that see it and where it is. Words in Uzbek, Russian or English. Use it before saying the platform cannot do something, and to answer "where is", "what is" and "how do we".',
    parameters: {
      type: 'object',
      properties: { words: { type: 'string', description: 'The words to look for.' } },
      required: ['words'],
    },
  },
  {
    name: EXPLAIN_PLACE,
    description:
      'Gives one page, panel or control of the map in full: what it does, the roles that see it, and what is on it (the tabs, panels, buttons, fields and columns). Take the id from find_in_platform, or a page path such as /people/students.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'A map id or a page path.' } },
      required: ['id'],
    },
  },
  {
    name: LINK_PLACE,
    description:
      'Links the exact place for the person: a page of the map, with the values of its path (a journal\u2019s id) and of its address (open = the id of the record to open in the side panel, q = a search, tab, a date, f.<key> = a filter of a list). Only a page the person\u2019s role opens; only the parameters the map gives for that page.',
    parameters: {
      type: 'object',
      properties: {
        page: { type: 'string', description: 'The page path, such as /journal/$journalId.' },
        node: { type: 'string', description: 'The map id of the control or panel meant, if one.' },
        params: { ...NAME_VALUE, description: 'The path parameters, as name and value.' },
        search: { ...NAME_VALUE, description: 'The address values, as name and value.' },
      },
      required: ['page'],
    },
  },
];

/**
 * Task 11.14 (plan decision 1): the link to one lesson's journal column, for a step the
 * assistant never takes there ("mark everyone present"). Offered to a role whose list reads the
 * lesson card; the engine links only a lesson whose card the person's own read answers.
 */
export const OPEN_LESSON_JOURNAL = 'open_lesson_journal';

/** The read that proves the person may open the lesson's journal. */
export const LESSON_CARD_ROUTE = 'GET /api/journal/lessons/:lessonId/card';

interface ParameterSchema {
  type?: unknown;
  properties?: unknown;
  required?: unknown;
  additionalProperties?: unknown;
  nullable?: unknown;
  format?: unknown;
  pattern?: unknown;
  enum?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  minLength?: unknown;
  maxLength?: unknown;
  minItems?: unknown;
  maxItems?: unknown;
  items?: unknown;
  description?: unknown;
  /** A number given as a number or as its text (the grade of a report): the first is shown. */
  anyOf?: unknown;
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function asSchema(value: unknown): ParameterSchema {
  if (value === null || typeof value !== 'object') {
    return {};
  }
  // A body of several shapes (`oneOf` of a discriminated union, task 11.13) is read as `anyOf`.
  const { oneOf, ...rest } = value as ParameterSchema & { oneOf?: unknown };
  return oneOf === undefined || 'anyOf' in rest ? rest : { ...rest, anyOf: oneOf };
}

/** The schema the model reads: the type, enum and format; the long patterns are left to the check. */
export function modelSchemaOf(value: unknown, where: string): ToolParameterSchema {
  const schema = asSchema(value);
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const options = schema.anyOf.map(asSchema);
    // A number of a few values (a weekday): one schema with their enum.
    if (options.every((option) => option.type === 'number' && Array.isArray(option.enum))) {
      return {
        type: 'integer',
        enum: options.flatMap((option) => option.enum as number[]),
        ...(schema.nullable === true ? { nullable: true } : {}),
      };
    }
    if (options.some((option) => option.type === 'object')) {
      // A body of several shapes (task 11.13): each is given.
      return {
        anyOf: options.map((option, index) => modelSchemaOf(option, `${where}|${String(index)}`)),
      };
    }
    return modelSchemaOf(schema.anyOf[0], where);
  }
  const type = schema.type;
  if (type === 'object') {
    const properties: Record<string, ToolParameterSchema> = {};
    const shape =
      schema.properties !== null && typeof schema.properties === 'object' ? schema.properties : {};
    for (const [key, property] of Object.entries(shape)) {
      properties[key] = modelSchemaOf(property, `${where}.${key}`);
    }
    const required = Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === 'string')
      : [];
    return {
      type: 'object',
      properties,
      required,
      ...(schema.nullable === true ? { nullable: true } : {}),
    };
  }
  if (
    type !== 'string' &&
    type !== 'integer' &&
    type !== 'number' &&
    type !== 'boolean' &&
    type !== 'array'
  ) {
    throw new Error(`The parameter ${where} has a schema the assistant's tools do not take.`);
  }
  const out: ToolParameterSchema = { type };
  if (schema.nullable === true) {
    out.nullable = true;
  }
  if (
    Array.isArray(schema.enum) &&
    schema.enum.every((item) => typeof item === 'string' || typeof item === 'number')
  ) {
    out.enum = schema.enum;
  }
  if (typeof schema.format === 'string') {
    out.format = schema.format;
  }
  if (typeof schema.description === 'string') {
    out.description = schema.description;
  }
  if (type === 'array') {
    out.items = modelSchemaOf(schema.items, `${where}[]`);
  }
  return out;
}

/** The generated tool of a listed route. */
export function generatedOf(route: string): GeneratedTool {
  const generated = GENERATED_TOOLS[route];
  if (generated === undefined) {
    throw new Error(`${route} has no generated tool: run "pnpm api:client".`);
  }
  return generated;
}

/** The name of a route's tool: a read by its operation, a change as `propose_<operation>`. */
export function toolNameOf(route: string, line: AssistantRouteLine): string {
  const name = generatedOf(route).name;
  return line.kind === 'change' ? `${PROPOSE}${name}`.slice(0, 64) : name;
}

/**
 * The body of a change as the model may give it (task 11.13): the route's body with every field
 * that never goes to the model removed at any depth (`isRemovedKey`, the 11.12 field filter;
 * plan review must fix 4), every warning flag but the line's own (review correction 2), the
 * fields the basis gives, and on a line with `only` every other field.
 */
export function changeBodySchemaOf(
  route: string,
  line: AssistantChangeLine,
  filter: ModelFilter,
): unknown {
  const body = generatedOf(route).body;
  if (body === undefined) {
    return undefined;
  }
  const kept = new Set(line.keepsFlags ?? []);
  const top = (key: string): boolean =>
    (line.only === undefined || line.only.includes(key)) &&
    !(line.fromBasis ?? []).includes(key) &&
    key !== line.serverBase?.field &&
    (!WARNING_FLAGS.includes(key) || kept.has(key));
  const stripped = stripSchema(body, top, true, filter);
  const base = line.serverBase;
  if (base === undefined) {
    return stripped;
  }
  // Task 11.14 (plan decision 9): the field the server reads is never the model's; the tool
  // takes the fields that find the record instead.
  const schema = asSchema(stripped);
  const properties = { ...(schema.properties as Record<string, unknown>) };
  const required = Array.isArray(schema.required) ? [...(schema.required as string[])] : [];
  for (const [name, field] of Object.entries(base.toolFields)) {
    properties[name] = { type: 'string', format: 'uuid', description: field.description };
    if (field.required) required.push(name);
  }
  return { ...schema, properties, required };
}

function stripSchema(
  value: unknown,
  keep: (key: string) => boolean,
  top: boolean,
  filter: ModelFilter,
): unknown {
  const schema = asSchema(value);
  if (Array.isArray(schema.anyOf)) {
    return {
      ...schema,
      anyOf: schema.anyOf.map((option) => stripSchema(option, keep, top, filter)),
    };
  }
  if (schema.type === 'array') {
    return { ...schema, items: stripSchema(schema.items, keep, false, filter) };
  }
  if (
    schema.type !== 'object' ||
    schema.properties === null ||
    typeof schema.properties !== 'object'
  ) {
    return schema;
  }
  const properties: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(schema.properties)) {
    if (
      filter.removesKey(key) ||
      (top && !keep(key)) ||
      (!top && WARNING_FLAGS.includes(key))
    ) {
      continue;
    }
    properties[key] = stripSchema(property, keep, false, filter);
  }
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key) => typeof key === 'string' && key in properties)
    : undefined;
  return { ...schema, properties, ...(required === undefined ? {} : { required }) };
}

/**
 * The required fields of a change's body that the model is not given (never-fields only: a
 * warning flag or a basis field is never required). A listed change has none; a test holds it.
 */
export function requiredFieldsWithheld(route: string, filter: ModelFilter): string[] {
  const withheld: string[] = [];
  const walk = (value: unknown, where: string): void => {
    const schema = asSchema(value);
    if (Array.isArray(schema.anyOf)) {
      schema.anyOf.forEach((option) => {
        walk(option, where);
      });
      return;
    }
    if (schema.type === 'array') {
      walk(schema.items, `${where}[]`);
      return;
    }
    if (
      schema.type !== 'object' ||
      schema.properties === null ||
      typeof schema.properties !== 'object'
    ) {
      return;
    }
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const [key, property] of Object.entries(schema.properties)) {
      if (filter.removesKey(key)) {
        if (required.includes(key)) {
          withheld.push(`${where}.${key}`);
        }
        continue;
      }
      walk(property, `${where}.${key}`);
    }
  };
  walk(generatedOf(route).body, route);
  return withheld;
}

/**
 * The declaration of one action of the list, or `undefined` for an action with no tool yet (an
 * export, a file, a download: plan decision 7) or a change whose required body field the
 * filter withholds (a group switched off).
 */
export function toolOf(
  route: string,
  line: AssistantRouteLine,
  filter: ModelFilter,
): ModelTool | undefined {
  if (ASSISTANT_KINDS_WITHOUT_TOOL.includes(kindOfLine(line))) {
    return undefined;
  }
  if (line.kind === 'change' && requiredFieldsWithheld(route, filter).length > 0) {
    return undefined;
  }
  return toolsOfLines({ [route]: line }, filter, false)[0];
}

/** The tools of the chosen role: its reads and proposals, and the map's tools. */
export function toolsOf(lines: RoleLines, filter: ModelFilter): ModelTool[] {
  return toolsOfLines(lines, filter, true);
}

function toolsOfLines(lines: RoleLines, filter: ModelFilter, withExtras: boolean): ModelTool[] {
  const tools: ModelTool[] = [];
  for (const [route, line] of Object.entries(lines)) {
    if (ASSISTANT_KINDS_WITHOUT_TOOL.includes(kindOfLine(line))) {
      continue;
    }
    if (line.kind === 'change' && requiredFieldsWithheld(route, filter).length > 0) {
      continue;
    }
    const generated = generatedOf(route);
    // Task 11.20: a parameter of a group switched off (a search by phone) is not given; a
    // route that needs one has no tool while the group is off.
    if (generated.parameters.some((one) => one.required && filter.removesKey(one.name))) {
      continue;
    }
    const parameters: ToolArgumentsSchema = { type: 'object', properties: {}, required: [] };
    for (const parameter of generated.parameters.filter((one) => !filter.removesKey(one.name))) {
      parameters.properties[parameter.name] = modelSchemaOf(
        parameter.schema,
        `${route} ${parameter.name}`,
      );
      if (parameter.required) {
        parameters.required.push(parameter.name);
      }
    }
    if (line.kind === 'preview') {
      // A preview or check writes nothing (task 11.13): the model may ask it before proposing,
      // with the fields that never go to it removed as from a change.
      if (generated.body !== undefined) {
        parameters.properties[BODY_ARGUMENT] = modelSchemaOf(
          stripSchema(generated.body, (key) => !WARNING_FLAGS.includes(key), true, filter),
          `${route} body`,
        );
        parameters.required.push(BODY_ARGUMENT);
      }
      tools.push({
        name: generated.name,
        description: `Writes nothing: ${line.description}`,
        parameters,
      });
      continue;
    }
    if (line.kind === 'change') {
      const body = changeBodySchemaOf(route, line, filter);
      if (body !== undefined) {
        parameters.properties[BODY_ARGUMENT] = modelSchemaOf(body, `${route} body`);
        parameters.required.push(BODY_ARGUMENT);
      }
      parameters.properties[SUMMARY_ARGUMENT] = {
        type: 'string',
        description:
          'One sentence in the person’s language saying what this step changes, naming the records, dates and slots.',
      };
      parameters.required.push(SUMMARY_ARGUMENT);
      tools.push({
        name: toolNameOf(route, line),
        description: `Proposes, never makes: ${line.description} The step runs only if the person confirms.`,
        parameters,
      });
      continue;
    }
    tools.push({ name: generated.name, description: line.description, parameters });
  }
  if (!withExtras) {
    return tools;
  }
  if (Object.hasOwn(lines, LESSON_CARD_ROUTE)) {
    tools.push({
      name: OPEN_LESSON_JOURNAL,
      description:
        'Links the journal column of one lesson for the person, to look at it or to enter there what they prefer to type themselves.',
      parameters: {
        type: 'object',
        properties: { lessonId: { type: 'string', description: 'The id of the lesson.' } },
        required: ['lessonId'],
      },
    });
  }
  tools.push(...MAP_TOOL_DEFINITIONS, FIND_ACTIONS_DEFINITION);
  return tools;
}

/** The route and line of a tool name on the role's list, or `undefined`. */
export function routeOfTool(
  lines: RoleLines,
  toolName: string,
): { route: string; tool: GeneratedTool; line: AssistantRouteLine } | undefined {
  for (const [route, line] of Object.entries(lines)) {
    const generated = GENERATED_TOOLS[route];
    if (generated !== undefined && toolNameOf(route, line) === toolName) {
      return { route, tool: generated, line };
    }
  }
  return undefined;
}

/** Why one value does not pass its parameter's schema, or `undefined` when it does. */
export function valueFault(value: unknown, schemaIn: unknown): string | undefined {
  const schema = asSchema(schemaIn);
  if (value === null && schema.nullable === true) {
    return undefined;
  }
  if (Array.isArray(schema.anyOf)) {
    const faults = schema.anyOf.map((option) => valueFault(value, option));
    return faults.includes(undefined) ? undefined : faults[0];
  }
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'not an object';
    const shape =
      schema.properties !== null && typeof schema.properties === 'object' ? schema.properties : {};
    const record = value as Record<string, unknown>;
    for (const key of Array.isArray(schema.required) ? schema.required : []) {
      if (typeof key === 'string' && record[key] === undefined) return `${key} is required`;
    }
    for (const [key, item] of Object.entries(record)) {
      if (!Object.hasOwn(shape, key)) return `${key} is not a field`;
      if (item === undefined) continue;
      const fault = valueFault(item, (shape as Record<string, unknown>)[key]);
      if (fault !== undefined) return `${key} is ${fault}`;
    }
    return undefined;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return 'not a list';
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) return 'too short';
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return 'too long';
    for (const item of value) {
      const fault = valueFault(item, schema.items);
      if (fault !== undefined) return fault;
    }
    return undefined;
  }
  if (schema.type === 'integer' || schema.type === 'number') {
    const number =
      typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
    if (typeof number !== 'number' || !Number.isFinite(number)) return 'not a number';
    if (schema.type === 'integer' && !Number.isInteger(number)) return 'not a whole number';
    if (typeof schema.minimum === 'number' && number < schema.minimum) return 'too small';
    if (typeof schema.maximum === 'number' && number > schema.maximum) return 'too large';
    return undefined;
  }
  if (schema.type === 'boolean') {
    return value === true || value === false || value === 'true' || value === 'false'
      ? undefined
      : 'not true or false';
  }
  if (typeof value !== 'string') return 'not a text';
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return 'not one of the values';
  if (schema.format === 'uuid' && !UUID.test(value)) return 'not an id';
  if (schema.format === 'date' && !DATE.test(value)) return 'not a date';
  if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) {
    return 'not of the expected form';
  }
  if (typeof schema.minLength === 'number' && value.length < schema.minLength) return 'too short';
  if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return 'too long';
  return undefined;
}

/**
 * The URL of a read, from the model's arguments, or why it is not sent (plan review, must fix
 * 1): only the tool's own parameters, each passing its schema; a path value is an id or one
 * value of an enum by then, so `..` or a `/` never reaches the path.
 */
export function urlOf(
  tool: GeneratedTool,
  args: Record<string, unknown>,
): { url: string } | { fault: string } {
  const known = new Map(tool.parameters.map((parameter) => [parameter.name, parameter]));
  for (const name of Object.keys(args)) {
    if (!known.has(name)) {
      return { fault: `${name} is not a parameter of this tool` };
    }
  }
  let path = tool.path;
  const query = new URLSearchParams();
  for (const parameter of tool.parameters) {
    const value = args[parameter.name];
    if (value === undefined || value === null) {
      if (parameter.required) return { fault: `${parameter.name} is required` };
      continue;
    }
    const fault = valueFault(value, parameter.schema);
    if (fault !== undefined) {
      return { fault: `${parameter.name} is ${fault}` };
    }
    if (parameter.in === 'path') {
      if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
        return { fault: `${parameter.name} is not of the expected form` };
      }
      path = path.replace(`:${parameter.name}`, value);
    } else {
      for (const item of Array.isArray(value) ? value : [value]) {
        query.append(parameter.name, String(item));
      }
    }
  }
  const text = query.toString();
  return { url: text === '' ? path : `${path}?${text}` };
}

/** The words of one map page or control that calls an operation, in the three languages. */
const MAP_WORDS_OF_OPERATION: ReadonlyMap<string, string> = (() => {
  const words = new Map<string, string[]>();
  const add = (operations: readonly string[], label: Readonly<Record<Language, string>>): void => {
    for (const operation of operations) {
      const list = words.get(operation) ?? [];
      list.push(label.uz, label.ru, label.en);
      words.set(operation, list);
    }
  };
  for (const page of PLATFORM_MAP.pages) add(page.operations, page.title);
  for (const node of PLATFORM_MAP.nodes) {
    if (node.label !== null) add(node.operations, node.label);
  }
  return new Map([...words].map(([operation, list]) => [operation, list.join(' ').toLowerCase()]));
})();

/** The words of a text, folded for a search: lower case, letters and digits. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3);
}

/**
 * `find_actions` (plan decision 10): the switched-on actions of the list that match the words,
 * best first: each word counted in the description, the route, the operation and the labels of
 * the map's pages and controls that call it (Uzbek, Russian and English).
 */
export function findActions(
  lines: RoleLines,
  text: string,
): { route: string; tool: string; kind: string; description: string }[] {
  const words = wordsOf(text);
  if (words.length === 0) return [];
  const scored: { route: string; score: number; line: AssistantRouteLine }[] = [];
  for (const [route, line] of Object.entries(lines)) {
    if (ASSISTANT_KINDS_WITHOUT_TOOL.includes(kindOfLine(line))) continue;
    const generated = GENERATED_TOOLS[route];
    if (generated === undefined) continue;
    const haystack = [
      line.description.toLowerCase(),
      route.toLowerCase(),
      generated.name.toLowerCase(),
      MAP_WORDS_OF_OPERATION.get(generated.name) ?? '',
    ].join(' ');
    let score = 0;
    for (const word of words) {
      // A word's stem: its first five letters, so "cancel" finds "cancels" and "cancelled".
      const stem = word.length > 5 ? word.slice(0, 5) : word;
      if (haystack.includes(word)) score += 2;
      else if (haystack.includes(stem)) score += 1;
    }
    if (score > 0) scored.push({ route, score, line });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.route.localeCompare(b.route))
    .slice(0, FIND_ACTIONS_LIMIT)
    .map(({ route, line }) => ({
      route,
      tool: toolNameOf(route, line),
      kind: kindOfLine(line),
      description: line.description,
    }));
}

/** The routes whose operations a page of the map calls (the page the person is on). */
export function routesOfPage(lines: RoleLines, page: string | undefined): string[] {
  if (page === undefined) return [];
  const found = PLATFORM_MAP.pages.find((one) => one.path === page);
  if (found === undefined) return [];
  const operations = new Set(found.operations);
  return Object.keys(lines).filter((route) => {
    const generated = GENERATED_TOOLS[route];
    return generated !== undefined && operations.has(generated.name);
  });
}
