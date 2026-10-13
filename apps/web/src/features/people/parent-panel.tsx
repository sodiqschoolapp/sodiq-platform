import {
  DEFAULT_PHONE_PREFIX,
  relativeDetailSchema,
  relativeIdentitySchema,
  relativePreviousPhoneSchema,
  type RelativeDetail,
  type RelativeEdit,
  type RelativeIdentity,
  type RelativeRecord,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { CHECKED, CheckboxField, Field, SelectField } from '@/components/field';
import { ErrorState, LoadingOutline } from '@/components/states';
import { useRecordForm } from '@/components/form/use-record-form';
import { Button } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { invalidateRelatives, phoneMatch, relativeDetailQuery } from './people-api';
import { asFormSchema } from './form-schema';
import { RelativeForm, type TakenPhone } from './relative-form';

/** A student as the list of students names them. */
const studentName = (student: { firstName: string; lastName: string }) =>
  `${student.firstName} ${student.lastName}`;

/**
 * A relative in the side panel of the Parents list (`04`, Close relatives:
 * "Shows the relative's data and all linked students. Editing the phone or
 * name here changes it for every linked student"; task 2.5a). The students of
 * other branches are a count (`edge`); workplace and email are read as
 * Identity, the Principal's behind a logged show (decision 5).
 */
export function ParentPanel({ id, name }: { id: string; name: string }) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const detail = useQuery(relativeDetailQuery(branchId, id));
  const [taken, setTaken] = useState<TakenPhone | null>(null);
  const navigate = useNavigate();
  const edit = useMutation({
    mutationFn: (record: RelativeEdit) =>
      answerOf(
        api.PATCH('/api/people/relatives/{id}', {
          params: { header: branchHeader(), path: { id } },
          body: record,
        }),
      ),
    onSuccess: async (answer) => {
      queryClient.setQueryData(
        relativeDetailQuery(branchId, id).queryKey,
        relativeDetailSchema.parse(answer),
      );
      await invalidateRelatives(queryClient);
    },
  });

  /**
   * After a merge the record that stays is shown, also when it is the other
   * one (spec review of the build, finding 9): the form of this record goes
   * first, so its refused phone is no unsent change, then the panel moves to
   * the record that stays. The list is read again.
   */
  const [keptId, setKeptId] = useState<string | null>(null);
  const merged = async (answer: unknown) => {
    const kept = relativeDetailSchema.parse(answer);
    queryClient.setQueryData(relativeDetailQuery(branchId, kept.id).queryKey, kept);
    setTaken(null);
    if (kept.id !== id) {
      setKeptId(kept.id);
    }
    await invalidateRelatives(queryClient);
  };
  useEffect(() => {
    if (keptId !== null) {
      void navigate({
        to: '/people/parents',
        search: (previous) => ({ ...previous, open: keptId }),
        replace: true,
      });
    }
  }, [keptId, navigate]);

  if (keptId !== null) {
    return <LoadingOutline />;
  }

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
  const relative = detail.data;
  return (
    <div className="grid gap-6">
      <RelativeTerms relative={relative} />
      <section className="grid gap-2">
        <h3 className="text-base font-semibold">{t('people.relatives.students')}</h3>
        <ul className="grid gap-1 text-sm">
          {relative.students.map((student) => (
            <li key={student.id} className="flex flex-wrap gap-x-2">
              <Link
                to="/people/students"
                search={{ open: student.id }}
                className="font-semibold text-link underline-offset-4 hover:underline"
              >
                {studentName(student)}
              </Link>
              <span className="text-muted-foreground">
                {t(`people.relatives.relationships.${student.relationship}`)}
              </span>
              {student.mainContact && (
                <span className="text-muted-foreground">{t('people.relatives.mainContact')}</span>
              )}
            </li>
          ))}
        </ul>
        {relative.elsewhere > 0 && (
          <p className="text-sm text-muted-foreground">
            {t('people.relatives.elsewhereCount', { count: relative.elsewhere })}
          </p>
        )}
      </section>
      {relative.canEdit && (
        <section className="grid gap-3">
          <h3 className="text-base font-semibold">{t('people.relatives.recordTitle')}</h3>
          <RelativeForm
            key={`${relative.id}-record`}
            relative={relative}
            label={t('people.relatives.formLabel', { name })}
            onSave={async (record: RelativeRecord) => {
              await edit.mutateAsync(record);
              setTaken(null);
            }}
            onTaken={setTaken}
          />
          {taken !== null && (
            <TakenChoices
              key={taken.record.phone}
              relative={relative}
              taken={taken}
              onEdit={async (body) => {
                await edit.mutateAsync(body);
                setTaken(null);
              }}
              onMerged={merged}
            />
          )}
        </section>
      )}
    </div>
  );
}

