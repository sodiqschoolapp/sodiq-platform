import {
  DEFAULT_PHONE_PREFIX,
  RELATIONSHIPS,
  relativeLinkEditSchema,
  relativeLinkInputSchema,
  relativePhoneSchema,
  studentRelativesSchema,
  type RelativeHolder,
  type RelativeLinkEdit,
  type RelativeLinkInput,
  type StudentRelative,
  type StudentRelatives,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { CHECKED, CheckboxField, Field, SelectField } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { asFormSchema } from './form-schema';
import { invalidateRelatives, phoneMatch, studentRelativesQuery } from './people-api';
import { NoticesField, phoneHolderOf, smsWarning } from './relative-form';

type AddField =
  | 'phone'
  | 'noPhone'
  | 'fullName'
  | 'workplace'
  | 'email'
  | 'relationship'
  | 'mainContact'
  | 'portalAccess'
  | 'receivesNotices';

type LinkField = 'relationship' | 'mainContact' | 'portalAccess' | 'receivesNotices';

const ADD_SCHEMA = asFormSchema<RelativeLinkInput>(relativeLinkInputSchema, (path) => {
  const last = path[path.length - 1];
  return [typeof last === 'string' ? last : 'phone'];
});
const LINK_SCHEMA = asFormSchema<RelativeLinkEdit>(relativeLinkEditSchema, (path) => [...path]);

const checked = (on: boolean) => (on ? CHECKED : '');

/**
 * The Relatives tab of a student (`04`, Close relatives; `edge/close-relatives`;
 * task 2.5a): the linked relatives with relationship, main contact and phone;
 * the link switches and workplace and email as far as the reader may see them.
 * The Super Admin and the Academic Vice Principal add, change and unlink, the
 * phone typed first; the last relative stays, and unlinking the main contact
 * names the next one.
 */
export function StudentRelativesTab({ studentId, name }: { studentId: string; name: string }) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const relatives = useQuery(studentRelativesQuery(branchId, studentId));
  const [adding, setAdding] = useState(false);
  if (relatives.isError) {
    return (
      <ErrorState
        error={relatives.error}
        onRetry={() => {
          void relatives.refetch();
        }}
      />
    );
  }
  if (relatives.data === undefined) {
    return <LoadingOutline />;
  }
  const { canEdit } = relatives.data;
  const list = relatives.data.relatives;
  const addButton = canEdit && !adding && (
    <Button
      variant="secondary"
      onClick={() => {
        setAdding(true);
      }}
    >
      {t('people.relatives.add')}
    </Button>
  );
  return (
    <section className="grid gap-4">
      {list.length === 0 ? (
        <EmptyState
          text={t('people.relatives.needsRelative')}
          action={addButton === false ? undefined : addButton}
        />
      ) : (
        <ul className="grid gap-4">
          {list.map((relative) => (
            <li key={relative.relativeId} className="grid gap-3 rounded-lg border p-4">
              <RelativeRow relative={relative} />
              {canEdit && (
                <LinkEditor
                  studentId={studentId}
                  studentName={name}
                  relative={relative}
                  others={list.filter((one) => one.relativeId !== relative.relativeId)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {list.length > 0 && addButton !== false && <div>{addButton}</div>}
      {adding && (
        <AddRelative
          studentId={studentId}
          studentName={name}
          first={list.length === 0}
          onDone={() => {
            setAdding(false);
          }}
        />
      )}
    </section>
  );
}

/** One relative as the reader may see them. */
function RelativeRow({ relative }: { relative: StudentRelative }) {
  const { t } = useTranslation();
  const notSet = t('people.relatives.notSet');
  const rows: [string, string][] = [
    [
      t('people.relatives.relationship'),
      t(`people.relatives.relationships.${relative.relationship}`),
    ],
    [t('people.relatives.phone'), relative.phone ?? t('people.relatives.noPhone')],
  ];
  if (relative.identity !== null) {
    rows.push(
      [t('people.relatives.workplace'), relative.identity.workplace ?? notSet],
      [t('people.relatives.email'), relative.identity.email ?? notSet],
    );
  }
  return (
    <div className="grid gap-2">
      <p className="font-semibold">
        {relative.fullName}
        {relative.mainContact && (
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {t('people.relatives.mainContact')}
          </span>
        )}
      </p>
      <dl className="grid gap-2 text-sm">
        {rows.map(([term, value]) => (
          <div key={term} className="grid gap-0.5">
            <dt className="text-muted-foreground">{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Sends a change of the links and puts the answer in place of the tab. */
function useLinkChange<Input>(
  studentId: string,
  send: (input: Input) => Promise<unknown>,
  after?: () => void,
) {
  const queryClient = useQueryClient();
  const { branchId } = useView();
  return useMutation({
    mutationFn: send,
    onSuccess: async (answer) => {
      queryClient.setQueryData<StudentRelatives>(
        studentRelativesQuery(branchId, studentId).queryKey,
        studentRelativesSchema.parse(answer),
      );
      after?.();
      await invalidateRelatives(queryClient);
    },
  });
}

/** The switches of one link and its unlink (decision 12: the main contact moves in one change). */
function LinkEditor({
  studentId,
  studentName,
  relative,
  others,
}: {
  studentId: string;
  studentName: string;
  relative: StudentRelative;
  others: StudentRelative[];
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const where = {
    header: branchHeader(),
    path: { id: studentId, relativeId: relative.relativeId },
  };
  const save = useLinkChange(studentId, (input: RelativeLinkEdit) =>
    answerOf(
      api.PATCH('/api/people/students/{id}/relatives/{relativeId}', { params: where, body: input }),
    ),
  );
  const unlink = useLinkChange(studentId, (newMainContactId: string | null) =>
    answerOf(
      api.POST('/api/people/students/{id}/relatives/{relativeId}/unlink', {
        params: where,
        body: { newMainContactId },
      }),
    ),
  );
  const [nextMain, setNextMain] = useState('');
  const form = useRecordForm<LinkField, RelativeLinkEdit>({
    schema: LINK_SCHEMA,
    initial: {
      relationship: relative.relationship,
      mainContact: checked(relative.mainContact),
      portalAccess: checked(relative.portalAccess ?? true),
      receivesNotices: checked(relative.receivesNotices ?? true),
    },
    read: (typed) => ({
      relationship: typed.relationship,
      mainContact: typed.mainContact === CHECKED,
      portalAccess: typed.portalAccess === CHECKED,
      receivesNotices: typed.receivesNotices === CHECKED,
    }),
    save: async (input) => {
      await save.mutateAsync(input);
    },
  });
  const option = (value: string, text: string) => ({ value, label: text });
  const needsNext = relative.mainContact && others.length > 0;
  const choice = others.some((one) => one.relativeId === nextMain) ? nextMain : '';
  return (
    <div className="grid gap-3">
      <RecordForm form={form} label={t('people.relatives.linkLabel', { name: relative.fullName })}>
        <SelectField
          label={t('people.relatives.relationship')}
          options={RELATIONSHIPS.map((one) =>
            option(one, t(`people.relatives.relationships.${one}`)),
          )}
          {...form.bind('relationship')}
        />
        {/* The main contact is moved by marking another one (decision 12). */}
        {!relative.mainContact && (
          <CheckboxField label={t('people.relatives.mainContact')} {...form.bind('mainContact')} />
        )}
        <CheckboxField label={t('people.relatives.portalAccess')} {...form.bind('portalAccess')} />
        <NoticesField
          label={t('people.relatives.receivesNotices')}
          hasPhone={relative.phone !== null}
          note={
            relative.phone === null && relative.mainContact
              ? t('people.relatives.noPhoneMain')
              : undefined
          }
          {...form.bind('receivesNotices')}
        />
      </RecordForm>
      {others.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          {needsNext && (
            <SelectField
              label={t('people.relatives.newMain')}
              options={[
                option('', t('people.relatives.choose')),
                ...others.map((one) => option(one.relativeId, one.fullName)),
              ]}
              name="newMain"
              value={choice}
              error={undefined}
              onChange={(event) => {
                setNextMain(event.target.value);
              }}
            />
          )}
          <Button
            variant="secondary"
            disabled={unlink.isPending || (needsNext && choice === '')}
            onClick={() => {
              void confirm({
                title: t('people.relatives.unlinkTitle'),
                text: t('people.relatives.unlinkText'),
                names: [relative.fullName, studentName],
                action: t('people.relatives.unlink'),
                destructive: true,
              }).then((go) => {
                if (go) {
                  unlink.mutate(needsNext ? choice : null);
                }
              });
            }}
          >
            {t('people.relatives.unlink')}
          </Button>
          <FailureAlert error={unlink.error} />
        </div>
      )}
    </div>
  );
}

/** A relative added to the student, the phone typed first (`04`, Adding a relative). */
function AddRelative({
  studentId,
  studentName,
  first,
  onDone,
}: {
  studentId: string;
  studentName: string;
  first: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [match, setMatch] = useState<{ phone: string; holder: RelativeHolder } | null>(null);
  const add = useLinkChange(
    studentId,
    (input: RelativeLinkInput) =>
      answerOf(
        api.POST('/api/people/students/{id}/relatives', {
          params: { header: branchHeader(), path: { id: studentId } },
          body: input,
        }),
      ),
    onDone,
  );
  const storedPhone = (typed: string): string | null => {
    const parsed = relativePhoneSchema.safeParse(typed);
    return parsed.success ? parsed.data : null;
  };
  const form = useRecordForm<AddField, RelativeLinkInput>({
    schema: ADD_SCHEMA,
    initial: {
      phone: `${DEFAULT_PHONE_PREFIX} `,
      noPhone: '',
      fullName: '',
      workplace: '',
      email: '',
      relationship: '',
      mainContact: checked(first),
      portalAccess: CHECKED,
      receivesNotices: CHECKED,
    },
    read: (typed) => {
      const noPhone = typed.noPhone === CHECKED;
      const phoneNow = noPhone ? null : storedPhone(typed.phone);
      const link = {
        relationship: typed.relationship,
        mainContact: typed.mainContact === CHECKED,
        portalAccess: typed.portalAccess === CHECKED,
        receivesNotices: typed.receivesNotices === CHECKED,
      };
      return match !== null && phoneNow === match.phone && match.holder.id !== null
        ? { kind: 'existing', relativeId: match.holder.id, phone: match.phone, ...link }
        : {
            kind: 'new',
            relative: {
              fullName: typed.fullName,
              phone: noPhone ? null : typed.phone,
              workplace: typed.workplace,
              email: typed.email,
            },
            ...link,
          };
    },
    save: async (input) => {
      try {
        await add.mutateAsync(input);
      } catch (error) {
        const holder = phoneHolderOf(error);
        if (
          holder !== null &&
          holder.id !== null &&
          input.kind === 'new' &&
          input.relative.phone !== null
        ) {
          setMatch({
            phone: input.relative.phone,
            holder: { id: holder.id, fullName: holder.fullName, students: holder.students },
          });
        }
        throw error;
      }
    },
  });
  const noPhone = form.bind('noPhone').value === CHECKED;
  const phone = form.bind('phone');
  const found =
    !noPhone && match !== null && storedPhone(phone.value) === match.phone ? match.holder : null;
  const option = (value: string, text: string) => ({ value, label: text });
  return (
    <section className="grid gap-3">
      <h3 className="text-base font-semibold">{t('people.relatives.add')}</h3>
      <RecordForm form={form} label={t('people.relatives.formLabel', { name: studentName })}>
        <CheckboxField
          label={t('people.relatives.noPhone')}
          {...form.bind('noPhone')}
          note={
            noPhone && (first || form.bind('mainContact').value === CHECKED)
              ? t('people.relatives.noPhoneMain')
              : undefined
          }
        />
        {!noPhone && (
          <Field
            label={t('people.relatives.phone')}
            type="tel"
            autoComplete="off"
            {...phone}
            note={smsWarning(phone.value) ? t('people.relatives.noSms') : undefined}
            onBlur={() => {
              const typed = storedPhone(phone.value);
              if (typed === null || typed === match?.phone) {
                return;
              }
              void phoneMatch(typed)
                .then((holder) => {
                  setMatch(holder === null || holder.id === null ? null : { phone: typed, holder });
                })
                .catch(() => {
                  setMatch(null);
                });
            }}
          />
        )}
        {found !== null ? (
          <p role="status" className="text-sm">
            {t('people.relatives.found', { name: found.fullName, count: found.students })}
          </p>
        ) : (
          <>
            <Field
              label={t('people.relatives.fullName')}
              autoComplete="off"
              {...form.bind('fullName')}
            />
            <Field
              label={t('people.relatives.workplace')}
              autoComplete="off"
              {...form.bind('workplace')}
            />
            <Field
              label={t('people.relatives.email')}
              type="email"
              autoComplete="off"
              {...form.bind('email')}
            />
          </>
        )}
        <SelectField
          label={t('people.relatives.relationship')}
          options={[
            option('', t('people.relatives.choose')),
            ...RELATIONSHIPS.map((one) => option(one, t(`people.relatives.relationships.${one}`))),
          ]}
          {...form.bind('relationship')}
        />
        {!first && (
          <CheckboxField label={t('people.relatives.mainContact')} {...form.bind('mainContact')} />
        )}
        <CheckboxField label={t('people.relatives.portalAccess')} {...form.bind('portalAccess')} />
        <NoticesField
          label={t('people.relatives.receivesNotices')}
          hasPhone={!noPhone}
          {...form.bind('receivesNotices')}
        />
      </RecordForm>
    </section>
  );
}
