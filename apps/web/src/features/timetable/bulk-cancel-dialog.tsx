import {
  bulkCancelBodySchema,
  classDisplayName,
  timeText,
  type BulkCancelAnswer,
  type BulkCancelBody,
  type BulkCancelCheckAnswer,
  type BulkCancelChoice,
  type DayLesson,
} from '@sodiq/shared';
import { useMutation } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { TextAreaField } from '@/components/field';
import { useRecordForm } from '@/components/form/use-record-form';
import { Button } from '@/components/ui/button';
import { CHECKBOX, CHECKBOX_TARGET } from '@/components/ui/control';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { checkBulkCancel, saveBulkCancel } from './timetable-api';

type Language = 'uz' | 'ru' | 'en';

/** The fewest lesson numbers offered, for a page whose class has a shorter day than others. */
const LEAST_NUMBERS = 8;

/**
 * The bulk cancel of a date (task 5.6a-3, pull request #162; `06`, Changes
 * after publishing: "Bulk cancel. For an event: chosen classes, date and
 * slots, with a reason."; edge/timetable, After publishing, the 7 Oxford row):
 * the classes ("Every class of the branch" ticks them all, decision 3), the
 * lesson numbers and the reason; "Check" lists what would be cancelled and
 * each block shared with classes not chosen, which needs a choice (decision
 * 7) before "Cancel lessons" sends once with what the check listed (decision
 * 12). A change of the classes or numbers asks for a new check.
 */
