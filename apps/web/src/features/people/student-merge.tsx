import {
  classDisplayName,
  studentMergePreviewSchema,
  studentMergeResultSchema,
  studentMergeSchema,
  studentUidSchema,
  type ErrorCode,
  type StudentDetail,
  type StudentMerge,
  type StudentMergePreview,
  type StudentMergeResult,
  type StudentMergeField,
  type StudentMergeSide,
} from '@sodiq/shared';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
import { failureText } from '@/api/failure-text';
import { useConfirm } from '@/components/confirm-dialog';
import { Field, TextAreaField } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { SaveCancelled } from '@/components/form/save-cancelled';
import { useRecordForm } from '@/components/form/use-record-form';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { SECTION_TITLE, SUBSECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { schoolDateText } from '@/lib/dates';
import { asFormSchema } from './form-schema';
import { studentStatusText } from './status-cause';
import { studentsKey } from './people-api';
import { useJournalEntries } from './journal-entries';

/**
 * The merge of two student records (`edge/students-classes-groups`, "The
 * Super Admin can merge two records; the older UID survives"; task 3.3d,
 * pull request #98): in the side panel of a student, for a reader the
 * server lets merge (`canMerge`). The other record is named by its UID; the
 * preview says which record stays, the status after the merge, the rows cut
 * or left behind, the fields filled and the values that differ, or why the
 * merge is refused. The merge sends the preview's digest back, so a change
 * made meanwhile answers "student changed, reload".
 */

/** Whether the panel's form key is the merge form. */
export const isMergeForm = (key: string | null): boolean => key === 'merge';

const previewQuery = (branchId: string | null, id: string, uid: string) =>
  queryOptions({
    queryKey: [...studentsKey(branchId), 'merge', id, uid],
    queryFn: async () =>
      studentMergePreviewSchema.parse(
        await answerOf(
          api.GET('/api/people/students/{id}/merge', {
            params: { header: branchHeader(), path: { id }, query: { uid } },
          }),
        ),
      ),
    enabled: branchId !== null && uid !== '',
    // A preview is read again each time it is asked for: its digest is the
    // state the merge compares (correction 3).
    gcTime: 0,
    staleTime: 0,
  });

/**
 * A value the merge names (a filled field, a differing value, a value on the
 * report), with a stored code by its name (`.claude/rules/web.md`): the sex,
 * the region, the document type; dates as dates.
 */
export function mergeValueText(
  t: TFunction,
  language: string,
  field: StudentMergeField,
  value: string,
): string {
  switch (field) {
    case 'sex':
      return t(`people.staff.sexes.${value}` as 'people.staff.sexes.male');
    case 'region':
      return t(`people.students.regions.${value}` as 'people.students.regions.other');
    case 'document': {
      const [type = '', ...number] = value.split(' ');
      return [
        t(`people.students.documentTypes.${type}` as 'people.students.documentTypes.passport'),
        ...number,
      ].join(' ');
    }
    case 'birthDate':
    case 'consentSignedOn':
      return schoolDateText(value, language);
    default:
      return value;
  }
}

/** The text of the History tab's line of a record merged into this one. */
export function mergedLineText(t: TFunction, line: { uid: string; reason: string }): string {
  return t('people.students.merge.historyLine', { uid: line.uid, reason: line.reason });
}

/** The Overview's line of the UIDs of the records merged into this one ("Also UID ..."). */
export function alsoUidRow(t: TFunction, student: StudentDetail): [string, string][] {
  return student.mergedUids.length === 0
    ? []
    : [[t('people.students.merge.alsoUid'), student.mergedUids.join(', ')]];
}

function SideOf({ title, side }: { title: string; side: StudentMergeSide }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="grid gap-1 text-sm">
      <span className="text-muted-foreground">{title}</span>
      <span>
        {t('people.students.merge.side', {
          name: `${side.lastName} ${side.firstName}`,
          uid: side.uid,
          branch: side.branch.name,
        })}
      </span>
      <span>{studentStatusText(t, side, side.today, i18n.language)}</span>
      <span>
        {side.class === null
          ? t('people.students.noClass')
          : t('people.students.merge.sideClass', {
              class: classDisplayName(side.class.grade, side.class.name),
            })}
      </span>
    </div>
  );
}

