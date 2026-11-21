import {
  integrationKeyChangeSchema,
  integrationKeyRecordSchema,
  type IntegrationKey,
  type IntegrationKeyPerson,
  type IntegrationKeyState,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/confirm-dialog';
import { DateField, Field, listValue, listValues } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm, type FieldBinding } from '@/components/form/use-record-form';
import { ListPage } from '@/components/list/list-page';
import { type Column, type Filter, type ListSearch } from '@/components/list/list-state';
import { PanelActions } from '@/components/list/panel-actions';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CHECKBOX, CHECKBOX_TARGET, PANEL, SECTION_TITLE } from '@/components/ui/control';
import { ErrorState, LoadingOutline } from '@/components/states';
import { formatMoment, schoolDateText } from '@/lib/dates';
import { cn } from '@/lib/utils';
import {
  INTEGRATION_KEYS_KEY,
  changeIntegrationKeyEnd,
  changeIntegrationKeyPeople,
  createIntegrationKey,
  integrationKeyChoicesQuery,
  integrationKeysQuery,
  revokeIntegrationKey,
} from './integration-keys-api';

const STATES: readonly IntegrationKeyState[] = ['active', 'ended', 'revoked'];

const personName = (person: IntegrationKeyPerson): string =>
  `${person.lastName} ${person.firstName}`;

/**
 * The Integration keys page of the Super Admin (`02`, Integration keys; task 10.9): every key
 * of the school with its people, end date, last use and state; create (the secret shown once),
 * and in the side panel the people, the end date and Revoke.
 */
export function IntegrationKeysPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/integration-keys' });
  const keys = useQuery(integrationKeysQuery());
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ name: string; secret: string } | null>(null);

  const columns = useMemo((): Column<IntegrationKey>[] => {
    const peopleText = (row: IntegrationKey) => row.people.map(personName).join(', ');
    return [
      {
        key: 'name',
        header: t('integrationKeys.name'),
        cell: (row) => row.name,
        sortValue: (row) => row.name,
        searchText: (row) => row.name,
        opens: true,
      },
      {
        key: 'people',
        header: t('integrationKeys.people'),
        cell: (row) => <span className="line-clamp-2 max-w-prose">{peopleText(row)}</span>,
        searchText: (row) =>
          `${peopleText(row)} ${row.people.map((person) => person.staffId).join(' ')}`,
        sortValue: (row) => row.people.length,
      },
      {
        key: 'endsOn',
        header: t('integrationKeys.endsOn'),
        cell: (row) => schoolDateText(row.endsOn, i18n.language),
        sortValue: (row) => row.endsOn,
      },
      {
        key: 'lastUsed',
        header: t('integrationKeys.lastUsed'),
        cell: (row) =>
          row.lastUsedAt === null
            ? t('integrationKeys.neverUsed')
            : formatMoment(i18n.language, row.lastUsedAt),
        sortValue: (row) => row.lastUsedAt ?? '',
      },
      {
        key: 'state',
        header: t('integrationKeys.state'),
        cell: (row) => t(`integrationKeys.state_${row.state}`),
        sortValue: (row) => row.state,
      },
    ];
  }, [t, i18n.language]);

  const filters = useMemo(
    (): Filter<IntegrationKey>[] => [
      {
        key: 'state',
        label: t('integrationKeys.state'),
        options: STATES.map((state) => ({
          value: state,
          label: t(`integrationKeys.state_${state}`),
        })),
        matches: (row, value) => row.state === value,
      },
    ],
    [t],
  );

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/integration-keys', search: next, replace: how === 'replace' });
  };

  return (
    <>
      <PageHeader
        title={t('integrationKeys.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('setup.title'), to: '/setup' },
        ]}
        actions={
          creating ? undefined : (
            <Button
              onClick={() => {
                setCreating(true);
              }}
            >
              {t('integrationKeys.create')}
            </Button>
          )
        }
      />
      {creating && keys.data !== undefined && (
        <CreateKeyForm
          today={keys.data.today}
          latest={keys.data.latestEndsOn}
          onCancel={() => {
            setCreating(false);
          }}
          onCreated={(name, value) => {
            setCreating(false);
            setSecret({ name, secret: value });
          }}
        />
      )}
      <ListPage
        listId="integration-keys"
        caption={t('integrationKeys.caption')}
        rows={keys.data?.keys}
        error={keys.error ?? undefined}
        onRetry={() => {
          void keys.refetch();
        }}
        rowId={(row) => row.id}
        rowName={(row) => row.name}
        columns={columns}
        filters={filters}
        search={search}
        onSearchChange={open}
        empty={{ title: t('integrationKeys.emptyTitle'), text: t('integrationKeys.empty') }}
        panel={(row) => (
          <KeyPanel
            key={row.id}
            integrationKey={row}
            today={keys.data?.today ?? row.endsOn}
            latest={keys.data?.latestEndsOn ?? row.endsOn}
          />
        )}
      />
      <SecretDialog
        shown={secret}
        onClose={() => {
          // The secret leaves the page with the dialog: nothing reads it again.
          setSecret(null);
        }}
      />
    </>
  );
}

