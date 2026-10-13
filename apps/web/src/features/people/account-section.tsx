import {
  accountCreateSchema,
  GIVABLE_ROLES,
  isAppointment,
  roleEndSchema,
  roleGiveSchema,
  SCHOOL_WIDE_ROLES,
  subjectsChangeSchema,
  type AccountCreate,
  type AccountRole,
  type Actor,
  type FirstPasswordSlip,
  type RoleEnd,
  type RoleGive,
  type StaffAccount,
  type StaffDetail,
  type SubjectsChange,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import {
  CheckboxGroupField,
  DateField,
  Field,
  listValue,
  listValues,
  SelectField,
} from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { SaveCancelled } from '@/components/form/save-cancelled';
import { useRecordForm } from '@/components/form/use-record-form';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { SUPER_ADMINS_KEY } from '@/features/access/super-admin-banner';
import { invalidateBranchesWithoutVice } from '@/features/access/vice-principal-banner';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { subjectsQuery } from '@/features/setup/subjects-api';
import { FirstPasswordSlipDialog } from './first-password-slip';
import { asFormSchema } from './form-schema';
import {
  invalidateHeadTeachers,
  loginSuggestionQuery,
  staffAccountKey,
  accountAccessKey,
  neverUsedKey,
  staffAccountQuery,
} from './people-api';
import { schoolDateText } from '@/lib/dates';

/** Who gave or ended a role: the name when the server could read it, the login otherwise. */
const actorText = (actor: Actor): string =>
  actor.name === null ? actor.login : `${actor.name.firstName} ${actor.name.lastName}`;

/**
 * The account and the roles of a person, in the side panel of the staff list
 * (task 2.3a, decisions 4 and 11): the Super Admin creates the account, gives
 * and ends roles; the Principal reads. What the reader may do comes from the
 * server (`canEdit`). A first password is shown once, in the slip dialog.
 */
export function AccountSection({ staff, label }: { staff: StaffDetail; label: string }) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const section = useQuery(staffAccountQuery(branchId, staff.id));
  const [slip, setSlip] = useState<{ slip: FirstPasswordSlip; issued: string } | null>(null);

  /** The answer of a role change is the section as it now is. */
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: staffAccountKey(staff.id) }),
      // What the sign-in access allows follows the roles and the status (task 2.3c-1).
      queryClient.invalidateQueries({ queryKey: accountAccessKey(staff.id) }),
      queryClient.invalidateQueries({ queryKey: neverUsedKey() }),
      queryClient.invalidateQueries({ queryKey: SUPER_ADMINS_KEY }),
      invalidateBranchesWithoutVice(queryClient),
      invalidateHeadTeachers(queryClient),
    ]);
  };

  let body;
  if (section.isError) {
    body = (
      <ErrorState
        error={section.error}
        onRetry={() => {
          void section.refetch();
        }}
      />
    );
  } else if (section.data === undefined) {
    body = <LoadingOutline />;
  } else {
    const data = section.data;
    body =
      data.account === null ? (
        data.canEdit && !data.left ? (
          <CreateAccount
            staff={staff}
            label={label}
            onCreated={async (created) => {
              setSlip({ slip: created, issued: data.today });
              await refresh();
            }}
          />
        ) : (
          <p className="text-sm">{t('people.account.none')}</p>
        )
      ) : (
        <AccountRoles staff={staff} label={label} data={data} onChange={refresh} />
      );
  }

  return (
    <section className="grid gap-3" aria-labelledby={`account-${staff.id}`}>
      <h3 id={`account-${staff.id}`} className="text-base font-semibold">
        {t('people.account.title')}
      </h3>
      {body}
      {slip !== null && (
        <FirstPasswordSlipDialog
          slip={slip.slip}
          issued={slip.issued}
          onClose={() => {
            setSlip(null);
          }}
        />
      )}
    </section>
  );
}

/** The create form, its login filled from the suggestion of answer 14; changeable before it is saved. */
function CreateAccount({
  staff,
  label,
  onCreated,
}: {
  staff: StaffDetail;
  label: string;
  onCreated: (slip: FirstPasswordSlip) => Promise<void>;
}) {
  const { branchId } = useView();
  const suggestion = useQuery(loginSuggestionQuery(branchId, staff.id));
  if (suggestion.isError) {
    return (
      <ErrorState
        error={suggestion.error}
        onRetry={() => {
          void suggestion.refetch();
        }}
      />
    );
  }
  if (suggestion.data === undefined) {
    return <LoadingOutline />;
  }
  return (
    <CreateAccountForm
      key={suggestion.data.login ?? ''}
      staff={staff}
      label={label}
      suggested={suggestion.data.login ?? ''}
      onCreated={onCreated}
    />
  );
}

