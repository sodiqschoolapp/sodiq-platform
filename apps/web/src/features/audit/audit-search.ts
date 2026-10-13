import {
  AUDIT_GROUPS,
  AUDIT_PERSON_KINDS,
  AUDIT_SCOPES,
  type AuditGroup,
  type AuditPersonKind,
  type AuditScope,
} from '@sodiq/shared';
import { listSearch, type ListSearch } from '@/components/list/list-state';

/** The search the server answers (task 2.6a, decision 5): beside the list state of the address. */
export interface AuditFilters {
  /** `staff:<id>`, `student:<id>` or `relative:<id>`. */
  person?: string;
  recordType?: string;
  recordId?: string;
  from?: string;
  to?: string;
  group?: AuditGroup;
  scope?: AuditScope;
}

/** The kind of person chosen before the person: the page only, never sent. */
export type AuditSearch = ListSearch & AuditFilters & { personKind?: AuditPersonKind };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PERSON = new RegExp(`^(${AUDIT_PERSON_KINDS.join('|')}):${UUID}$`, 'i');
const RECORD_ID = new RegExp(`^${UUID}$`, 'i');
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** `validateSearch` of the Audit log page: the list state and the filters the server reads. */
export function auditSearch(search: Record<string, unknown>): AuditSearch {
  const result: AuditSearch = listSearch(search);
  const person = text(search.person);
  if (person !== undefined && PERSON.test(person)) {
    result.person = person.toLowerCase();
  }
  const personKind = AUDIT_PERSON_KINDS.find((one) => one === search.personKind);
  if (result.person === undefined && personKind !== undefined) {
    result.personKind = personKind;
  }
  const recordType = text(search.recordType);
  const recordId = text(search.recordId);
  if (
    recordType !== undefined &&
    /^[a-z_]{1,40}$/.test(recordType) &&
    recordId !== undefined &&
    RECORD_ID.test(recordId)
  ) {
    result.recordType = recordType;
    result.recordId = recordId.toLowerCase();
  }
  for (const key of ['from', 'to'] as const) {
    const date = text(search[key]);
    if (date !== undefined && DATE.test(date)) {
      result[key] = date;
    }
  }
  const group = AUDIT_GROUPS.find((one) => one === search.group);
  if (group !== undefined) {
    result.group = group;
  }
  const scope = AUDIT_SCOPES.find((one) => one === search.scope);
  if (scope !== undefined && scope !== 'branch') {
    result.scope = scope;
  }
  return result;
}

/** The filters of a search, without the list state. */
export function filtersOf(search: AuditSearch): AuditFilters {
  const { person, recordType, recordId, from, to, group, scope } = search;
  return Object.fromEntries(
    Object.entries({ person, recordType, recordId, from, to, group, scope }).filter(
      ([, value]) => value !== undefined,
    ),
  );
}

/** The person of a search, split. */
export function personOf(
  person: string | undefined,
): { kind: AuditPersonKind; id: string } | undefined {
  if (person === undefined) {
    return undefined;
  }
  const [kind, id] = person.split(':');
  const known = AUDIT_PERSON_KINDS.find((one) => one === kind);
  return known === undefined || id === undefined ? undefined : { kind: known, id };
}
