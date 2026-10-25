import type { LessonCard } from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { CHECKBOX } from '@/components/ui/control';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useView } from '@/features/access/use-view';
import { downloadPlanFile } from '@/features/plans/plans-api';
import { schoolDateText } from '@/lib/dates';
import {
  invalidateJournal,
  journalKey,
  lessonCardQuery,
  setDelivery,
  setHomeworkGiven,
} from './journal-api';

/**
 * The lesson card (task 8.8, pull request #226; `09`, In the journal: "Clicking it opens the
 * lesson card: number, date, slot, topic, classworks, homeworks, objectives, materials"; "The
 * lesson card shows two homework lines: 'given today' ... and 'checked today'"). On it the
 * lesson's teacher or substitute sets "topic not delivered" and marks homeworks "not given"
 * (`edge/lesson-plans`, "A substitute supervises the class"). The plan is read only here.
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
  const busy = delivery.isPending || homework.isPending;
  const found = card.data;
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
        if (!open) onClose();
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
                        <span>{work.title}</span>
                        {work.description !== '' && (
                          <span className="text-muted-foreground">{work.description}</span>
                        )}
                      </span>
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
                        <span className={given.notGiven ? 'line-through' : undefined}>
                          {given.title ?? t('journal.grid.homeworkShort', { number: index + 1 })}
                        </span>
                        {found.canMark && given.planWorkId !== null && (
                          <label className="flex items-center gap-2">
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
                        <span>
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
            {found.whole && (found.links.length > 0 || found.files.length > 0) && (
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
                  {found.files.map((file) => (
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
              <label className="flex items-center gap-2">
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
          </div>
        )}
        <DialogFooter>
          {onOpenWorks !== undefined && (
            <Button variant="secondary" onClick={onOpenWorks}>
              {t('journal.works.button')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t('journal.entry.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
