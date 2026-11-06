import { PERMISSIONS, permits } from '@sodiq/shared';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useScrollRow } from '@/components/scroll-row';
import { useView } from '@/features/access/use-view';

type Section =
  'staff' | 'students' | 'parents' | 'vacancies' | 'head-teachers' | 'never-used' | 'reset-entries';

const SECTIONS: readonly {
  key: Section;
  to:
    | '/people/staff'
    | '/people/students'
    | '/people/parents'
    | '/people/vacancies'
    | '/people/head-teachers'
    | '/people/never-used'
    | '/people/reset-entries';
  area: string;
  title:
    | 'people.staff.title'
    | 'people.students.title'
    | 'people.relatives.title'
    | 'people.vacancies.title'
    | 'people.headTeachers.title'
    | 'people.neverUsed.title'
    | 'people.resetEntries.title';
}[] = [
  { key: 'staff', to: '/people/staff', area: 'staff', title: 'people.staff.title' },
  // Task 2.4a: the students of the branch.
  {
    key: 'students',
    to: '/people/students',
    area: 'students',
    title: 'people.students.title',
  },
  // Task 2.5a: the Parents.
  {
    key: 'parents',
    to: '/people/parents',
    area: 'relatives',
    title: 'people.relatives.title',
  },
  { key: 'vacancies', to: '/people/vacancies', area: 'vacancies', title: 'people.vacancies.title' },
  {
    key: 'head-teachers',
    to: '/people/head-teachers',
    area: 'head_teachers',
    title: 'people.headTeachers.title',
  },
  // Task 2.3c-1: the accounts never used, for the readers of `account_access`.
  {
    key: 'never-used',
    to: '/people/never-used',
    area: 'account_access',
    title: 'people.neverUsed.title',
  },
  // Task 6.1c: the entries after a reset, for the same readers.
  {
    key: 'reset-entries',
    to: '/people/reset-entries',
    area: 'account_access',
    title: 'people.resetEntries.title',
  },
];

/**
 * The sections of People, each a list with its own address, so that each
 * keeps its own search, filters and open record: the staff and the vacancies
 * (`04`, Vacancy: "The teacher list shows vacancies in a section of their
 * own"; task 2.2b) and the Head Teachers (task 2.3b-2). A tab shows for each
 * section the role views; the row shows when there are two or more
 * (decision 6 of #64).
 */
export function PeopleTabs({ current }: { current: Section }) {
  const { t } = useTranslation();
  const { role } = useView();
  const shown = SECTIONS.filter(
    (section) => role !== null && permits(PERMISSIONS, role, section.area, 'view'),
  );
  const row = useRef<HTMLElement>(null);
  useEffect(() => {
    const tab = row.current?.querySelector<HTMLElement>('[aria-current="page"]');
    // Not every browser of the tests draws a layout to scroll in.
    if (tab !== null && tab !== undefined && typeof tab.scrollIntoView === 'function') {
      tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [current]);
  useScrollRow(row);
  if (shown.length < 2) {
    return null;
  }
  return (
    // One row that scrolls sideways inside its own box when the tabs do not
    // fit (a phone), with the tab in use scrolled into view (issue #39, hand
    // test of 13 October 2026, finding 8), never with a scrollbar; a cut
    // edge fades (issue #105, H15).
    <nav
      ref={row}
      aria-label={t('people.sections')}
      className="scroll-row mb-4 flex gap-6 border-b whitespace-nowrap"
    >
      {shown.map((section) => (
        <Link
          key={section.key}
          to={section.to}
          data-section={section.key}
          aria-current={current === section.key ? 'page' : undefined}
          className={
            current === section.key
              ? 'shrink-0 border-b-2 border-foreground px-1 pb-2 font-semibold max-sm:pt-3'
              : 'shrink-0 border-b-2 border-transparent px-1 pb-2 text-muted-foreground hover:text-foreground max-sm:pt-3'
          }
        >
          {t(section.title)}
        </Link>
      ))}
    </nav>
  );
}
