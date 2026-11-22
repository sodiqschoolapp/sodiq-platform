import type { AssistantProposal, AssistantStep } from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { SECTION_TITLE } from '@/components/ui/control';
import { formatMoment, schoolDateText } from '@/lib/dates';

/** Clock minutes of a day as "09:50". */
function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

const STATE_TONE: Record<AssistantStep['state'], string> = {
  waiting: 'text-muted-foreground',
  done: 'text-success',
  refused: 'text-destructive',
  outdated: 'text-destructive',
  not_run: 'text-muted-foreground',
  unknown: 'text-muted-foreground',
};

/**
 * A proposal of the assistant (task 11.13; `02`, Reading and proposing): every step in the
 * platform's own words (the action's name, the record, what is sent, the lessons its preview
 * names) with the assistant's sentence beside them, never instead (plan decision 5), and Confirm
 * and Decline while it waits. Without `onDecide` (the Super Admin's page of every
 * conversation) it is read only.
 */
export function ProposalCard({
  proposal,
  onDecide,
  deciding,
}: {
  proposal: AssistantProposal;
  onDecide?: (which: 'confirm' | 'decline') => void;
  deciding?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const waiting = proposal.state === 'waiting';
  const language = (['uz', 'ru', 'en'] as const).find((one) => one === i18n.language) ?? 'en';
  return (
    <section
      aria-label={t('assistant.proposal.title')}
      className="grid gap-3 rounded-lg border px-3 py-3"
    >
      <header className="grid gap-1">
        <h3 className={SECTION_TITLE}>{t('assistant.proposal.title')}</h3>
        <p role="status" className="text-sm text-muted-foreground">
          {t(`assistant.proposal.states.${proposal.state}`)}
          {waiting && (
            <span className="ml-2">
              {t('assistant.proposal.validUntil', {
                time: formatMoment(i18n.language, proposal.expiresAt),
              })}
            </span>
          )}
        </p>
      </header>
      <ol className="grid gap-3">
        {proposal.steps.map((step) => (
          <li key={step.id} className="grid gap-1">
            <p className="font-semibold">
              {String(step.seq)}.{' '}
              {t(`assistant.actions.${step.action}`, { defaultValue: step.action })}
            </p>
            {step.recordName !== null && (
              <p className="text-sm">
                {t('assistant.proposal.record', {
                  name: step.recordNames === null ? step.recordName : step.recordNames[language],
                })}
              </p>
            )}
            {[...new Set(step.previewLessons.map((lesson) => lesson.list))].map((list) => (
              <div key={list} className="grid gap-1">
                <p className="text-sm font-semibold">
                  {t(`assistant.proposal.lists.${list}`, {
                    defaultValue: t('assistant.proposal.lists.other'),
                  })}
                </p>
                <ul className="grid gap-0.5 text-sm">
                  {step.previewLessons
                    .filter((lesson) => lesson.list === list)
                    .map((lesson, index) => (
                      <li key={`${lesson.date}-${String(lesson.start)}-${String(index)}`}>
                        {t('assistant.proposal.lessonLine', {
                          date: schoolDateText(lesson.date, i18n.language),
                          time: clock(lesson.start),
                          unit: lesson.unitName,
                          subject:
                            lesson.subjectNames === null ? '' : lesson.subjectNames[language],
                        })}
                        {lesson.hasData && (
                          <span className="ml-2 font-semibold">
                            {t('assistant.proposal.hasData')}
                          </span>
                        )}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
            {step.previewMore > 0 && (
              <p className="text-sm">
                {t('assistant.proposal.moreLessons', { count: step.previewMore })}
              </p>
            )}
            {step.previewIssues.length > 0 && (
              <ul className="grid gap-0.5 text-sm">
                {step.previewIssues.map((issue) => (
                  <li key={`${issue.kind}:${issue.code}`} className="font-semibold">
                    {t(`assistant.proposal.issue_${issue.kind}`, {
                      text: t(`errors.${issue.code}`, { defaultValue: issue.code }),
                    })}
                  </li>
                ))}
              </ul>
            )}
            {step.previewCounts.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {step.previewCounts
                  .map((one) =>
                    t('assistant.proposal.count', {
                      list: t(`assistant.proposal.lists.${one.list}`, {
                        defaultValue: t('assistant.proposal.lists.other'),
                      }),
                      number: one.count,
                    }),
                  )
                  .join('; ')}
              </p>
            )}
            {step.fields.length > 0 && (
              <details className="text-sm">
                <summary>{t('assistant.proposal.fields')}</summary>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 break-words">
                  {step.fields.map((field) => (
                    <div key={field.name} className="contents">
                      <dt className="text-muted-foreground">
                        {t(`assistant.fields.${field.name}`, {
                          defaultValue: t('assistant.fields.other'),
                        })}
                      </dt>
                      <dd className="min-w-0">{field.value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
            <p className="text-sm text-muted-foreground break-words whitespace-pre-wrap">
              {t('assistant.proposal.assistantSays', { text: step.summary })}
            </p>
            {proposal.state === 'confirmed' && (
              <p className={`text-sm font-semibold ${STATE_TONE[step.state]}`}>
                {t(`assistant.proposal.stepStates.${step.state}`)}
                {step.code !== null && (
                  <span className="ml-2 font-normal">
                    {t('assistant.proposal.refusal', {
                      text: t(`errors.${step.code}`, { defaultValue: step.code }),
                    })}
                  </span>
                )}
              </p>
            )}
          </li>
        ))}
      </ol>
      {waiting && onDecide !== undefined && (
        <>
          <p className="text-sm text-muted-foreground">{t('assistant.proposal.note')}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={deciding}
              onClick={() => {
                onDecide('confirm');
              }}
            >
              {deciding === true
                ? t('assistant.proposal.confirming')
                : t('assistant.proposal.confirm')}
            </Button>
            <Button
              variant="secondary"
              disabled={deciding}
              onClick={() => {
                onDecide('decline');
              }}
            >
              {t('assistant.proposal.decline')}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
