import type { AssistantRole } from '@sodiq/shared';
import { MENU_ITEMS } from '@sodiq/shared';
import { assistantRoutesOf } from '../access/assistant-routes.js';
import type { ModelTool, ToolArgumentsSchema, ToolParameterSchema } from './model.js';
import { GENERATED_TOOLS } from './tools.generated.js';

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
}

/** The virtual tool that names a page of the menu (plan decision 16). */
export const SUGGEST_PAGE = 'suggest_page';

interface ParameterSchema {
  type?: unknown;
  format?: unknown;
  pattern?: unknown;
  enum?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  minLength?: unknown;
  maxLength?: unknown;
  items?: unknown;
  description?: unknown;
  /** A number given as a number or as its text (the grade of a report): the first is shown. */
  anyOf?: unknown;
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function asSchema(value: unknown): ParameterSchema {
  return value !== null && typeof value === 'object' ? value : {};
}

/** The schema the model reads: the type, enum and format; the long patterns are left to the check. */
export function modelSchemaOf(value: unknown, where: string): ToolParameterSchema {
  const schema = asSchema(value);
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return modelSchemaOf(schema.anyOf[0], where);
  }
  const type = schema.type;
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
  if (Array.isArray(schema.enum) && schema.enum.every((item) => typeof item === 'string')) {
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

/** The tools of a role: its routes, and `suggest_page` with the pages it may open. */
export function toolsOf(role: AssistantRole, pages: readonly string[]): ModelTool[] {
  const lines = assistantRoutesOf(role);
  const tools: ModelTool[] = Object.entries(lines).map(([route, line]) => {
    const generated = GENERATED_TOOLS[route];
    if (generated === undefined) {
      throw new Error(`${route} has no generated tool: run "pnpm api:client".`);
    }
    const parameters: ToolArgumentsSchema = { type: 'object', properties: {}, required: [] };
    for (const parameter of generated.parameters) {
      parameters.properties[parameter.name] = modelSchemaOf(
        parameter.schema,
        `${route} ${parameter.name}`,
      );
      if (parameter.required) {
        parameters.required.push(parameter.name);
      }
    }
    return { name: generated.name, description: line.description, parameters };
  });
  tools.push({
    name: SUGGEST_PAGE,
    description:
      'Links a page of the platform for the person, for a step the assistant does not take (an export, a change, a password).',
    parameters: {
      type: 'object',
      properties: {
        page: {
          type: 'string',
          enum: pages.filter((page) => MENU_ITEMS.some((item) => item === page)),
        },
      },
      required: ['page'],
    },
  });
  return tools;
}

/** The route of a tool name on the role's list, or `undefined`. */
export function routeOfTool(role: AssistantRole, toolName: string): GeneratedTool | undefined {
  for (const route of Object.keys(assistantRoutesOf(role))) {
    const generated = GENERATED_TOOLS[route];
    if (generated?.name === toolName) {
      return generated;
    }
  }
  return undefined;
}

/** Why one value does not pass its parameter's schema, or `undefined` when it does. */
function valueFault(value: unknown, schemaIn: unknown): string | undefined {
  const schema = asSchema(schemaIn);
  if (Array.isArray(schema.anyOf)) {
    const faults = schema.anyOf.map((option) => valueFault(value, option));
    return faults.includes(undefined) ? undefined : faults[0];
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return 'not a list';
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
