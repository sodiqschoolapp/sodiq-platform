import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { cn } from 'cn';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/brand/logo';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  LogoutIcon,
  MoreHorizIcon,
  type IconProps,
} from '@/components/icons';
import { LanguageChooser } from '@/components/language-chooser';
import { ThemeSwitch } from '@/components/theme-switch';
import { Button } from '@/components/ui/button';
import { QUICK } from '@/components/ui/control';
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
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { sessionQuery } from '@/features/auth/session';
import { FeedbackButton } from '@/features/feedback/feedback-button';
import { languageOf } from '@/i18n/i18n';
import { isLanguage, LANGUAGE_NAMES, LANGUAGES, type Language } from '@/i18n/languages';
import { isTheme, THEMES, useTheme } from '@/theme/theme';
import type { MenuPage } from './menu-pages';
import { useMenuShape } from './menu-state';
import { useMenuPages } from './use-menu';
import { useView } from './use-view';

/** What the menu does for the person, given by the layout, which shows a failure. */
export interface PersonActions {
  /** Signs out, after asking about typed changes. */
  signOut: () => void;
  /** Changes the language and saves it to the account (task 0.8d). */
  chooseLanguage: (language: Language) => void;
}

/** Focus inside the navy menu: the orange ring, 2 px out over the navy (7.75 : 1). */
const MENU_FOCUS =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring';

/** A control in the menu: corner 8, the menu's text, the darker navy when hovered. */
const MENU_CONTROL = `rounded-lg text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${QUICK} ${MENU_FOCUS}`;

/**
 * The tab bar shows the role's first four items and "More" with the rest
 * (docs/design-system.md, This app, Phone tab bar). "More" is always there:
 * the person's own entries and sign-out are reached through it.
 */
export function tabBarSplit<T>(pages: readonly T[]): { tabs: T[]; more: T[] } {
  return { tabs: pages.slice(0, 4), more: pages.slice(4) };
}

/** Up to two letters for the avatar, from the parts of a name or a login ("Dilnoza Karimova", "d.karimova" → "DK"). */
export function initialsOf(login: string): string {
  const parts = login.split(/[^\p{L}\p{N}]+/u).filter((part) => part !== '');
  const letters =
    parts.length >= 2 ? [parts[0]?.[0], parts[1]?.[0]] : [...(parts[0] ?? '')].slice(0, 2);
  return letters.join('').toUpperCase();
}

/** The word of an item and, at its right, a count as a plain number (no dot, no pill). */
export function MenuItemText({ title, count }: { title: string; count?: number | undefined }) {
  return (
    <>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {count !== undefined && count > 0 && (
        <span className="shrink-0 tabular-nums" data-count="">
          {count}
        </span>
      )}
    </>
  );
}

/**
 * One item of the menu: 40 high, icon and word, the current page a solid
 * orange fill with navy text in weight 600 and `aria-current` (not by colour
 * alone). In the rail the icon alone, named for a screen reader and a pointer.
 */
