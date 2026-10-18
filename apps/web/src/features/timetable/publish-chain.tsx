import type {
  CarryChangeAnswer,
  PublishChain,
  PublishChainAnswer,
  PublishImpactAnswer,
} from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import {
  CHECKBOX,
  CHECKBOX_TARGET,
  SECTION_TITLE,
  SUBSECTION_TITLE,
} from '@/components/ui/control';
import { schoolDateText, weekdayName } from '@/lib/dates';

/**
 * The question of a publish before a later published version, in step 8
 * (task 5.5a-3a, pull request #145; `edge/timetable`, Versions and drafts:
 * "Publishing before an already published later version asks: 'run until
 * that version starts', 'replace the versions that follow', or — offered only
 * when the new version differs from the version it started from in nothing
 * but the teachers or rooms of entries — 'carry the change into them'"). The
 * later versions, the three answers, the changes to carry and, under
 * "carry", what each later version takes. The server decides; this shows its
 * check of the answer chosen.
 */
export function PublishChainQuestion({
  answer,
  impact,
  chosen,
  onChoose,
  canEdit,
  lessonName,
}: {
  answer: PublishChainAnswer;
  impact: PublishImpactAnswer | null;
  chosen: PublishChain | null;
  onChoose: (chain: PublishChain) => void;
  canEdit: boolean;
  /** The class or group and subject of a change as a person reads them. */
  lessonName: (change: CarryChangeAnswer) => string;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const names = impact?.names;
  const teacherName = (id: string | null): string =>
    id === null
      ? t('timetable.publish.chain.none')
      : (names?.teachers.find((one) => one.id === id)?.name ??
        t('timetable.publish.impact.unknownTeacher'));
  const roomName = (id: string | null): string =>
    id === null
      ? t('timetable.publish.chain.none')
      : (names?.rooms.find((one) => one.id === id)?.name ??
        t('timetable.publish.impact.unknownRoom'));

  const changeText = (change: CarryChangeAnswer): string => {
    const lesson = lessonName(change);
    switch (change.kind) {
      case 'teacher':
        return t('timetable.publish.chain.change.teacher', {
          lesson,
          before: teacherName(change.before),
          after: teacherName(change.after),
        });
      case 'row_room':
        return t('timetable.publish.chain.change.row_room', {
          lesson,
          before: roomName(change.before),
          after: roomName(change.after),
        });
      case 'entry_room':
        return t('timetable.publish.chain.change.entry_room', {
          lesson,
          day: weekdayName(language, change.weekday ?? 1),
          slot: change.slotPosition ?? 0,
          before: roomName(change.before),
          after: roomName(change.after),
        });
    }
  };

  const carriedImpact = (versionId: string) =>
    impact?.carried.find((one) => one.versionId === versionId);

  return (
    <section aria-labelledby="publish-chain" className="grid gap-3" data-chain="true">
      <h3 id="publish-chain" className={SECTION_TITLE}>
        {t('timetable.publish.chain.title')}
      </h3>
      <p className="text-sm">{t('timetable.publish.chain.intro')}</p>
      <ul className="grid gap-1 text-sm" data-later="true">
        {answer.later.map((one) => (
          <li key={one.id}>
            {t('timetable.publish.chain.laterItem', {
              number: one.number,
              date: schoolDateText(one.startsOn, language),
            })}
          </li>
        ))}
      </ul>
      <fieldset className="grid gap-2" disabled={!canEdit}>
        <legend className="sr-only">{t('timetable.publish.chain.title')}</legend>
        {(['run_until', 'replace', 'carry'] as const).map((chain) => {
          const off = chain === 'carry' && !answer.carryOffered;
          return (
            <div key={chain} className="grid gap-0.5">
              <label className={CHECKBOX_TARGET}>
                <input
                  type="radio"
                  name="publishChain"
                  className={CHECKBOX}
                  value={chain}
                  checked={chosen === chain}
                  disabled={off}
                  onChange={() => {
                    onChoose(chain);
                  }}
                />
                <span className="text-sm font-semibold">
                  {t(`timetable.publish.chain.answers.${chain}`)}
                </span>
              </label>
              <p className="text-sm text-muted-foreground" data-hint={chain}>
                {off && answer.carryReason !== null
                  ? t(`timetable.publish.chain.notOffered.${answer.carryReason}`)
                  : t(`timetable.publish.chain.hints.${chain}`)}
              </p>
            </div>
          );
        })}
      </fieldset>
      {answer.changes.length > 0 && (
        <div className="grid gap-1">
          <h4 className={SUBSECTION_TITLE}>{t('timetable.publish.chain.changesTitle')}</h4>
          <ul className="grid gap-1 text-sm" data-carry-changes="true">
            {answer.changes.map((change, index) => (
              <li key={index} data-kind={change.kind}>
                {changeText(change)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {chosen === 'carry' && answer.carried.length > 0 && (
        <div className="grid gap-1">
          <h4 className={SUBSECTION_TITLE}>{t('timetable.publish.chain.carriedTitle')}</h4>
          <ul className="grid gap-1 text-sm" data-carried="true">
            {answer.carried.map((one) => (
              <li
                key={one.versionId}
                data-left={one.left ? 'true' : 'false'}
                data-applied={one.applied}
              >
                {one.left
                  ? t('timetable.publish.chain.left', { number: one.number })
                  : one.applied === 0
                    ? t('timetable.publish.chain.nothingToCarry', { number: one.number })
                    : t('timetable.publish.chain.carried', {
                        number: one.number,
                        lessons: carriedImpact(one.versionId)?.counts.changed ?? 0,
                      })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
