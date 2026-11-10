import {
  listName,
  gradeRanges,
  type Subject,
  type SubjectQuarter,
  type SubjectRecord,
  gradeChangesSchema,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { ApiFailure, answerOf } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { SaveCancelled } from '@/components/form/save-cancelled';
import { FailureAlert } from '@/components/failure-alert';
import { SelectField } from '@/components/field';
import { PanelActions } from '@/components/list/panel-actions';
import { usePanelEditing, type PanelEditing } from '@/components/list/use-panel-editing';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { groupsQuery } from '@/features/classes/groups-api';
import { useChangeReason } from '@/features/results/change-reason';
import { MoveLoads } from '@/features/people/move-loads';
import { staffQuery, vacanciesQuery } from '@/features/people/people-api';
import { nameOf, yearsQuery } from './setup-api';
import { SubjectChip } from './subject-colour';
import { SubjectForm, type DepartmentChoice } from './subject-form';
import { invalidateSubjects, quarterWeightsQuery } from './subjects-api';
import { WeightsForm, weightsText, type WeightPart, type Weights } from './weights-form';
import { schoolDateText } from '@/lib/dates';
import { SECTION_TITLE, SUBSECTION_TITLE } from '@/components/ui/control';

const THREE: readonly WeightPart[] = ['attendance', 'classwork', 'homework'];
const FOUR: readonly WeightPart[] = ['attendance', 'classwork', 'homework', 'ratingExam'];

interface SubjectPanelProps {
  subject: Subject;
  departments: readonly DepartmentChoice[];
  /** The name of the subject's department in force, archived ones included. */
  departmentName: string;
  /** The name of the department of a planned move (task 3.6b-3); empty without one. */
  plannedDepartmentName: string;
  canEdit: boolean;
  canArchive: boolean;
  /** The server's answer, from every current assignment (decision 17), not the role shown. */
  mayMoveDepartment: boolean;
}

/**
 * A subject in the side panel of the list: its record, this branch's daily
 * distribution and its quarterly distributions per year (`05`, Grading
 * weights on a subject: "The quarterly distribution is set for each quarter
 * separately"), and its archive. The record is the same in every branch; the
 * weights are this branch's (owner's answer 3).
 */
export function SubjectPanel({
  subject,
  departments,
  departmentName,
  plannedDepartmentName,
  canEdit,
  canArchive,
  mayMoveDepartment,
}: SubjectPanelProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const language = i18n.language;
  const name = nameOf(subject.names, language);
  const active = subject.archivedAt === null;
  const graded = subject.journalType === 'graded';
  const refresh = () => invalidateSubjects(queryClient);
  // One form open at a time: the record, the daily or a quarter's distribution (task 2.7c-2b-1).
  const panel = usePanelEditing();
  const editable = canEdit && active;

  const edit = useMutation({
    mutationFn: (record: SubjectRecord) =>
      answerOf(
        api.PUT('/api/setup/subjects/{id}', {
          params: { header: branchHeader(), path: { id: subject.id } },
          body: record,
        }),
      ),
    onSuccess: refresh,
  });

  const setDaily = useMutation({
    mutationFn: (weights: Weights) =>
      answerOf(
        api.PUT('/api/setup/subjects/{id}/daily-weights', {
          params: { header: branchHeader(), path: { id: subject.id } },
          body: {
            attendance: weights.attendance,
            classwork: weights.classwork,
            homework: weights.homework,
          },
        }),
      ),
    onSuccess: refresh,
  });

  const archive = useMutation({
    mutationFn: (restore: boolean) =>
      answerOf(
        api.POST(
          restore ? '/api/setup/subjects/{id}/restore' : '/api/setup/subjects/{id}/archive',
          { params: { header: branchHeader(), path: { id: subject.id } } },
        ),
      ),
    onSuccess: refresh,
  });

  const askArchive = async () => {
    if (
      await confirm({
        title: active
          ? t('setup.subjects.archiveTitle', { count: 1, n: '1' })
          : t('setup.subjects.restoreTitle', { count: 1, n: '1' }),
        text: active ? t('setup.subjects.archiveText') : t('setup.subjects.restoreText'),
        names: [name],
        action: active ? t('setup.subjects.archive') : t('setup.subjects.restore'),
        destructive: active,
      })
    ) {
      archive.mutate(!active);
    }
  };

  const yes = (on: boolean) => (on ? t('setup.subjects.yes') : t('setup.subjects.no'));

  return (
    <div className="grid gap-6">
      {editable && panel.editing === 'record' ? (
        // The form takes the read view's place; a refusal that names the
        // teachers who keep the subject follows it.
        <div className="grid gap-4">
          <SubjectForm
            subject={subject}
            departments={departments}
            hasDaily={graded && subject.daily !== null}
            departmentLocked={!mayMoveDepartment}
            label={name}
            onSave={async (record) => {
              await edit.mutateAsync(record);
              panel.stop({ saved: true, key: 'record' });
            }}
            onCancel={() => {
              panel.stop();
            }}
          />
          <MoveLoads error={edit.error} />
          <TeachersOutside error={edit.error} />
          <GroupsOutside error={edit.error} />
        </div>
      ) : (
        <>
          <dl className="grid gap-2 text-sm">
            {(
              [
                [
                  t('setup.subjects.name'),
                  <SubjectChip key="chip" colour={subject.colour} name={name} />,
                ],
                [t('setup.subjects.nameUz'), subject.names.uz],
                [t('setup.subjects.nameRu'), subject.names.ru],
                [t('setup.subjects.nameEn'), subject.names.en],
                [
                  t('setup.subjects.department'),
                  <span key="department" className="grid">
                    <span>
                      {subject.departmentSince === null
                        ? departmentName
                        : t('setup.subjects.departmentSince', {
                            name: departmentName,
                            date: schoolDateText(subject.departmentSince, language),
                          })}
                    </span>
                    {/* Task 3.6b-3 (L195): the move shows from its start date. */}
                    {subject.departmentMove !== null && (
                      <span>
                        {t('setup.subjects.departmentMove', {
                          name: plannedDepartmentName,
                          date: schoolDateText(subject.departmentMove.startsOn, language),
                        })}
                      </span>
                    )}
                  </span>,
                ],
                [t('setup.subjects.grades'), gradeRanges(subject.grades)],
                [
                  t('setup.subjects.journalType'),
                  t(`setup.subjects.journalTypes.${subject.journalType}`),
                ],
                [t('setup.subjects.ratingExam'), yes(subject.ratingExam)],
                [t('setup.subjects.groupSubject'), yes(subject.groupSubject)],
                [t('setup.subjects.languageRule'), yes(subject.languageRule)],
                [t('setup.subjects.demanding'), yes(subject.demanding)],
                [
                  t('setup.subjects.status'),
                  active ? t('setup.subjects.active') : t('setup.subjects.archived'),
                ],
              ] as const
            ).map(([term, value]) => (
              <div key={term} className="grid gap-0.5">
                <dt className="text-muted-foreground">{term}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>

          {graded && (
            <section className="grid gap-3">
              <h3 className={SECTION_TITLE}>{t('setup.subjects.daily')}</h3>
              {subject.daily === null ? (
                <p className="text-sm text-muted-foreground">{t('setup.subjects.notSet')}</p>
              ) : editable && panel.editing === 'weights:daily' ? (
                <WeightsForm
                  kind="daily"
                  parts={THREE}
                  weights={subject.daily}
                  label={t('setup.subjects.daily')}
                  onSave={async (weights) => {
                    await setDaily.mutateAsync(weights);
                    panel.stop({ saved: true, key: 'weights:daily' });
                  }}
                  onCancel={() => {
                    panel.stop();
                  }}
                />
              ) : (
                <>
                  <p className="text-sm">{weightsText(subject.daily, language)}</p>
                  {editable && (
                    <ChangeWeights
                      panel={panel}
                      editKey="weights:daily"
                      name={t('setup.subjects.daily')}
                    />
                  )}
                </>
              )}
            </section>
          )}

          {graded && <QuarterWeights subject={subject} canEdit={editable} panel={panel} />}
        </>
      )}

      {(canEdit || canArchive) && panel.editing === null && (
        <PanelActions
          primary={
            editable && (
              <Button
                {...panel.opener('record')}
                onClick={() => {
                  panel.start('record');
                }}
              >
                {t('form.edit')}
              </Button>
            )
          }
          secondary={
            canArchive &&
            !active && (
              <Button
                variant="secondary"
                disabled={archive.isPending}
                onClick={() => {
                  void askArchive();
                }}
              >
                {t('setup.subjects.restoreSubject')}
              </Button>
            )
          }
          danger={
            canArchive &&
            active && (
              <Button
                variant="destructive"
                disabled={archive.isPending}
                onClick={() => {
                  void askArchive();
                }}
              >
                {t('setup.subjects.archiveSubject')}
              </Button>
            )
          }
          error={archive.error}
          saved={panel.saved}
        />
      )}
      <GroupsOutside error={archive.error} />
    </div>
  );
}

/**
 * The active groups that keep a subject from losing a grade or from its
 * archive (task 3.2a, decision 16): those of this branch by name, those of
 * other branches as a number only, as `TeachersOutside` does for staff. A
 * name the group list does not hold is left out, never shown as a blank.
 */
function GroupsOutside({ error }: { error: unknown }) {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const refused =
    error instanceof ApiFailure &&
    (error.code === 'subject_grade_groups' || error.code === 'subject_has_groups');
  const details = refused ? (error.details ?? []) : [];
  const ids = details
    .filter((detail) => detail.path.startsWith('group.'))
    .map((detail) => detail.path.slice('group.'.length));
  const groups = useQuery({
    ...groupsQuery(branchId),
    enabled: ids.length > 0 && branchId !== null,
  });
  if (!refused) {
    return null;
  }
  if (groups.isError) {
    return (
      <ErrorState
        error={groups.error}
        onRetry={() => {
          void groups.refetch();
        }}
      />
    );
  }
  if (ids.length > 0 && groups.data === undefined) {
    return <LoadingOutline lines={1} />;
  }
  const elsewhere = Number(details.find((detail) => detail.path === 'elsewhere')?.code ?? '0');
  const number = new Intl.NumberFormat(i18n.language);
  const names = ids
    .map((id) => groups.data?.groups.find((one) => one.id === id)?.name)
    .filter((name): name is string => name !== undefined);
  return (
    <div className="grid gap-1 text-sm" role="status">
      {names.length > 0 && <p>{t('setup.subjects.groupsHere', { names: names.join(', ') })}</p>}
      {elsewhere > 0 && (
        <p>
          {t('setup.subjects.groupsElsewhere', { count: elsewhere, n: number.format(elsewhere) })}
        </p>
      )}
    </div>
  );
}

/** The secondary button that opens a distribution's form in its section. */
function ChangeWeights({
  panel,
  editKey,
  name,
}: {
  panel: PanelEditing;
  editKey: string;
  name: string;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <Button
        variant="secondary"
        aria-label={t('setup.subjects.changeWeightsOf', { name })}
        {...panel.opener(editKey)}
        onClick={() => {
          panel.start(editKey);
        }}
      >
        {t('setup.subjects.changeWeights')}
      </Button>
    </div>
  );
}

/**
 * The quarterly distributions of one planned or current year of the branch.
 * With no such year the section says so (`edge/academic-year`: "An action
 * whose prerequisite is missing is switched off and says what is missing").
 */
function QuarterWeights({
  subject,
  canEdit,
  panel,
}: {
  subject: Subject;
  canEdit: boolean;
  /** The panel's one open form: a quarter's form is one of them. */
  panel: PanelEditing;
}) {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const years = useQuery(yearsQuery(branchId));
  const open = (years.data?.years ?? []).filter(
    (year) => year.status === 'planned' || year.status === 'current',
  );
  const [chosen, setChosen] = useState<string | null>(null);
  // A new key for the forms of quarters 2 to 4 after a copy: they show what it wrote.
  const [copies, setCopies] = useState(0);
  // A choice no longer offered falls back to the first year offered.
  const yearId = open.some((year) => year.id === chosen) ? chosen : (open[0]?.id ?? null);
  const quarters = useQuery(quarterWeightsQuery(branchId, subject.id, yearId));
  const title = t('setup.subjects.quarterly');
  const refresh = () => invalidateSubjects(queryClient);

  // Task 9.1: the grades a change alters, and its reason, before it is saved.
  const reasons = useChangeReason();
  const bodyOf = (weights: Weights) => ({
    attendance: weights.attendance,
    classwork: weights.classwork,
    homework: weights.homework,
    ratingExam: weights.ratingExam ?? null,
  });

  const setQuarter = useMutation({
    mutationFn: ({
      quarterId,
      weights,
      reason,
    }: {
      quarterId: string;
      weights: Weights;
      reason: string | undefined;
    }) =>
      answerOf(
        api.PUT('/api/setup/subjects/{id}/quarter-weights/{quarterId}', {
          params: { header: branchHeader(), path: { id: subject.id, quarterId } },
          body: { ...bodyOf(weights), ...(reason === undefined ? {} : { reason }) },
        }),
      ),
    onSuccess: refresh,
  });

  /** Saves a quarter after its preview: `false` when the person went back. */
  const saveQuarter = async (quarterId: string, weights: Weights): Promise<boolean> => {
    const preview = gradeChangesSchema.parse(
      await answerOf(
        api.POST('/api/setup/subjects/{id}/quarter-weights/{quarterId}/preview', {
          params: { header: branchHeader(), path: { id: subject.id, quarterId } },
          body: bodyOf(weights),
        }),
      ),
    );
    const reason = await reasons.ask(preview);
    if (reason === null) return false;
    await setQuarter.mutateAsync({ quarterId, weights, reason });
    return true;
  };

  const copy = useMutation({
    mutationFn: async ({ year, overwritten }: { year: string; overwritten: boolean }) => {
      const preview = gradeChangesSchema.parse(
        await answerOf(
          api.POST('/api/setup/subjects/{id}/quarter-weights/copy/preview', {
            params: { header: branchHeader(), path: { id: subject.id } },
            body: { yearId: year },
          }),
        ),
      );
      // A change of stored distributions asks its reason, which names what changes; the
      // overwrite of rows that change no grade is asked as before.
      if (
        !preview.reasonRequired &&
        overwritten &&
        !(await confirm({
          title: t('setup.subjects.copyTitle'),
          text: t('setup.subjects.copyText'),
          action: t('setup.subjects.copy'),
          destructive: true,
        }))
      ) {
        return;
      }
      const reason = await reasons.ask(preview);
      if (reason === null) return;
      await answerOf(
        api.POST('/api/setup/subjects/{id}/quarter-weights/copy', {
          params: { header: branchHeader(), path: { id: subject.id } },
          body: { yearId: year, ...(reason === undefined ? {} : { reason }) },
        }),
      );
    },
    // The forms take what the copy wrote once the quarters are read again.
    onSuccess: async () => {
      await refresh();
      setCopies((before) => before + 1);
    },
  });

  const askCopy = (rows: readonly SubjectQuarter[]) => {
    if (yearId === null) {
      return;
    }
    const overwritten = rows.some((row) => row.number > 1 && row.weights !== null);
    copy.mutate({ year: yearId, overwritten });
  };

  let body;
  if (years.isError) {
    body = (
      <ErrorState
        error={years.error}
        onRetry={() => {
          void years.refetch();
        }}
      />
    );
  } else if (years.data === undefined) {
    body = <LoadingOutline lines={2} />;
  } else if (yearId === null) {
    body = <p className="text-sm text-muted-foreground">{t('setup.subjects.noYear')}</p>;
  } else if (quarters.isError) {
    body = (
      <ErrorState
        error={quarters.error}
        onRetry={() => {
          void quarters.refetch();
        }}
      />
    );
  } else if (quarters.data === undefined) {
    body = <LoadingOutline lines={4} />;
  } else {
    const rows = quarters.data.quarters;
    const frozen = quarters.data.yearStatus === 'closed';
    body = (
      <div className="grid gap-4">
        {rows.map((row) => {
          const label = t('setup.subjects.quarter', { n: row.number });
          const dates =
            row.startDate === null || row.endDate === null
              ? t('setup.subjects.undated')
              : `${schoolDateText(row.startDate, i18n.language, false)} – ${schoolDateText(row.endDate, i18n.language, false)}`;
          const state =
            row.weights === null
              ? t('setup.subjects.notSet')
              : row.fits
                ? weightsText(row.weights, i18n.language)
                : t('setup.subjects.setAgain');
          return (
            <div
              key={row.quarterId}
              data-quarter={row.number}
              className="grid gap-2 rounded-lg border p-3"
            >
              <h4 className={SUBSECTION_TITLE}>
                {label} <span className="font-normal text-muted-foreground">{dates}</span>
              </h4>
              {canEdit && !frozen && panel.editing === `weights:${row.quarterId}` ? (
                <WeightsForm
                  key={`${row.quarterId}-${String(row.ratingExam)}-${row.number === 1 ? '' : String(copies)}`}
                  kind="quarter"
                  // Task 8.2: the shape of the quarter's own rating exam switch.
                  parts={row.ratingExam ? FOUR : THREE}
                  weights={row.fits ? row.weights : null}
                  label={label}
                  onSave={async (weights) => {
                    if (!(await saveQuarter(row.quarterId, weights))) throw new SaveCancelled();
                    panel.stop({ saved: true, key: `weights:${row.quarterId}` });
                  }}
                  onCancel={() => {
                    panel.stop();
                  }}
                />
              ) : (
                <>
                  <p className="text-sm">{state}</p>
                  {canEdit && !frozen && (
                    <ChangeWeights
                      panel={panel}
                      editKey={`weights:${row.quarterId}`}
                      name={label}
                    />
                  )}
                </>
              )}
              {/* Under the open form only: the read view says it already. */}
              {panel.editing === `weights:${row.quarterId}` &&
                row.weights !== null &&
                !row.fits && (
                  <p className="text-sm text-muted-foreground">{t('setup.subjects.setAgain')}</p>
                )}
            </div>
          );
        })}
        {reasons.dialog}
        {canEdit && !frozen && panel.editing === null && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              disabled={copy.isPending || !(rows[0]?.fits ?? false)}
              onClick={() => {
                askCopy(rows);
              }}
            >
              {t('setup.subjects.copy')}
            </Button>
            {!(rows[0]?.fits ?? false) && (
              <span className="text-sm text-muted-foreground">{t('setup.subjects.copyOff')}</span>
            )}
            <FailureAlert error={copy.error} />
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="grid gap-3">
      <h3 className={SECTION_TITLE}>{title}</h3>
      {open.length === 1 && (
        <p className="text-sm text-muted-foreground">
          {t('setup.subjects.yearNamed', { name: open[0]?.name })}
        </p>
      )}
      {open.length > 1 && (
        <SelectField
          label={t('setup.subjects.year')}
          name="year"
          value={yearId ?? ''}
          error={undefined}
          options={open.map((year) => ({ value: year.id, label: year.name }))}
          onChange={(event) => {
            setChosen(event.target.value);
          }}
        />
      )}
      {body}
    </section>
  );
}

/**
 * Who keeps a subject from losing its department or a grade (task 2.2a,
 * decision 13 and correction 7 of the review of pull request #53): the staff
 * of this branch by name, those of other branches as a number only.
 */
function TeachersOutside({ error }: { error: unknown }) {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const refused = error instanceof ApiFailure && error.code === 'subject_has_teachers';
  const details = refused ? (error.details ?? []) : [];
  const idsOf = (prefix: string) =>
    details
      .filter((detail) => detail.path.startsWith(prefix))
      .map((detail) => detail.path.slice(prefix.length));
  const ids = idsOf('staff.');
  // Open vacancies of the branch keep the subject too (task 2.2b, correction 4).
  const vacancyIds = idsOf('vacancy.');
  const staff = useQuery({ ...staffQuery(branchId), enabled: ids.length > 0 && branchId !== null });
  const vacancies = useQuery({
    ...vacanciesQuery(branchId),
    enabled: vacancyIds.length > 0 && branchId !== null,
  });
  if (!refused) {
    return null;
  }
  const elsewhere = Number(details.find((detail) => detail.path === 'elsewhere')?.code ?? '0');
  const number = new Intl.NumberFormat(i18n.language);
  const failed = staff.isError ? staff : vacancies.isError ? vacancies : null;
  if (failed !== null) {
    return (
      <ErrorState
        error={failed.error}
        onRetry={() => {
          void failed.refetch();
        }}
      />
    );
  }
  if (
    (ids.length > 0 && staff.data === undefined) ||
    (vacancyIds.length > 0 && vacancies.data === undefined)
  ) {
    return <LoadingOutline lines={1} />;
  }
  const names = [
    ...ids.map((id) => {
      const person = staff.data?.staff.find((one) => one.id === id);
      // Surname first, as the staff list (finding 27).
      return person === undefined ? '' : listName(person);
    }),
    ...vacancyIds.map((id) => vacancies.data?.vacancies.find((one) => one.id === id)?.name ?? ''),
  ];
  return (
    <div className="grid gap-1 text-sm" role="status">
      {names.length > 0 && <p>{t('setup.subjects.teachersHere', { names: names.join(', ') })}</p>}
      {elsewhere > 0 && (
        <p>
          {t('setup.subjects.teachersElsewhere', {
            count: elsewhere,
            n: number.format(elsewhere),
          })}
        </p>
      )}
    </div>
  );
}
