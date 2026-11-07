import type { LessonCard, PlanItemFile } from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/confirm-dialog';
import { useLeave } from '@/components/unsent/unsent-changes';
import { FailureAlert } from '@/components/failure-alert';
import { TextAreaField } from '@/components/field';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { CHECKBOX, CHECKBOX_TARGET } from '@/components/ui/control';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useView } from '@/features/access/use-view';
import { NotUploaded, PlanItemEditor, type HeldFile } from '@/features/plans/plan-item-editor';
import { askPlanRequest, downloadPlanFile, invalidatePlans } from '@/features/plans/plans-api';
import { schoolDateText } from '@/lib/dates';
import {
  invalidateJournal,
  journalKey,
  lessonCardQuery,
  setDelivery,
  setHomeworkGiven,
} from './journal-api';
import { WorkKindTag } from './work-kind-tag';

/**
 * The lesson card (task 8.8, pull request #226; `09`, In the journal: "Clicking it opens the
 * lesson card: number, date, slot, topic, classworks, homeworks, objectives, materials"; "The
 * lesson card shows two homework lines: 'given today' ... and 'checked today'"). On it the
 * lesson's teacher or substitute sets "topic not delivered" and marks homeworks "not given"
 * (`edge/lesson-plans`, "A substitute supervises the class"). Task 10.8 (`09`, In the journal:
 * "The lesson card is a second way into the plan item of its lesson"): the plan's owner edits the
 * item here while its row is open (`plan.edit` `open`), through the plan's own routes, and
 * otherwise sends the edit request for this lesson; the files show under their work, the item's
 * own files as its "Materials".
 */
