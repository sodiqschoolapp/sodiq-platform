import type { PortalChild } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/brand/logo';
import {
  AccountCircleIcon,
  AssignmentIcon,
  CalendarMonthIcon,
  CampaignIcon,
  ExpandMoreIcon,
  FactCheckIcon,
  GradingIcon,
  HomeIcon,
  LeaderboardIcon,
  MoreHorizIcon,
  type IconProps,
} from '@/components/icons';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { FOCUS_RING, QUICK } from '@/components/ui/control';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { portalChildrenQuery } from './portal-api';

/** The pages of a child, in the order of the menu (`10`, What parents see). */
export const PORTAL_PAGES = [
  'today',
  'timetable',
  'homework',
  'grades',
  'attendance',
  'rating',
  'announcements',
] as const;

export type PortalPage = (typeof PORTAL_PAGES)[number];

export const PAGE_PATHS = {
  today: '/portal/$studentId/today',
  timetable: '/portal/$studentId/timetable',
  homework: '/portal/$studentId/homework',
  grades: '/portal/$studentId/grades',
  attendance: '/portal/$studentId/attendance',
  rating: '/portal/$studentId/rating',
  announcements: '/portal/$studentId/announcements',
} as const;

const PAGE_ICONS: Record<PortalPage, (props: IconProps) => React.JSX.Element> = {
  today: HomeIcon,
  timetable: CalendarMonthIcon,
  homework: AssignmentIcon,
  grades: GradingIcon,
  attendance: FactCheckIcon,
  rating: LeaderboardIcon,
  announcements: CampaignIcon,
};

/** The tab bar at phone width: the first four pages, the rest under "More". */
const TABS = PORTAL_PAGES.slice(0, 4);
const MORE = PORTAL_PAGES.slice(4);

/** The page of an address; `null` off a child's page (the parent's own account). */
export function pageOf(pathname: string): PortalPage | null {
  return PORTAL_PAGES.find((one) => pathname.endsWith(`/${one}`)) ?? null;
}

/** The child last opened in this tab: the account page's menu keeps to that child. */
const CHILD_KEY = 'sodiq.portalChild';

export function rememberChild(studentId: string): void {
  try {
    sessionStorage.setItem(CHILD_KEY, studentId);
  } catch {
    // A tab without storage starts from the first child.
  }
}

function rememberedChild(): string | null {
  try {
    return sessionStorage.getItem(CHILD_KEY);
  } catch {
    return null;
  }
}

/** The child whose pages the menu opens: the one of the address, else the last one, else the first. */
export function childOfMenu(
  children: readonly PortalChild[],
  studentId: string | undefined,
): string | undefined {
  const ids = children.map((one) => one.id);
  if (studentId !== undefined) return studentId;
  const last = rememberedChild();
  return last !== null && ids.includes(last) ? last : ids[0];
}

/** Two letters of a child's name for the round avatar (docs/design-system.md: round for avatars). */
function initialsOf(child: PortalChild): string {
  return `${child.firstName.charAt(0)}${child.lastName.charAt(0)}`.toLocaleUpperCase();
}

function Avatar({ child }: { child: PortalChild }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className="grid size-10 shrink-0 place-items-center rounded-full bg-sidebar-avatar text-sm font-semibold text-sidebar-accent-foreground"
    >
      {initialsOf(child)}
    </span>
  );
}

function ChildName({ child }: { child: PortalChild }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <span className="grid min-w-0 text-left">
      <span className="truncate font-semibold">
        {t('portal.childName', { first: child.firstName, last: child.lastName })}
      </span>
      {child.className !== null && (
        <span className="truncate text-sm text-muted-foreground">{child.className}</span>
      )}
    </span>
  );
}

/**
 * The child at the top of every page (`10`: "switches between children at the top of the page"):
 * the round avatar, the name and the class. With two or more children it is a menu that keeps
 * the page open when the child changes; with one child it is only the name.
 */
