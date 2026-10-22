import { PLAN_FILE_TYPES, type Plan, type PlanItem, type PlanRow } from '@sodiq/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { Field, TextAreaField } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { PanelActions } from '@/components/list/panel-actions';
import { usePanelEditing } from '@/components/list/use-panel-editing';
import { Button } from '@/components/ui/button';
import { rowDateText } from './plan-page';
import {
  baseOf,
  filledSlots,
  initialOf,
  noteField,
  planFormSchema,
  titleField,
  WORK_KINDS,
  type PlanField,
  type WorkKind,
} from './plan-item-form';
import {
  addPlanFile,
  clearPlanItem,
  createPlanItem,
  downloadPlanFile,
  invalidatePlans,
  removePlanFile,
  savePlanItem,
} from './plans-api';

/** The value stored now of each field a save was refused for (`plan_item_stale`), by field. */
function storedNotes(
  failure: unknown,
  item: PlanItem | null,
  t: (key: string, options?: Record<string, unknown>) => string,
): Partial<Record<PlanField, string>> {
  if (!(failure instanceof ApiFailure) || failure.code !== 'plan_item_stale') return {};
  const notes: Partial<Record<PlanField, string>> = {};
  for (const detail of failure.details ?? []) {
    const value = detail.storedPlanValue;
    const [, field, workId] = detail.path.split('.');
    const text =
      value === null || value === undefined
        ? t('plans.panel.removedMeanwhile')
        : typeof value === 'string'
          ? t('plans.panel.storedNow', { value: value === '' ? '—' : value })
          : Array.isArray(value)
            ? t('plans.panel.storedNow', { value: value.join(', ') || '—' })
            : t('plans.panel.storedNow', { value: value.title });
    if (field === 'topic' || field === 'objectives' || field === 'links') {
      notes[field] = text;
    } else if ((field === 'classworks' || field === 'homeworks') && item !== null) {
      const kind: WorkKind = field === 'classworks' ? 'classwork' : 'homework';
      const slot = item[field].findIndex((work) => work.id === workId);
      if (slot >= 0) notes[titleField(kind, slot)] = text;
    }
  }
  return notes;
}

/**
 * A row of a plan in the side panel (task 7.1a): the item it holds, read; the
 * owner fills or edits it (`09`, What a plan contains), clears a row whose
 * lesson is not yet held (`edge/lesson-plans`, "Clear") and adds files. A
 * save refused because a field changed meanwhile shows the value stored now
 * beside the value typed (edge: "both values are shown").
 */
