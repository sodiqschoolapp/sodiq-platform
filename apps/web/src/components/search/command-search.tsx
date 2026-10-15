import {
  classDisplayName,
  listName,
  PERMISSIONS,
  permits,
  phoneText,
  searchWords,
} from '@sodiq/shared';
import { useQueries } from '@tanstack/react-query';
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
import { studentStatusText } from '@/features/people/status-cause';
import { indexedPages, type IndexedPage } from '@/app/page-index';
import { useMenuPages } from '@/features/access/use-menu';
import { useView } from '@/features/access/use-view';
import { searchKey, type ListSearch } from '@/components/list/list-state';
import { Button } from '@/components/ui/button';
import { FIELD } from '@/components/ui/control';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { nameOf } from '@/features/setup/setup-api';
import {
  RECORD_KINDS,
  recordSearchQuery,
  SEARCH_FROM_LENGTH,
  type Found,
  type RecordKind,
  type RecordList,
} from './search-api';

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
 * difference of case, of apostrophes, of composed letters or of script.
 */
export function matchingPages(pages: readonly TitledPage[], typed: string): TitledPage[] {
  const words = searchWords(typed);
  if (words === null) {
    return [...pages];
  }
  return pages.filter((page) => {
    const title = searchKey(page.title);
    return words.every((word) => title.includes(word));
  });
}

/** One line of the list: a page, a record or "More on the list". */
interface Option {
  key: string;
  label: string;
  detail?: string;
  /** A "More on the list" line, set apart from the records it follows. */
  more?: boolean;
  open: () => void;
}

/** A heading of the list and its lines. */
interface Section {
  key: string;
  heading: string;
  options: Option[];
}

/** How long the typed text rests before the records are asked for (decision 7). */
const PAUSE_MS = 100;

/**
 * docs/spec/12-ux-standards.md, One pattern everywhere, Search: "Ctrl+K opens
 * a search across students, staff, classes, groups and pages"; Speed targets:
 * "Results while typing". The pages of the menu of the active role and the
 * pages every role has, then (task 3.2d) the students, staff, classes and
 * groups the active role views, from the second typed character after a
 * short pause, each kind answered by the server in the reader's scope.
 * Ctrl+K (Cmd+K on a Mac) and the button in the top bar open it: a tablet or
 * a phone has no Ctrl+K (Devices). Inside the layout only: a search needs a
 * signed-in person. The arrows move across every line, Enter opens the page or
 * the record in the side panel of its list, Escape closes.
 */