function ChildSwitcher({
  children,
  studentId,
}: {
  children: readonly PortalChild[];
  studentId: string | undefined;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const shown = children.find((one) => one.id === studentId);
  if (children.length < 2) {
    return shown === undefined ? null : (
      <span className="flex min-w-0 items-center gap-3" data-child="">
        <Avatar child={shown} />
        <ChildName child={shown} />
      </span>
    );
  }
  const page = pageOf(pathname) ?? 'today';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={
              shown === undefined
                ? t('portal.chooseChild')
                : t('portal.switchChild', { first: shown.firstName, last: shown.lastName })
            }
            className={cn(
              'flex min-h-11 min-w-0 items-center gap-3 rounded-lg p-1 pr-2 hover:bg-accent',
              QUICK,
              FOCUS_RING,
            )}
          />
        }
      >
        {shown === undefined ? (
          <span className="font-semibold">{t('portal.chooseChild')}</span>
        ) : (
          <>
            <Avatar child={shown} />
            <ChildName child={shown} />
          </>
        )}
        <ExpandMoreIcon className="shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('portal.children')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={studentId ?? ''}
            onValueChange={(value: unknown) => {
              if (typeof value === 'string' && children.some((one) => one.id === value)) {
                rememberChild(value);
                void navigate({ to: PAGE_PATHS[page], params: { studentId: value } });
              }
            }}
          >
            {children.map((child) => (
              <DropdownMenuRadioItem key={child.id} value={child.id} closeOnClick>
                <span className="flex min-w-0 items-center gap-3 py-1">
                  <Avatar child={child} />
                  <ChildName child={child} />
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Focus inside the navy menu: the orange ring over the navy (as the staff menu). */
const MENU_FOCUS =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring';

const ACTIVE =
  'aria-[current=page]:bg-sidebar-primary aria-[current=page]:font-semibold aria-[current=page]:text-sidebar-primary-foreground';

/**
 * From 640 px: the navy menu at the left, as the staff app's (docs/design-system.md, Layout
 * shell), with the child's pages and the parent's account at its foot.
 */
function SideMenu({
  studentId,
  page,
}: {
  studentId: string | undefined;
  page: PortalPage | null;
}): React.JSX.Element {
  const { t } = useTranslation();
  const item = `flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${QUICK} ${MENU_FOCUS} ${ACTIVE}`;
  return (
    <div data-print="hide" className="hidden w-60 shrink-0 sm:block">
      <div className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col gap-4 bg-sidebar px-3 py-4 text-sidebar-foreground">
        <span className="flex h-10 items-center px-3">
          <Logo variant="horizontal-on-dark" className="h-8" />
        </span>
        {studentId !== undefined && (
          <nav aria-label={t('portal.pages')} className="min-h-0 flex-1 overflow-y-auto">
            <ul className="grid gap-1">
              {PORTAL_PAGES.map((one) => {
                const Icon = PAGE_ICONS[one];
                return (
                  <li key={one}>
                    <Link
                      to={PAGE_PATHS[one]}
                      params={{ studentId }}
                      className={item}
                      aria-current={page === one ? 'page' : undefined}
                    >
                      <Icon />
                      {t(`portal.${one}.title`)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
        <div className="mt-auto border-t border-sidebar-border pt-3">
          <Link to="/parent" className={item} aria-current={page === null ? 'page' : undefined}>
            <AccountCircleIcon />
            {t('portal.account')}
          </Link>
        </div>
      </div>
    </div>
  );
}

/** A tab of the phone tab bar: the icon over its word, 56 high (as the staff tab bar). */
const TAB = `flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-xs font-medium text-sidebar-foreground ${QUICK} ${MENU_FOCUS}`;

/**
 * Below 640 px: the navy tab bar at the bottom (docs/design-system.md, Layout shell, Phone width:
 * "the app's main items with icon and word, the active one orange"), the first four pages and
 * "More" with the rest and the account.
 */
function TabBar({
  studentId,
  page,
}: {
  studentId: string | undefined;
  page: PortalPage | null;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const inMore = page === null || (MORE as readonly string[]).includes(page);
  const close = () => {
    setOpen(false);
  };
  const row = `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium hover:bg-accent aria-[current=page]:bg-primary aria-[current=page]:font-semibold aria-[current=page]:text-primary-foreground ${QUICK} ${FOCUS_RING}`;
  return (
    <nav
      aria-label={t('portal.pages')}
      data-print="hide"
      className="fixed inset-x-0 bottom-0 z-40 flex gap-1 bg-sidebar px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] sm:hidden"
    >
      {studentId !== undefined &&
        TABS.map((one) => {
          const Icon = PAGE_ICONS[one];
          return (
            <Link
              key={one}
              to={PAGE_PATHS[one]}
              params={{ studentId }}
              className={cn(TAB, 'hover:bg-sidebar-accent', ACTIVE)}
              aria-current={page === one ? 'page' : undefined}
            >
              <Icon className="size-6" />
              <span className="max-w-full truncate">{t(`portal.${one}.tab`)}</span>
            </Link>
          );
        })}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={
            <button
              type="button"
              {...(inMore ? { 'aria-current': 'page' as const } : {})}
              className={cn(TAB, 'hover:bg-sidebar-accent', ACTIVE)}
            />
          }
        >
          <MoreHorizIcon className="size-6" />
          <span>{t('portal.more')}</span>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>{t('portal.more')}</DialogTitle>
          <DialogDescription className="sr-only">{t('portal.pages')}</DialogDescription>
          <ul className="grid gap-1">
            {studentId !== undefined &&
              MORE.map((one) => {
                const Icon = PAGE_ICONS[one];
                return (
                  <li key={one}>
                    <Link
                      to={PAGE_PATHS[one]}
                      params={{ studentId }}
                      onClick={close}
                      className={row}
                      aria-current={page === one ? 'page' : undefined}
                    >
                      <Icon className="size-6" />
                      {t(`portal.${one}.title`)}
                    </Link>
                  </li>
                );
              })}
            <li className="mt-2 border-t pt-3">
              <Link
                to="/parent"
                onClick={close}
                className={row}
                aria-current={page === null ? 'page' : undefined}
              >
                <AccountCircleIcon className="size-6" />
                {t('portal.account')}
              </Link>
            </li>
          </ul>
          <div className="flex justify-end">
            <DialogClose render={<Button variant="ghost" />}>{t('portal.close')}</DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </nav>
  );
}

/**
 * The frame of every parent page (task 11.2, redesigned on 19 November 2026): phone first. A
 * white top bar with the child; the navy tab bar at the bottom below 640 px and the navy menu at
 * the left from 640 px; the page in one column. `studentId` is the child of the address, or
 * `undefined` on the parent's own account page, whose menu keeps to the last child opened.
 */
export function PortalShell({
  studentId,
  ownPage = false,
  children,
}: {
  studentId: string | undefined;
  /**
   * The parent's own account page: drawn whatever the list of children answers, so that the
   * language, the password and sign-out are always in reach.
   */
  ownPage?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const listed = useQuery(portalChildrenQuery);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const page = pageOf(pathname);
  const menuChild =
    listed.data === undefined ? studentId : childOfMenu(listed.data.children, studentId);
  return (
    <div className="flex min-h-dvh bg-background">
      <SideMenu studentId={menuChild} page={page} />
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b bg-card">
          <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
            <Logo variant="mark" className="h-8 shrink-0 sm:hidden" />
            <div className="min-w-0 flex-1">
              {listed.data !== undefined && (
                <ChildSwitcher children={listed.data.children} studentId={menuChild} />
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto grid max-w-3xl gap-4 px-4 pt-4 pb-28 sm:pb-8">
          {ownPage ? (
            children
          ) : listed.isError ? (
            <ErrorState
              error={listed.error}
              onRetry={() => {
                void listed.refetch();
              }}
            />
          ) : listed.data === undefined ? (
            <LoadingOutline />
          ) : (
            children
          )}
        </main>
      </div>
      <TabBar studentId={menuChild} page={page} />
    </div>
  );
}

/** The page title of the portal: Page title 28 / 34, 700 (docs/design-system.md, Type). */
export function PortalTitle({
  children,
  fact,
}: {
  children: React.ReactNode;
  /** A short fact on the title's line in muted text ("Thursday, 19 November"). */
  fact?: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h1 className="text-[1.75rem]/[2.125rem] font-bold tracking-[-0.01em]">{children}</h1>
      {fact !== undefined && <span className="text-muted-foreground">{fact}</span>}
    </div>
  );
}
