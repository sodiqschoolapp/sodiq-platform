import { HOME_KIND } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/states';
import { relativeNoValidPhoneQuery, studentNoClassQuery } from '@/features/people/people-api';
import { attentionQuery } from '@/features/timetable/timetable-api';
import { AttentionTiles } from './attention-tiles';
import { NoClassTile } from './no-class-tile';
import { NoValidPhoneTile } from './no-valid-phone-tile';
import { useView } from './use-view';

/**
 * The first screen of the active role (`08`, Home pages by role). Each later
 * task fills the page of its kind; until then a kind with nothing on it is
 * the empty page of the design system with one short line of its own and no
 * action, since there is nothing to act on yet (pull request #80, decision 3).
 */
export function HomePage() {
  const { t } = useTranslation();
  const { role } = useView();
  const kind = role === null ? null : HOME_KIND[role];
  return (
    <section>
      <PageHeader title={t('home.title')} />
      {kind === 'academic_vice_principal' ? (
        <ViceHome />
      ) : (
        <EmptyState
          title={t('home.emptyTitle')}
          text={kind === null ? t('home.noRole') : t(`home.${kind}`)}
        />
      )}
    </section>
  );
}

/**
 * The Academic Vice Principal's home: the "No class" counter (task 2.4b-2)
 * and the parents with no valid phone (task 2.5b-1), each hidden at 0, 24
 * apart; the lessons that need a teacher and the unresolved ones (task
 * 5.7a-1), each hidden when empty. When all have answered 0 the page is never blank: it is the empty
 * page with the kind's own line (pull request #80, correction 1). Each tile
 * keeps its own loading and error state; the queries are the tiles' own, so
 * nothing is asked twice.
 */
function ViceHome() {
  const { t } = useTranslation();
  const { branchId } = useView();
  const noClass = useQuery(studentNoClassQuery(branchId));
  const noValidPhone = useQuery(relativeNoValidPhoneQuery(branchId));
  const attention = useQuery(attentionQuery(branchId));
  // A failed refetch keeps the old answer: the tile then shows its failure,
  // and the page is not called empty under it.
  const nothing =
    noClass.data?.count === 0 &&
    noValidPhone.data?.count === 0 &&
    attention.data?.needsTeacher.length === 0 &&
    attention.data.unresolved.length === 0 &&
    attention.data.needsInvigilator.length === 0 &&
    !noClass.isError &&
    !noValidPhone.isError &&
    !attention.isError;
  return (
    <div className="grid gap-6">
      <NoClassTile />
      <NoValidPhoneTile />
      <AttentionTiles />
      {nothing && (
        <EmptyState title={t('home.emptyTitle')} text={t('home.academic_vice_principal')} />
      )}
    </div>
  );
}
