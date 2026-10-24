import type { Reminder } from '@sodiq/shared';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { momentText, schoolDateText } from '@/lib/dates';

type Language = 'uz' | 'ru' | 'en';

const KINDS = [
  'no_attendance',
  'numbers_missing',
  'no_topic',
  'rating_missing',
  'about_to_lock',
] as const;

const languageOf = (language: string): Language =>
  language === 'ru' || language === 'en' ? language : 'uz';

/**
 * The reminders panel (task 8.7, pull request #225; `07`, Reminders: "A panel on
 * the journal and on the teacher home page lists: lessons with no attendance,
 * planned works whose numbers are missing, lessons with no topic (graded subjects
 * only), rating exam scores missing in the last two weeks of a quarter, and
 * lessons about to lock"). The server works every item out; each opens its
 * journal at the lesson's date.
 */
export function RemindersPanel({
  reminders,
  error,
  onRetry,
  folded = false,
}: {
  /** `undefined` while loading. */
  reminders: readonly Reminder[] | undefined;
  error?: unknown;
  onRetry?: () => void;
  /** On the journal: folded under its title with the count, opened by the person. */
  folded?: boolean;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = languageOf(i18n.language);
  const title = t('journal.reminders.title');
  let body: React.JSX.Element;
  if (error !== undefined && error !== null) {
    body = <ErrorState error={error} onRetry={onRetry} />;
  } else if (reminders === undefined) {
    body = <LoadingOutline />;
  } else if (reminders.length === 0) {
    body = <EmptyState text={t('journal.reminders.empty')} />;
  } else {
    body = (
      <ul className="grid gap-2 text-sm">
        {reminders.map((reminder) => {
          if (reminder.kind === 'rating_missing') {
            return (
              <li
                key={`rating-${reminder.journal.id}-${reminder.quarterId}`}
                data-reminder="rating_missing"
                className="flex flex-wrap items-center gap-2"
              >
                <span className="font-semibold">
                  {t('journal.reminders.rating_missing', {
                    count: reminder.count,
                    date: schoolDateText(reminder.lastDay, language, false),
                  })}
                </span>
                <span className="text-muted-foreground">
                  {reminder.journal.unit.name} · {reminder.journal.subject.names[language]}
                </span>
                <Link
                  to="/journal/$journalId"
                  params={{ journalId: reminder.journal.id }}
                  className="text-link"
                >
                  {t('journal.reminders.open')}
                </Link>
              </li>
            );
          }
          const { lesson } = reminder;
          const what =
            reminder.kind === 'no_topic'
              ? t('journal.reminders.no_topic')
              : reminder.kind === 'about_to_lock'
                ? t('journal.reminders.about_to_lock', {
                    date: momentText(i18n.language, reminder.locksAt ?? ''),
                  })
                : t(`journal.reminders.${reminder.kind}`, { count: reminder.count });
          return (
            <li
              key={`${reminder.kind}-${lesson.id}`}
              data-reminder={reminder.kind}
              data-lesson={lesson.id}
              className="flex flex-wrap items-center gap-2"
            >
              <span className="font-semibold">{what}</span>
              <span className="text-muted-foreground">
                {t('journal.reminders.lesson', {
                  date: schoolDateText(lesson.date, language, false),
                  unit: lesson.unit?.name ?? '',
                  subject: lesson.subject.names[language],
                })}
              </span>
              {lesson.journalId !== null && (
                <Link
                  to="/journal/$journalId"
                  params={{ journalId: lesson.journalId }}
                  search={{ date: lesson.date }}
                  className="text-link"
                >
                  {t('journal.reminders.open')}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    );
  }
  if (folded) {
    return (
      <details className={PANEL} data-reminders="true">
        <summary className="cursor-pointer font-semibold">
          {title} ({reminders?.length ?? 0})
          {reminders !== undefined && reminders.length > 0 && (
            <span
              className="ml-2 text-sm font-normal text-muted-foreground"
              data-reminder-kinds="true"
            >
              {KINDS.flatMap((kind) => {
                const count = reminders.filter((one) => one.kind === kind).length;
                return count === 0
                  ? []
                  : [`${t(`journal.reminders.kinds.${kind}`)}: ${String(count)}`];
              }).join(' · ')}
            </span>
          )}
        </summary>
        <div className="mt-3">{body}</div>
      </details>
    );
  }
  return (
    <section className={`${PANEL} grid gap-3`} data-reminders="true" aria-label={title}>
      <h2 className={SECTION_TITLE}>{title}</h2>
      {body}
    </section>
  );
}