export function LessonCardDialog({
  lessonId,
  language,
  onClose,
  onOpenWorks,
}: {
  lessonId: string;
  language: string;
  onClose: () => void;
  /** The works of the lesson (task 8.1), for a reader who enters them. */
  onOpenWorks?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const card = useQuery(lessonCardQuery(branchId, lessonId));
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: [...journalKey(branchId), 'card', lessonId] });
    await invalidateJournal(queryClient);
  };
  const delivery = useMutation({
    mutationFn: (value: LessonCard['delivery'] & { next: boolean }) =>
      setDelivery(lessonId, { notDelivered: value.next, version: value.version }),
    onSettled: refresh,
  });
  const homework = useMutation({
    mutationFn: (value: { planWorkId: string; notGiven: boolean }) =>
      setHomeworkGiven(lessonId, { planWorkIds: [value.planWorkId], notGiven: value.notGiven }),
    onSettled: refresh,
  });
  const download = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => downloadPlanFile(id, name),
  });
  // Task 10.8: the card's way into the plan.
  const [editing, setEditing] = useState(false);
  const [failed, setFailed] = useState<HeldFile[]>([]);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const ask = useMutation({
    mutationFn: async (value: { found: LessonCard; reason: string }) => {
      const { found: at } = value;
      await askPlanRequest(
        at.journalId,
        // `edge/lesson-plans`: "Lessons already held take only Text"; a lesson not yet held is
        // re-planned from itself (plan decision 12).
        at.held
          ? {
              kind: 'text',
              quarterId: at.plan.quarterId,
              lessonIds: [at.lessonId],
              reason: value.reason,
            }
          : {
              kind: 'replan',
              quarterId: at.plan.quarterId,
              fromLessonId: at.lessonId,
              reason: value.reason,
            },
      );
      await invalidatePlans(queryClient);
    },
    onSuccess: () => {
      setAsking(false);
      setReason('');
    },
  });
  const confirm = useConfirm();
  const leave = useLeave();
  // Code review (spec 4): files not uploaded are never dropped without a word; closing asks.
  const close = async () => {
    // Code review: an item being edited, with its typed values and held files, is asked about
    // first, as every unsent form (`useLeave`).
    if (editing && !(await leave.leave())) return;
    if (failed.length === 0) {
      onClose();
      return;
    }
    void confirm({
      title: t('plans.files.notUploaded'),
      text: t('plans.files.closeText'),
      names: failed.map((one) => one.file.name),
      action: t('plans.files.closeAction'),
      destructive: true,
    }).then((sure) => {
      if (sure) onClose();
    });
  };
  const busy = delivery.isPending || homework.isPending;
  const found = card.data;
  const filesOf = (workId: string | null): PlanItemFile[] =>
    (found?.files ?? []).filter((file) => file.workId === workId);
  const fileList = (files: readonly PlanItemFile[]) =>
    files.length === 0 ? null : (
      <ul className="grid gap-1">
        {files.map((file) => (
          <li key={file.id}>
            <Button
              variant="ghost"
              disabled={download.isPending}
              onClick={() => {
                download.mutate({ id: file.id, name: file.name });
              }}
            >
              {file.name}
            </Button>
          </li>
        ))}
      </ul>
    );
  const title =
    found === undefined
      ? t('journal.card.titleLoading')
      : found.number === null
        ? t('journal.card.titleNoNumber', { date: schoolDateText(found.date, language) })
        : t('journal.card.title', {
            number: found.number,
            date: schoolDateText(found.date, language),
          });
  const dateOf = (date: string) => schoolDateText(date, language);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void close();
      }}
    >
      <DialogContent aria-label={title}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {card.isError ? (
          <ErrorState
            error={card.error}
            onRetry={() => {
              void card.refetch();
            }}
          />
        ) : found === undefined ? (
          <LoadingOutline lines={4} />
        ) : editing && found.plan.position !== null ? (
          <PlanItemEditor
            journalId={found.journalId}
            quarterId={found.plan.quarterId}
            position={found.plan.position}
            lessonId={found.lessonId}
            item={found.plan.item}
            label={title}
            onSaved={(_saved, notSent) => {
              setFailed(notSent);
              setEditing(false);
              void refresh();
            }}
            onCancel={() => {
              setEditing(false);
            }}
          />
        ) : (
          <div className="grid gap-4 text-sm" data-lesson-card={found.lessonId}>
            <p className="text-muted-foreground">
              {found.slot === null
                ? dateOf(found.date)
                : t('journal.card.dateSlot', { date: dateOf(found.date), slot: found.slot })}
            </p>
            <div className="grid gap-1">
              <p className="font-semibold">{t('journal.card.topic')}</p>
              <p data-card-topic="true">
                {found.topic === null || found.topic === ''
                  ? t('journal.works.noPlan')
                  : found.topic}
              </p>
              {found.delivery.notDelivered && (
                <p className="font-semibold" data-not-delivered="true">
                  {t('journal.card.notDelivered')}
                </p>
              )}
              {found.movedFrom !== null && (
                <p className="text-muted-foreground">
                  {t('journal.card.movedFrom', { date: dateOf(found.movedFrom) })}
                </p>
              )}
              {found.editedAfterLesson && (
                <p className="text-muted-foreground">{t('journal.card.editedAfterLesson')}</p>
              )}
            </div>
            {found.whole && found.classworks.length > 0 && (
              <div className="grid gap-1">
                <p className="font-semibold">{t('journal.card.classworks')}</p>
                <ul className="grid list-disc gap-1 pl-5">
                  {found.classworks.map((work) => (
                    <li key={work.id}>
                      <span className="flex flex-wrap gap-2">
                        {/* Task 10.7: the kind's tag in front of each work of the card. */}
                        <span className="inline-flex items-center gap-1">
                          <WorkKindTag kind="classwork" />
                          {work.title}
                        </span>
                        {work.description !== '' && (
                          <span className="text-muted-foreground">{work.description}</span>
                        )}
                        {found.addedInJournal.includes(work.id) && (
                          <span className="text-muted-foreground">
                            {t('plans.plan.addedInJournal')}
                          </span>
                        )}
                      </span>
                      {fileList(filesOf(work.id))}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid gap-1" data-given-today="true">
              <p className="font-semibold">{t('journal.card.givenToday')}</p>
              {found.givenToday.length === 0 ? (
                <p className="text-muted-foreground">{t('journal.card.none')}</p>
              ) : (
                <ul className="grid gap-2">
                  {found.givenToday.map((given, index) => (
                    <li key={given.planWorkId ?? String(index)} className="grid gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <WorkKindTag kind="homework" />
                        <span className={given.notGiven ? 'line-through' : undefined}>
                          {given.title ?? t('journal.grid.homeworkShort', { number: index + 1 })}
                        </span>
                        {found.canMark && given.planWorkId !== null && (
                          <label className={CHECKBOX_TARGET}>
                            <input
                              type="checkbox"
                              className={CHECKBOX}
                              checked={given.notGiven}
                              disabled={busy}
                              onChange={(event) => {
                                homework.mutate({
                                  planWorkId: given.planWorkId ?? '',
                                  notGiven: event.target.checked,
                                });
                              }}
                            />
                            {t('journal.card.notGiven')}
                          </label>
                        )}
                        {!found.canMark && given.notGiven && (
                          <span className="text-muted-foreground">
                            {t('journal.card.notGiven')}
                          </span>
                        )}
                      </div>
                      {given.description !== null && given.description !== '' && (
                        <span className="text-muted-foreground">{given.description}</span>
                      )}
                      {found.whole &&
                        given.planWorkId !== null &&
                        fileList(filesOf(given.planWorkId))}
                      {!given.notGiven && given.checkAt !== null && (
                        <span className="text-muted-foreground">
                          {given.checkedSameDay && given.checkAt.slot !== null
                            ? t('journal.card.checkedSameDay', { slot: given.checkAt.slot })
                            : t('journal.works.checkedOn', { date: dateOf(given.checkAt.date) })}
                        </span>
                      )}
                      {!given.notGiven && given.ungraded !== null && (
                        <span className="text-muted-foreground">
                          {t(`journal.works.ungraded.${given.ungraded}`)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="grid gap-1" data-checked-today="true">
              <p className="font-semibold">{t('journal.card.checkedToday')}</p>
              {found.checkedToday.length === 0 ? (
                <p className="text-muted-foreground">{t('journal.card.none')}</p>
              ) : (
                <ul className="grid list-disc gap-1 pl-5">
                  {found.checkedToday.map((checked, index) => (
                    <li key={`${checked.title ?? ''}:${String(index)}`}>
                      <span className="flex flex-wrap gap-2">
                        <span className="inline-flex items-center gap-1">
                          <WorkKindTag kind="homework" />
                          {checked.title ?? t('journal.grid.homeworkShort', { number: index + 1 })}
                        </span>
                        {checked.givenOn !== null && (
                          <span className="text-muted-foreground">
                            {t('journal.card.givenOn', { date: dateOf(checked.givenOn) })}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {found.whole && found.objectives !== null && found.objectives !== '' && (
              <div className="grid gap-1">
                <p className="font-semibold">{t('journal.card.objectives')}</p>
                <p className="whitespace-pre-line">{found.objectives}</p>
              </div>
            )}
            {found.whole && (found.links.length > 0 || filesOf(null).length > 0) && (
              <div className="grid gap-1">
                <p className="font-semibold">{t('journal.card.materials')}</p>
                <ul className="grid gap-1">
                  {found.links.map((link) => (
                    <li key={link}>
                      <a className="text-link" href={link} target="_blank" rel="noreferrer">
                        {link}
                      </a>
                    </li>
                  ))}
                  {filesOf(null).map((file) => (
                    <li key={file.id}>
                      <Button
                        variant="ghost"
                        disabled={download.isPending}
                        onClick={() => {
                          download.mutate({ id: file.id, name: file.name });
                        }}
                      >
                        {file.name}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {found.canMark && (
              <label className={CHECKBOX_TARGET}>
                <input
                  type="checkbox"
                  className={CHECKBOX}
                  checked={found.delivery.notDelivered}
                  disabled={busy}
                  onChange={(event) => {
                    delivery.mutate({ ...found.delivery, next: event.target.checked });
                  }}
                />
                {t('journal.card.markNotDelivered')}
              </label>
            )}
            {delivery.isError && <FailureAlert error={delivery.error} />}
            {homework.isError && <FailureAlert error={homework.error} />}
            {download.isError && <FailureAlert error={download.error} />}
            <NotUploaded
              itemId={found.plan.item?.id ?? null}
              failed={failed}
              onChange={setFailed}
            />
            {asking && (
              <form
                className="grid gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (reason.trim() === '') return;
                  ask.mutate({ found, reason: reason.trim() });
                }}
              >
                <TextAreaField
                  label={t('journal.card.askReason')}
                  rows={2}
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                  }}
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={ask.isPending || reason.trim() === ''}>
                    {t('journal.card.askSend')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setAsking(false);
                    }}
                  >
                    {t('form.cancel')}
                  </Button>
                </div>
              </form>
            )}
            {ask.isSuccess && !asking && (
              <p role="status" data-asked="true">
                {t('journal.card.asked')}
              </p>
            )}
            {ask.isError && <FailureAlert error={ask.error} />}
          </div>
        )}
        <DialogFooter>
          {found !== undefined &&
            !editing &&
            found.plan.edit === 'open' &&
            found.plan.position !== null && (
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(true);
                }}
              >
                {t('journal.card.editPlan')}
              </Button>
            )}
          {found !== undefined && !asking && found.plan.edit === 'request' && (
            <Button
              variant="secondary"
              onClick={() => {
                setAsking(true);
              }}
            >
              {t('journal.card.askToEdit')}
            </Button>
          )}
          {onOpenWorks !== undefined && (
            <Button variant="secondary" onClick={onOpenWorks}>
              {t('journal.works.button')}
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              void close();
            }}
          >
            {t('journal.entry.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
