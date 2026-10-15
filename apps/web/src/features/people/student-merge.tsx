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
import { SECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { schoolDateText } from '@/lib/dates';
import { asFormSchema } from './form-schema';
import { studentsKey } from './people-api';

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
  const { t } = useTranslation();
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
      <span>
        {side.status === null
          ? t('people.students.notStarted')
          : t(`people.students.statuses.${side.status}`)}
      </span>
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
            <h4 className="font-semibold">{t('people.students.merge.life')}</h4>
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
              <h4 className="font-semibold">{t('people.students.merge.rows')}</h4>
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
          {preview.differing.length > 0 && (
            <section className="grid gap-1 text-sm">
              <h4 className="font-semibold">{t('people.students.merge.differing')}</h4>
              <ul className="grid gap-1">
                {preview.differing.map((one) => (
                  <li key={one.field}>
                    {t('people.students.merge.differs', {
                      field: t(`people.students.merge.fields.${one.field}`),
                      merged: mergeValueText(t, i18n.language, one.field, one.merged),
                    })}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
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
        const answer = await answerOf(
          api.POST('/api/people/students/{id}/merge', {
            params: { header: branchHeader(), path: { id: student.id } },
            body: input,
          }),
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
  const typed = () => uid.value.trim();
  const title = t('people.students.merge.action');
  const ready = studentUidSchema.safeParse(uid.value).success;
  return (
    <section className="grid gap-3">
      <h3 className={SECTION_TITLE}>{title}</h3>
      <RecordForm form={form} label={title} onCancel={onCancel}>
        <div className="grid gap-2">
          <Field label={t('people.students.merge.uid')} inputMode="numeric" {...uid} />
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

