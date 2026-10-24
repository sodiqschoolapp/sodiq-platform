import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ErrorState, LoadingOutline } from '@/components/states';
import { useMayView, useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { schoolDateText } from '@/lib/dates';
import { studentExemptionsQuery } from './exemptions-api';

/**
 * The Exemptions tab of the student profile (`04`, Profile tabs; task 8.5):
 * every exemption of the student in the branch, for the readers of
 * exemptions; the reason's detail and the document open on the Exemptions page.
 */
export function StudentExemptions({ studentId }: { studentId: string }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const reads = useMayView('exemptions');
  const list = useQuery(studentExemptionsQuery(branchId, studentId, reads));
  const language = i18n.language;
  if (list.isError) {
    return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  }
  if (list.data === undefined) return <LoadingOutline />;
  if (list.data.items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('journal.exemptions.panelEmpty')}</p>;
  }
  return (
    <ul className="grid gap-2 text-sm" data-student-exemptions="true">
      {list.data.items.map((one) => (
        <li key={one.id}>
          <span className="font-semibold">{t(`journal.exemptions.kinds.${one.kind}`)}</span>
          {' · '}
          {one.slots === null
            ? t('journal.exemptions.datesLine', {
                from: schoolDateText(one.startDate, language),
                to: schoolDateText(one.endDate, language),
              })
            : t('journal.exemptions.slotsLine', {
                date: schoolDateText(one.startDate, language),
                start: one.slots.start,
                end: one.slots.end,
              })}
          {' · '}
          {one.subjects === null
            ? t('journal.exemptions.allSubjects')
            : one.subjects.map((subject) => nameOf(subject.name, language)).join(', ')}
          {' · '}
          {t(`journal.exemptions.categories.${one.category}`)}
          {' · '}
          {t(`journal.exemptions.states.${one.state}`)}
        </li>
      ))}
    </ul>
  );
}
