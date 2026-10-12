import {
  STAFF_STATUSES,
  staffBranchesSchema,
  staffDetailSchema,
  staffIdentitySchema,
  staffStatusChangeSchema,
  staffTeachingSchema,
  type DivisionList,
  type InstructionLanguage,
  type StaffBranches,
  type StaffDetail,
  type StaffRecord,
  type StaffStatusChange,
  type StaffTeaching,
  type Subject,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { SaveCancelled } from '@/components/form/save-cancelled';
import {
  CheckboxGroupField,
  DateField,
  listValue,
  listValues,
  SelectField,
} from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { initialsOf, PersonPhoto } from '@/components/person-photo';
import { useRecordForm } from '@/components/form/use-record-form';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { nameOf, schoolDateText } from '@/features/setup/setup-api';
import {
  invalidateStaff,
  removeStaffPhoto,
  setStaffPhoto,
  staffDetailQuery,
  staffPhotoQuery,
} from './people-api';
import { photoRefusalOf, shrinkPhoto } from './shrink-photo';
import { AvailabilitySection } from './availability-section';
import { asFormSchema } from './form-schema';
import { StaffForm } from './staff-form';

interface StaffPanelProps {
  id: string;
  name: string;
  divisions: DivisionList;
  subjects: readonly Subject[];
}

/**
 * A person in the side panel of the staff list: the record, the subjects and
 * languages, the branches and the status with its history (`04`; task 2.2a).
 * What the account may change comes from the server (`rights`), decided from
 * every current assignment, not from the role shown.
 */
export function StaffPanel({ id, name, divisions, subjects }: StaffPanelProps) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const detail = useQuery(staffDetailQuery(branchId, id));
  /** The answer of a change is the record as it now is; the lists are read again. */
  const refresh = async (answer: unknown) => {
    queryClient.setQueryData(
      staffDetailQuery(branchId, id).queryKey,
      staffDetailSchema.parse(answer),
    );
    await invalidateStaff(queryClient);
  };
  const where = () => ({ header: branchHeader(), path: { id } });

  const edit = useMutation({
    mutationFn: (record: StaffRecord) =>
      answerOf(api.PUT('/api/people/staff/{id}', { params: where(), body: record })),
    onSuccess: refresh,
  });
  const teaching = useMutation({
    mutationFn: (record: StaffTeaching) =>
      answerOf(api.PUT('/api/people/staff/{id}/teaching', { params: where(), body: record })),
    onSuccess: refresh,
  });
  const branches = useMutation({
    mutationFn: (record: StaffBranches) =>
      answerOf(api.PUT('/api/people/staff/{id}/branches', { params: where(), body: record })),
    onSuccess: refresh,
  });
  const status = useMutation({
    mutationFn: (change: StaffStatusChange) =>
      answerOf(api.POST('/api/people/staff/{id}/status', { params: where(), body: change })),
    onSuccess: refresh,
  });

  if (detail.isError) {
    return (
      <ErrorState
        error={detail.error}
        onRetry={() => {
          void detail.refetch();
        }}
      />
    );
  }
  if (detail.data === undefined) {
    return <LoadingOutline />;
  }
  const staff = detail.data;

  return (
    <div className="grid gap-6">
      <PhotoSection staff={staff} name={name} onChange={refresh} />
      <Overview staff={staff} divisions={divisions} />
      {staff.rights.contact && (
        <section className="grid gap-3">
          <h3 className="text-base font-semibold">{t('people.staff.recordTitle')}</h3>
          <StaffForm
            key={`${staff.id}-record`}
            staff={staff}
            divisions={divisions}
            contactOnly={!staff.rights.all}
            label={name}
            onSave={async (record) => {
              await edit.mutateAsync(record);
            }}
          />
        </section>
      )}
      <TeachingSection
        staff={staff}
        divisions={divisions}
        subjects={subjects}
        label={name}
        onSave={async (record) => {
          await teaching.mutateAsync(record);
        }}
      />
      <AvailabilitySection id={staff.id} label={name} />
      {staff.rights.all && (
        <BranchesSection
          staff={staff}
          label={name}
          onSave={async (record) => {
            await branches.mutateAsync(record);
          }}
        />
      )}
      <StatusSection
        staff={staff}
        label={name}
        onSave={async (change) => {
          await status.mutateAsync(change);
        }}
      />
    </div>
  );
}

