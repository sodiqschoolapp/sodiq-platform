import type { AttentionGroup } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from 'cn';
import { ErrorState, LoadingOutline } from '@/components/states';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { attentionQuery } from '@/features/timetable/timetable-api';
import { schoolDateText } from '@/lib/dates';
import { useView } from './use-view';

/**
 * The "needs a teacher" and "unresolved" lessons of the branch on the
 * Academic Vice Principal's home page (task 5.7a-1, decisions 9 and 10;
 * `06`, How surprises are prevented: "marks them 'needs a teacher' ... on the
 * Academic Vice Principal's home page"; `edge/timetable`: "The lesson stays
 * 'unresolved' on the Academic Vice Principal's home page"). One row per
 * cause, each opening the day page of its first lesson; each tile hidden
 * when it has no row.
 */
export function AttentionTiles() {
  const { t } = useTranslation();
  const { branchId } = useView();
  const attention = useQuery(attentionQuery(branchId));
  if (attention.isError) {
    return (
      <div className={PANEL}>
        <ErrorState
          error={attention.error}
          onRetry={() => {
            void attention.refetch();
          }}
        />
      </div>
    );
  }
  if (attention.data === undefined) {
    return (
      <div className={PANEL}>
        <LoadingOutline lines={2} />
      </div>
    );
  }
  return (
    <>
      <Tile
        kind="needsTeacher"
        title={t('home.needsTeacher.title')}
        groups={attention.data.needsTeacher}
      />
      <Tile
        kind="unresolved"
        title={t('home.unresolved.title')}
        groups={attention.data.unresolved}
      />
    </>
  );
}

function Tile({
  kind,
  title,
  groups,
}: {
  kind: string;
  title: string;
  groups: readonly AttentionGroup[];
}) {
  const { t, i18n } = useTranslation();
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  if (groups.length === 0) return null;
  const nameOf = (group: AttentionGroup) =>
    group.cause === 'nobody'
      ? t('home.attention.nobody')
      : group.cause === 'vacancy'
        ? t('home.attention.vacancy', { name: group.teacher?.name ?? '' })
        : // A person the branch no longer sees is named by nothing (code review finding 1).
          (group.teacher?.name ?? '') === ''
          ? t('home.attention.absenceUnnamed')
          : t('home.attention.absence', { name: group.teacher?.name ?? '' });
  const date = (value: string) => schoolDateText(value, i18n.language, false);
  return (
    <section aria-label={title} className={cn(PANEL, 'grid max-w-2xl gap-3')} data-tile={kind}>
      <h2 className={SECTION_TITLE}>{title}</h2>
      <ul className="grid gap-3">
        {groups.map((group) => (
          <li
            key={`${group.cause}-${group.absence?.id ?? group.teacher?.id ?? ''}`}
            className="grid gap-0.5"
            data-group={group.cause}
          >
            <span className="font-semibold">{nameOf(group)}</span>
            <span className="text-sm">
              {t('home.attention.lessons', {
                count: group.lessons,
                n: number.format(group.lessons),
              })}
              {' · '}
              {group.firstDate === group.lastDate
                ? date(group.firstDate)
                : t('home.attention.range', {
                    from: date(group.firstDate),
                    to: date(group.lastDate),
                  })}
            </span>
            {group.suggestPermanent && (
              <span className="text-sm" data-permanent>
                {t('home.attention.permanent')}
              </span>
            )}
            <Link
              to="/timetable/day"
              search={{ date: group.firstDate }}
              className="text-link justify-self-start text-sm"
            >
              {t('home.attention.open')}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