/** The people who may be put on a key, ticked by name or staff ID. */
function PeoplePicker({
  binding,
  kept,
}: {
  /** The field of the form: the ticked staff records, joined as `listValue` joins them. */
  binding: FieldBinding;
  /** People on the key already, shown even when they no longer hold a key role. */
  kept: readonly IntegrationKeyPerson[];
}) {
  const chosen = listValues(binding.value);
  const onChange = (next: string[]) => {
    binding.onChange({ target: { value: listValue(next) } });
  };
  const { t } = useTranslation();
  const id = useId();
  const choices = useQuery(integrationKeyChoicesQuery());
  const [text, setText] = useState('');
  const everyone = useMemo(() => {
    const byId = new Map<string, IntegrationKeyPerson>();
    for (const person of [...kept, ...(choices.data?.people ?? [])]) {
      if (!byId.has(person.staffRecordId)) byId.set(person.staffRecordId, person);
    }
    return [...byId.values()].sort((a, b) => personName(a).localeCompare(personName(b)));
  }, [kept, choices.data]);
  const needle = text.trim().toLowerCase();
  const shown = everyone.filter(
    (person) =>
      needle === '' ||
      chosen.includes(person.staffRecordId) ||
      personName(person).toLowerCase().includes(needle) ||
      person.staffId.toLowerCase().includes(needle),
  );
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1.5 text-sm font-medium">{t('integrationKeys.people')}</legend>
      <Field
        label={t('integrationKeys.findPerson')}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      {choices.isError && (
        <ErrorState
          error={choices.error}
          onRetry={() => {
            void choices.refetch();
          }}
        />
      )}
      {choices.isPending && <LoadingOutline lines={2} />}
      <ul className="grid max-h-64 gap-1 overflow-y-auto">
        {shown.map((person) => {
          const inputId = `${id}-${person.staffRecordId}`;
          return (
            <li key={person.staffRecordId}>
              <label htmlFor={inputId} className={cn(CHECKBOX_TARGET, 'text-sm')}>
                <input
                  id={inputId}
                  type="checkbox"
                  className={CHECKBOX}
                  checked={chosen.includes(person.staffRecordId)}
                  onChange={(event) => {
                    onChange(
                      event.target.checked
                        ? [...chosen, person.staffRecordId]
                        : chosen.filter((one) => one !== person.staffRecordId),
                    );
                  }}
                />
                {personName(person)} · {person.staffId}
                {!person.holdsKeyRole && (
                  <span className="ml-2 text-muted-foreground">
                    {t('integrationKeys.noKeyRole')}
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
      {binding.error !== undefined && (
        <p className="text-sm text-destructive" role="alert">
          {binding.error}
        </p>
      )}
    </fieldset>
  );
}

function CreateKeyForm({
  today,
  latest,
  onCancel,
  onCreated,
}: {
  today: string;
  latest: string;
  onCancel: () => void;
  onCreated: (name: string, secret: string) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const form = useRecordForm({
    schema: integrationKeyRecordSchema,
    initial: { name: '', endsOn: latest, staffRecordIds: '' },
    checkedOnSave: ['staffRecordIds'],
    read: (typed) => ({ ...typed, staffRecordIds: listValues(typed.staffRecordIds) }),
    // Called directly, not through a query or a mutation: the secret goes into no cache
    // (`.claude/rules/web.md`, a secret an answer holds once) and only into the dialog's state.
    save: async (record) => {
      const answer = await createIntegrationKey(record);
      await queryClient.invalidateQueries({ queryKey: INTEGRATION_KEYS_KEY });
      onCreated(answer.key.name, answer.secret);
    },
  });
  return (
    <section className={cn(PANEL, 'mb-6 max-w-xl')}>
      <RecordForm form={form} label={t('integrationKeys.create')} onCancel={onCancel}>
        <Field label={t('integrationKeys.name')} autoComplete="off" {...form.bind('name')} />
        <DateField
          label={t('integrationKeys.endsOn')}
          min={today}
          max={latest}
          note={t('integrationKeys.endsOnNote')}
          {...form.bind('endsOn')}
        />
        <PeoplePicker binding={form.bind('staffRecordIds')} kept={[]} />
      </RecordForm>
    </section>
  );
}

/** The secret of a new key, shown this one time with a copy button. */
function SecretDialog({
  shown,
  onClose,
}: {
  shown: { name: string; secret: string } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <Dialog
      open={shown !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('integrationKeys.secretTitle', { name: shown?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('integrationKeys.secretOnce')}</DialogDescription>
        </DialogHeader>
        <code className="block break-all rounded-md border bg-muted p-3 text-sm">
          {shown?.secret}
        </code>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              if (shown !== null) {
                void navigator.clipboard.writeText(shown.secret).then(() => {
                  setCopied(true);
                });
              }
            }}
          >
            {copied ? t('integrationKeys.copied') : t('integrationKeys.copy')}
          </Button>
          <Button
            onClick={() => {
              setCopied(false);
              onClose();
            }}
          >
            {t('integrationKeys.done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One key: its people, end date and state; nothing changes on a revoked key. */
function KeyPanel({
  integrationKey,
  today,
  latest,
}: {
  integrationKey: IntegrationKey;
  today: string;
  latest: string;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const revoked = integrationKey.state === 'revoked';
  const refresh = () => queryClient.invalidateQueries({ queryKey: INTEGRATION_KEYS_KEY });
  const people = integrationKey.people.map((one) => one.staffRecordId);
  // One form, one Save (one primary in the side panel): each part goes to its own route, and
  // only when it changed.
  const form = useRecordForm({
    schema: integrationKeyChangeSchema,
    initial: { endsOn: integrationKey.endsOn, staffRecordIds: listValue(people) },
    checkedOnSave: ['staffRecordIds'],
    read: (typed) => ({ endsOn: typed.endsOn, staffRecordIds: listValues(typed.staffRecordIds) }),
    save: async ({ endsOn, staffRecordIds }) => {
      if (endsOn !== integrationKey.endsOn) {
        await changeIntegrationKeyEnd(integrationKey.id, endsOn);
      }
      const same =
        staffRecordIds.length === people.length &&
        staffRecordIds.every((one) => people.includes(one));
      if (!same) {
        await changeIntegrationKeyPeople(integrationKey.id, staffRecordIds);
      }
      await refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: () => revokeIntegrationKey(integrationKey.id),
    onSuccess: refresh,
  });
  const askRevoke = async () => {
    if (
      await confirm({
        title: t('integrationKeys.revokeTitle', { name: integrationKey.name }),
        text: t('integrationKeys.revokeText'),
        action: t('integrationKeys.revoke'),
        destructive: true,
      })
    ) {
      revoke.mutate();
    }
  };
  return (
    <div className="grid gap-6">
      {!revoked && (
        <PanelActions
          secondary={
            <Button
              variant="destructive"
              disabled={revoke.isPending}
              onClick={() => {
                void askRevoke();
              }}
            >
              {t('integrationKeys.revoke')}
            </Button>
          }
          error={revoke.error}
        />
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="font-semibold">{t('integrationKeys.state')}</dt>
        <dd>
          {revoked && integrationKey.revokedAt !== null
            ? t('integrationKeys.revokedOn', {
                moment: formatMoment(i18n.language, integrationKey.revokedAt),
              })
            : t(`integrationKeys.state_${integrationKey.state}`)}
        </dd>
        <dt className="font-semibold">{t('integrationKeys.created')}</dt>
        <dd>{formatMoment(i18n.language, integrationKey.createdAt)}</dd>
        <dt className="font-semibold">{t('integrationKeys.lastUsed')}</dt>
        <dd>
          {integrationKey.lastUsedAt === null
            ? t('integrationKeys.neverUsed')
            : formatMoment(i18n.language, integrationKey.lastUsedAt)}
        </dd>
        {revoked && (
          <>
            <dt className="font-semibold">{t('integrationKeys.endsOn')}</dt>
            <dd>{schoolDateText(integrationKey.endsOn, i18n.language)}</dd>
          </>
        )}
      </dl>
      {revoked ? (
        <section className="grid gap-2">
          <h3 className={SECTION_TITLE}>{t('integrationKeys.people')}</h3>
          <ul className="grid gap-1 text-sm">
            {integrationKey.people.map((person) => (
              <li key={person.staffRecordId}>
                {personName(person)} · {person.staffId}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <>
          <RecordForm form={form} label={integrationKey.name}>
            <DateField
              label={t('integrationKeys.endsOn')}
              min={today}
              max={latest}
              {...form.bind('endsOn')}
            />
            <PeoplePicker binding={form.bind('staffRecordIds')} kept={integrationKey.people} />
          </RecordForm>
        </>
      )}
    </div>
  );
}
