import { z } from 'zod';
import { ROLES } from './roles.js';

/**
 * The map of the platform (task 11.19; docs/spec/02-roles-and-access.md, Assistant, "Knows the
 * platform"): every staff page of the web app and each tab, panel, button, field and column on
 * it, with its label in the three languages, the roles that see it, the API operations it calls
 * and the address that opens it. Generated from the web app's code by `pnpm assistant:map`
 * into `apps/api/src/modules/assistant/platform-map.generated.json`; read by the assistant's
 * map tools only.
 */

export const PLATFORM_MAP_KINDS = ['page', 'tab', 'panel', 'button', 'field', 'column'] as const;

export type PlatformMapKind = (typeof PLATFORM_MAP_KINDS)[number];

const labelSchema = z.strictObject({ uz: z.string(), ru: z.string(), en: z.string() });

export type PlatformMapLabel = z.infer<typeof labelSchema>;

/** How a path parameter or a search value of an address is checked. */
export const platformValueKindSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('id') }),
  z.strictObject({ kind: z.literal('date') }),
  z.strictObject({ kind: z.literal('month') }),
  z.strictObject({ kind: z.literal('text') }),
  z.strictObject({ kind: z.literal('number') }),
  z.strictObject({ kind: z.literal('boolean') }),
  z.strictObject({ kind: z.literal('record') }),
  z.strictObject({ kind: z.literal('enum'), values: z.array(z.string()).min(1) }),
]);

export type PlatformValueKind = z.infer<typeof platformValueKindSchema>;

const roleSchema = z.enum(ROLES);

export const platformMapPageSchema = z.strictObject({
  /** `page:/journal/$journalId`. */
  id: z.string(),
  /** The route's template, as the router names it. */
  path: z.string(),
  title: labelSchema,
  roles: z.array(roleSchema),
  params: z.record(z.string(), platformValueKindSchema),
  search: z.record(z.string(), platformValueKindSchema),
  /** The API operations the page's files call, by operation id. */
  operations: z.array(z.string()),
  description: z.string().min(1),
});

export type PlatformMapPage = z.infer<typeof platformMapPageSchema>;

export const platformMapNodeSchema = z.strictObject({
  /** `features/people/student-panel.tsx#button:people.students.archive`. */
  id: z.string(),
  kind: z.enum(PLATFORM_MAP_KINDS).exclude(['page']),
  /** The label as the person sees it; `null` for a record's panel, named by the record. */
  label: labelSchema.nullable(),
  /** The pages that draw it, by path; `*` for the shell, drawn on every page. */
  pages: z.array(z.string()).min(1),
  /** The panel or dialog it is inside, by id. */
  parent: z.string().nullable(),
  roles: z.array(roleSchema),
  /** The API operation it calls, when the map names one. */
  operation: z.string().nullable(),
  description: z.string().min(1),
});

export type PlatformMapNode = z.infer<typeof platformMapNodeSchema>;

export const platformMapSchema = z.strictObject({
  pages: z.array(platformMapPageSchema),
  nodes: z.array(platformMapNodeSchema),
});

export type PlatformMap = z.infer<typeof platformMapSchema>;

/** The page path of the shell's controls (the top bar, the menu), drawn on every page. */
export const PLATFORM_SHELL = '*';
