import { timeText, type DayLesson, type ErrorDetail, type HeldData } from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { CheckboxField } from '@/components/field';

/**
 * What a lesson that holds data holds (task 6.1b-2, decision 2;
 * edge/timetable, After publishing: "with a reason and a list of what is
 * affected"): each kind it holds, with its number.
 */
export function HeldDataText({ held }: { held: HeldData }) {
  const { t } = useTranslation();
  const parts = (
    [
      ['attendance', held.attendance],
      ['scores', held.scores],
      ['totals', held.totals],
      ['notHeld', held.notHeld],
    ] as const
  )
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => t(`timetable.held.${kind}`, { count }));
  return <span data-held-data="true">{parts.join(', ')}</span>;
}

/**
 * The list of a `cancel_holds_data` and the tick that sends the cancel again
 * (task 6.1b-2, decision 2): the entries are kept, struck through and left
 * out of every figure.
 */
export function HeldDataTick({
  details,
  lessons,
  confirm,
}: {
  details: readonly ErrorDetail[];
  /** The lessons the list may name (the refusal names each by `recordId`): its time and class or group. */
  lessons: readonly DayLesson[];
  confirm: Omit<Parameters<typeof CheckboxField>[0], 'label'>;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2" data-held-ticks="true">
      <p className="text-sm font-medium">{t('timetable.held.title')}</p>
      <ul className="grid gap-1 text-sm">
        {details.flatMap((detail, index) =>
          detail.heldData === undefined
            ? []
            : [
                <li key={`${detail.path}-${String(index)}`} data-held-lesson={detail.recordId}>
                  {lessonName(lessons.find((one) => one.id === detail.recordId))}
                  <HeldDataText held={detail.heldData} />
                </li>,
              ],
        )}
      </ul>
      <CheckboxField {...confirm} label={t('timetable.held.confirm')} />
    </div>
  );
}

/** A lesson as the list names it: its time and class or group, before what it holds. */
function lessonName(lesson: DayLesson | undefined): string {
  return lesson === undefined
    ? ''
    : `${timeText(lesson.start)}–${timeText(lesson.end)} ${lesson.unit.name}: `;
}
