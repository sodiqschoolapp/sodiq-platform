import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useParams, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/brand/logo';
import { ErrorState, LoadingOutline } from '@/components/states';
import { buttonVariants } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { portalChildrenQuery } from './portal-api';

export type PortalTab =
  'timetable' | 'homework' | 'grades' | 'attendance' | 'rating' | 'announcements';

const TAB_PATHS = {
  timetable: '/portal/$studentId/timetable',
  homework: '/portal/$studentId/homework',
  grades: '/portal/$studentId/grades',
  attendance: '/portal/$studentId/attendance',
  rating: '/portal/$studentId/rating',
  announcements: '/portal/$studentId/announcements',
} as const;

const TABS = ['timetable', 'homework', 'grades', 'attendance', 'rating', 'announcements'] as const;

/** The tab of the address: the page a switch of child keeps. */
function tabOf(pathname: string): PortalTab {
  return TABS.find((one) => pathname.endsWith(`/${one}`)) ?? 'timetable';
}

/**
 * The frame of the parent portal (task 11.2, pull request #294; `10`, What parents see: "switches
 * between children at the top of the page"). Phone first: one column, no side menu. The child
 * switcher lists each child the server answers (an open link, portal access on, active, in any
 * branch); switching keeps the page. "Account" opens the parent's own page (language,
 * password, sign-out, task 11.1).
 */
export function PortalFrame(): React.JSX.Element {
  const { t } = useTranslation();
  const children = useQuery(portalChildrenQuery);
  const params: { studentId?: string } = useParams({ strict: false });
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const tab = tabOf(pathname);
  const studentId = params.studentId;
  const tabLink = (to: PortalTab) =>
    cn(buttonVariants({ variant: tab === to ? 'default' : 'ghost' }), 'flex-1 sm:flex-none');
  return (
    <div className="min-h-dvh bg-background">
      <header className="bg-card">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-4 py-3">
          <Logo variant="mark" className="h-8" />
          <div className="min-w-0 flex-1">
            {children.data !== undefined && children.data.children.length > 0 && (
              <Select
                aria-label={t('portal.child')}
                value={studentId ?? ''}
                onChange={(event) => {
                  void navigate({
                    to: TAB_PATHS[tab],
                    params: { studentId: event.target.value },
                  });
                }}
              >
                {/* A child no longer listed (a link switched off): the field shows no other child. */}
                {!children.data.children.some((child) => child.id === studentId) && (
                  <option value={studentId ?? ''} disabled>
                    {t('portal.chooseChild')}
                  </option>
                )}
                {children.data.children.map((child) => (
                  <option key={child.id} value={child.id}>
                    {child.className === null
                      ? t('portal.childName', { first: child.firstName, last: child.lastName })
                      : t('portal.childWithClass', {
                          first: child.firstName,
                          last: child.lastName,
                          className: child.className,
                        })}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <Link to="/parent" className={buttonVariants({ variant: 'ghost' })}>
            {t('portal.account')}
          </Link>
        </div>
        {studentId !== undefined && (
          <nav
            aria-label={t('portal.pages')}
            className="mx-auto grid max-w-3xl grid-cols-2 gap-2 px-4 pb-3 sm:flex [&>*:last-child:nth-child(odd)]:col-span-2"
          >
            {TABS.map((one) => (
              <Link
                key={one}
                to={TAB_PATHS[one]}
                params={{ studentId }}
                className={tabLink(one)}
                aria-current={tab === one ? 'page' : undefined}
              >
                {t(`portal.${one}.title`)}
              </Link>
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto grid max-w-3xl gap-4 px-4 py-4">
        {children.isError ? (
          <ErrorState
            error={children.error}
            onRetry={() => {
              void children.refetch();
            }}
          />
        ) : children.data === undefined ? (
          <LoadingOutline />
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}
