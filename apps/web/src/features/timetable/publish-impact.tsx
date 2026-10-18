import { classDisplayName, type ImpactChangeAnswer, type PublishImpactAnswer } from '@sodiq/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WarningIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  CHECKBOX,
  CHECKBOX_TARGET,
  SECTION_TITLE,
  SUBSECTION_TITLE,
} from '@/components/ui/control';
import { nameOf } from '@/features/setup/setup-api';
import { rangeText } from '@/features/setup/templates-api';
import { schoolDateText, weekdayName } from '@/lib/dates';

/** How many lines of changes show before "Show all". */
const FIRST_LINES = 20;

/**
 * The impact preview of a publish in step 8 (task 5.5a-2b-1; `06`, How
 * surprises are prevented, Impact preview): the lessons created, moved,
 * removed and changed, the teachers, classes and rooms affected, who will be
 * notified, the lessons per week under each vacancy, and the transition week
 * with its tick (`edge/timetable`, "A version starts on a Wednesday"). The
 * server's answer names everything it shows.
 */
export function PublishImpact({
  impact,
  ticked,
  onTick,
  canEdit,
}: {
  impact: PublishImpactAnswer;
  ticked: boolean;
  onTick: (ticked: boolean) => void;
  canEdit: boolean;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const [all, setAll] = useState(false);
  const { names } = impact;

  const unitName = (id: string): string => {
    const unit = names.units.find((one) => one.id === id);
    if (unit === undefined) return t('timetable.publish.impact.unknownUnit');
    return unit.kind === 'class' ? classDisplayName(unit.grades[0] ?? 0, unit.name) : unit.name;
  };
  const subjectName = (id: string): string => {
    const subject = names.subjects.find((one) => one.id === id);
    return subject === undefined
      ? t('timetable.publish.impact.unknownSubject')
      : nameOf(subject.names, language);
  };
  const teacherName = (id: string): string =>
    names.teachers.find((one) => one.id === id)?.name ??
    t('timetable.publish.impact.unknownTeacher');
  const roomName = (id: string): string =>
    names.rooms.find((one) => one.id === id)?.name ?? t('timetable.publish.impact.unknownRoom');

  const slotText = (slot: NonNullable<ImpactChangeAnswer['before']>): string =>
    [
      `${weekdayName(language, slot.weekday)} ${rangeText(t, slot.start, slot.end)}`,
      slot.teacherIds.length === 0
        ? t('timetable.publish.impact.noTeacher')
        : slot.teacherIds.map(teacherName).join(', '),
      slot.roomId === null ? null : roomName(slot.roomId),
    ]
      .filter(Boolean)
      .join(', ');
  const changeText = (change: ImpactChangeAnswer): string => {
    const where =
      change.before !== null && change.after !== null
        ? t('timetable.publish.impact.fromTo', {
            before: slotText(change.before),
            after: slotText(change.after),
          })
        : slotText(
            change.after ??
              change.before ?? { weekday: 1, start: 0, end: 0, teacherIds: [], roomId: null },
          );
    const dates =
      change.firstDate === change.lastDate
        ? schoolDateText(change.firstDate, language)
        : t('timetable.publish.impact.dates', {
            first: schoolDateText(change.firstDate, language),
            last: schoolDateText(change.lastDate, language),
          });
    return [
      `${t(`timetable.publish.impact.kinds.${change.kind}`)}: ${unitName(change.unitId)}, ${subjectName(change.subjectId)}`,
      where,
      t('timetable.publish.impact.lessons', { count: change.count }),
      dates,
    ].join('. ');
  };

  const shown = all ? impact.changes : impact.changes.slice(0, FIRST_LINES);
  const transition = impact.transition;
  return (
    <section aria-labelledby="publish-impact" className="grid gap-4" data-impact="true">
      <h3 id="publish-impact" className={SECTION_TITLE}>
        {t('timetable.publish.impact.title')}
      </h3>
      <p className="text-sm">
        {impact.beforeVersion === null
          ? t('timetable.publish.impact.first')
          : t('timetable.publish.impact.against', { number: impact.beforeVersion.number })}
      </p>
      <ul className="grid gap-1 text-sm" data-counts="true">
        {(['created', 'moved', 'removed', 'changed', 'unchanged'] as const).map((kind) => (
          <li key={kind} data-kind={kind}>
            {t(`timetable.publish.impact.counts.${kind}`, { count: impact.counts[kind] })}
          </li>
        ))}
      </ul>
      {impact.changes.length > 0 && (
        <div className="grid gap-2">
          <ul className="grid gap-1 text-sm" data-changes="true">
            {shown.map((change, index) => (
              <li key={index} data-kind={change.kind}>
                {changeText(change)}
              </li>
            ))}
          </ul>
          {!all && impact.changes.length > FIRST_LINES && (
            <div>
              <Button
                variant="secondary"
                onClick={() => {
                  setAll(true);
                }}
              >
                {t('timetable.publish.impact.showAll', { count: impact.changes.length })}
              </Button>
            </div>
          )}
        </div>
      )}
      {impact.teachers.length > 0 && (
        <div className="grid gap-1">
          <h4 className={SUBSECTION_TITLE}>{t('timetable.publish.impact.teachersTitle')}</h4>
          <ul className="grid gap-1 text-sm" data-teachers="true">
            {impact.teachers.map((one) => (
              <li key={one.id} data-teacher={one.id}>
                {t('timetable.publish.impact.teacherLine', {
                  name: teacherName(one.id),
                  mark: t(
                    one.vacancy
                      ? 'timetable.publish.impact.vacancy'
                      : one.notified
                        ? 'timetable.publish.impact.notified'
                        : 'timetable.publish.impact.noAccount',
                  ),
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
      {impact.classIds.length > 0 && (
        <div className="grid gap-1">
          <h4 className={SUBSECTION_TITLE}>{t('timetable.publish.impact.classesTitle')}</h4>
          <p className="text-sm" data-classes="true">
            {impact.classIds.map(unitName).join(', ')}
          </p>
        </div>
      )}
      {impact.roomIds.length > 0 && (
        <div className="grid gap-1">
          <h4 className={SUBSECTION_TITLE}>{t('timetable.publish.impact.roomsTitle')}</h4>
          <p className="text-sm" data-rooms="true">
            {impact.roomIds.map(roomName).join(', ')}
          </p>
        </div>
      )}
      {impact.vacancies.length > 0 && (
        <div className="grid gap-1">
          <h4 className={SUBSECTION_TITLE}>{t('timetable.publish.impact.vacanciesTitle')}</h4>
          <ul className="grid gap-1 text-sm" data-vacancies="true">
            {impact.vacancies.map((one) => (
              <li key={one.id}>
                {t('timetable.publish.impact.vacancyLessons', {
                  name: teacherName(one.id),
                  count: one.lessonsPerWeek,
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
      {transition !== null && (
        <div className="grid gap-2" data-transition="true">
          <h4 className={SUBSECTION_TITLE}>
            {t('timetable.publish.transition.title', {
              first: schoolDateText(transition.weekStart, language),
              last: schoolDateText(transition.weekEnd, language),
            })}
          </h4>
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th scope="col" className="py-1 pr-3 font-normal">
                    {t('timetable.publish.transition.unit')}
                  </th>
                  <th scope="col" className="py-1 pr-3 font-normal">
                    {t('timetable.publish.transition.subject')}
                  </th>
                  <th scope="col" className="py-1 pr-3 font-normal">
                    {t('timetable.publish.transition.before')}
                  </th>
                  <th scope="col" className="py-1 pr-3 font-normal">
                    {t('timetable.publish.transition.after')}
                  </th>
                  <th scope="col" className="py-1 pr-3 font-normal">
                    {t('timetable.publish.transition.load')}
                  </th>
                  <th scope="col" className="py-1 font-normal">
                    <span className="sr-only">{t('timetable.publish.transition.differs')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {transition.rows.map((row) => (
                  <tr key={`${row.unitId}|${row.subjectId}`} data-differs={row.differs}>
                    <td className="py-1 pr-3">{unitName(row.unitId)}</td>
                    <td className="py-1 pr-3">{subjectName(row.subjectId)}</td>
                    <td className="py-1 pr-3">{row.before}</td>
                    <td className="py-1 pr-3">{row.after}</td>
                    <td className="py-1 pr-3">{row.lessonsPerWeek}</td>
                    <td className="py-1">
                      {row.differs && (
                        <span className="flex items-center gap-1">
                          <WarningIcon aria-hidden="true" className="size-4 shrink-0" />
                          {t('timetable.publish.transition.differs')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {transition.key !== null && canEdit && (
            <label className={`${CHECKBOX_TARGET} text-sm font-medium select-none`}>
              <input
                type="checkbox"
                name="transitionChecked"
                className={CHECKBOX}
                checked={ticked}
                onChange={(event) => {
                  onTick(event.target.checked);
                }}
              />
              {t('timetable.publish.transition.tick')}
            </label>
          )}
        </div>
      )}
    </section>
  );
}
