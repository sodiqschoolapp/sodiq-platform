import { PERMISSIONS, permits } from '@sodiq/shared';
import { useNavigate } from '@tanstack/react-router';
import { cn } from 'cn';
import { ChevronRightIcon, SearchIcon, CloseIcon } from '@/components/icons';
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { indexedPages, type IndexedPage } from '@/app/page-index';
import { useMenuPages } from '@/features/access/use-menu';
import { useView } from '@/features/access/use-view';
import { searchKey, searchWords } from '@/components/list/list-state';
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
import { Input } from '@/components/ui/input';

/**
 * Whether a key press is the shortcut of the search: Ctrl+K, or Cmd+K on a Mac.
 * The key is read by its position too (`code`): with a Cyrillic layout the same
 * key gives the letter л.
 */
export function isSearchShortcut(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    (event.key.toLowerCase() === 'k' || event.code === 'KeyK')
  );
}

/** Where the keyboard has a Command key, the shortcut is shown with it. */
const onMac = (): boolean => /Mac|iPhone|iPad/.test(window.navigator.platform);

interface TitledPage extends IndexedPage {
  title: string;
}

/**
 * The pages whose title holds every typed word, as the lists compare text: no
 * difference of case, of apostrophes or of composed letters.
 */
export function matchingPages(
  pages: readonly TitledPage[],
  typed: string,
  language: string,
): TitledPage[] {
  const words = searchWords(typed, language);
  if (words === null) {
    return [...pages];
  }
  return pages.filter((page) => {
    const title = searchKey(page.title, language);
    return words.every((word) => title.includes(word));
  });
}

/**
 * docs/spec/12-ux-standards.md, One pattern everywhere, Search: "Ctrl+K opens
 * a search across students, staff, classes, groups and pages"; Speed targets:
 * "Results while typing". This task: the pages of the menu of the active role and the pages every role has.
 * Ctrl+K (Cmd+K on a Mac) and the button in the top bar open it: a tablet or
 * a phone has no Ctrl+K (Devices). Inside the layout only: a search needs a
 * signed-in person. The arrows move, Enter opens the page, Escape closes.
 */
export function CommandSearch() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (isSearchShortcut(event)) {
        // Not the browser's own search box.
        event.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const menuPages = useMenuPages();
  const { role } = useView();
  const pages = useMemo<TitledPage[]>(
    () =>
      indexedPages(
        menuPages,
        (area) => role !== null && permits(PERMISSIONS, role, area, 'view'),
      ).map((page) => ({ ...page, title: t(page.titleKey) })),
    [t, menuPages, role],
  );
  const matching = matchingPages(pages, typed, i18n.language);
  const activeIndex = Math.min(active, Math.max(0, matching.length - 1));
  const activePage = matching[activeIndex];
  const optionId = (index: number): string => `${listId}-${String(index)}`;

  const change = (next: boolean): void => {
    setOpen(next);
    if (!next) {
      setTyped('');
      setActive(0);
    }
  };

  const openPage = (page: TitledPage): void => {
    change(false);
    void navigate({ to: page.to });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(Math.min(activeIndex + 1, Math.max(0, matching.length - 1)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (event.key === 'Enter' && activePage !== undefined) {
      event.preventDefault();
      openPage(activePage);
    }
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      {/* docs/design-system.md, Layout shell, Top bar: the search field with "Ctrl K"
          as plain text at its right; at phone width the search button. */}
      <DialogTrigger
        render={
          <button
            type="button"
            className={cn(
              'flex h-10 items-center gap-2 rounded-lg border border-input bg-card px-3 text-sm text-muted-foreground sm:w-64',
              'max-sm:size-11 max-sm:justify-center max-sm:border-0 max-sm:bg-transparent max-sm:px-0 max-sm:text-foreground max-sm:hover:bg-accent',
              QUICK,
              FOCUS_RING,
            )}
          />
        }
      >
        <SearchIcon aria-hidden />
        <span className="max-sm:sr-only">{t('search.label')}</span>
        <span aria-hidden className="ml-auto text-xs max-sm:hidden">
          {t(onMac() ? 'search.shortcutMac' : 'search.shortcut')}
        </span>
      </DialogTrigger>
      <DialogContent className="top-[15%] translate-y-0 gap-3 sm:max-w-md">
        <DialogTitle className="sr-only">{t('search.label')}</DialogTitle>
        <DialogDescription className="sr-only">{t('search.placeholder')}</DialogDescription>
        <div className="flex items-center gap-2">
          <Input
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activePage === undefined ? undefined : optionId(activeIndex)}
            aria-autocomplete="list"
            aria-label={t('search.label')}
            placeholder={t('search.placeholder')}
            autoComplete="off"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <DialogClose
            render={<Button variant="ghost" size="icon-sm" aria-label={t('layout.dismiss')} />}
          >
            <CloseIcon aria-hidden />
          </DialogClose>
        </div>
        <ul id={listId} role="listbox" aria-label={t('search.pages')} className="grid gap-0.5">
          {matching.map((page, index) => (
            <li
              key={page.to}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                index === activeIndex && 'bg-muted',
              )}
              onMouseDown={(event) => {
                // The focus stays in the box.
                event.preventDefault();
              }}
              onClick={() => {
                openPage(page);
              }}
            >
              {/* The active page is marked by the sign as well as by the colour. */}
              <ChevronRightIcon
                aria-hidden
                className={cn('size-4', index !== activeIndex && 'invisible')}
              />
              {page.title}
            </li>
          ))}
        </ul>
        {matching.length === 0 && (
          <p role="status" className="px-2 text-sm text-muted-foreground">
            {t('search.noMatch')}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