function CreateAccountForm({
  staff,
  label,
  suggested,
  onCreated,
}: {
  staff: StaffDetail;
  label: string;
  suggested: string;
  onCreated: (slip: FirstPasswordSlip) => Promise<void>;
}) {
  const { t } = useTranslation();
  const create = useMutation({
    // Not through the offline queue and into no cache: the answer holds the
    // first password (correction 4), so the mutation keeps nothing once the
    // slip is handed to its dialog.
    gcTime: 0,
    mutationFn: (account: AccountCreate) =>
      answerOf(
        api.POST('/api/people/staff/{id}/account', {
          params: { header: branchHeader(), path: { id: staff.id } },
          body: account,
        }),
      ),
  });
  const form = useRecordForm<'login', AccountCreate>({
    schema: asFormSchema<AccountCreate>(accountCreateSchema, (path) => [...path]),
    initial: { login: suggested },
    save: async (account) => {
      const answer = await create.mutateAsync(account);
      create.reset();
      await onCreated(answer);
    },
    message: (field) => (field === 'login' ? t('people.account.loginFormat') : undefined),
  });
  const bound = form.bind('login');
  const taken =
    form.failure instanceof ApiFailure &&
    form.failure.code === 'login_taken' &&
    form.failure.details?.some((detail) => detail.path === 'login') === true;
  return (
    <RecordForm form={form} label={t('people.account.createOf', { name: label })}>
      <Field
        label={t('people.account.login')}
        autoComplete="off"
        spellCheck={false}
        {...bound}
        error={bound.error ?? (taken ? t('errors.login_taken') : undefined)}
      />
    </RecordForm>
  );
}

const stateText = (role: AccountRole) => `people.account.states.${role.state}` as const;

