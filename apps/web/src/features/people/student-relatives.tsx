import {
  phoneText,
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
import { CHECKED, CheckboxField, Field, PhoneField, SelectField } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { asFormSchema } from './form-schema';
import { invalidateRelatives, phoneMatch, studentRelativesQuery } from './people-api';
import {
  extraPhoneIssueField,
  extraPhonesInitial,
  extraPhonesTyped,
  ExtraPhonesField,
  NEW_OWNER,
  NoticesField,
  OwnerChoice,
  phoneHolderOf,
  SAME_PERSON,
  smsWarning,
  type ExtraPhoneFields,
  linkingFound,
  usePhoneLookup,
} from './relative-form';
import { SECTION_TITLE } from '@/components/ui/control';
import type { PanelEditing } from '@/components/list/use-panel-editing';

type AddField =
  | 'owner'
  | 'previousPhone'
  | 'previousUnknown'
  | 'phone'
  | 'noPhone'
  | 'fullName'
  | 'workplace'
  | 'email'
  | 'relationship'
  | 'mainContact'
  | 'portalAccess'
  | 'receivesNotices'
  | 'extraCount'
  | 'extra1'
  | 'extra2'
  | 'extra3';

/** The extra phones of a new relative (task 2.5b-2). */
const EXTRA_FIELDS: ExtraPhoneFields<'extraCount' | 'extra1' | 'extra2' | 'extra3'> = {
  count: 'extraCount',
  phones: ['extra1', 'extra2', 'extra3'],
};

type LinkField = 'relationship' | 'mainContact' | 'portalAccess' | 'receivesNotices';

const ADD_SCHEMA = asFormSchema<RelativeLinkInput>(relativeLinkInputSchema, (path) => {
  const extra = extraPhoneIssueField(path, EXTRA_FIELDS);
  if (extra !== undefined) {
    return [extra];
  }
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
 * names the next one. Each row reads first; its form opens behind its button
 * through the side panel, one at a time (task 2.7c-2b-2b).
 */
export function StudentRelativesTab({
  studentId,
  name,
  panel,
}: {
  studentId: string;
  name: string;
  panel: PanelEditing;
}) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const relatives = useQuery(studentRelativesQuery(branchId, studentId));
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
  const addButton = canEdit && panel.editing !== 'relative-new' && (
    <Button
      variant="secondary"
      {...panel.opener('relative-new')}
      onClick={() => {
        panel.start('relative-new');
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
                <LinkActions
                  studentId={studentId}
                  studentName={name}
                  relative={relative}
                  others={list.filter((one) => one.relativeId !== relative.relativeId)}
                  panel={panel}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {list.length > 0 && addButton !== false && <div>{addButton}</div>}
      {panel.editing === 'relative-new' && (
        <AddRelative
          studentId={studentId}
          studentName={name}
          first={list.length === 0}
          onDone={() => {
            panel.stop({ saved: true, key: 'relative-new' });
          }}
          onCancel={() => {
            panel.stop();
          }}
        />
      )}
    </section>
  );
}

/** One relative as the reader may see them; the extra phones under the main one (task 2.5b-2). */
function RelativeRow({ relative }: { relative: StudentRelative }) {
  const { t } = useTranslation();
  const notSet = t('people.relatives.notSet');
  const rows: [string, string][] = [
    [
      t('people.relatives.relationship'),
      t(`people.relatives.relationships.${relative.relationship}`),
    ],
    [
      t('people.relatives.phone'),
      relative.phone === null ? t('people.relatives.noPhone') : phoneText(relative.phone),
    ],
  ];
  if (relative.extraPhones.length > 0) {
    rows.push([t('people.relatives.extraPhones'), relative.extraPhones.map(phoneText).join(', ')]);
  }
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

/**
 * The actions of one link in its row (decision 12 of task 2.5a: the main
 * contact moves in one change): "Change the link" opens its form, and
 * "Unlink", only while another relative is linked (`04`: the last relative
 * stays), acts behind its confirmation, or first asks for the new main
 * contact when this one is the main contact. Both give way while another
 * form of the panel is open.
 */
function LinkActions({
  studentId,
  studentName,
  relative,
  others,
  panel,
}: {
  studentId: string;
  studentName: string;
  relative: StudentRelative;
  others: StudentRelative[];
  panel: PanelEditing;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const linkKey = `link:${relative.relativeId}`;
  const unlinkKey = `unlink:${relative.relativeId}`;
  const where = {
    header: branchHeader(),
    path: { id: studentId, relativeId: relative.relativeId },
  };
  const save = useLinkChange(studentId, (input: RelativeLinkEdit) =>
    answerOf(
      api.PATCH('/api/people/students/{id}/relatives/{relativeId}', { params: where, body: input }),
    ),
  );
  // The row goes with the unlink: the focus goes to "Add relative".
  const unlink = useLinkChange(
    studentId,
    (newMainContactId: string | null) =>
      answerOf(
        api.POST('/api/people/students/{id}/relatives/{relativeId}/unlink', {
          params: where,
          body: { newMainContactId },
        }),
      ),
    () => {
      // With the choice open it closes; done at once, "Saved." is said all the same.
      panel.stop({ saved: true, key: unlinkKey, focus: 'relative-new' });
      panel.point('relative-new', { saved: true });
    },
  );
  const askUnlink = async (newMainContactId: string | null) => {
    const go = await confirm({
      title: t('people.relatives.unlinkTitle'),
      text: t('people.relatives.unlinkText'),
      names: [relative.fullName, studentName],
      action: t('people.relatives.unlink'),
      destructive: true,
    });
    if (go) {
      unlink.mutate(newMainContactId);
    }
  };
  const needsNext = relative.mainContact && others.length > 0;
  return panel.editing === `link:${relative.relativeId}` ? (
    <LinkForm
      relative={relative}
      onSave={async (input) => {
        await save.mutateAsync(input);
        panel.stop({ saved: true, key: linkKey });
      }}
      onCancel={() => {
        panel.stop();
      }}
    />
  ) : panel.editing === `unlink:${relative.relativeId}` ? (
    <UnlinkChoiceForm
      relative={relative}
      others={others}
      pending={unlink.isPending}
      failure={unlink.error}
      onUnlink={(newMainContactId) => {
        void askUnlink(newMainContactId);
      }}
      onCancel={() => {
        unlink.reset();
        panel.stop();
      }}
    />
  ) : panel.editing === null ? (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="secondary"
        {...panel.opener(linkKey)}
        onClick={() => {
          panel.start(linkKey);
        }}
      >
        {t('people.relatives.changeLink')}
      </Button>
      {others.length > 0 && (
        <Button
          variant="secondary"
          {...panel.opener(unlinkKey)}
          disabled={unlink.isPending}
          onClick={() => {
            if (needsNext) {
              unlink.reset();
              panel.start(unlinkKey);
              return;
            }
            void askUnlink(null);
          }}
        >
          {t('people.relatives.unlink')}
        </Button>
      )}
      <FailureAlert error={unlink.error} />
    </div>
  ) : null;
}

/** The switches of one link. */
function LinkForm({
  relative,
  onSave,
  onCancel,
}: {
  relative: StudentRelative;
  onSave: (input: RelativeLinkEdit) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
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
    save: onSave,
  });
  const option = (value: string, text: string) => ({ value, label: text });
  return (
    <RecordForm
      form={form}
      label={t('people.relatives.linkLabel', { name: relative.fullName })}
      onCancel={onCancel}
    >
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
  );
}

/**
 * The unlink of the main contact: another relative is chosen as the main
 * contact in the same action (`edge/close-relatives`, row 6).
 */
function UnlinkChoiceForm({
  relative,
  others,
  pending,
  failure,
  onUnlink,
  onCancel,
}: {
  relative: StudentRelative;
  others: StudentRelative[];
  pending: boolean;
  failure: unknown;
  onUnlink: (newMainContactId: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [nextMain, setNextMain] = useState('');
  // Unlink pressed with no new main contact chosen (issue #39, hand test of
  // 13 October 2026, finding 6): the select says what to do first.
  const [mainMissing, setMainMissing] = useState(false);
  const choice = others.some((one) => one.relativeId === nextMain) ? nextMain : '';
  return (
    <form
      data-slot="panel-form"
      className="grid gap-3"
      aria-label={t('people.relatives.unlinkLabel', { name: relative.fullName })}
      onSubmit={(event) => {
        event.preventDefault();
        if (choice === '') {
          setMainMissing(true);
          return;
        }
        onUnlink(choice);
      }}
    >
      <SelectField
        label={t('people.relatives.newMain')}
        options={[
          { value: '', label: t('people.relatives.choose') },
          ...others.map((one) => ({ value: one.relativeId, label: one.fullName })),
        ]}
        name="newMain"
        value={choice}
        error={mainMissing && choice === '' ? t('people.relatives.chooseMainFirst') : undefined}
        onChange={(event) => {
          setNextMain(event.target.value);
          setMainMissing(false);
        }}
      />
      <FailureAlert error={failure} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="destructive" disabled={pending}>
          {t('people.relatives.unlink')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('form.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** A relative added to the student, the phone typed first (`04`, Adding a relative). */
function AddRelative({
  studentId,
  studentName,
  first,
  onDone,
  onCancel,
}: {
  studentId: string;
  studentName: string;
  first: boolean;
  onDone: () => void;
  onCancel: () => void;
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
  const lookup = usePhoneLookup(phoneMatch);
  const lookUp = (typedPhone: string) => {
    const typed = storedPhone(typedPhone);
    if (typed === null || typed === match?.phone) {
      return;
    }
    void lookup(typed).then((holder) => {
      setMatch(holder === null || holder.id === null ? null : { phone: typed, holder });
    });
  };
  const form = useRecordForm<AddField, RelativeLinkInput>({
    schema: ADD_SCHEMA,
    initial: {
      owner: SAME_PERSON,
      previousPhone: `${DEFAULT_PHONE_PREFIX} `,
      previousUnknown: '',
      phone: `${DEFAULT_PHONE_PREFIX} `,
      noPhone: '',
      fullName: '',
      workplace: '',
      email: '',
      relationship: '',
      mainContact: checked(first),
      portalAccess: CHECKED,
      receivesNotices: CHECKED,
      ...extraPhonesInitial(EXTRA_FIELDS, []),
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
      const matched =
        match !== null && phoneNow === match.phone && match.holder.id !== null ? match : null;
      if (matched !== null && matched.holder.id !== null && typed.owner === NEW_OWNER) {
        // "Different person, the number has a new owner" (task 2.5b-1).
        return {
          kind: 'new_owner',
          relative: {
            fullName: typed.fullName,
            phone: typed.phone,
            workplace: typed.workplace,
            email: typed.email,
            extraPhones: extraPhonesTyped(EXTRA_FIELDS, typed),
          },
          previousId: matched.holder.id,
          previousPhone: typed.previousUnknown === CHECKED ? null : typed.previousPhone,
          ...link,
        };
      }
      return matched !== null && matched.holder.id !== null
        ? { kind: 'existing', relativeId: matched.holder.id, phone: matched.phone, ...link }
        : {
            kind: 'new',
            relative: {
              fullName: typed.fullName,
              phone: noPhone ? null : typed.phone,
              workplace: typed.workplace,
              email: typed.email,
              extraPhones: extraPhonesTyped(EXTRA_FIELDS, typed),
            },
            ...link,
          };
    },
    save: async (typedInput) => {
      // H26: Save waits for the lookup of the phone it sends and links the person found.
      const found =
        typedInput.kind === 'new' && typedInput.relative.phone !== null
          ? await lookup(typedInput.relative.phone)
          : null;
      if (
        found !== null &&
        found.id !== null &&
        typedInput.kind === 'new' &&
        typedInput.relative.phone !== null
      ) {
        setMatch({ phone: typedInput.relative.phone, holder: found });
      }
      const input = linkingFound(typedInput, found);
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
      <h3 className={SECTION_TITLE}>{t('people.relatives.add')}</h3>
      <RecordForm
        form={form}
        label={t('people.relatives.formLabel', { name: studentName })}
        onCancel={onCancel}
      >
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
          <PhoneField
            label={t('people.relatives.phone')}
            {...phone}
            note={smsWarning(phone.value) ? t('people.relatives.noSms') : undefined}
            // The lookup starts once a whole number is typed (H26), and again on leaving.
            onChange={(event) => {
              phone.onChange(event);
              lookUp(event.target.value);
            }}
            onBlur={() => {
              lookUp(phone.value);
            }}
          />
        )}
        {found !== null && (
          <OwnerChoice
            found={found}
            owner={form.bind('owner')}
            previousPhone={form.bind('previousPhone')}
            previousUnknown={form.bind('previousUnknown')}
          />
        )}
        {(found === null || form.bind('owner').value === NEW_OWNER) && (
          <>
            <Field
              label={t('people.relatives.fullNameField')}
              autoComplete="off"
              {...form.bind('fullName')}
            />
            <ExtraPhonesField
              count={form.bind(EXTRA_FIELDS.count)}
              phones={EXTRA_FIELDS.phones.map((field) => form.bind(field))}
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