export function CommandSearch() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [rested, setRested] = useState('');
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

  // The records are asked for once the typed text rests (decision 7).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRested(typed.trim());
    }, PAUSE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [typed]);

  const menuPages = useMenuPages();
  const { role, branchId } = useView();
  const pages = useMemo<TitledPage[]>(
    () =>
      indexedPages(
        menuPages,
        (area, action = 'view') => role !== null && permits(PERMISSIONS, role, area, action),
      ).map((page) => ({ ...page, title: t(page.titleKey) })),
    [t, menuPages, role],
  );
  const matching = matchingPages(pages, typed);

  // Decision 4: the kinds the active role views; the server decides the rest.
  const kinds = RECORD_KINDS.filter(
    ({ area }) => role !== null && permits(PERMISSIONS, role, area, 'view'),
  );
  const searching = open && typed.trim().length >= SEARCH_FROM_LENGTH;
  const answers = useQueries({
    queries: kinds.map(({ kind }) => recordSearchQuery(kind, branchId, rested, searching)),
  });
  // A kind is shown only while its query is on: a disabled query keeps the
  // previous answer as a placeholder.
  const shown = searching && rested.length >= SEARCH_FROM_LENGTH;

  const change = (next: boolean): void => {
    setOpen(next);
    if (!next) {
      setTyped('');
      setRested('');
      setActive(0);
    }
  };

  const go = (to: Parameters<typeof navigate>[0]): void => {
    change(false);
    void navigate(to);
  };

  /** A list of a kind, with a record open in its side panel or its search typed. */
  const openList = (list: RecordList, search: ListSearch): void => {
    change(false);
    switch (list) {
      case '/people/students':
        void navigate({ to: '/people/students', search });
        break;
      case '/people/staff':
        void navigate({ to: '/people/staff', search });
        break;
      case '/people/parents':
        void navigate({ to: '/people/parents', search });
        break;
      case '/classes':
        void navigate({ to: '/classes', search });
        break;
      case '/groups':
        void navigate({ to: '/groups', search });
        break;
    }
  };

  const detailOf = (
    kind: RecordKind,
    item: Found[RecordKind],
    today: string | undefined,
  ): Pick<Option, 'label' | 'detail'> => {
    const parts = (...texts: (string | null)[]): string =>
      texts.filter((text) => text !== null && text !== '').join(' · ');
    switch (kind) {
      case 'students': {
        const student = item as Found['students'];
        return {
          label: parts(listName(student), student.paternalName),
          detail: parts(
            // H33: the relative whose phone found the student.
            student.relative === undefined
              ? null
              : t('search.relativeOf', { name: student.relative }),
            student.uid,
            student.class === null
              ? null
              : classDisplayName(student.class.grade, student.class.name),
            today === undefined
              ? student.status === null
                ? t('people.students.notStarted')
                : t(`people.students.statuses.${student.status}`)
              : studentStatusText(t, student, today, i18n.language),
          ),
        };
      }
      case 'staff': {
        const person = item as Found['staff'];
        return {
          label: listName(person),
          detail: parts(
            person.staffId,
            person.status === null
              ? t('people.staff.notStarted')
              : t(`people.staff.statuses.${person.status}`),
          ),
        };
      }
      case 'relatives': {
        const relative = item as Found['relatives'];
        return {
          label: relative.fullName,
          detail: parts(
            relative.phone === null ? null : phoneText(relative.phone),
            t('search.relativeStudents', { count: relative.students }),
          ),
        };
      }
      case 'classes': {
        const found = item as Found['classes'];
        return { label: classDisplayName(found.grade, found.name), detail: found.yearName };
      }
      case 'groups': {
        const group = item as Found['groups'];
        return {
          label: group.name,
          detail: parts(nameOf(group.subject, i18n.language), group.yearName),
        };
      }
    }
  };

  const sections: Section[] = [
    {
      key: 'pages',
      heading: t('search.pages'),
      options: matching.map((page) => ({
        key: `page:${page.to}`,
        label: page.title,
        open: () => {
          go({ to: page.to });
        },
      })),
    },
  ];
  if (shown) {
    kinds.forEach(({ kind, list }, index) => {
      const data = answers[index]?.data;
      if (data === undefined) {
        return;
      }
      const options: Option[] = data.items.map((item) => ({
        key: `${kind}:${item.id}`,
        ...detailOf(kind, item, data.today),
        open: () => {
          openList(list, { open: item.id });
        },
      }));
      if (data.more) {
        options.push({
          key: `${kind}:more`,
          label: t('search.more'),
          more: true,
          open: () => {
            openList(list, { q: rested });
          },
        });
      }
      sections.push({ key: kind, heading: t(`search.${kind}`), options });
    });
  }
  const options = sections.flatMap((section) => section.options);
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));
  const activeOption = options[activeIndex];
  const optionId = (index: number): string => `${listId}-${String(index)}`;

  const failed = shown ? answers.filter((answer) => answer.isError) : [];
  // Every kind answered for the text typed now: not during the pause, not
  // while an answer of an earlier text stands in (the spec review of the
  // build: "No match" never shows before the records were asked for).
  const current = typed.trim();
  const settled =
    kinds.length === 0 ||
    current.length < SEARCH_FROM_LENGTH ||
    (rested === current &&
      answers.every((answer) => answer.data !== undefined && !answer.isPlaceholderData));
  const waiting = !settled && failed.length === 0;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(Math.min(activeIndex + 1, Math.max(0, options.length - 1)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (event.key === 'Enter' && activeOption !== undefined) {
      event.preventDefault();
      activeOption.open();
    }
  };

  let index = -1;
  return (
    <Dialog open={open} onOpenChange={change}>
      {/* docs/design-system.md, Layout shell, Top bar: the search field with "Ctrl K"
          as plain text at its right; below 1280 px the search button with its name read
          out (task 2.7b-2, finding 14: one top bar row at laptop width). */}
      <DialogTrigger
        render={
          <button
            type="button"
            className={cn(
              FIELD,
              'flex items-center gap-2 text-left text-muted-foreground xl:w-64',
              'max-xl:size-10 max-sm:size-11 max-xl:justify-center max-xl:border-0 max-xl:bg-transparent max-xl:px-0 max-xl:text-foreground max-xl:hover:bg-accent',
            )}
          />
        }
      >
        <SearchIcon aria-hidden />
        <span className="max-xl:sr-only">{t('search.label')}</span>
        <span aria-hidden className="ml-auto text-xs max-xl:hidden">
          {t(onMac() ? 'search.shortcutMac' : 'search.shortcut')}
        </span>
      </DialogTrigger>
      <DialogContent className="top-[15%] translate-y-0 gap-3 sm:max-w-md">
        <DialogTitle className="sr-only">{t('search.label')}</DialogTitle>
        <DialogDescription className="sr-only">
          {t(kinds.length > 0 ? 'search.placeholderRecords' : 'search.placeholder')}
        </DialogDescription>
        <div className="flex items-center gap-2">
          <Input
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeOption === undefined ? undefined : optionId(activeIndex)}
            aria-autocomplete="list"
            aria-label={t('search.label')}
            placeholder={t(kinds.length > 0 ? 'search.placeholderRecords' : 'search.placeholder')}
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
        <div
          id={listId}
          role="listbox"
          aria-label={t('search.label')}
          className="grid max-h-[60vh] gap-2 overflow-y-auto"
        >
          {sections.map(
            (section) =>
              section.options.length > 0 && (
                <div
                  key={section.key}
                  role="group"
                  aria-labelledby={`${listId}-${section.key}`}
                  className="grid gap-0.5"
                >
                  <div
                    id={`${listId}-${section.key}`}
                    role="presentation"
                    className="px-2 pt-1 text-xs font-semibold text-muted-foreground"
                  >
                    {section.heading}
                  </div>
                  {section.options.map((option) => {
                    index += 1;
                    const at = index;
                    return (
                      <div
                        key={option.key}
                        id={optionId(at)}
                        role="option"
                        aria-selected={at === activeIndex}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                          at === activeIndex && 'bg-muted',
                          option.more === true && 'text-link',
                        )}
                        onMouseDown={(event) => {
                          // The focus stays in the box.
                          event.preventDefault();
                        }}
                        onClick={() => {
                          option.open();
                        }}
                      >
                        {/* The active line is marked by the sign as well as by the colour. */}
                        <ChevronRightIcon
                          aria-hidden
                          className={cn('size-4 shrink-0', at !== activeIndex && 'invisible')}
                        />
                        <span className="min-w-0 truncate">{option.label}</span>
                        {option.detail !== undefined && (
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                            {option.detail}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ),
          )}
        </div>
        {waiting && (
          <p role="status" className="px-2 text-sm text-muted-foreground">
            {t('search.searching')}
          </p>
        )}
        {failed.length > 0 && (
          // `.claude/rules/web.md`: a failed query shows a retry (correction 2 of the plan review).
          <div className="flex items-center gap-2 px-2">
            <p role="alert" className="text-sm">
              {t('search.failed')}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                for (const answer of failed) {
                  void answer.refetch();
                }
              }}
            >
              {t('problems.retry')}
            </Button>
          </div>
        )}
        {options.length === 0 && settled && failed.length === 0 && (
          <p role="status" className="px-2 text-sm text-muted-foreground">
            {t('search.noMatch')}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
