import { classDisplayName, type PublishCheck, type ShortenedDay } from '@sodiq/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { Button } from '@/components/ui/button';
import { CHECKBOX, CHECKBOX_TARGET, SECTION_TITLE } from '@/components/ui/control';
import { schoolDateText } from '@/lib/dates';
import { invalidateTimetable, setDayKeep } from './timetable-api';

const keyOf = (one: { date: string; classId: string }) => `${one.date}|${one.classId}`;

/**
 * The dates shortened for a class in step 8 (task 5.5a-2b-2, pull request
 * #143; edge/time-dates-calendar, "A shortened day": "listed per class in the
 * preview. The Academic Vice Principal can choose which lessons are kept"):
 * each class's lessons of the day with those kept ticked, saved as the
 * draft's choice, or back to the default; and the stored choices that no
 * longer decide anything (decision 3), each with Remove. The server decides
 * what fits; Save is off with more ticked than the day holds.
 */
export function PublishShortened({
  versionId,
  answer,
  canEdit,
  className,
  lessonsText,
}: {
  /** The draft whose choices are saved; `null` shows them only (a vacancy's fill, task 5.7a-3b). */
  versionId: string | null;
  answer: PublishCheck;
  canEdit: boolean;
  /** The name of a class, or `null` when it is not known here. */
  className: (classId: string) => string | null;
  /** The lessons of pattern entries in words. */
  lessonsText: (entryIds: readonly string[]) => string;
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const queryClient = useQueryClient();
  // The ticks changed by the person, per date and class; the rest follow the answer.
  const [ticks, setTicks] = useState<Record<string, number[]>>({});
  const save = useMutation({
    mutationFn: (body: { date: string; classId: string; slotPositions: number[] }) => {
      // Never runs without a draft: its Save is not drawn then.
      if (versionId === null) throw new Error('no draft to keep a shortened day on');
      return setDayKeep(versionId, body);
    },
    onSuccess: async (_saved, body) => {
      setTicks((all) => {
        const rest = { ...all };
        delete rest[keyOf(body)];
        return rest;
      });
      await invalidateTimetable(queryClient);
    },
  });

  if (answer.shortenedDays.length === 0 && answer.unusedKeeps.length === 0) {
    return null;
  }
  const nameOfClass = (classId: string) =>
    className(classId) ?? t('timetable.publish.shortened.aClass');

  const dayItem = (day: ShortenedDay) => {
    const key = keyOf(day);
    const ticked = ticks[key] ?? day.kept;
    const tooMany = ticked.length > day.lessonSlots;
    const changed = ticks[key] !== undefined;
    return (
      <li key={key} className="grid gap-2" data-shortened={key}>
        <p className="text-sm font-semibold">
          {t('timetable.publish.shortened.day', {
            date: schoolDateText(day.date, language),
            class: nameOfClass(day.classId),
          })}
          {day.chosen && (
            <span className="ml-2 font-normal" data-chosen="true">
              {t('timetable.publish.shortened.chosen')}
            </span>
          )}
        </p>
        {day.missingPositions.length > 0 && (
          <p className="text-sm" data-missing="true">
            {t('timetable.publish.shortened.missing')}
          </p>
        )}
        <ul className="grid gap-1 text-sm">
          {day.lessons.map((lesson, index) => (
            <li key={lesson.slotPosition}>
              <label className={CHECKBOX_TARGET}>
                <input
                  type="checkbox"
                  className={CHECKBOX}
                  checked={ticked.includes(lesson.slotPosition)}
                  disabled={!canEdit || save.isPending}
                  onChange={(event) => {
                    const on = event.target.checked;
                    setTicks((all) => ({
                      ...all,
                      [key]: on
                        ? [...ticked, lesson.slotPosition].sort((a, b) => a - b)
                        : ticked.filter((one) => one !== lesson.slotPosition),
                    }));
                  }}
                />
                <span>
                  {t('timetable.publish.shortened.lesson', {
                    number: index + 1,
                    lessons: lessonsText(lesson.entryIds),
                  })}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p className="text-sm" data-kept-count="true">
          {t('timetable.publish.shortened.keeps', { kept: ticked.length, slots: day.lessonSlots })}
        </p>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              disabled={!changed || tooMany || ticked.length === 0 || save.isPending}
              onClick={() => {
                save.mutate({ date: day.date, classId: day.classId, slotPositions: ticked });
              }}
            >
              {t('timetable.publish.shortened.save')}
            </Button>
            {day.chosen && (
              <Button
                variant="secondary"
                disabled={save.isPending}
                onClick={() => {
                  save.mutate({ date: day.date, classId: day.classId, slotPositions: [] });
                }}
              >
                {t('timetable.publish.shortened.reset')}
              </Button>
            )}
            {tooMany && (
              <span className="text-sm" data-too-many="true">
                {t('timetable.publish.shortened.tooMany', { slots: day.lessonSlots })}
              </span>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <section aria-labelledby="publish-shortened" className="grid gap-2">
      <h3 id="publish-shortened" className={SECTION_TITLE}>
        {t('timetable.publish.shortened.title', { count: answer.shortenedDays.length })}
      </h3>
      {answer.shortenedDays.length > 0 && (
        <ul className="grid gap-4">{answer.shortenedDays.map(dayItem)}</ul>
      )}
      {answer.unusedKeeps.length > 0 && (
        <div className="grid gap-1">
          <p className="text-sm font-semibold">{t('timetable.publish.shortened.unused')}</p>
          <ul className="grid gap-1 text-sm">
            {answer.unusedKeeps.map((one) => (
              <li
                key={keyOf(one)}
                className="flex flex-wrap items-center gap-2"
                data-unused={keyOf(one)}
              >
                <span>
                  {t('timetable.publish.shortened.day', {
                    date: schoolDateText(one.date, language),
                    class: nameOfClass(one.classId),
                  })}
                </span>
                {canEdit && (
                  <Button
                    variant="secondary"
                    disabled={save.isPending}
                    onClick={() => {
                      save.mutate({ date: one.date, classId: one.classId, slotPositions: [] });
                    }}
                  >
                    {t('timetable.publish.shortened.remove')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {save.isError && <FailureAlert error={save.error} />}
    </section>
  );
}

/** The name of a class from the load's class rows or the preview's names; `null` when neither holds it. */
export function classNameFrom(
  units: readonly {
    id: string;
    kind: 'class' | 'group';
    name: string;
    grades: readonly number[];
  }[],
) {
  return (classId: string): string | null => {
    const unit = units.find((one) => one.kind === 'class' && one.id === classId);
    return unit === undefined ? null : classDisplayName(unit.grades[0] ?? 0, unit.name);
  };
}