/** The new phone of the earlier holder, or "unknown" (no valid phone). */
const PREVIOUS_SCHEMA = asFormSchema<{ previousPhone: string | null }>(
  relativePreviousPhoneSchema,
  () => ['previousPhone'],
);

/**
 * A phone change refused because the number exists (`edge/close-relatives`,
 * rows 2 and 3; task 2.5b-1, decision 8): "Merge" when the holder may be
 * merged by this reader, and always "the number has a new owner", which asks
 * for the holder's new phone or "unknown" (no valid phone).
 */
function TakenChoices({
  relative,
  taken,
  onEdit,
  onMerged,
}: {
  relative: RelativeDetail;
  taken: TakenPhone;
  onEdit: (body: RelativeEdit) => Promise<void>;
  onMerged: (answer: unknown) => Promise<void>;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [choice, setChoice] = useState<'merge' | 'owner' | null>(null);
  const [nameOf, setNameOf] = useState<'this' | 'other'>('this');
  const [phoneOf, setPhoneOf] = useState<'this' | 'other'>(
    relative.phone === null ? 'other' : 'this',
  );
  const holderName = taken.holder.fullName;
  const typed = taken.record.phone;
  /**
   * The holder's id, read by the phone match (the same holders as the merge
   * and the new owner); a phone that has no holder any more is the race of
   * `relative_phone_changed`.
   */
  const holderId = async (): Promise<string> => {
    const found = await phoneMatch(typed);
    if (found?.id === undefined || found.id === null) {
      throw new ApiFailure('relative_phone_changed');
    }
    return found.id;
  };
  const merge = useMutation({
    mutationFn: async () => {
      const otherId = await holderId();
      return answerOf(
        api.POST('/api/people/relatives/{id}/merge', {
          params: { header: branchHeader(), path: { id: relative.id } },
          body: { otherId, thisPhone: relative.phone, otherPhone: typed, phoneOf, nameOf },
        }),
      );
    },
    onSuccess: onMerged,
  });
  const owner = useRecordForm<
    'previousUnknown' | 'previousPhone',
    { previousPhone: string | null }
  >({
    schema: PREVIOUS_SCHEMA,
    initial: { previousUnknown: '', previousPhone: `${DEFAULT_PHONE_PREFIX} ` },
    read: (values) => ({
      previousPhone: values.previousUnknown === CHECKED ? null : values.previousPhone,
    }),
    save: async ({ previousPhone }) => {
      await onEdit({ ...taken.record, newOwner: { previousId: await holderId(), previousPhone } });
    },
  });
  const bindOf = (name: string, value: string, set: (value: string) => void) => ({
    name,
    value,
    error: undefined,
    onChange: (event: { target: { value: string } }) => {
      set(event.target.value);
    },
  });
  const choose = (next: 'merge' | 'owner', text: string) => (
    <Button
      variant="secondary"
      aria-pressed={choice === next}
      onClick={() => {
        setChoice(next);
      }}
    >
      {text}
    </Button>
  );
  return (
    <section className="grid gap-3" aria-label={t('people.relatives.takenTitle')}>
      <div className="flex flex-wrap gap-3">
        {taken.holder.mergeable &&
          choose('merge', t('people.relatives.mergeWith', { name: holderName }))}
        {choose('owner', t('people.relatives.newOwner'))}
      </div>
      {choice === 'merge' && (
        <div className="grid gap-3">
          {/* Both records side by side, with the students whose links move. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1 text-sm">
              <h4 className="font-semibold">{t('people.relatives.thisRecord')}</h4>
              <p>{relative.fullName}</p>
              <p>{relative.phone ?? t('people.relatives.noPhone')}</p>
              <ul className="text-muted-foreground">
                {relative.students.map((student) => (
                  <li key={student.id}>{studentName(student)}</li>
                ))}
              </ul>
              {relative.elsewhere > 0 && (
                <p className="text-muted-foreground">
                  {t('people.relatives.elsewhereCount', { count: relative.elsewhere })}
                </p>
              )}
            </div>
            <div className="grid gap-1 text-sm">
              <h4 className="font-semibold">{t('people.relatives.otherRecord')}</h4>
              <p>{holderName}</p>
              <p>{typed}</p>
              <p className="text-muted-foreground">
                {t('people.relatives.linkedCount', { count: taken.holder.students })}
              </p>
            </div>
          </div>
          <SelectField
            label={t('people.relatives.mergeName')}
            options={[
              { value: 'this', label: relative.fullName },
              { value: 'other', label: holderName },
            ]}
            {...bindOf('mergeName', nameOf, (value) => {
              setNameOf(value === 'other' ? 'other' : 'this');
            })}
          />
          <SelectField
            label={t('people.relatives.mergePhone')}
            options={[
              ...(relative.phone === null ? [] : [{ value: 'this', label: relative.phone }]),
              { value: 'other', label: typed },
            ]}
            {...bindOf('mergePhone', phoneOf, (value) => {
              setPhoneOf(value === 'other' ? 'other' : 'this');
            })}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={merge.isPending}
              onClick={() => {
                void confirm({
                  title: t('people.relatives.mergeTitle'),
                  text: t('people.relatives.mergeText'),
                  names: [
                    relative.fullName,
                    holderName,
                    ...relative.students.map((student) => studentName(student)),
                  ],
                  action: t('people.relatives.merge'),
                  destructive: true,
                }).then((go) => {
                  if (go) {
                    merge.mutate();
                  }
                });
              }}
            >
              {t('people.relatives.merge')}
            </Button>
            <FailureAlert error={merge.error} />
          </div>
        </div>
      )}
      {choice === 'owner' && (
        <form
          className="grid gap-3"
          aria-label={t('people.relatives.newOwner')}
          onSubmit={(event) => {
            event.preventDefault();
            void owner.submit();
          }}
        >
          <CheckboxField
            label={t('people.relatives.previousUnknown', { name: holderName })}
            {...owner.bind('previousUnknown')}
          />
          {owner.bind('previousUnknown').value !== CHECKED && (
            <Field
              label={t('people.relatives.previousPhone', { name: holderName })}
              type="tel"
              autoComplete="off"
              {...owner.bind('previousPhone')}
            />
          )}
          <FailureAlert error={owner.failure} />
          <div>
            <Button type="submit" disabled={owner.status === 'saving'}>
              {t('people.relatives.giveNumber')}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

/** Name, phone, and workplace and email as far as the reader may see them. */
function RelativeTerms({ relative }: { relative: RelativeDetail }) {
  const { t, i18n } = useTranslation();
  const [shown, setShown] = useState<RelativeIdentity | null>(null);
  const show = useMutation({
    mutationFn: async () =>
      relativeIdentitySchema.parse(
        await answerOf(
          api.POST('/api/people/relatives/{id}/show', {
            params: { header: branchHeader(), path: { id: relative.id } },
          }),
        ),
      ),
    onSuccess: setShown,
  });
  const notSet = t('people.relatives.notSet');
  const identity = relative.identity ?? shown;
  const rows: [string, string][] = [
    [t('people.relatives.fullName'), relative.fullName],
    [
      t('people.relatives.phone'),
      relative.phone ??
        (relative.phoneInvalidSince === null
          ? t('people.relatives.noPhone')
          : t('people.relatives.noValidPhoneSince', {
              date: new Date(relative.phoneInvalidSince).toLocaleDateString(i18n.language),
            })),
    ],
  ];
  if (identity !== null) {
    rows.push(
      [t('people.relatives.workplace'), identity.workplace ?? notSet],
      [t('people.relatives.email'), identity.email ?? notSet],
    );
  } else if (relative.identityHidden) {
    rows.push(
      [t('people.relatives.workplace'), t('people.relatives.hidden')],
      [t('people.relatives.email'), t('people.relatives.hidden')],
    );
  }
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
      {relative.identityHidden && shown === null && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            disabled={show.isPending}
            onClick={() => {
              show.mutate();
            }}
          >
            {t('people.relatives.show')}
          </Button>
          <FailureAlert error={show.error} />
        </div>
      )}
    </section>
  );
}
