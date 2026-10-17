import {
  classDisplayName,
  weekdaySchema,
  type GridAnswer,
  type TimetableLock,
  type TimetableLockRecord,
} from '@sodiq/shared';
import type { PatternBlock } from '@sodiq/timetable-rules';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SelectField } from '@/components/field';
import { LockIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { SECTION_TITLE } from '@/components/ui/control';
import { weekdayName } from '@/lib/dates';

/**
 * The locks of the draft (task 5.4c-1; 06, Auto-generation: "A lesson, a
 * class, a teacher or a day can be locked. 'Regenerate' changes only what is
 * not locked."): each with Unlock, and the class shown, a teacher of the
 * load or a weekday of the board locked here; a lesson is locked from its
 * tile. "Suggest a place" leaves what they hold where it is (decision 8).
 */
export function GridLocks({
  grid,
  classId,
  weekdays,
  teachers,
  lessonName,
  editable,
  pending,
  onLock,
  onUnlock,
}: {
  grid: GridAnswer;
  classId: string;
  weekdays: readonly number[];
  teachers: readonly { id: string; name: string }[];
  lessonName: (block: Pick<PatternBlock, 'lessons'>) => string;
  editable: boolean;
  pending: boolean;
  onLock: (record: TimetableLockRecord) => void;
  onUnlock: (lockId: string) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const [weekday, setWeekday] = useState<number | null>(null);
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const dayChosen = weekdays.find((one) => one === weekday) ?? weekdays[0];
  const teacherChosen = teachers.find((one) => one.id === teacherId) ?? teachers[0];
  const classLocked = grid.locks.some((lock) => lock.kind === 'class' && lock.classId === classId);
  const dayName = (day: number) => weekdayName(language, weekdaySchema.parse(day));

  const textOf = (lock: TimetableLock): string => {
    switch (lock.kind) {
      case 'block': {
        const block = grid.blocks.find((one) => one.id === lock.blockId);
        return t('timetable.grid.lockedLesson', {
          lesson: block === undefined ? '' : lessonName(block),
        });
      }
      case 'class': {
        const found = grid.classes.find((one) => one.id === lock.classId);
        return t('timetable.grid.lockedClass', {
          name: found === undefined ? '' : classDisplayName(found.grade, found.name),
        });
      }
      case 'teacher':
        return t('timetable.grid.lockedTeacher', {
          name: teachers.find((one) => one.id === lock.teacherId)?.name ?? '',
        });
      case 'day':
        return t('timetable.grid.lockedDay', { day: dayName(lock.weekday) });
    }
  };

  return (
    <section aria-labelledby="grid-locks" className="grid content-start gap-2" data-locks="">
      <h3 id="grid-locks" className={SECTION_TITLE}>
        {t('timetable.grid.locks')}
      </h3>
      {grid.locks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('timetable.grid.noLocks')}</p>
      ) : (
        <ul className="grid gap-1">
          {grid.locks.map((lock) => (
            <li key={lock.id} className="flex items-center gap-2 text-sm" data-lock={lock.id}>
              <LockIcon className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">{textOf(lock)}</span>
              {editable && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    onUnlock(lock.id);
                  }}
                >
                  {t('timetable.grid.unlock')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="grid gap-3">
          {!classLocked && (
            <span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() => {
                  onLock({ kind: 'class', classId });
                }}
              >
                {t('timetable.grid.lockClass')}
              </Button>
            </span>
          )}
          {dayChosen !== undefined && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-32">
                <SelectField
                  label={t('timetable.grid.lockDayLabel')}
                  name="lock-day"
                  value={String(dayChosen)}
                  options={weekdays.map((one) => ({ value: String(one), label: dayName(one) }))}
                  onChange={(event) => {
                    setWeekday(Number(event.target.value));
                  }}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() => {
                  onLock({ kind: 'day', weekday: weekdaySchema.parse(dayChosen) });
                }}
              >
                {t('timetable.grid.lockDay')}
              </Button>
            </div>
          )}
          {teacherChosen !== undefined && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-40">
                <SelectField
                  label={t('timetable.grid.lockTeacherLabel')}
                  name="lock-teacher"
                  value={teacherChosen.id}
                  options={teachers.map((one) => ({ value: one.id, label: one.name }))}
                  onChange={(event) => {
                    setTeacherId(event.target.value);
                  }}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() => {
                  onLock({ kind: 'teacher', teacherId: teacherChosen.id });
                }}
              >
                {t('timetable.grid.lockTeacher')}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
