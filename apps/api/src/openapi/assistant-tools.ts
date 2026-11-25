import { ROUTE_LINES } from '../modules/access/assistant-routes.js';
import type { GeneratedTool, GeneratedParameter } from '../modules/assistant/tools.js';

/**
 * Task 11.12 (build plan: "tools generated from the OpenAPI operations on a list fixed in code
 * per role"): `pnpm api:client` writes `src/modules/assistant/tools.generated.ts` from
 * `openapi.generated.json`, one entry per route with a line (task 11.20: every route a role of the assistant holds), with the route's path and query
 * parameters as the OpenAPI document gives them. `assistant-tools.test.ts` fails when the file
 * is not what this writes.
 */
export const ASSISTANT_TOOLS_FILE = 'src/modules/assistant/tools.generated.ts';

interface DocumentParameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: unknown;
  description?: string;
}

interface DocumentOperation {
  operationId?: string;
  parameters?: DocumentParameter[];
  requestBody?: { content?: Record<string, { schema?: unknown }> };
}

export interface ToolsDocument {
  paths: Record<string, Partial<Record<string, DocumentOperation>>>;
}

/** The Express name `/api/classes/:id` as an OpenAPI path `/api/classes/{id}`. */
function openApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/** The tools of every route on a list, by route name, in the order of the names. */
export function assistantToolsOf(document: ToolsDocument): Record<string, GeneratedTool> {
  const names = Object.keys(ROUTE_LINES).sort();
  const tools: Record<string, GeneratedTool> = {};
  for (const name of names) {
    const space = name.indexOf(' ');
    const method = name.slice(0, space);
    const path = name.slice(space + 1);
    const operation = document.paths[openApiPath(path)]?.[method.toLowerCase()];
    if (operation?.operationId === undefined) {
      throw new Error(
        `${name} is on an assistant list and has no operation in the OpenAPI document.`,
      );
    }
    const parameters: GeneratedParameter[] = (operation.parameters ?? [])
      .filter((parameter) => parameter.in === 'path' || parameter.in === 'query')
      .map((parameter) => ({
        name: parameter.name,
        in: parameter.in === 'path' ? 'path' : 'query',
        required: parameter.required === true || parameter.in === 'path',
        schema: parameter.schema ?? {},
      }));
    const body = operation.requestBody?.content?.['application/json']?.schema;
    tools[name] = {
      name: operation.operationId.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64),
      method,
      path,
      parameters,
      // Task 11.13: the body of a change or a preview, as the OpenAPI document gives it.
      ...(method === 'GET' || body === undefined ? {} : { body }),
    };
  }
  return tools;
}

/** The text of `tools.generated.ts`. */
export function renderAssistantTools(document: ToolsDocument): string {
  return [
    '// Written by `pnpm api:client` from openapi.generated.json (src/openapi/assistant-tools.ts).',
    '// Do not edit: `assistant-tools.test.ts` fails when this is not what it writes.',
    "import type { GeneratedTool } from './tools.js';",
    '',
    `export const GENERATED_TOOLS: Readonly<Record<string, GeneratedTool>> = ${JSON.stringify(assistantToolsOf(document), null, 2)};`,
    '',
  ].join('\n');
}