export function PlanRowPanel({ plan, row }: { plan: Plan; row: PlanRow }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const panel = usePanelEditing();
  const item = row.item;
  const index = plan.rows.findIndex((one) => one.lessonId === row.lessonId);
  const previous = index > 0 ? plan.rows[index - 1] : undefined;
  const next = plan.rows[index + 1];
  const editable = plan.canEdit;
  const slotText = (slot: number) => t('plans.plan.slot', { number: slot });
  const [shown, setShown] = useState<Record<WorkKind, number>>({
    classwork: item?.classworks.length ?? 0,
    homework: item?.homeworks.length ?? 0,
  });
  const fileInput = useRef<HTMLInputElement>(null);

  const form = useRecordForm({
    schema: planFormSchema(item),
    initial: initialOf(item),
    message: (field) => (field === 'links' ? t('plans.panel.linksInvalid') : undefined),
    save: async (values) => {
      if (item === null) {
        await createPlanItem(plan.journalId, {
          quarterId: plan.quarterId,
          position: row.number,
          values: {
            ...values,
            classworks: values.classworks.map(({ title, description }) => ({ title, description })),
            homeworks: values.homeworks.map(({ title, description }) => ({ title, description })),
          },
        });
      } else {
        await savePlanItem(item.id, { base: baseOf(item), values });
      }
      await invalidatePlans(queryClient);
      panel.stop({ saved: true, key: 'item' });
    },
  });
  const notes = storedNotes(form.failure, item, t);

  const clear = useMutation({
    mutationFn: async (id: string) => {
      const sure = await confirm({
        title: t('plans.panel.clearTitle'),
        text: t('plans.panel.clearText'),
        names: [t('plans.plan.rowName', { number: row.number })],
        action: t('plans.panel.clear'),
        destructive: true,
      });
      if (!sure) return;
      await clearPlanItem(id);
      await invalidatePlans(queryClient);
    },
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (item === null) return;
      await addPlanFile(item.id, file);
      await invalidatePlans(queryClient);
    },
  });
  const removeFile = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const sure = await confirm({
        title: t('plans.panel.removeFileTitle'),
        names: [name],
        action: t('plans.panel.removeFile'),
        destructive: true,
      });
      if (!sure) return;
      await removePlanFile(id);
      await invalidatePlans(queryClient);
    },
  });
  const download = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => downloadPlanFile(id, name),
  });

  // A homework given at the first of two same-day lessons is checked at the second
  // (edge/lesson-plans, "A double lesson").
  const checkedToday =
    next !== undefined && next.date === row.date && next.slot !== null
      ? t('plans.panel.checkedToday', { slot: next.slot })
      : undefined;

  const works = (kind: WorkKind) => {
    const list = item === null ? [] : kind === 'classwork' ? item.classworks : item.homeworks;
    return list;
  };

  return (
    <div className="grid gap-6">
      <p className="text-sm text-muted-foreground">{rowDateText(row, i18n.language, slotText)}</p>
      {panel.editing === 'item' ? (
        <RecordForm
          form={form}
          label={t('plans.plan.rowName', { number: row.number })}
          onCancel={() => {
            panel.stop();
          }}
        >
          {item === null &&
            previous !== undefined &&
            previous.date === row.date &&
            previous.item !== null && (
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    form.bind('topic').onChange({ target: { value: previous.item?.topic ?? '' } });
                  }}
                >
                  {t('plans.panel.sameTopic')}
                </Button>
              </div>
            )}
          <Field label={t('plans.plan.topic')} note={notes.topic} {...form.bind('topic')} />
          <TextAreaField
            label={t('plans.panel.objectives')}
            note={notes.objectives}
            rows={3}
            {...form.bind('objectives')}
          />
          <TextAreaField
            label={t('plans.panel.links')}
            note={notes.links ?? t('plans.panel.linksNote')}
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
                {kind === 'homework' && checkedToday !== undefined && (
                  <p className="text-sm text-muted-foreground">{checkedToday}</p>
                )}
                {Array.from({ length: count }, (_, slot) => (
                  <div key={slot} className="grid gap-2 sm:grid-cols-2">
                    <Field
                      label={t(`plans.panel.${kind}Title`, { number: slot + 1 })}
                      note={notes[titleField(kind, slot)]}
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
      ) : (
        <dl className="grid gap-3">
          <div className="grid gap-0.5">
            <dt className="text-sm text-muted-foreground">{t('plans.plan.topic')}</dt>
            <dd>{item?.topic ?? t('plans.plan.emptyRow')}</dd>
          </div>
          {item !== null && item.objectives !== '' && (
            <div className="grid gap-0.5">
              <dt className="text-sm text-muted-foreground">{t('plans.panel.objectives')}</dt>
              <dd className="whitespace-pre-wrap">{item.objectives}</dd>
            </div>
          )}
          {item !== null && item.links.length > 0 && (
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
          {WORK_KINDS.map((kind) =>
            works(kind).length === 0 ? null : (
              <div key={kind} className="grid gap-0.5">
                <dt className="text-sm text-muted-foreground">
                  {kind === 'classwork' ? t('plans.plan.classworks') : t('plans.plan.homeworks')}
                </dt>
                <dd>
                  <ol className="grid list-decimal gap-1 pl-5">
                    {works(kind).map((work) => (
                      <li key={work.id}>
                        {work.title}
                        {work.description !== '' && (
                          <span className="text-muted-foreground"> — {work.description}</span>
                        )}
                      </li>
                    ))}
                  </ol>
                  {kind === 'homework' && checkedToday !== undefined && (
                    <p className="text-sm text-muted-foreground">{checkedToday}</p>
                  )}
                </dd>
              </div>
            ),
          )}
          {item !== null && (
            <div className="grid gap-1">
              <dt className="text-sm text-muted-foreground">{t('plans.plan.files')}</dt>
              <dd className="grid gap-2">
                {item.files.length > 0 && (
                  <ul className="grid gap-1">
                    {item.files.map((file) => (
                      <li key={file.id} className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="text-link text-left"
                          onClick={() => {
                            download.mutate({ id: file.id, name: file.name });
                          }}
                        >
                          {file.name}
                        </button>
                        {editable && (
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            aria-label={t('plans.panel.removeFileOf', { name: file.name })}
                            onClick={() => {
                              removeFile.mutate({ id: file.id, name: file.name });
                            }}
                          >
                            {t('plans.panel.removeFile')}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {editable && item.files.length < 10 && (
                  <div>
                    <input
                      ref={fileInput}
                      type="file"
                      className="sr-only"
                      aria-label={t('plans.panel.addFile')}
                      accept={PLAN_FILE_TYPES.join(',')}
                      onChange={(event) => {
                        const chosen = event.target.files?.[0];
                        event.target.value = '';
                        if (chosen !== undefined) upload.mutate(chosen);
                      }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={upload.isPending}
                      onClick={() => {
                        fileInput.current?.click();
                      }}
                    >
                      {t('plans.panel.addFile')}
                    </Button>
                  </div>
                )}
                <FailureAlert error={upload.error ?? removeFile.error ?? download.error} />
              </dd>
            </div>
          )}
        </dl>
      )}
      {panel.editing === null && editable && (
        <PanelActions
          primary={
            <Button
              {...panel.opener('item')}
              onClick={() => {
                panel.start('item', form.reset);
              }}
            >
              {item === null ? t('plans.panel.fill') : t('form.edit')}
            </Button>
          }
          secondary={
            item !== null && !row.held ? (
              <Button
                variant="ghost"
                disabled={clear.isPending}
                onClick={() => {
                  clear.mutate(item.id);
                }}
              >
                {t('plans.panel.clear')}
              </Button>
            ) : undefined
          }
          saved={panel.saved}
        />
      )}
      <FailureAlert error={clear.error} />
    </div>
  );
}
