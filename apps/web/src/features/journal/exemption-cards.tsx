import type { ExemptionTodayStudent } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '@/components/states';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { useMayView, useView } from '@/features/access/use-view';
import { schoolDateText } from '@/lib/dates';
import { exemptionsTodayQuery } from './exemptions-api';

/**
 * The teaching home's exemption cards (task 8.5; `edge/exemptions`: "The
 * Tutor's home page shows 'exempt today'"; `07`, Problem cases: "The
 * student's Tutor and teachers see 'back from exemption' on that day"). The
 * students of the reader's own classes and of the reader's lessons today,
 * as the server scopes them; nothing is drawn while both lists are empty.
 */
export function ExemptionCards(): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const reads = useMayView('journal');
  const cards = useQuery(exemptionsTodayQuery(branchId, reads));
  const language = i18n.language;
  if (!reads) return null;
  if (cards.isError) {
    return (
      <section className={PANEL}>
        <ErrorState error={cards.error} onRetry={() => void cards.refetch()} />
      </section>
    );
  }
  if (cards.data === undefined) return null;
  const line = (one: ExemptionTodayStudent) =>
    [
      [one.student.lastName, one.student.firstName].filter(Boolean).join(' '),
      one.student.className,
      t(`journal.exemptions.kinds.${one.kind}`),
      one.slots === null
        ? t('journal.exemptions.datesLine', {
            from: schoolDateText(one.startDate, language, false),
            to: schoolDateText(one.endDate, language, false),
          })
        : `${one.slots.start}–${one.slots.end}`,
      one.category === null ? null : t(`journal.exemptions.categories.${one.category}`),
    ]
      .filter((part) => part !== null)
      .join(' · ');
  const parts = [
    {
      key: 'exemptToday',
      title: t('journal.exemptions.home.exemptToday'),
      items: cards.data.exemptToday,
    },
    {
      key: 'backToday',
      title: t('journal.exemptions.home.backToday'),
      items: cards.data.backToday,
    },
  ].filter((part) => part.items.length > 0);
  if (parts.length === 0) return null;
  return (
    <>
      {parts.map((part) => (
        <section key={part.key} className={`${PANEL} grid gap-3`} data-home-exemptions={part.key}>
          <h2 className={SECTION_TITLE}>{part.title}</h2>
          <ul className="grid gap-1 text-sm">
            {part.items.map((one) => (
              <li key={`${one.student.id}|${one.startDate}`}>{line(one)}</li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