/**
 * The photo of the record (task 2.2c-2): shown to every reader, set and
 * removed by those who change the record's contact fields, the Super Admin
 * and the Academic Vice Principal (decision 2). The browser checks the type
 * and the 5 MB, then shrinks the photo before it is sent (answer 2).
 */
function PhotoSection({
  staff,
  name,
  onChange,
}: {
  staff: StaffDetail;
  name: string;
  onChange: (answer: unknown) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const refusal = photoRefusalOf(file);
      if (refusal !== null) {
        throw new ApiFailure(refusal);
      }
      let shrunk: Blob;
      try {
        shrunk = await shrinkPhoto(file);
      } catch {
        throw new ApiFailure('photo_invalid');
      }
      return setStaffPhoto(staff.id, shrunk);
    },
    onSuccess: onChange,
  });
  const remove = useMutation({
    mutationFn: () => removeStaffPhoto(staff.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: staffDetailQuery(branchId, staff.id).queryKey,
      });
      await invalidateStaff(queryClient);
    },
  });
  const pending = upload.isPending || remove.isPending;

  return (
    <section className="grid gap-3" aria-label={t('people.staff.photo.title')}>
      <div className="flex flex-wrap items-center gap-4">
        <PersonPhoto
          name={name}
          initials={initialsOf(staff.firstName, staff.lastName)}
          photo={staff.photoId === null ? null : staffPhotoQuery(branchId, staff.id, staff.photoId)}
          size="lg"
        />
        {staff.rights.contact && (
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              aria-label={t(
                staff.photoId === null ? 'people.staff.photo.add' : 'people.staff.photo.change',
              )}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file !== undefined) {
                  remove.reset();
                  upload.mutate(file);
                }
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => {
                input.current?.click();
              }}
            >
              {t(staff.photoId === null ? 'people.staff.photo.add' : 'people.staff.photo.change')}
            </Button>
            {staff.photoId !== null && (
              <Button
                variant="destructive"
                size="sm"
                disabled={pending}
                onClick={() => {
                  void confirm({
                    title: t('people.staff.photo.removeTitle'),
                    text: t('people.staff.photo.removeText'),
                    names: [name],
                    action: t('people.staff.photo.remove'),
                    destructive: true,
                  }).then((go) => {
                    if (go) {
                      upload.reset();
                      remove.mutate();
                    }
                  });
                }}
              >
                {t('people.staff.photo.remove')}
              </Button>
            )}
          </div>
        )}
      </div>
      <FailureAlert error={upload.error ?? remove.error} />
    </section>
  );
}

