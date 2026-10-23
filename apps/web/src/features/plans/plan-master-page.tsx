import {
  planMasterRenameSchema,
  type PlanItemValues,
  type PlanMaster,
  type PlanMasterItem,
  type PlanMasterRename,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { Field, TextAreaField } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { ListPage } from '@/components/list/list-page';
import type { Column, ListSearch } from '@/components/list/list-state';
import { PanelActions } from '@/components/list/panel-actions';
import { useNewRecord } from '@/components/list/use-new-record';
import { usePanelEditing } from '@/components/list/use-panel-editing';
import { PageHeader } from '@/components/page-header';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { PANEL } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import {
  filledSlots,
  initialOf,
  noteField,
  planFormSchema,
  titleField,
  WORK_KINDS,
  type ItemContent,
  type WorkKind,
} from './plan-item-form';
import {
  archivePlanMaster,
  createPlanMasterItem,
  invalidatePlans,
  orderPlanMaster,
  planMasterQuery,
  removePlanMasterItem,
  renamePlanMaster,
  savePlanMasterItem,
} from './plans-api';

/** The works of a master item carry no id: nothing refers to them (task 7.3). */
const withoutIds = (values: PlanItemValues) => ({
  ...values,
  classworks: values.classworks.map(({ title, description }) => ({ title, description })),
  homeworks: values.homeworks.map(({ title, description }) => ({ title, description })),
});

/**
 * One master plan (task 7.3, pull request #216; `09`, Master plans: "the same
 * list of topics, classwork and homework, in order, but with no dates"; "The
 * Head Teacher can edit the master at any time"). Its items in order, each in
 * the side panel; its keeper adds, edits, moves and removes them, renames,
 * archives and restores the master. The server answers who keeps it.
 */
export function PlanMasterPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { masterId } = useParams({ from: '/app/plans/masters/$masterId' });
  const search: ListSearch = useSearch({ from: '/app/plans/masters/$masterId' });
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const master = useQuery(planMasterQuery(branchId, masterId));
  const data = master.data;
  const newRecord = useNewRecord();
  const [renaming, setRenaming] = useState(false);
  const archive = useMutation({
    mutationFn: async (target: PlanMaster) => {
      const archiving = !target.archived;
      if (archiving) {
        const sure = await confirm({
          title: t('plans.master.archiveTitle'),
          names: [target.name],
          action: t('plans.master.archive'),
          destructive: true,
        });
        if (!sure) return;
      }
      await archivePlanMaster(target.id, target.revision, archiving);
      await invalidatePlans(queryClient);
    },
  });
  const columns = useMemo(
    (): Column<PlanMasterItem>[] => [
      {
        key: 'number',
        header: t('plans.master.number'),
        cell: (row) => String(row.position),
        fixed: true,
      },
      {
        key: 'topic',
        header: t('plans.plan.topic'),
        cell: (row) => row.topic,
        searchText: (row) => row.topic,
        opens: true,
      },
      {
        key: 'classworks',
        header: t('plans.plan.classworks'),
        cell: (row) => row.classworks.map((work) => work.title).join(', '),
      },
      {
        key: 'homeworks',
        header: t('plans.plan.homeworks'),
        cell: (row) => row.homeworks.map((work) => work.title).join(', '),
      },
    ],
    [t],
  );

  if (master.isError) {
    return (
      <>
        <PageHeader
          title={t('plans.masters.title')}
          breadcrumbs={[
            { label: t('home.title'), to: '/' },
            { label: t('plans.masters.title'), to: '/plans/masters' },
          ]}
        />
        <ErrorState
          error={master.error}
          onRetry={() => {
            void master.refetch();
          }}
        />
      </>
    );
  }
  if (data === undefined) return <LoadingOutline />;
  const editable = data.canEdit && !data.archived;
  const addButton = editable && newRecord.value === null && (
    <Button
      id={newRecord.buttonId}
      onClick={() => {
        newRecord.start(true);
      }}
    >
      {t('plans.master.addItem')}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={data.name}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('plans.page.title'), to: '/plans' },
          { label: t('plans.masters.title'), to: '/plans/masters' },
        ]}
        actions={
          <>
            {addButton === false ? null : addButton}
            {data.canEdit && !data.archived && !renaming && (
              <Button
                variant="secondary"
                onClick={() => {
                  setRenaming(true);
                }}
              >
                {t('plans.master.rename')}
              </Button>
            )}
            {data.canEdit && (
              <Button
                variant={data.archived ? 'secondary' : 'ghost'}
                disabled={archive.isPending}
                onClick={() => {
                  archive.mutate(data);
                }}
              >
                {data.archived ? t('plans.master.restore') : t('plans.master.archive')}
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground" data-master-facts>
          {[
            nameOf(data.subject.names, i18n.language),
            t('plans.master.gradeOf', { grade: data.grade }),
            t(`people.staff.languages.${data.language}`),
            t('plans.page.quarter', { number: data.quarter }),
            t(`plans.masters.scopes.${data.scope}`),
            ...(data.archived ? [t('plans.masters.archived')] : []),
          ].join(' · ')}
        </p>
        <FailureAlert error={archive.error} />
        {renaming && (
          <div className={`${PANEL} p-4`}>
            <RenameForm
              master={data}
              onDone={() => {
                setRenaming(false);
              }}
            />
          </div>
        )}
        <ListPage
          listId="plan-master-items"
          caption={data.name}
          rows={data.masterItems}
          rowId={(row) => row.id}
          rowName={(row) => t('plans.master.itemName', { number: row.position })}
          columns={columns}
          search={search}
          onSearchChange={(next, how) => {
            void navigate({
              to: '/plans/masters/$masterId',
              params: { masterId },
              search: next,
              replace: how === 'replace',
            });
          }}
          empty={{
            title: t('plans.master.emptyTitle'),
            text: t('plans.master.empty'),
            action: addButton === false ? undefined : addButton,
          }}
          creating={
            newRecord.value === null
              ? undefined
              : {
                  key: 'item',
                  title: t('plans.master.addItem'),
                  content: ({ saved, close }) => (
                    <div className="grid gap-4">
                      <ItemForm
                        item={null}
                        label={t('plans.master.addItem')}
                        onSave={async (values) => {
                          const answer = await createPlanMasterItem(data.id, {
                            revision: data.revision,
                            position: data.masterItems.length + 1,
                            values: withoutIds(values),
                          });
                          await invalidatePlans(queryClient);
                          saved(answer.masterItems.at(-1)?.id);
                        }}
                      />
                      <div>
                        <Button variant="ghost" onClick={close}>
                          {t('plans.masters.cancel')}
                        </Button>
                      </div>
                    </div>
                  ),
                  ...newRecord.handlers,
                }
          }
          panel={(row) => (
            <MasterItemPanel key={row.id} master={data} item={row} editable={editable} />
          )}
        />
      </div>
    </>
  );
}

function RenameForm({ master, onDone }: { master: PlanMaster; onDone: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const form = useRecordForm<'name', PlanMasterRename>({
    schema: planMasterRenameSchema,
    initial: { name: master.name },
    read: (typed) => ({ revision: master.revision, name: typed.name }),
    save: async (body) => {
      await renamePlanMaster(master.id, body);
      await invalidatePlans(queryClient);
      onDone();
    },
  });
  return (
    <RecordForm form={form} label={t('plans.master.rename')} onCancel={onDone}>
      <Field label={t('plans.masters.name')} autoComplete="off" {...form.bind('name')} />
    </RecordForm>
  );
}

/** The fields of a master item: topic, objectives, links and works, as a plan row has them. */
function ItemForm({
  item,
  label,
  onSave,
  onCancel,
}: {
  item: ItemContent | null;
  label: string;
  onSave: (values: PlanItemValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [shown, setShown] = useState<Record<WorkKind, number>>({
    classwork: item?.classworks.length ?? 0,
    homework: item?.homeworks.length ?? 0,
  });
  const form = useRecordForm({
    schema: planFormSchema(item),
    initial: initialOf(item),
    message: (field) => (field === 'links' ? t('plans.panel.linksInvalid') : undefined),
    save: onSave,
  });
  return (
    <RecordForm form={form} label={label} {...(onCancel === undefined ? {} : { onCancel })}>
      <Field label={t('plans.plan.topic')} {...form.bind('topic')} />
      <TextAreaField label={t('plans.panel.objectives')} rows={3} {...form.bind('objectives')} />
      <TextAreaField
        label={t('plans.panel.links')}
        note={t('plans.panel.linksNote')}
        rows={2}
        {...form.bind('links')}
      />
      {WORK_KINDS.map((kind) => {
        const count = Math.max(
          shown[kind],
          ...filledSlots(initialOf(item), kind).map((slot) => slot + 1),
        );
        return (
          <fieldset key={kind} className="grid gap-3">
            <legend className="font-semibold">
              {kind === 'classwork' ? t('plans.plan.classworks') : t('plans.plan.homeworks')}
            </legend>
            {Array.from({ length: count }, (_, slot) => (
              <div key={slot} className="grid gap-2 sm:grid-cols-2">
                <Field
                  label={t(`plans.panel.${kind}Title`, { number: slot + 1 })}
                  autoComplete="off"
                  {...form.bind(titleField(kind, slot))}
                />
                <Field
                  label={t('plans.panel.description')}
                  autoComplete="off"
                  {...form.bind(noteField(kind, slot))}
                />
              </div>
            ))}
            {count < 10 && (
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShown((before) => ({ ...before, [kind]: count + 1 }));
                  }}
                >
                  {kind === 'classwork'
                    ? t('plans.panel.addClasswork')
                    : t('plans.panel.addHomework')}
                </Button>
              </div>
            )}
          </fieldset>
        );
      })}
    </RecordForm>
  );
}

/** A master item in the side panel: read, edited, moved or removed by the keeper. */
function MasterItemPanel({
  master,
  item,
  editable,
}: {
  master: PlanMaster;
  item: PlanMasterItem;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const panel = usePanelEditing();
  const ids = master.masterItems.map((one) => one.id);
  const index = ids.indexOf(item.id);
  const move = useMutation({
    mutationFn: async (step: -1 | 1) => {
      const order = [...ids];
      const other = order[index + step];
      if (other === undefined) return;
      order[index + step] = item.id;
      order[index] = other;
      await orderPlanMaster(master.id, { revision: master.revision, order });
      await invalidatePlans(queryClient);
    },
  });
  const remove = useMutation({
    mutationFn: async () => {
      const sure = await confirm({
        title: t('plans.master.removeTitle'),
        names: [t('plans.master.itemName', { number: item.position })],
        action: t('plans.master.remove'),
        destructive: true,
      });
      if (!sure) return;
      await removePlanMasterItem(master.id, item.id, master.revision);
      await invalidatePlans(queryClient);
    },
  });
  if (panel.editing === 'item') {
    return (
      <ItemForm
        item={item}
        label={t('plans.master.itemName', { number: item.position })}
        onCancel={() => {
          panel.stop();
        }}
        onSave={async (values) => {
          await savePlanMasterItem(master.id, item.id, {
            revision: master.revision,
            values: withoutIds(values),
          });
          await invalidatePlans(queryClient);
          panel.stop({ saved: true, key: 'item' });
        }}
      />
    );
  }
  return (
    <div className="grid gap-6">
      <dl className="grid gap-3">
        <div className="grid gap-0.5">
          <dt className="text-sm text-muted-foreground">{t('plans.plan.topic')}</dt>
          <dd>{item.topic}</dd>
        </div>
        {item.objectives !== '' && (
          <div className="grid gap-0.5">
            <dt className="text-sm text-muted-foreground">{t('plans.panel.objectives')}</dt>
            <dd className="whitespace-pre-wrap">{item.objectives}</dd>
          </div>
        )}
        {item.links.length > 0 && (
          <div className="grid gap-0.5">
            <dt className="text-sm text-muted-foreground">{t('plans.panel.links')}</dt>
            <dd>
              <ul className="grid gap-1">
                {item.links.map((link) => (
                  <li key={link}>
                    <a
                      className="text-link break-all"
                      href={link}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        {WORK_KINDS.map((kind) => {
          const works = kind === 'classwork' ? item.classworks : item.homeworks;
          return works.length === 0 ? null : (
            <div key={kind} className="grid gap-0.5">
              <dt className="text-sm text-muted-foreground">
                {kind === 'classwork' ? t('plans.plan.classworks') : t('plans.plan.homeworks')}
              </dt>
              <dd>
                <ol className="grid list-decimal gap-1 pl-5">
                  {works.map((work) => (
                    <li key={work.id}>
                      {work.title}
                      {work.description !== '' && (
                        <span className="text-muted-foreground"> — {work.description}</span>
                      )}
                    </li>
                  ))}
                </ol>
              </dd>
            </div>
          );
        })}
      </dl>
      {editable && (
        <PanelActions
          primary={
            <Button
              {...panel.opener('item')}
              onClick={() => {
                panel.start('item', () => undefined);
              }}
            >
              {t('form.edit')}
            </Button>
          }
          secondary={
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={index <= 0 || move.isPending}
                onClick={() => {
                  move.mutate(-1);
                }}
              >
                {t('plans.master.moveUp')}
              </Button>
              <Button
                variant="secondary"
                disabled={index >= ids.length - 1 || move.isPending}
                onClick={() => {
                  move.mutate(1);
                }}
              >
                {t('plans.master.moveDown')}
              </Button>
              <Button
                variant="ghost"
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate();
                }}
              >
                {t('plans.master.remove')}
              </Button>
            </div>
          }
          saved={panel.saved}
        />
      )}
      <FailureAlert error={move.error ?? remove.error} />
    </div>
  );
}
