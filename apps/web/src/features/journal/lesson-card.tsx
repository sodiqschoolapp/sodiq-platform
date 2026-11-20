import type { PlanItemFile } from '@sodiq/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
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
import { lessonCardQuery } from './journal-api';
import { WorkKindTag } from './work-kind-tag';

/**
 * The lesson card (task 8.8, pull request #226; `09`, In the journal: "Clicking it opens the
 * lesson card: number, date, slot, topic, classworks, homeworks, objectives, materials"; "The
 * lesson card shows two homework lines: 'given today' ... and 'checked today'"). The owner, 20
 * November 2026: read only, for a reader who views the journal; whoever enters the journal edits
 * the lesson in the one lesson editor (`lesson-editor.tsx`), and "topic not delivered", "not
 * given" and the edit request of the card are gone. The files show under their work, the item's
 * own files as its "Materials".
 */
export function LessonCardDialog({
  lessonId,
  language,
  onClose,
}: {
  lessonId: string;
  language: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const card = useQuery(lessonCardQuery(branchId, lessonId));
  const download = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => downloadPlanFile(id, name),
  });
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
        if (!open) onClose();
      }}
    >
      <DialogContent aria-label={title} className="sm:max-w-lg">
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
            {/* The title gives the number and the date; this line adds the lesson's place in the
                day, without the date again (design review of 17 November 2026, J3). */}
            {found.slot !== null && (
              <p className="text-muted-foreground" data-card-slot="true">
                {t('journal.card.slotOfDay', { slot: found.slot })}
              </p>
            )}
            <div className="grid gap-1">
              <p className="font-semibold">{t('journal.card.topic')}</p>
              <p data-card-topic="true">
                {found.topic === null || found.topic === ''
                  ? t('journal.works.noPlan')
                  : found.topic}
              </p>
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
                        {given.notGiven && (
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
            {download.isError && <FailureAlert error={download.error} />}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('journal.entry.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
