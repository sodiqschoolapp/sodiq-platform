import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { Segmented } from '@/components/ui/segmented';
import { tenthsText } from '@/features/results/rating-page';
import { portalRatingQuery } from './portal-api';

/**
 * The Rating page of the portal (task 11.6; `08`, Rating, "Own position": "The student's own
 * place and the class average, without other students' names"). For the quarter chosen, the
 * child's place in the class across all subjects, the child's figure and the class average, as
 * the server answers them from the staff rating lists; nothing is calculated here, and no other
 * student is on the page (the server sends none).
 */
export function PortalRatingPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { studentId } = useParams({ from: '/portal/$studentId/rating' });
  const { quarter } = useSearch({ from: '/portal/$studentId/rating' });
  const navigate = useNavigate({ from: '/portal/$studentId/rating' });
  const rating = useQuery(portalRatingQuery(studentId, quarter));
  if (rating.isError) {
    return (
      <ErrorState
        error={rating.error}
        onRetry={() => {
          void rating.refetch();
        }}
      />
    );
  }
  if (rating.data === undefined) return <LoadingOutline lines={4} />;
  const answer = rating.data;
  const shown = answer.quarters.find((one) => one.id === answer.quarterId);
  const theClass = answer.class;
  const figure = (label: string, value: number | null, name: string) => (
    <div className="grid">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-xl font-bold" data-figure={name}>
        {value === null ? t('results.none') : tenthsText(value, i18n.language)}
      </dd>
    </div>
  );
  return (
    <>
      <h1 className="text-[1.75rem]/[2.125rem] font-bold tracking-[-0.01em]">
        {t('portal.rating.title')}
      </h1>
      {shown === undefined ? (
        <section className={PANEL}>
          <EmptyState text={t('portal.rating.noYear')} />
        </section>
      ) : (
        <>
          <Segmented
            label={t('portal.rating.quarter')}
            options={answer.quarters.map((one) => ({
              value: one.id,
              label: t('results.quarterNumber', { number: one.number }),
            }))}
            value={shown.id}
            onChange={(next) => {
              void navigate({ search: { quarter: next } });
            }}
          />
          <p
            className="text-sm font-semibold"
            data-quarter-state={answer.provisional ? 'provisional' : 'final'}
          >
            {answer.provisional ? t('portal.rating.provisional') : t('portal.rating.final')}
          </p>
          {answer.notOfficial && <p className="text-sm">{t('portal.rating.notOfficial')}</p>}
          {theClass === null ? (
            <section className={PANEL}>
              <EmptyState text={t('portal.rating.noClass')} />
            </section>
          ) : (
            <section className={PANEL} aria-labelledby="portal-rating-place">
              <h2
                id="portal-rating-place"
                className={SECTION_TITLE}
                data-place={theClass.place ?? ''}
              >
                {theClass.place === null
                  ? t('portal.rating.noPlace', { className: theClass.name })
                  : t('portal.rating.place', { place: theClass.place, className: theClass.name })}
              </h2>
              <dl className="mt-3 grid grid-cols-2 gap-3">
                {figure(t('portal.rating.own'), theClass.value, 'own')}
                {figure(t('portal.rating.average'), theClass.average, 'average')}
              </dl>
              <p className="mt-3 text-sm text-muted-foreground">
                {t('portal.rating.subjects', { count: theClass.subjects })}
                {theClass.fewerSubjects && <> · {t('portal.rating.fewerSubjects')}</>}
              </p>
            </section>
          )}
        </>
      )}
    </>
  );
}