/** What everybody who sees the record reads; birth date and JSHSHIR behind a logged show for the Principal. */
function Overview({ staff, divisions }: { staff: StaffDetail; divisions: DivisionList }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { branchId } = useView();
  const [shown, setShown] = useState<{ birthDate: string; jshshir: string | null } | null>(null);
  const show = useMutation({
    mutationFn: async () =>
      staffIdentitySchema.parse(
        await answerOf(
          api.POST('/api/people/staff/{id}/identity', {
            params: { header: branchHeader(), path: { id: staff.id } },
          }),
        ),
      ),
    onSuccess: setShown,
  });
  const divisionName = (id: string) => divisions.divisions.find((division) => division.id === id);
  const departmentName = (id: string | null) =>
    id === null
      ? null
      : divisions.divisions
          .flatMap((division) => division.departments)
          .find((department) => department.id === id);
  const birthDate = shown?.birthDate ?? staff.birthDate;
  const jshshir = shown === null ? staff.jshshir : shown.jshshir;
  const rows: [string, string][] = [
    [t('people.staff.staffId'), staff.staffId],
    [
      t('people.staff.categories'),
      staff.categories.length === 0
        ? t('people.staff.none')
        : staff.categories.map((role) => t(`roles.${role}`)).join(', '),
    ],
    [t('people.staff.sex'), t(`people.staff.sexes.${staff.sex}`)],
    [
      t('people.staff.birthDate'),
      birthDate === null ? t('people.staff.hidden') : schoolDateText(birthDate, language),
    ],
    [
      t('people.staff.jshshir'),
      staff.identityHidden && shown === null
        ? t('people.staff.hidden')
        : (jshshir ?? t('people.staff.notSet')),
    ],
    [t('people.staff.phone'), staff.phone],
    [t('people.staff.email'), staff.email ?? t('people.staff.notSet')],
    [
      t('people.staff.branches'),
      staff.branches
        .map((branch) =>
          branch.main ? t('people.staff.mainBranch', { name: branch.name }) : branch.name,
        )
        .join(', '),
    ],
    [
      t('people.staff.divisions'),
      staff.divisions
        .map((division) => {
          const found = divisionName(division.divisionId);
          const department = departmentName(division.departmentId);
          const text = [
            found === undefined ? '' : nameOf(found.names, language),
            department === null || department === undefined
              ? null
              : nameOf(department.names, language),
          ]
            .filter((part) => part !== null)
            .join(', ');
          return division.main ? t('people.staff.mainDivisionText', { name: text }) : text;
        })
        .join('; '),
    ],
    [t('people.staff.admissionDate'), schoolDateText(staff.admissionDate, language)],
  ];
  return (
    <section className="grid gap-3">
      <dl className="grid gap-2 text-sm">
        {rows.map(([term, value]) => (
          <div key={term} className="grid gap-0.5">
            <dt className="text-muted-foreground">{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {staff.identityHidden && shown === null && branchId !== null && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={show.isPending}
            onClick={() => {
              show.mutate();
            }}
          >
            {t('people.staff.showIdentity')}
          </Button>
          <FailureAlert error={show.error} />
        </div>
      )}
    </section>
  );
}

/**
 * Subjects with the grades taught and the languages of instruction (`04`).
 * The subjects offered are those of the person's Academic department; a
 * subject the person already has stays offered.
 */
function TeachingSection({
  staff,
  divisions,
  subjects,
  label,
  onSave,
}: {
  staff: StaffDetail;
  divisions: DivisionList;
  subjects: readonly Subject[];
  label: string;
  onSave: (record: StaffTeaching) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const academic = divisions.divisions.find((division) => division.builtIn);
  const department = staff.divisions.find(
    (division) => division.divisionId === academic?.id,
  )?.departmentId;
  const offered = subjects.filter(
    (subject) =>
      staff.subjects.some((own) => own.subjectId === subject.id) ||
      (subject.archivedAt === null && subject.departmentId === department),
  );
  const subjectName = (id: string) => {
    const found = subjects.find((subject) => subject.id === id);
    return found === undefined ? '' : nameOf(found.names, language);
  };
  const gradeText = (grades: readonly number[]) =>
    grades.map((grade) => t('setup.subjects.grade', { grade })).join(', ');
  const languageText = (languages: readonly InstructionLanguage[]) =>
    languages.length === 0
      ? t('people.staff.none')
      : languages.map((one) => t(`people.staff.languages.${one}`)).join(', ');

  return (
    <section className="grid gap-3">
      <h3 className="text-base font-semibold">{t('people.staff.teachingTitle')}</h3>
      {staff.rights.teaching && department !== undefined && department !== null ? (
        <TeachingForm
          key={`${staff.id}-teaching-${staff.subjects.map((own) => own.subjectId).join('-')}`}
          staff={staff}
          offered={offered}
          label={t('people.staff.teachingOf', { name: label })}
          onSave={onSave}
        />
      ) : (
        <dl className="grid gap-2 text-sm">
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">{t('people.staff.subjects')}</dt>
            <dd>
              {staff.subjects.length === 0
                ? t('people.staff.none')
                : staff.subjects
                    .map((own) => `${subjectName(own.subjectId)} (${gradeText(own.grades)})`)
                    .join('; ')}
            </dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">{t('people.staff.languagesTitle')}</dt>
            <dd>{languageText(staff.languages)}</dd>
          </div>
        </dl>
      )}
      {staff.rights.teaching && (department === undefined || department === null) && (
        <p className="text-sm text-muted-foreground">{t('people.staff.needsAcademic')}</p>
      )}
    </section>
  );
}

function TeachingForm({
  staff,
  offered,
  label,
  onSave,
}: {
  staff: StaffDetail;
  offered: readonly Subject[];
  label: string;
  onSave: (record: StaffTeaching) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  type Fields = 'subjects' | 'languages' | `grades.${string}`;
  const initial: Record<string, string> = {
    subjects: listValue(staff.subjects.map((own) => own.subjectId)),
    languages: listValue(staff.languages),
  };
  for (const subject of offered) {
    initial[`grades.${subject.id}`] = listValue(
      (staff.subjects.find((own) => own.subjectId === subject.id)?.grades ?? []).map(String),
    );
  }
  const form = useRecordForm<Fields, StaffTeaching>({
    schema: asFormSchema<StaffTeaching>(staffTeachingSchema, (path) => {
      const [first, index] = path;
      if (first === 'subjects' && typeof index === 'number') {
        return ['subjects'];
      }
      return [...path];
    }),
    initial: initial,
    read: (typed) => ({
      subjects: listValues(typed.subjects).map((subjectId) => ({
        subjectId,
        grades: listValues(typed[`grades.${subjectId}`] ?? '')
          .map(Number)
          .sort((a, b) => a - b),
      })),
      languages: listValues(typed.languages),
    }),
    save: onSave,
  });
  const chosen = listValues(form.bind('subjects').value);
  return (
    <RecordForm form={form} label={label}>
      <CheckboxGroupField
        label={t('people.staff.subjects')}
        options={offered.map((subject) => ({
          value: subject.id,
          label: nameOf(subject.names, language),
        }))}
        {...form.bind('subjects')}
      />
      {offered
        .filter((subject) => chosen.includes(subject.id))
        .map((subject) => (
          <CheckboxGroupField
            key={subject.id}
            label={t('people.staff.gradesOf', { subject: nameOf(subject.names, language) })}
            options={subject.grades.map((grade) => ({
              value: String(grade),
              label: t('setup.subjects.grade', { grade }),
            }))}
            {...form.bind(`grades.${subject.id}`)}
          />
        ))}
      <CheckboxGroupField
        label={t('people.staff.languagesTitle')}
        options={(['uz', 'ru'] as const).map((one) => ({
          value: one,
          label: t(`people.staff.languages.${one}`),
        }))}
        {...form.bind('languages')}
      />
    </RecordForm>
  );
}

/** The main and further branches (`04`): the Super Admin only (decision 18). */
function BranchesSection({
  staff,
  label,
  onSave,
}: {
  staff: StaffDetail;
  label: string;
  onSave: (record: StaffBranches) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { branches } = useView();
  const main = staff.branches.find((branch) => branch.main)?.branchId ?? '';
  const form = useRecordForm<'mainBranchId' | 'furtherBranchIds', StaffBranches>({
    schema: asFormSchema<StaffBranches>(staffBranchesSchema, (path) => [...path]),
    initial: {
      mainBranchId: main,
      furtherBranchIds: listValue(
        staff.branches.filter((branch) => !branch.main).map((branch) => branch.branchId),
      ),
    },
    read: (typed) => ({
      mainBranchId: typed.mainBranchId,
      furtherBranchIds: listValues(typed.furtherBranchIds).filter(
        (id) => id !== typed.mainBranchId,
      ),
    }),
    save: onSave,
  });
  const chosenMain = form.bind('mainBranchId').value;
  return (
    <section className="grid gap-3">
      <h3 className="text-base font-semibold">{t('people.staff.branchesTitle')}</h3>
      <RecordForm form={form} label={t('people.staff.branchesOf', { name: label })}>
        <SelectField
          label={t('people.staff.mainBranchField')}
          options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
          {...form.bind('mainBranchId')}
        />
        <CheckboxGroupField
          label={t('people.staff.furtherBranches')}
          options={branches
            .filter((branch) => branch.id !== chosenMain)
            .map((branch) => ({ value: branch.id, label: branch.name }))}
          {...form.bind('furtherBranchIds')}
        />
      </RecordForm>
    </section>
  );
}

/**
 * The status with its history (`edge/people-roles-accounts`, Staff over time:
 * "Each status change has a date, which can be in the future"). A change is
 * the Super Admin's; it replaces a change planned after today.
 */
function StatusSection({
  staff,
  label,
  onSave,
}: {
  staff: StaffDetail;
  label: string;
  onSave: (change: StaffStatusChange) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const confirm = useConfirm();
  const form = useRecordForm<'status' | 'from', StaffStatusChange>({
    schema: asFormSchema<StaffStatusChange>(staffStatusChangeSchema, (path) => [...path]),
    initial: { status: '', from: staff.today },
    // A status change cannot be taken back once its date has come, and "left"
    // ends every role of the person's account (`.claude/rules/web.md`).
    save: async (change) => {
      const go = await confirm({
        title: t('people.staff.statusConfirmTitle', {
          status: t(`people.staff.statuses.${change.status}`),
          date: schoolDateText(change.from, language),
        }),
        text:
          change.status === 'left'
            ? t('people.staff.statusConfirmLeft')
            : t('people.staff.statusConfirmText'),
        names: [label],
        action: t('people.staff.statusConfirmAction'),
        destructive: change.status !== 'active',
      });
      if (!go) {
        throw new SaveCancelled();
      }
      await onSave(change);
    },
  });
  return (
    <section className="grid gap-3">
      <h3 className="text-base font-semibold">{t('people.staff.statusTitle')}</h3>
      <p className="text-sm">
        {staff.status === null
          ? t('people.staff.notStarted')
          : t(`people.staff.statuses.${staff.status}`)}
        {staff.planned !== null && (
          <>
            {' '}
            {t('people.staff.planned', {
              status: t(`people.staff.statuses.${staff.planned.status}`),
              date: schoolDateText(staff.planned.from, language),
            })}
          </>
        )}
      </p>
      <table className="text-sm">
        <caption className="sr-only">{t('people.staff.historyTitle')}</caption>
        <thead>
          <tr className="text-left text-muted-foreground">
            <th scope="col" className="py-1 pr-3 font-normal">
              {t('people.staff.statusColumn')}
            </th>
            <th scope="col" className="py-1 pr-3 font-normal">
              {t('people.staff.from')}
            </th>
            <th scope="col" className="py-1 font-normal">
              {t('people.staff.until')}
            </th>
          </tr>
        </thead>
        <tbody>
          {staff.statuses.map((row) => (
            <tr key={row.id}>
              <td className="py-1 pr-3">{t(`people.staff.statuses.${row.status}`)}</td>
              <td className="py-1 pr-3">{schoolDateText(row.from, language)}</td>
              <td className="py-1">
                {row.until === null ? '' : schoolDateText(row.until, language)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {staff.rights.all && (
        <RecordForm form={form} label={t('people.staff.statusOf', { name: label })}>
          <SelectField
            label={t('people.staff.newStatus')}
            options={[
              { value: '', label: t('people.staff.choose') },
              ...STAFF_STATUSES.map((one) => ({
                value: one,
                label: t(`people.staff.statuses.${one}`),
              })),
            ]}
            {...form.bind('status')}
          />
          <DateField label={t('people.staff.from')} min={staff.today} {...form.bind('from')} />
        </RecordForm>
      )}
    </section>
  );
}