/** The account, its roles with their dates, and the forms to give and end roles. */
function AccountRoles({
  staff,
  label,
  data,
  onChange,
}: {
  staff: StaffDetail;
  label: string;
  data: StaffAccount;
  onChange: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const [ending, setEnding] = useState<string | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  const account = data.account;
  if (account === null) {
    return null;
  }
  return (
    <div className="grid gap-4">
      <p className="text-sm">
        <span className="font-semibold">{account.login}</span>
        {account.neverUsed && <> · {t('people.account.neverUsed')}</>}
        {account.locked && <> · {t('people.account.locked')}</>}
      </p>
      {account.roles.length === 0 ? (
        <p className="text-sm">{t('people.account.noRoles')}</p>
      ) : (
        <table className="text-sm">
          <caption className="sr-only">{t('people.account.rolesTitle')}</caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="py-1 pr-3 font-normal">
                {t('people.account.role')}
              </th>
              <th scope="col" className="py-1 pr-3 font-normal">
                {t('people.account.branch')}
              </th>
              <th scope="col" className="py-1 pr-3 font-normal">
                {t('people.account.dates')}
              </th>
              <th scope="col" className="py-1 font-normal">
                <span className="sr-only">{t('people.account.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {account.roles.map((role) => (
              <tr key={role.id} data-role={role.role}>
                <td className="py-1 pr-3 align-top">
                  {t(`roles.${role.role}`)}
                  {role.subjects.length > 0 && (
                    <span className="block text-xs" data-subjects>
                      {role.subjects
                        .map((subject) =>
                          subject.archived
                            ? t('people.account.archivedSubject', {
                                name: nameOf(subject.names, language),
                              })
                            : nameOf(subject.names, language),
                        )
                        .join(', ')}
                    </span>
                  )}
                  {role.givenBy !== null && (
                    <span className="block text-xs text-muted-foreground">
                      {t('people.account.givenBy', { name: actorText(role.givenBy) })}
                    </span>
                  )}
                </td>
                <td className="py-1 pr-3 align-top">
                  {role.branchName ?? t('people.account.allBranches')}
                </td>
                <td className="py-1 pr-3 align-top">
                  {schoolDateText(role.from, language)}
                  {role.until !== null && <> – {schoolDateText(role.until, language)}</>}
                  <span className="block text-xs text-muted-foreground">{t(stateText(role))}</span>
                </td>
                <td className="py-1 align-top">
                  {data.canEdit && role.state !== 'ended' && isAppointment(role.role) && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={t('people.account.changeSubjectsOf', {
                        role: t(`roles.${role.role}`),
                      })}
                      onClick={() => {
                        setChanging(role.id);
                      }}
                    >
                      {t('people.account.changeSubjects')}
                    </Button>
                  )}
                  {data.canEdit && role.state !== 'ended' && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={t('people.account.endOf', {
                        role: t(`roles.${role.role}`),
                      })}
                      onClick={() => {
                        setEnding(role.id);
                      }}
                    >
                      {t('people.account.end')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.canEdit &&
        account.roles
          .filter((role) => role.id === ending && role.state !== 'ended')
          .map((role) => (
            <EndRoleForm
              key={role.id}
              staff={staff}
              label={label}
              role={role}
              today={data.today}
              onEnded={async () => {
                setEnding(null);
                await onChange();
              }}
            />
          ))}
      {data.canEdit &&
        account.roles
          .filter(
            (role) => role.id === changing && role.state !== 'ended' && isAppointment(role.role),
          )
          .map((role) => (
            <ChangeSubjectsForm
              key={role.id}
              staff={staff}
              role={role}
              today={data.today}
              onChanged={async () => {
                setChanging(null);
                await onChange();
              }}
            />
          ))}
      {data.canEdit && !data.left && (
        <GiveRoleForm staff={staff} label={label} today={data.today} onGiven={onChange} />
      )}
    </div>
  );
}

type GiveField = 'role' | 'branchId' | 'from' | 'subjectIds';

/**
 * The active subjects of the school for an appointment, in the language of the
 * screen (task 2.3b-1). The list is the same in every branch.
 */
function useSubjectOptions() {
  const { i18n } = useTranslation();
  const { branchId } = useView();
  const subjects = useQuery(subjectsQuery(branchId));
  const options = (subjects.data?.subjects ?? [])
    .filter((subject) => subject.archivedAt === null)
    .map((subject) => ({ value: subject.id, label: nameOf(subject.names, i18n.language) }))
    .sort((a, b) => a.label.localeCompare(b.label, i18n.language));
  return { subjects, options };
}

/**
 * The subjects of an appointment: one switch per active subject, and "Choose
 * all" for an appointment of every subject (decision 9 of #63). A failed list
 * says so with a retry.
 */
function SubjectsField({
  bound,
}: {
  bound: Omit<ComponentProps<typeof CheckboxGroupField>, 'label' | 'options'>;
}) {
  const { t } = useTranslation();
  const { subjects, options } = useSubjectOptions();
  if (subjects.isError) {
    return (
      <p className="text-sm" role="alert">
        {t('people.account.subjectsFailed')}{' '}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            void subjects.refetch();
          }}
        >
          {t('people.account.retry')}
        </Button>
      </p>
    );
  }
  if (subjects.data === undefined) {
    return <LoadingOutline />;
  }
  return (
    <div className="grid gap-2">
      <CheckboxGroupField label={t('people.account.subjects')} options={options} {...bound} />
      <div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            bound.onChange({ target: { value: listValue(options.map((option) => option.value)) } });
          }}
        >
          {t('people.account.chooseAll')}
        </Button>
      </div>
    </div>
  );
}

/** A role from a date (decision 10): no branch for the Super Admin, one of the person's branches otherwise. */
function GiveRoleForm({
  staff,
  label,
  today,
  onGiven,
}: {
  staff: StaffDetail;
  label: string;
  today: string;
  onGiven: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const give = useMutation({
    mutationFn: (role: RoleGive) =>
      answerOf(
        api.POST('/api/people/staff/{id}/roles', {
          params: { header: branchHeader(), path: { id: staff.id } },
          body: role,
        }),
      ),
  });
  const main = staff.branches.find((branch) => branch.main) ?? staff.branches[0];
  const form = useRecordForm<GiveField, RoleGive>({
    schema: asFormSchema<RoleGive>(roleGiveSchema, (path) => [...path]),
    initial: { role: '', branchId: main?.branchId ?? '', from: today, subjectIds: '' },
    read: (typed) => ({
      role: typed.role,
      branchId:
        SCHOOL_WIDE_ROLES.some((one) => one === typed.role) || typed.branchId === ''
          ? null
          : typed.branchId,
      from: typed.from,
      ...(APPOINTMENT_ROLE_VALUES.includes(typed.role)
        ? { subjectIds: listValues(typed.subjectIds) }
        : {}),
    }),
    save: async (role) => {
      await give.mutateAsync(role);
      await onGiven();
    },
  });
  const role = form.bind('role');
  return (
    <RecordForm form={form} label={t('people.account.giveOf', { name: label })}>
      <SelectField
        label={t('people.account.newRole')}
        options={[
          { value: '', label: t('people.account.choose') },
          ...GIVABLE_ROLES.map((one) => ({ value: one, label: t(`roles.${one}`) })),
        ]}
        {...role}
      />
      {!SCHOOL_WIDE_ROLES.some((one) => one === role.value) && (
        <SelectField
          label={t('people.account.branch')}
          options={staff.branches.map((branch) => ({
            value: branch.branchId,
            label: branch.name,
          }))}
          {...form.bind('branchId')}
        />
      )}
      {APPOINTMENT_ROLE_VALUES.includes(role.value) && (
        <SubjectsField bound={form.bind('subjectIds')} />
      )}
      <DateField label={t('people.account.from')} min={today} {...form.bind('from')} />
    </RecordForm>
  );
}

const APPOINTMENT_ROLE_VALUES: readonly string[] = GIVABLE_ROLES.filter((one) =>
  isAppointment(one),
);

/**
 * The subjects of a Head Teacher or Senior Head Teacher appointment from a
 * date (task 2.3b-1, decision 6 of #63): the server ends it and begins a new
 * one with these subjects at the same moment.
 */
function ChangeSubjectsForm({
  staff,
  role,
  today,
  onChanged,
}: {
  staff: StaffDetail;
  role: AccountRole;
  today: string;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const change = useMutation({
    mutationFn: (changed: SubjectsChange) =>
      answerOf(
        api.POST('/api/people/staff/{id}/roles/{assignmentId}/subjects', {
          params: { header: branchHeader(), path: { id: staff.id, assignmentId: role.id } },
          body: changed,
        }),
      ),
  });
  const form = useRecordForm<'subjectIds' | 'from', SubjectsChange>({
    schema: asFormSchema<SubjectsChange>(subjectsChangeSchema, (path) => [...path]),
    // An archived subject is kept by the appointment but not offered again
    // (decision 12 of #63): the change starts from the active ones.
    initial: {
      subjectIds: listValue(
        role.subjects.filter((subject) => !subject.archived).map((subject) => subject.id),
      ),
      from: today,
    },
    read: (typed) => ({ subjectIds: listValues(typed.subjectIds), from: typed.from }),
    save: async (changed) => {
      await change.mutateAsync(changed);
      await onChanged();
    },
  });
  return (
    <RecordForm
      form={form}
      label={t('people.account.changeSubjectsOf', { role: t(`roles.${role.role}`) })}
    >
      <SubjectsField bound={form.bind('subjectIds')} />
      <DateField label={t('people.account.subjectsFrom')} min={today} {...form.bind('from')} />
    </RecordForm>
  );
}

/** The end of a role from a date: today ends it now, a later date at the start of that day. */
function EndRoleForm({
  staff,
  label,
  role,
  today,
  onEnded,
}: {
  staff: StaffDetail;
  label: string;
  role: AccountRole;
  today: string;
  onEnded: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const end = useMutation({
    mutationFn: (ending: RoleEnd) =>
      answerOf(
        api.POST('/api/people/staff/{id}/roles/{assignmentId}/end', {
          params: { header: branchHeader(), path: { id: staff.id, assignmentId: role.id } },
          body: ending,
        }),
      ),
  });
  const roleName = t(`roles.${role.role}`);
  const form = useRecordForm<'from', RoleEnd>({
    schema: asFormSchema<RoleEnd>(roleEndSchema, (path) => [...path]),
    initial: { from: today },
    // An end that has come cannot be taken back (0.7a).
    save: async (ending) => {
      const go = await confirm({
        title: t('people.account.endConfirmTitle', {
          role: roleName,
          date: schoolDateText(ending.from, i18n.language),
        }),
        text: t('people.account.endConfirmText'),
        names: [`${label}: ${roleName}, ${role.branchName ?? t('people.account.allBranches')}`],
        action: t('people.account.end'),
        destructive: true,
      });
      if (!go) {
        throw new SaveCancelled();
      }
      await end.mutateAsync(ending);
      await onEnded();
    },
  });
  return (
    <RecordForm form={form} label={t('people.account.endOf', { role: roleName })}>
      <DateField label={t('people.account.endFrom')} min={today} {...form.bind('from')} />
    </RecordForm>
  );
}
