import {
  PLAN_FILES_MAX,
  type Plan,
  type PlanItem,
  type PlanItemFile,
  type PlanRow,
} from '@sodiq/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { PanelActions } from '@/components/list/panel-actions';
import { usePanelEditing } from '@/components/list/use-panel-editing';
import { Button } from '@/components/ui/button';
import { rowDateText } from './plan-page';
import { CopiedFrom } from './plan-sharing';
import { FilePicker, NotUploaded, PlanItemEditor, type HeldFile } from './plan-item-editor';
import { titleField, WORK_KINDS, type PlanField, type WorkKind } from './plan-item-form';
import {
  addPlanFile,
  clearPlanItem,
  downloadPlanFile,
  invalidatePlans,
  removePlanFile,
} from './plans-api';

/** The value stored now of each field a save was refused for (`plan_item_stale`), by field. */
function storedNotes(
  failure: unknown,
  item: PlanItem | null,
  t: TFunction,
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
  // Task 7.2: the window or an open period opens the row (`row.open`); the server decides.
  const editable = plan.canEdit && row.open !== 'none';
  const slotText = (slot: number) => t('plans.plan.slot', { number: slot });
  // Task 10.8: the files a save could not upload, kept until sent again or removed.
  const [failed, setFailed] = useState<HeldFile[]>([]);

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
    mutationFn: async ({ file, workId }: { file: File; workId: string | null }) => {
      if (item === null) return;
      await addPlanFile(item.id, file, workId);
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
      {item?.copiedFrom != null && <CopiedFrom from={item.copiedFrom} />}
      {panel.editing === 'item' ? (
        <PlanItemEditor
          journalId={plan.journalId}
          quarterId={plan.quarterId}
          position={row.number}
          lessonId={row.lessonId}
          item={item}
          label={t('plans.plan.rowName', { number: row.number })}
          failureNotes={(failure, stored) => storedNotes(failure, stored, t)}
          {...(item === null &&
          previous !== undefined &&
          previous.date === row.date &&
          previous.item !== null
            ? { sameTopic: previous.item.topic }
            : {})}
          {...(checkedToday === undefined ? {} : { checkedToday })}
          onSaved={(_saved, notSent) => {
            setFailed(notSent);
            panel.stop({ saved: true, key: 'item' });
          }}
          onCancel={() => {
            panel.stop();
          }}
        />
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
                  <ol className="grid list-decimal gap-2 pl-5">
                    {works(kind).map((work) => (
                      <li key={work.id} className="grid gap-1">
                        <span>
                          {work.title}
                          {work.description !== '' && (
                            <span className="text-muted-foreground"> — {work.description}</span>
                          )}
                          {/* Task 10.8: `09`, In the journal: "marked ... as added in the journal". */}
                          {item?.addedInJournal.includes(work.id) === true && (
                            <span className="text-muted-foreground">
                              {' '}
                              · {t('plans.plan.addedInJournal')}
                            </span>
                          )}
                        </span>
                        <ItemFiles
                          files={(item?.files ?? []).filter((file) => file.workId === work.id)}
                          editable={editable}
                          busy={upload.isPending}
                          pickLabel={t('plans.files.attachTo', { name: work.title })}
                          onDownload={(file) => {
                            download.mutate(file);
                          }}
                          onRemove={(file) => {
                            removeFile.mutate(file);
                          }}
                          onPick={(file) => {
                            upload.mutate({ file, workId: work.id });
                          }}
                        />
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
              {/* Task 10.8: the item's own files are its "Materials", for staff only. */}
              <dt className="text-sm text-muted-foreground">{t('plans.files.materials')}</dt>
              <dd className="grid gap-2">
                <ItemFiles
                  files={item.files.filter((file) => file.workId === null)}
                  editable={editable}
                  busy={upload.isPending}
                  pickLabel={t('plans.files.attachMaterial')}
                  onDownload={(file) => {
                    download.mutate(file);
                  }}
                  onRemove={(file) => {
                    removeFile.mutate(file);
                  }}
                  onPick={(file) => {
                    upload.mutate({ file, workId: null });
                  }}
                />
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
                // The editor is drawn fresh each time it opens (`PlanItemEditor`).
                panel.start('item', () => undefined);
              }}
            >
              {item === null ? t('plans.panel.fill') : t('form.edit')}
            </Button>
          }
          secondary={
            item !== null && !row.held && row.open === 'all' ? (
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
      <NotUploaded itemId={item?.id ?? null} failed={failed} onChange={setFailed} />
    </div>
  );
}

/** Task 10.8: the files of a work or of the materials, with download, remove and a picker. */
function ItemFiles({
  files,
  editable,
  busy,
  pickLabel,
  onDownload,
  onRemove,
  onPick,
}: {
  files: readonly PlanItemFile[];
  editable: boolean;
  busy: boolean;
  pickLabel: string;
  onDownload: (file: { id: string; name: string }) => void;
  onRemove: (file: { id: string; name: string }) => void;
  onPick: (file: File) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-1">
      {files.length > 0 && (
        <ul className="grid gap-1">
          {files.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="text-link text-left"
                onClick={() => {
                  onDownload({ id: file.id, name: file.name });
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
                    onRemove({ id: file.id, name: file.name });
                  }}
                >
                  {t('plans.panel.removeFile')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && files.length < PLAN_FILES_MAX && (
        <FilePicker label={pickLabel} disabled={busy} onPick={onPick} />
      )}
    </div>
  );
}
