import {
  PERMISSIONS,
  permits,
  SLOT_KINDS,
  SLOT_LENGTH_MAX_MINUTES,
  SLOT_LENGTH_MIN_MINUTES,
  slotTypeRecordSchema,
  type SlotType,
  type SlotTypeRecord,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { Field, NumberField, SelectField } from '@/components/field';
import { wholeNumber } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { ListPage } from '@/components/list/list-page';
import { type Column, type Filter, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useLeave } from '@/components/unsent/unsent-changes';
import { useView } from '@/features/access/use-view';
import { schoolDateText } from './setup-api';
import { SlotTypePanel } from './slot-type-panel';
import { invalidateTemplates, slotTypesQuery } from './templates-api';

/** The next length planned after today, if any. */
export const plannedLength = (slotType: SlotType, today: string) =>
  slotType.lengths.find((length) => length.validFrom > today);

/** A new slot type: name, kind and length (owner's answer 9). The kind is fixed from then on. */
function SlotTypeForm({ onSave }: { onSave: (record: SlotTypeRecord) => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  const form = useRecordForm({
    schema: slotTypeRecordSchema,
    initial: { name: '', kind: 'lesson', lengthMinutes: '' },
    read: (typed) => ({
      name: typed.name,
      kind: typed.kind,
      lengthMinutes: wholeNumber(typed.lengthMinutes),
    }),
    save: onSave,
  });
  return (
    <RecordForm form={form} label={t('setup.slotTypes.newTitle')}>
      <Field label={t('setup.slotTypes.name')} autoComplete="off" {...form.bind('name')} />
      <SelectField
        label={t('setup.slotTypes.kind')}
        options={SLOT_KINDS.map((kind) => ({
          value: kind,
          label: t(`setup.slotTypes.kinds.${kind}`),
        }))}
        {...form.bind('kind')}
      />
      <NumberField
        label={t('setup.slotTypes.length')}
        note={t('setup.slotTypes.lengthNote', {
          min: number.format(SLOT_LENGTH_MIN_MINUTES),
          max: number.format(SLOT_LENGTH_MAX_MINUTES),
        })}
        {...form.bind('lengthMinutes')}
      />
    </RecordForm>
  );
}

/**
 * The slot types of the branch in use (`03`, Slot types and day templates: "A
 * slot type has a name, a kind (lesson or break) and a length in minutes";
 * task 1.5), each opened in the side panel. The Super Admin and the Academic
 * Vice Principal add, rename, change the length from a date and archive; the
 * Principal reads (owner's answer 14).
 */
export function SlotTypesPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/setup/slot-types' });
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const leave = useLeave();
  const [adding, setAdding] = useState(false);
  const can = (action: 'create' | 'edit' | 'archive') =>
    role !== null && permits(PERMISSIONS, role, 'day_templates', action);
  const slotTypes = useQuery(slotTypesQuery(branchId));
  const today = slotTypes.data?.today;
  const language = i18n.language;
  const number = useMemo(() => new Intl.NumberFormat(language), [language]);

  const create = useMutation({
    mutationFn: (record: SlotTypeRecord) =>
      answerOf(
        api.POST('/api/setup/slot-types', { params: { header: branchHeader() }, body: record }),
      ),
    onSuccess: async () => {
      setAdding(false);
      await invalidateTemplates(queryClient);
    },
  });

  const columns = useMemo(
    (): Column<SlotType>[] => [
      {
        key: 'name',
        header: t('setup.slotTypes.name'),
        cell: (row) => row.name,
        sortValue: (row) => row.name,
        searchText: (row) => row.name,
        opens: true,
      },
      {
        key: 'kind',
        header: t('setup.slotTypes.kind'),
        cell: (row) => t(`setup.slotTypes.kinds.${row.kind}`),
        sortValue: (row) => SLOT_KINDS.indexOf(row.kind),
      },
      {
        key: 'length',
        header: t('setup.slotTypes.length'),
        cell: (row) => t('setup.slotTypes.minutes', { n: number.format(row.lengthMinutes) }),
        sortValue: (row) => row.lengthMinutes,
        numeric: true,
      },
      {
        key: 'planned',
        header: t('setup.slotTypes.planned'),
        cell: (row) => {
          const planned = today === undefined ? undefined : plannedLength(row, today);
          return planned === undefined
            ? ''
            : t('setup.slotTypes.plannedText', {
                n: number.format(planned.lengthMinutes),
                date: schoolDateText(planned.validFrom, language),
              });
        },
      },
      {
        key: 'state',
        header: t('setup.slotTypes.state'),
        cell: (row) =>
          row.archivedAt === null ? t('setup.slotTypes.active') : t('setup.slotTypes.archived'),
        sortValue: (row) => (row.archivedAt === null ? 0 : 1),
      },
    ],
    [t, number, today, language],
  );

  const filters = useMemo(
    (): Filter<SlotType>[] => [
      {
        key: 'kind',
        label: t('setup.slotTypes.kind'),
        options: SLOT_KINDS.map((kind) => ({
          value: kind,
          label: t(`setup.slotTypes.kinds.${kind}`),
        })),
        matches: (row, value) => row.kind === value,
      },
      {
        key: 'state',
        label: t('setup.slotTypes.state'),
        options: [
          { value: 'active', label: t('setup.slotTypes.active') },
          { value: 'archived', label: t('setup.slotTypes.archived') },
        ],
        matches: (row, value) => (value === 'active') === (row.archivedAt === null),
      },
    ],
    [t],
  );

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/setup/slot-types', search: next, replace: how === 'replace' });
  };

  const addButton = can('create') && !adding && (
    <Button
      onClick={() => {
        setAdding(true);
      }}
    >
      {t('setup.slotTypes.add')}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t('setup.slotTypes.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('setup.title'), to: '/setup' },
        ]}
        actions={addButton === false ? undefined : addButton}
      />
      {adding && (
        <section
          aria-label={t('setup.slotTypes.newTitle')}
          className="mb-6 grid max-w-xl gap-3 rounded-xl bg-card p-6 max-sm:p-4"
        >
          <h2 className="text-lg font-semibold">{t('setup.slotTypes.newTitle')}</h2>
          <SlotTypeForm
            onSave={async (record) => {
              await create.mutateAsync(record);
            }}
          />
          <div>
            <Button
              variant="ghost"
              onClick={() => {
                void leave.leave().then((leaves) => {
                  if (leaves) {
                    setAdding(false);
                  }
                });
              }}
            >
              {t('setup.slotTypes.cancel')}
            </Button>
          </div>
        </section>
      )}
      <ListPage
        listId="slot-types"
        caption={t('setup.slotTypes.caption')}
        rows={slotTypes.data?.slotTypes}
        error={slotTypes.error ?? undefined}
        onRetry={() => {
          void slotTypes.refetch();
        }}
        rowId={(row) => row.id}
        rowName={(row) => row.name}
        columns={columns}
        filters={filters}
        search={search}
        onSearchChange={open}
        empty={{
          title: t('setup.slotTypes.emptyTitle'),
          text: t('setup.slotTypes.empty'),
          action: addButton === false ? undefined : addButton,
        }}
        panel={(row) =>
          today === undefined ? null : (
            <SlotTypePanel
              key={row.id}
              slotType={row}
              today={today}
              canEdit={can('edit')}
              canArchive={can('archive')}
            />
          )
        }
      />
    </>
  );
}