function MenuLink({
  page,
  rail,
  count,
  onNavigate,
}: {
  page: MenuPage;
  rail: boolean;
  count?: number;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const Icon = page.icon;
  const title = t(page.titleKey);
  return (
    <Link
      to={page.to}
      {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
      {...(rail ? { 'aria-label': title, title } : {})}
      className={cn(
        MENU_CONTROL,
        'flex h-10 items-center gap-3 text-sm font-medium data-[status=active]:bg-sidebar-primary data-[status=active]:font-semibold data-[status=active]:text-sidebar-primary-foreground',
        rail ? 'w-10 justify-center' : 'px-3',
      )}
      activeOptions={{ exact: page.to === '/' }}
      activeProps={{ 'aria-current': 'page' }}
    >
      <Icon />
      {!rail && <MenuItemText title={title} count={count} />}
    </Link>
  );
}

/**
 * How the person is named in the menu and in "More": the first and last name
 * of the staff record, the login for an account with none (task 2.3a).
 */
function useShownName(): string {
  const { data: session } = useQuery(sessionQuery);
  const name = session?.name ?? null;
  return name === null ? (session?.login ?? '') : `${name.firstName} ${name.lastName}`;
}

/** The round avatar with initials, the one round shape of the menu. */
function Avatar({ shown }: { shown: string }) {
  return (
    <span
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-avatar text-xs font-semibold text-sidebar-accent-foreground"
    >
      {initialsOf(shown)}
    </span>
  );
}

/**
 * The person at the foot of the menu (docs/design-system.md, Layout shell,
 * Menu): the avatar, the person's name and the role on display (pull request
 * #61, decision 6); the login for an account with no staff record (task 2.3a). It opens the person's own entries: the own account, the
 * password, the theme and the language (decision 3).
 */
function PersonMenu({ rail, actions }: { rail: boolean; actions: PersonActions }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { role } = useView();
  const { theme, setTheme } = useTheme();
  const shown = useShownName();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={t('layout.account')}
            className={cn(
              MENU_CONTROL,
              'flex min-w-0 items-center gap-3 p-1 text-left',
              rail ? 'justify-center' : 'flex-1',
            )}
          />
        }
      >
        <Avatar shown={shown} />
        {!rail && (
          <span className="grid min-w-0">
            <span className="truncate text-sm font-semibold text-sidebar-accent-foreground">
              {shown}
            </span>
            {role !== null && <span className="truncate text-xs">{t(`roles.${role}`)}</span>}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => {
              void navigate({ to: '/account' });
            }}
          >
            {t('account.title')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              void navigate({ to: '/account/password' });
            }}
          >
            {t('layout.changePassword')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('theme.label')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(value: unknown) => {
              if (isTheme(value)) {
                setTheme(value);
              }
            }}
          >
            {THEMES.map((option) => (
              <DropdownMenuRadioItem key={option} value={option} closeOnClick>
                {t(`theme.${option}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('language.label')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={languageOf(i18n)}
            onValueChange={(value: unknown) => {
              if (isLanguage(value)) {
                actions.chooseLanguage(value);
              }
            }}
          >
            {LANGUAGES.map((language) => (
              <DropdownMenuRadioItem key={language} value={language} lang={language} closeOnClick>
                {LANGUAGE_NAMES[language]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The sign-out icon button of the menu's foot, the size of the collapse button. */
function SignOutButton({ actions }: { actions: PersonActions }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-label={t('layout.signOut')}
      title={t('layout.signOut')}
      className={cn(MENU_CONTROL, 'grid size-10 shrink-0 place-items-center')}
      onClick={actions.signOut}
    >
      <LogoutIcon />
    </button>
  );
}

/**
 * The menu from 640 px up (docs/design-system.md, Layout shell, Menu; `12`,
 * Navigation): navy in both themes, 240 wide with the one-line logo, or the
 * 72-wide rail of icons with the shield, by the person's choice.
 */
export function SideMenu({ actions }: { actions: PersonActions }) {
  const { t } = useTranslation();
  const pages = useMenuPages();
  const { shape, setShape } = useMenuShape();
  const rail = shape === 'rail';
  const Toggle = rail ? ChevronRightIcon : ChevronLeftIcon;

  const width = rail ? 'w-[72px]' : 'w-60';
  // Fixed to the window, with a column of its width in the page: focus that
  // comes back to the person (a choice in its menu) never scrolls the page.
  return (
    <div data-print="hide" className={cn('hidden shrink-0 sm:block', width)}>
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex flex-col gap-4 bg-sidebar py-4 text-sidebar-foreground',
          width,
          rail ? 'items-center px-2' : 'px-3',
        )}
      >
        <Link
          to="/"
          className={cn('flex h-10 items-center rounded-lg', MENU_FOCUS, !rail && 'px-3')}
        >
          <Logo variant={rail ? 'mark-on-dark' : 'horizontal-on-dark'} className="h-8" />
        </Link>
        <nav aria-label={t('layout.menu')} className="min-h-0 flex-1 overflow-y-auto">
          <ul className="grid gap-1">
            {pages.map((page) => (
              <li key={page.titleKey}>
                <MenuLink page={page} rail={rail} />
              </li>
            ))}
          </ul>
        </nav>
        <button
          type="button"
          aria-label={t(rail ? 'menu.expand' : 'menu.collapse')}
          title={t(rail ? 'menu.expand' : 'menu.collapse')}
          aria-expanded={!rail}
          className={cn(MENU_CONTROL, 'grid size-10 shrink-0 place-items-center')}
          onClick={() => {
            setShape(rail ? 'open' : 'rail');
          }}
        >
          <Toggle />
        </button>
        <div
          className={cn(
            'flex gap-1 border-t border-sidebar-border pt-3',
            rail ? 'flex-col items-center' : 'items-center',
          )}
        >
          <PersonMenu rail={rail} actions={actions} />
          <SignOutButton actions={actions} />
        </div>
      </div>
    </div>
  );
}

/** A tab of the phone tab bar: the icon over its word, at least 44 high. */
const TAB = `flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-xs font-medium text-sidebar-foreground ${QUICK} ${MENU_FOCUS}`;

function TabIcon({ Icon }: { Icon: (props: IconProps) => React.JSX.Element }) {
  return <Icon className="size-6" />;
}

/**
 * Below 640 px the menu is a navy tab bar at the bottom (docs/design-system.md,
 * Layout shell, Phone width; This app, Phone tab bar): the role's first four
 * items and "More", which holds the rest, the person's own entries, the
 * feedback and sign-out.
 */
export function PhoneTabBar({ actions }: { actions: PersonActions }) {
  const { t } = useTranslation();
  const pages = useMenuPages();
  const { tabs, more } = tabBarSplit(pages);
  const path = useRouterState({ select: (state) => state.location.pathname });
  const inMore = more.some((page) =>
    page.to === '/' ? path === '/' : path === page.to || path.startsWith(`${String(page.to)}/`),
  );
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
  };
  const shown = useShownName();

  return (
    <nav
      aria-label={t('menu.tabs')}
      data-print="hide"
      className="fixed inset-x-0 bottom-0 z-40 flex gap-1 bg-sidebar px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] sm:hidden"
    >
      {tabs.map((page) => (
        <Link
          key={page.titleKey}
          to={page.to}
          className={cn(
            TAB,
            'data-[status=active]:bg-sidebar-primary data-[status=active]:font-semibold data-[status=active]:text-sidebar-primary-foreground',
          )}
          activeOptions={{ exact: page.to === '/' }}
          activeProps={{ 'aria-current': 'page' }}
          // The short label on the bar, the full name as the tab's name (H16).
          aria-label={t(page.titleKey)}
        >
          <TabIcon Icon={page.icon} />
          <span className="max-w-full truncate">{t(page.shortKey)}</span>
        </Link>
      ))}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={
            <button
              type="button"
              // The page open is under "More": the tab is the current one (Phone width,
              // "the active one orange"), by its fill and for a screen reader.
              {...(inMore ? { 'aria-current': 'page' as const } : {})}
              className={cn(
                TAB,
                inMore
                  ? 'bg-sidebar-primary font-semibold text-sidebar-primary-foreground'
                  : 'hover:bg-sidebar-accent',
              )}
            />
          }
        >
          <TabIcon Icon={MoreHorizIcon} />
          <span>{t('menu.more')}</span>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>{t('menu.more')}</DialogTitle>
          <DialogDescription className="sr-only">{t('layout.menu')}</DialogDescription>
          <p data-person="" className="flex items-center gap-3 text-sm font-semibold">
            {/* The avatar of the menu, on #1B2A63 (docs/design-system.md, Layout shell). */}
            <Avatar shown={shown} />
            {shown}
          </p>
          {more.length > 0 && (
            <nav aria-label={t('menu.moreItems')}>
              <ul className="grid gap-1">
                {more.map((page) => {
                  const Icon = page.icon;
                  return (
                    <li key={page.titleKey}>
                      <Link
                        to={page.to}
                        onClick={close}
                        className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium hover:bg-accent data-[status=active]:bg-primary data-[status=active]:font-semibold data-[status=active]:text-primary-foreground"
                        activeOptions={{ exact: page.to === '/' }}
                        activeProps={{ 'aria-current': 'page' }}
                      >
                        <Icon className="size-6" />
                        {t(page.titleKey)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}
          <ul className="grid gap-1 border-t pt-3">
            <li>
              <Link
                to="/account"
                onClick={close}
                className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium hover:bg-accent"
              >
                {t('account.title')}
              </Link>
            </li>
            <li>
              <Link
                to="/account/password"
                onClick={close}
                className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium hover:bg-accent"
              >
                {t('layout.changePassword')}
              </Link>
            </li>
          </ul>
          <div className="grid gap-3 border-t pt-3">
            <ThemeSwitch />
            <LanguageChooser onChange={actions.chooseLanguage} />
            <FeedbackButton withWord />
          </div>
          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Button
              variant="secondary"
              onClick={() => {
                close();
                actions.signOut();
              }}
            >
              <LogoutIcon />
              {t('layout.signOut')}
            </Button>
            <DialogClose render={<Button variant="ghost" />}>{t('menu.close')}</DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </nav>
  );
}
