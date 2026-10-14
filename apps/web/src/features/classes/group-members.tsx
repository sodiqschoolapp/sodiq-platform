import {
  classDisplayName,
  groupParamsSchema,
  groupPlacementSchema,
  listName,
  type AcademicYear,
  type GroupDetail,
  type GroupMember,
  type GroupPlacement,
  type SchoolGroup,
  type StudentListItem,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/confirm-dialog';
import { CheckboxGroupField, DateField, listValues, SelectField } from '@/components/field';
import { FailureAlert } from '@/components/failure-alert';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import type { PanelEditing } from '@/components/list/use-panel-editing';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { SECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { asFormSchema } from '@/features/people/form-schema';
import { invalidateStudents, studentsQuery } from '@/features/people/people-api';
import { nameOf } from '@/features/setup/setup-api';
import { schoolDateText } from '@/lib/dates';
import { placementDay, refusedNames, useFollowingDefault } from './class-members';
import {
  groupMembersQuery,
  groupsQuery,
  invalidateGroups,
  markReviewed,
  placeInGroup,
  withdrawGroupMember,
} from './groups-api';

/** After a change of members: the groups (their counts and tabs) and the students (their groups). */
const refreshAll = (queryClient: ReturnType<typeof useQueryClient>) =>
  Promise.all([invalidateGroups(queryClient), invalidateStudents(queryClient)]);

/** An issue of a placement names the field: every issue of a student is the field of the students. */
const placementField = (path: readonly PropertyKey[]): PropertyKey[] =>
  path[0] === 'students' ? ['students'] : [...path];

const PICKED_SCHEMA = asFormSchema<GroupPlacement>(groupPlacementSchema, placementField);

type ChosenPlacement = GroupPlacement & { groupId: string };

const CHOSEN_SCHEMA = asFormSchema<ChosenPlacement>(
  groupPlacementSchema.extend({ groupId: groupParamsSchema.shape.id }),
  placementField,
);

/** The class a row of the student list shows: in force today, else the first planned. */
const classOfRow = (row: StudentListItem) => row.class ?? row.plannedClass;

/**
 * Whether a student of the list can be put into a group of this subject from
 * the group's classes (decision 10, the server's rule as the list knows it):
 * in one of its classes now or planned, and in no group of the subject now or
 * planned.
 */
export const placeableInGroup = (
  row: StudentListItem,
  group: { subject: { id: string }; classes: readonly { id: string }[] },
): boolean => {
  const shown = classOfRow(row);
  return (
    shown !== null &&
    group.classes.some((one) => one.id === shown.id) &&
    !row.groups.some((one) => one.subjectId === group.subject.id)
  );
};

interface GroupMembersProps {
  group: GroupDetail;
  years: readonly AcademicYear[];
  /** Places, withdraws and marks reviewed: `groups` `edit`, a group active in an open year. */
  canEdit: boolean;
  panel: PanelEditing;
}

/**
 * The Students tab of a group (task 3.2b): the members in force today and the
 * planned ones with their first day and class, the tag "placed
 * automatically, review" with "Mark reviewed", the free seats today and the
 * fewest from today on (edge, "Groups work the same way"), "Put into a group"
 * and the withdraw of a planned placement. A Tutor reads the members of own
 * classes and a count of the others (decision 4).
 */
export function GroupMembers({ group, years, canEdit, panel }: GroupMembersProps) {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const members = useQuery(groupMembersQuery(branchId, group.id));
  const withdraw = useMutation({
    mutationFn: async (member: GroupMember) => {
      const go = await confirm({
        title: t('groups.withdrawTitle'),
        text: t('groups.withdrawText'),
        names: [
          `${listName(member)}, ${t('groups.joinsOn', {
            date: schoolDateText(member.from, i18n.language),
          })}`,
        ],
        action: t('groups.withdraw'),
        destructive: true,
      });
      return go ? withdrawGroupMember(group.id, member.id) : null;
    },
    onSuccess: async (answer) => {
      if (answer !== null) {
        await refreshAll(queryClient);
      }
    },
  });
  const review = useMutation({
    mutationFn: (member: GroupMember) => markReviewed(group.id, member.id),
    onSuccess: () => refreshAll(queryClient),
  });

  if (members.isError) {
    return (
      <ErrorState
        error={members.error}
        onRetry={() => {
          void members.refetch();
        }}
      />
    );
  }
  if (members.data === undefined) {
    return <LoadingOutline lines={3} />;
  }
  const tab = members.data;
  const yearStart = years.find((year) => year.id === group.academicYearId)?.startDate;
  return (
    <section className="grid gap-3">
      <h3 className={SECTION_TITLE}>{t('groups.members')}</h3>
      <p className="text-sm text-muted-foreground">
        {t('groups.freeToday', { n: tab.freeToday })} ·{' '}
        {t('groups.freeLeast', { n: tab.freeLeast })}
      </p>
      {tab.members.length === 0 && tab.othersCount === 0 ? (
        <p className="text-sm text-muted-foreground">{t('groups.noMembers')}</p>
      ) : (
        <ul className="grid gap-2">
          {tab.members.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-semibold">{listName(member)}</span>
              <span className="text-muted-foreground">
                {member.uid} · {classDisplayName(member.class.grade, member.class.name)}
              </span>
              {/* Plain words, never a tinted tag (docs/design-system.md, What we never do, 4). */}
              {member.state === 'planned' && (
                <span className="text-muted-foreground">
                  {t('groups.joinsOn', { date: schoolDateText(member.from, i18n.language) })}
                </span>
              )}
              {member.review && <span className="font-semibold">{t('groups.review')}</span>}
              {canEdit && member.review && panel.editing === null && (
                <Button
                  variant="secondary"
                  disabled={review.isPending}
                  onClick={() => {
                    review.mutate(member);
                  }}
                >
                  {t('groups.markReviewed')}
                </Button>
              )}
              {canEdit && member.state === 'planned' && panel.editing === null && (
                <Button
                  variant="secondary"
                  disabled={withdraw.isPending}
                  onClick={() => {
                    withdraw.mutate(member);
                  }}
                >
                  {t('groups.withdraw')}
                </Button>
              )}
            </li>
          ))}
          {tab.othersCount > 0 && (
            <li className="text-sm text-muted-foreground">
              {t('groups.others', {
                count: tab.othersCount,
                n: new Intl.NumberFormat(i18n.language).format(tab.othersCount),
              })}
            </li>
          )}
        </ul>
      )}
      {withdraw.error !== null && <FailureAlert error={withdraw.error} />}
      {review.error !== null && <FailureAlert error={review.error} />}
      {canEdit && panel.editing === 'place' && (
        <PickForm
          group={group}
          label={t('groups.putIntoNamed', { group: group.name })}
          yearStart={yearStart}
          today={tab.today}
          onPlaced={() => {
            panel.stop({ saved: true, key: 'place' });
          }}
          onCancel={() => {
            panel.stop();
          }}
        />
      )}
      {canEdit && panel.editing === null && (
        <div>
          <Button
            variant="secondary"
            {...panel.opener('place')}
            onClick={() => {
              panel.start('place');
            }}
          >
            {t('groups.putIntoGroup')}
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * "Put into a group" from the group: the students of its classes in no group
 * of its subject, and the first day (decision 15).
 */
function PickForm({
  group,
  label,
  yearStart,
  today,
  onPlaced,
  onCancel,
}: {
  group: GroupDetail;
  label: string;
  yearStart: string | undefined;
  today: string;
  onPlaced: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const students = useQuery(studentsQuery(branchId));
  const candidates = (students.data?.students ?? []).filter((row) => placeableInGroup(row, group));
  const byId = new Map(candidates.map((row) => [row.id, row] as const));
  const place = useMutation({
    mutationFn: (placement: GroupPlacement) => placeInGroup(group.id, placement),
    onSuccess: () => refreshAll(queryClient),
    // A student changed meanwhile: the list is read again for the next try.
    onError: () => invalidateStudents(queryClient),
  });
  const form = useRecordForm<'students' | 'from', GroupPlacement>({
    schema: PICKED_SCHEMA,
    initial: { students: '', from: placementDay(today, yearStart, []) },
    read: (typed) => ({
      students: listValues(typed.students).flatMap((id) => (byId.has(id) ? [{ id }] : [])),
      from: typed.from,
    }),
    checkedOnSave: ['students'],
    save: async (placement) => {
      await place.mutateAsync(placement);
      onPlaced();
    },
  });
  useFollowingDefault(
    form.bind('from'),
    placementDay(
      today,
      yearStart,
      listValues(form.bind('students').value).flatMap((id) => {
        const row = byId.get(id);
        const shown = row === undefined ? null : classOfRow(row);
        return shown === null ? [] : [shown.from];
      }),
    ),
  );
  if (students.isError) {
    return (
      <ErrorState
        error={students.error}
        onRetry={() => {
          void students.refetch();
        }}
      />
    );
  }
  if (students.data === undefined) {
    return <LoadingOutline lines={2} />;
  }
  const names = refusedNames(form.failure, (id) => {
    const row = byId.get(id);
    return row === undefined ? undefined : listName(row);
  });
  return (
    <RecordForm form={form} label={label} onCancel={onCancel}>
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('groups.noPlaceable')}</p>
      ) : (
        <CheckboxGroupField
          label={t('groups.pickStudents')}
          options={candidates.map((row) => {
            const shown = classOfRow(row);
            return {
              value: row.id,
              label: `${listName(row)} (${row.uid}${
                shown === null ? '' : `, ${classDisplayName(shown.grade, shown.name)}`
              })`,
            };
          })}
          {...form.bind('students')}
        />
      )}
      <DateField label={t('groups.from')} {...form.bind('from')} />
      {names.length > 0 && (
        <p className="text-sm">{t('groups.refusedNames', { names: names.join(', ') })}</p>
      )}
    </RecordForm>
  );
}

/**
 * "Put into a group" of the students ticked in the student list (task 3.2b):
 * one active group of an open year that draws from the class of every ticked
 * student, and the first day; all or none, the refused students named.
 */
export function PlaceTickedInGroupForm({
  rows,
  title,
  onPlaced,
}: {
  rows: readonly StudentListItem[];
  title: string;
  onPlaced: (placed: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const groups = useQuery(groupsQuery(branchId));
  // Today in the branch, as the list read it (the list opened this form).
  const today = useQuery(studentsQuery(branchId)).data?.today;
  const shown = rows.map(classOfRow);
  const offered = (groups.data?.groups ?? []).filter(
    (one: SchoolGroup) =>
      !one.archived &&
      one.yearStatus !== 'closed' &&
      shown.every((held) => held !== null && one.classes.some((item) => item.id === held.id)),
  );
  const starts = shown.flatMap((held) => (held === null ? [] : [held.from]));
  const place = useMutation({
    mutationFn: (input: { groupId: string; placement: GroupPlacement }) =>
      placeInGroup(input.groupId, input.placement),
    onSuccess: () => refreshAll(queryClient),
    onError: () => invalidateStudents(queryClient),
  });
  const form = useRecordForm<'groupId' | 'from', ChosenPlacement>({
    schema: CHOSEN_SCHEMA,
    initial: {
      groupId: '',
      from: today === undefined ? '' : placementDay(today, undefined, starts),
    },
    read: (typed) => ({
      groupId: typed.groupId,
      students: rows.map((row) => ({ id: row.id })),
      from: typed.from,
    }),
    save: async ({ groupId, ...placement }) => {
      await place.mutateAsync({ groupId, placement });
      onPlaced(rows.length);
    },
  });
  useFollowingDefault(
    form.bind('from'),
    today === undefined ? '' : placementDay(today, undefined, starts),
  );
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
  if (groups.data === undefined) {
    return <LoadingOutline lines={2} />;
  }
  const names = refusedNames(form.failure, (id) => {
    const row = rows.find((one) => one.id === id);
    return row === undefined ? undefined : listName(row);
  });
  return (
    <RecordForm form={form} label={title}>
      <p className="text-sm">{rows.map((row) => listName(row)).join(', ')}</p>
      {offered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('groups.noGroupOfClass')}</p>
      ) : (
        <SelectField
          label={t('groups.columns.name')}
          options={[
            { value: '', label: t('groups.chooseGroup') },
            ...offered.map((one) => ({
              value: one.id,
              label: t('groups.groupOfSubject', {
                group: one.name,
                subject: nameOf(one.subject.names, language),
              }),
            })),
          ]}
          {...form.bind('groupId')}
        />
      )}
      <DateField label={t('groups.from')} {...form.bind('from')} />
      {names.length > 0 && (
        <p className="text-sm">{t('groups.refusedNames', { names: names.join(', ') })}</p>
      )}
    </RecordForm>
  );
}