export function BulkCancelDialog({
  date,
  classes,
  startClassId,
  slotCount,
  language,
  onClose,
  onDone,
}: {
  date: string;
  classes: readonly { id: string; grade: number; name: string }[];
  startClassId: string;
  slotCount: number;
  language: Language;
  onClose: () => void;
  onDone: (answer: BulkCancelAnswer) => Promise<void>;
}) {
  const { t } = useTranslation();
  const key = useRef(crypto.randomUUID());
  const done = useRef<BulkCancelAnswer | null>(null);
  const [chosen, setChosen] = useState<readonly string[]>([startClassId]);
  const [numbers, setNumbers] = useState<readonly number[]>([]);
  const [choices, setChoices] = useState<Readonly<Record<string, BulkCancelChoice>>>({});
  const check = useMutation({
    mutationFn: () => checkBulkCancel({ date, classIds: [...chosen], lessonNumbers: [...numbers] }),
    onSuccess: () => {
      setChoices({});
    },
  });
  const result: BulkCancelCheckAnswer | null = check.data ?? null;
  const form = useRecordForm<'reason', BulkCancelBody>({
    schema: bulkCancelBodySchema,
    initial: { reason: '' },
    read: (typed) => ({
      date,
      classIds: [...chosen],
      lessonNumbers: [...numbers],
      reason: typed.reason,
      blocks: (result?.shared ?? []).flatMap((one) => {
        const choice = choices[one.blockId];
        return choice === undefined ? [] : [{ blockId: one.blockId, choice }];
      }),
      lessonIds: (result?.cancel ?? []).map((one) => one.lesson.id),
    }),
    save: async (body) => {
      done.current = await saveBulkCancel(body, key.current);
    },
    message: (field) => (field === 'reason' ? t('timetable.bulk.reasonNeeded') : undefined),
  });
  const element = useRef<HTMLFormElement>(null);
  const title = t('timetable.bulk.title', { date });

  // A new scope needs a new check.
  const rescope = () => {
    check.reset();
    setChoices({});
  };
  const offered = Array.from({ length: Math.max(slotCount, LEAST_NUMBERS) }, (_, at) => at + 1);
  const everyClass = classes.length > 0 && chosen.length === classes.length;
  const unchosen = (result?.shared ?? []).filter((one) => choices[one.blockId] === undefined);
  const ready = result !== null && unchosen.length === 0 && form.status !== 'saving';

  const lessonText = (lesson: DayLesson) =>
    t('timetable.bulk.lesson', {
      start: timeText(lesson.start),
      end: timeText(lesson.end),
      unit: lesson.unit.name,
      subject: lesson.subject.names[language],
      teacher: lesson.teacher?.name ?? t('timetable.day.needsTeacher'),
    });

  const send = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!ready) return;
    const checked = await form.submit();
    if (!checked) {
      element.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    if (done.current !== null) {
      await onDone(done.current);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          ref={element}
          aria-label={title}
          className="grid gap-4"
          onSubmit={(event) => {
            void send(event);
          }}
        >
          <fieldset className="grid gap-1" data-bulk-classes="true">
            <legend className="mb-1 text-sm font-semibold">{t('timetable.bulk.classes')}</legend>
            <label className={CHECKBOX_TARGET}>
              <input
                type="checkbox"
                className={CHECKBOX}
                checked={everyClass}
                onChange={(event) => {
                  setChosen(event.target.checked ? classes.map((one) => one.id) : []);
                  rescope();
                }}
              />
              <span className="text-sm">{t('timetable.bulk.everyClass')}</span>
            </label>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {classes.map((one) => (
                <label key={one.id} className={CHECKBOX_TARGET}>
                  <input
                    type="checkbox"
                    className={CHECKBOX}
                    checked={chosen.includes(one.id)}
                    onChange={(event) => {
                      const on = event.target.checked;
                      setChosen((all) =>
                        on ? [...all, one.id] : all.filter((each) => each !== one.id),
                      );
                      rescope();
                    }}
                  />
                  <span className="text-sm">{classDisplayName(one.grade, one.name)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="grid gap-1" data-bulk-numbers="true">
            <legend className="mb-1 text-sm font-semibold">{t('timetable.bulk.slots')}</legend>
            <div className="flex flex-wrap gap-3">
              {offered.map((number) => (
                <label key={number} className={CHECKBOX_TARGET}>
                  <input
                    type="checkbox"
                    className={CHECKBOX}
                    checked={numbers.includes(number)}
                    onChange={(event) => {
                      const on = event.target.checked;
                      setNumbers((all) =>
                        on
                          ? [...all, number].sort((a, b) => a - b)
                          : all.filter((each) => each !== number),
                      );
                      rescope();
                    }}
                  />
                  <span className="text-sm">{t('timetable.bulk.slot', { number })}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={chosen.length === 0 || numbers.length === 0 || check.isPending}
              onClick={() => {
                check.mutate();
              }}
            >
              {t('timetable.bulk.check')}
            </Button>
          </div>
          <FailureAlert error={check.error} />
          {result !== null && (
            <div className="grid gap-3" data-bulk-result="true">
              <section className="grid gap-1" data-bulk-cancel="true">
                <h3 className="text-sm font-semibold">{t('timetable.bulk.toCancel')}</h3>
                {result.cancel.length === 0 ? (
                  <p className="text-sm">{t('timetable.bulk.noneToCancel')}</p>
                ) : (
                  <ul className="grid gap-1 text-sm">
                    {result.cancel.map((one) => (
                      <li key={one.lesson.id} data-lesson={one.lesson.id}>
                        {lessonText(one.lesson)}
                        {one.broughtIn && <> · {t('timetable.bulk.broughtIn')}</>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {result.shared.map((one) => (
                <fieldset
                  key={one.blockId}
                  className="grid gap-1 rounded-md border p-3"
                  data-shared={one.blockId}
                >
                  <legend className="px-1 text-sm font-semibold">
                    {t('timetable.bulk.shared', {
                      chosen: one.chosenClasses.map((each) => each.name).join(', '),
                      others: one.otherClasses.map((each) => each.name).join(', '),
                    })}
                  </legend>
                  <ul className="grid gap-1 text-sm">
                    {one.lessons.map((lesson) => (
                      <li key={lesson.id}>{lessonText(lesson)}</li>
                    ))}
                  </ul>
                  {(['cancel', 'keep'] as const).map((choice) => (
                    <label key={choice} className={CHECKBOX_TARGET}>
                      <input
                        type="radio"
                        name={`shared-${one.blockId}`}
                        className={CHECKBOX}
                        value={choice}
                        checked={choices[one.blockId] === choice}
                        onChange={() => {
                          setChoices((all) => ({ ...all, [one.blockId]: choice }));
                        }}
                      />
                      <span className="text-sm">{t(`timetable.bulk.choice_${choice}`)}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
              {result.alreadyCancelled.length > 0 && (
                <section className="grid gap-1" data-bulk-already="true">
                  <h3 className="text-sm font-semibold">{t('timetable.bulk.alreadyCancelled')}</h3>
                  <ul className="grid gap-1 text-sm">
                    {result.alreadyCancelled.map((lesson) => (
                      <li key={lesson.id}>{lessonText(lesson)}</li>
                    ))}
                  </ul>
                </section>
              )}
              {result.held.length > 0 && (
                <section className="grid gap-1" data-bulk-held="true">
                  <h3 className="text-sm font-semibold">{t('timetable.bulk.held')}</h3>
                  <ul className="grid gap-1 text-sm">
                    {result.held.map((lesson) => (
                      <li key={lesson.id}>{lessonText(lesson)}</li>
                    ))}
                  </ul>
                </section>
              )}
              {unchosen.length > 0 && (
                <p className="text-sm" data-bulk-unchosen="true">
                  {t('timetable.bulk.chooseEach')}
                </p>
              )}
            </div>
          )}
          <TextAreaField label={t('timetable.day.reason')} rows={3} {...form.bind('reason')} />
          <FailureAlert error={form.failure} />
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>{t('timetable.day.back')}</DialogClose>
            <Button type="submit" variant="destructive" disabled={!ready}>
              {t('timetable.bulk.send')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
