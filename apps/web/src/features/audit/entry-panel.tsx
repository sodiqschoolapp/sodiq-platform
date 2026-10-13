import { isAuditAction, type AuditEntryAnswer } from '@sodiq/shared';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ParseKeys, TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useView } from '@/features/access/use-view';
import { formatMoment } from '@/features/auth/moments';
import { showEntry } from './audit-api';
import { codesOf, fieldLabel, fieldsTypeOf } from './field-labels';

/** The name of an action on the screen; an action the list does not hold shows as stored. */
export function actionName(t: TFunction, action: string): string {
  return isAuditAction(action) ? t(`audit.actions.${action}`) : action;
}

const RECORD_TYPES = [
  'student',
  'staff',
  'relative',
  'account',
  'session',
  'assignment',
  'branch',
  'building',
  'floor',
  'room',
  'division',
  'department',
  'subject',
  'academic_year',
  'calendar_entry',
  'slot_type',
  'day_template',
  'vacancy',
  'audit_entry',
] as const;

/** The name of a kind of record; a kind the list does not hold shows as stored. */
export function recordTypeName(t: TFunction, type: string): string {
  const known = RECORD_TYPES.find((one) => one === type);
  return known === undefined ? type : t(`audit.recordTypes.${known}`);
}

/** Every value of a stored JSON by its dotted path; arrays and plain values are leaves. */
function leaves(value: unknown, path: string, into: Map<string, unknown>): void {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, inner] of Object.entries(value)) {
      leaves(inner, path === '' ? key : `${path}.${key}`, into);
    }
    return;
  }
  if (path !== '') {
    into.set(path, value);
  }
}

function leavesOf(value: unknown): Map<string, unknown> {
  const found = new Map<string, unknown>();
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    leaves(value, '', found);
  } else if (value !== null && value !== undefined) {
    found.set('', value);
  }
  return found;
}

/**
 * One entry of the log in the side panel (task 2.6a): who acted, with the
 * role of the assignment that allowed it, about whom, the record, the reason,
 * the old and new values field by field with the labels of the record's form
 * (correction 2), the details (an export's list, filters and row count), and
 * the logged "Show" of the values hidden from this reader (decision 6).
 */
export function EntryPanel({ entry }: { entry: AuditEntryAnswer }) {
  const { t, i18n } = useTranslation();
  const { branches } = useView();
  const [shown, setShown] = useState<AuditEntryAnswer | null>(null);
  const show = useMutation({
    mutationFn: () => showEntry(entry.id),
    onSuccess: (answer) => {
      setShown(answer);
    },
  });
  const current = shown ?? entry;
  const hidden = new Set(current.hidden);
  const type = fieldsTypeOf(current.action, current.record?.type ?? null);

  const labelOf = (path: string, kind: 'oldValue' | 'newValue' | 'details'): string => {
    if (path === '') {
      return t(
        kind === 'oldValue'
          ? 'audit.before'
          : kind === 'newValue'
            ? 'audit.after'
            : 'audit.details',
      );
    }
    return path
      .split('.')
      .map((segment) => {
        const label = fieldLabel(type, segment);
        if (label !== undefined) {
          return t(label);
        }
        return /^\d+$/.test(segment) ? String(Number(segment) + 1) : segment;
      })
      .join(' › ');
  };

  const valueOf = (value: unknown, path: string): string => {
    if (hidden.has(path)) {
      return t('audit.hidden');
    }
    if (value === null || value === undefined || value === '') {
      return t('audit.emptyValue');
    }
    if (typeof value === 'boolean') {
      return value ? t('audit.yes') : t('audit.no');
    }
    if (typeof value === 'string') {
      // A stored code (a sex, a role, a relationship) in the language of the page.
      const codes = codesOf(type, path.split('.').at(-1) ?? '');
      const key = codes === undefined ? undefined : `${codes}.${value}`;
      // The key is read only after i18n says it exists, so the cast names a real text.
      return key !== undefined && i18n.exists(key) ? t(key as ParseKeys) : value;
    }
    if (typeof value === 'number') {
      return String(value);
    }
    if (Array.isArray(value) && value.every((item) => typeof item !== 'object' || item === null)) {
      return value.map((item) => (item === null ? t('audit.emptyValue') : String(item))).join(', ');
    }
    return JSON.stringify(value);
  };

  const before = leavesOf(current.oldValue);
  const after = leavesOf(current.newValue);
  const paths = [...new Set([...before.keys(), ...after.keys()])];
  const details = leavesOf(current.details);
  const branch =
    current.branchId === null
      ? t('audit.schoolWide')
      : (branches.find((one) => one.id === current.branchId)?.name ?? null);

  const terms: [string, string][] = [
    [t('audit.when'), formatMoment(i18n.language, current.occurredAt)],
    [t('audit.action'), actionName(t, current.action)],
    [
      t('audit.by'),
      current.actor === null ? t('audit.system') : (current.actor.name ?? t('audit.unnamed')),
    ],
    ...(current.assignment === null
      ? []
      : [[t('audit.as'), t(`roles.${current.assignment.role}`)] as [string, string]]),
    ...(current.person === null
      ? []
      : [[t('audit.about'), current.person.name ?? t('audit.unnamed')] as [string, string]]),
    ...(current.record === null
      ? []
      : [
          [
            t('audit.record'),
            [recordTypeName(t, current.record.type), current.record.name]
              .filter((part) => part !== null)
              .join(': '),
          ] as [string, string],
        ]),
    ...(branch === null ? [] : [[t('audit.branch'), branch] as [string, string]]),
    ...(current.reason === null ? [] : [[t('audit.reason'), current.reason] as [string, string]]),
  ];

  return (
    <div className="grid gap-6">
      <dl className="grid gap-2 text-sm">
        {terms.map(([term, value]) => (
          <div key={term} className="grid gap-0.5">
            <dt className="text-muted-foreground">{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {paths.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('audit.field')}</TableHead>
              <TableHead>{t('audit.before')}</TableHead>
              <TableHead>{t('audit.after')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paths.map((path) => (
              <TableRow key={path}>
                <TableCell className="text-muted-foreground">{labelOf(path, 'newValue')}</TableCell>
                <TableCell className="break-all">
                  {before.has(path)
                    ? valueOf(before.get(path), `oldValue${path === '' ? '' : `.${path}`}`)
                    : ''}
                </TableCell>
                <TableCell className="break-all">
                  {after.has(path)
                    ? valueOf(after.get(path), `newValue${path === '' ? '' : `.${path}`}`)
                    : ''}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {details.size > 0 && (
        <section className="grid gap-2">
          <h3 className="text-base font-semibold">{t('audit.details')}</h3>
          <dl className="grid gap-2 text-sm">
            {[...details.entries()].map(([path, value]) => (
              <div key={path} className="grid gap-0.5">
                <dt className="text-muted-foreground">{labelOf(path, 'details')}</dt>
                <dd className="break-all">
                  {valueOf(value, `details${path === '' ? '' : `.${path}`}`)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {current.hidden.length > 0 && (
        <div className="grid justify-items-start gap-2">
          <Button
            variant="secondary"
            disabled={show.isPending}
            onClick={() => {
              show.mutate();
            }}
          >
            {t('audit.show')}
          </Button>
          <FailureAlert error={show.error} />
        </div>
      )}

      {current.record !== null && (
        <Link
          to="/audit"
          search={{ recordType: current.record.type, recordId: current.record.id }}
          className="font-semibold text-link underline-offset-4 hover:underline"
        >
          {t('audit.allOfRecord')}
        </Link>
      )}
    </div>
  );
}