/** What the merge would do, as the preview answers it. */
function PreviewOf({ preview, branchId }: { preview: StudentMergePreview; branchId: string }) {
  const { t, i18n } = useTranslation();
  const date = (day: string) => schoolDateText(day, i18n.language);
  const statusName = (status: string) =>
    t(`people.students.statuses.${status}` as 'people.students.statuses.active');
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <SideOf title={t('people.students.merge.kept')} side={preview.kept} />
        <SideOf title={t('people.students.merge.merged')} side={preview.merged} />
      </div>
      {preview.branch.id !== branchId && (
        <p className="text-sm">
          {t('people.students.merge.branchAfter', { branch: preview.branch.name })}
        </p>
      )}
      {preview.refusal !== null ? (
        <div role="alert" className="grid gap-1 text-sm">
          <span>{t('people.students.merge.refused')}</span>
          <span>{failureText(t, new ApiFailure(preview.refusal.code as ErrorCode))}</span>
          {preview.refusal.day !== null && (
            <span>
              {t('people.students.merge.refusedDay', { date: date(preview.refusal.day) })}
            </span>
          )}
        </div>
      ) : (
        <>
          <section className="grid gap-1 text-sm">
            <h4 className={SUBSECTION_TITLE}>{t('people.students.merge.life')}</h4>
            <ul className="grid gap-1">
              {preview.life.map((stretch) => (
                <li key={`${stretch.from}-${stretch.side}`}>
                  {stretch.until === null
                    ? t('people.students.merge.stretchOpen', {
                        status: statusName(stretch.status),
                        from: date(stretch.from),
                      })
                    : t('people.students.merge.stretch', {
                        status: statusName(stretch.status),
                        from: date(stretch.from),
                        until: date(stretch.until),
                      })}
                </li>
              ))}
            </ul>
          </section>
          {preview.rows.length > 0 && (
            <section className="grid gap-1 text-sm">
              <h4 className={SUBSECTION_TITLE}>{t('people.students.merge.rows')}</h4>
              <ul className="grid gap-1">
                {preview.rows.map((row, index) => {
                  const name = row.kind === 'status' ? statusName(row.name) : row.name;
                  return (
                    <li key={`${row.kind}-${row.from}-${String(index)}`}>
                      {row.action === 'cut' && row.cutAt !== null
                        ? t('people.students.merge.rowCut', {
                            name,
                            from: date(row.from),
                            cutAt: date(row.cutAt),
                          })
                        : t('people.students.merge.rowLeft', { name, from: date(row.from) })}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <p className="text-sm">
            {t('people.students.merge.carried', { count: preview.carried })}
          </p>
          {preview.filled.length > 0 && (
            <p className="text-sm">
              {t('people.students.merge.filled')}:{' '}
              {preview.filled.map((field) => t(`people.students.merge.fields.${field}`)).join(', ')}
            </p>
          )}
          <DifferingValues preview={preview} />
        </>
      )}
    </div>
  );
}

/**
 * The values that differ between the two records and the one kept (task
 * 3.5b, H29 of issue #105): the personal fields, the start date, the grade,
 * the scholarship, the contracts and the relatives, each of the record that
 * stays and of the merged record, and what the merge keeps.
 */
function DifferingValues({ preview }: { preview: StudentMergePreview }) {
  const { t, i18n } = useTranslation();
  const date = (day: string) => schoolDateText(day, i18n.language);
  const { values } = preview;
  const rows: { key: string; text: string }[] = [];
  const row = (key: string, field: string, kept: string, merged: string, result: string) => {
    rows.push({ key, text: t('people.students.merge.differs', { field, kept, merged, result }) });
  };
  for (const one of preview.differing) {
    const kept = mergeValueText(t, i18n.language, one.field, one.kept);
    row(
      one.field,
      t(`people.students.merge.fields.${one.field}`),
      kept,
      mergeValueText(t, i18n.language, one.field, one.merged),
      kept,
    );
  }
  const fieldName = (key: 'startsOn' | 'grade' | 'scholarship' | 'contracts' | 'relatives') =>
    t(`people.students.merge.valueFields.${key}`);
  if (values.startsOn.kept !== values.startsOn.merged && values.startsOn.result !== null) {
    row(
      'startsOn',
      fieldName('startsOn'),
      date(values.startsOn.kept),
      date(values.startsOn.merged),
      date(values.startsOn.result),
    );
  }
  const later = <T,>(pair: { kept: T; merged: T }): T =>
    values.later === 'merged' ? pair.merged : pair.kept;
  if (values.grade.kept !== values.grade.merged) {
    const grade = (n: number) => t('setup.subjects.grade', { grade: n });
    row(
      'grade',
      fieldName('grade'),
      grade(values.grade.kept),
      grade(values.grade.merged),
      grade(later(values.grade)),
    );
  }
  const scholarship = (one: StudentMergePreview['values']['scholarship']['kept']) =>
    [
      t(`people.students.scholarshipTypes.${one.type}`),
      ...(one.coverage === null ? [] : [t(`people.students.scholarshipCoverages.${one.coverage}`)]),
      ...(one.amount === null ? [] : [new Intl.NumberFormat(i18n.language).format(one.amount)]),
    ].join(', ');
  const scholarshipKept = scholarship(values.scholarship.kept);
  const scholarshipMerged = scholarship(values.scholarship.merged);
  if (scholarshipKept !== scholarshipMerged) {
    row(
      'scholarship',
      fieldName('scholarship'),
      scholarshipKept,
      scholarshipMerged,
      scholarship(later(values.scholarship)),
    );
  }
  const listOf = (texts: readonly string[]) =>
    texts.length === 0 ? t('people.students.merge.noValue') : texts.join(', ');
  const contractsOf = (side: 'kept' | 'merged') =>
    values.contracts
      .filter((one) => one.side === side)
      .map((one) =>
        t('people.students.merge.contractText', { number: one.number, date: date(one.signedOn) }),
      );
  if (contractsOf('merged').length > 0) {
    row(
      'contracts',
      fieldName('contracts'),
      listOf(contractsOf('kept')),
      listOf(contractsOf('merged')),
      t('people.students.merge.allKept'),
    );
  }
  const relativeText = (one: StudentMergePreview['values']['relatives'][number]) =>
    t('people.students.merge.relativeText', {
      name: one.fullName,
      relationship: t(`people.relatives.relationships.${one.relationship}`),
    });
  const relativesOf = (side: 'kept' | 'merged') =>
    values.relatives.filter((one) => one.side === side);
  const added = relativesOf('merged').filter((one) => one.fate === 'added');
  if (added.length > 0) {
    row(
      'relatives',
      fieldName('relatives'),
      listOf(relativesOf('kept').map(relativeText)),
      listOf(relativesOf('merged').map(relativeText)),
      listOf([...relativesOf('kept'), ...added].map(relativeText)),
    );
  }
  const already = relativesOf('merged').filter((one) => one.fate === 'already_linked');
  if (rows.length === 0 && already.length === 0) {
    return null;
  }
  return (
    <section className="grid gap-1 text-sm">
      <h4 className={SUBSECTION_TITLE}>{t('people.students.merge.differing')}</h4>
      <ul className="grid gap-1">
        {rows.map((one) => (
          <li key={one.key}>{one.text}</li>
        ))}
        {already.map((one) => (
          <li key={`already-${one.fullName}-${one.relationship}`}>
            {t('people.students.merge.alreadyLinked', {
              name: one.fullName,
              relationship: t(`people.relatives.relationships.${one.relationship}`),
            })}
          </li>
        ))}
      </ul>
    </section>
  );
}

const MERGE_SCHEMA = asFormSchema<StudentMerge>(studentMergeSchema, (path) =>
  path[0] === 'reason' ? ['reason'] : ['uid'],
);

/** The fields of the merge form: the UID asked for and the reason. */
type MergeField = 'uid' | 'reason';

/**
 * The merge form: the UID of the other record, "Show the merge", the preview,
 * then a reason and "Merge", which asks a confirmation naming both records
 * and saying it cannot be undone (`.claude/rules/web.md`).
 */
export function MergeForm({
  student,
  onMerged,
  onStale,
  onCancel,
}: {
  student: StudentDetail;
  onMerged: (result: StudentMergeResult) => Promise<void>;
  onStale: () => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const confirm = useConfirm();
  const { withEntries, dialog } = useJournalEntries({ movesDate: false });
  const [asked, setAsked] = useState('');
  const preview = useQuery(previewQuery(branchId, student.id, asked));
  const form = useRecordForm<MergeField, StudentMerge>({
    schema: MERGE_SCHEMA,
    initial: { uid: '', reason: '' },
    read: (typed) => ({
      uid: asked,
      reason: typed.reason,
      digest: preview.data?.digest ?? '',
    }),
    save: async (input) => {
      const seen = preview.data;
      if (seen === undefined || seen.refusal !== null || input.uid !== typed()) {
        throw new SaveCancelled();
      }
      const go = await confirm({
        title: t('people.students.merge.confirmTitle'),
        text: t('people.students.merge.confirmText', {
          kept: seen.kept.uid,
          merged: seen.merged.uid,
        }),
        names: [seen.kept, seen.merged].map((side) =>
          t('people.students.merge.side', {
            name: `${side.lastName} ${side.firstName}`,
            uid: side.uid,
            branch: side.branch.name,
          }),
        ),
        action: t('people.students.merge.submit'),
        destructive: true,
      });
      if (!go) {
        throw new SaveCancelled();
      }
      try {
        // Task 8.6: the merged record's entries on days the merge cuts are voided with a reason.
        const answer = await withEntries((journalEntries) =>
          answerOf(
            api.POST('/api/people/students/{id}/merge', {
              params: { header: branchHeader(), path: { id: student.id } },
              body: { ...input, ...(journalEntries === undefined ? {} : { journalEntries }) },
            }),
          ),
        );
        await onMerged(studentMergeResultSchema.parse(answer));
      } catch (error) {
        if (error instanceof ApiFailure && error.code === 'student_changed') {
          await onStale();
          await preview.refetch();
        }
        throw error;
      }
    },
  });
  const uid = form.bind('uid');
  // The UID as the server compares it: spaces left out (task 9.4c).
  const checked = studentUidSchema.safeParse(uid.value);
  const typed = () => (checked.success ? checked.data : '');
  const title = t('people.students.merge.action');
  const ready = checked.success;
  return (
    <section className="grid gap-3">
      {dialog}
      <h3 className={SECTION_TITLE}>{title}</h3>
      <RecordForm form={form} label={title} onCancel={onCancel}>
        <div className="grid gap-2">
          <Field
            label={t('people.students.merge.uid')}
            note={t('people.students.uidFormat')}
            {...uid}
          />
          <span>
            <Button
              type="button"
              variant="secondary"
              disabled={!ready}
              onClick={() => {
                setAsked(typed());
              }}
            >
              {t('people.students.merge.show')}
            </Button>
          </span>
        </div>
        {asked !== '' &&
          (preview.isError ? (
            <ErrorState
              error={preview.error}
              onRetry={() => {
                void preview.refetch();
              }}
            />
          ) : preview.data === undefined ? (
            <LoadingOutline />
          ) : (
            branchId !== null && <PreviewOf preview={preview.data} branchId={branchId} />
          ))}
        <TextAreaField label={t('people.students.merge.reason')} {...form.bind('reason')} />
      </RecordForm>
    </section>
  );
}
