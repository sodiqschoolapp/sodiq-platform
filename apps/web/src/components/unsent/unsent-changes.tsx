import { useBlocker } from '@tanstack/react-router';
import { TriangleAlertIcon } from 'lucide-react';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';

/** Something a person typed that the server does not have. */
export interface UnsentEntry {
  /** What a person calls it, for example the name of the record. */
  label: string;
  /** `typed`: not saved yet. `failed`: a save was tried and refused. */
  state: 'typed' | 'failed';
  /** Drops what was typed; called when the person chooses to leave without saving. */
  discard: () => void;
  /** Puts the focus where the changes are. */
  focus: () => void;
  /** Over when no save of it is on its way; a question about leaving waits for it. */
  settled: () => Promise<void>;
}

class UnsentStore {
  private readonly entries = new Map<string, UnsentEntry>();
  private readonly listeners = new Set<() => void>();
  private list: readonly UnsentEntry[] = [];
  /** The question about leaving that is open now: one for the tab, whoever asks. */
  asking: Promise<boolean> | null = null;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The same array until something changes. */
  readonly snapshot = (): readonly UnsentEntry[] => this.list;

  set(id: string, entry: UnsentEntry | null): void {
    if (entry === null) {
      if (!this.entries.delete(id)) {
        return;
      }
    } else {
      this.entries.set(id, entry);
    }
    this.list = [...this.entries.values()];
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Every entry is dropped: the person chose to leave without saving. */
  discardAll(): void {
    const dropped = this.list;
    this.entries.clear();
    this.list = [];
    for (const entry of dropped) {
      entry.discard();
    }
    for (const listener of this.listeners) {
      listener();
    }
  }
}

const UnsentContext = createContext<UnsentStore | null>(null);

const NOTHING: readonly UnsentEntry[] = [];
const subscribeToNothing = (): (() => void) => () => undefined;
const nothing = (): readonly UnsentEntry[] => NOTHING;

/**
 * Holds what is typed and not saved anywhere in the tab
 * (docs/spec/12-ux-standards.md, No lost work). Record forms put themselves
 * here; the journal's queue of unsent entries joins in task 8.3c.
 */
export function UnsentProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new UnsentStore());
  return <UnsentContext.Provider value={store}>{children}</UnsentContext.Provider>;
}

/** What is typed and not saved now. Nothing outside the app (a piece drawn alone in a test). */
export function useUnsent(): readonly UnsentEntry[] {
  const store = useContext(UnsentContext);
  return useSyncExternalStore(store?.subscribe ?? subscribeToNothing, store?.snapshot ?? nothing);
}

/** Keeps an entry in the store while there is one; `null` takes it out. */
export function useUnsentEntry(entry: UnsentEntry | null): void {
  const id = useId();
  const store = useContext(UnsentContext);
  const label = entry?.label;
  const state = entry?.state;
  // The newest functions of the form, without putting the entry in again for them.
  const latest = useRef(entry);
  useEffect(() => {
    latest.current = entry;
  });

  useEffect(() => {
    if (store === null || label === undefined || state === undefined) {
      return;
    }
    store.set(id, {
      label,
      state,
      discard: () => latest.current?.discard(),
      focus: () => latest.current?.focus(),
      settled: () => latest.current?.settled() ?? Promise.resolve(),
    });
    return () => {
      store.set(id, null);
    };
  }, [store, id, label, state]);
}

export interface Leave {
  /** Whether anything is typed and not saved; the answer is there at once. */
  unsent: () => boolean;
  /**
   * Asks "Leave without saving?" when something is, naming it. `true`: nothing
   * was unsaved, or the person leaves and what was typed is dropped. `false`:
   * the person stays.
   */
  leave: () => Promise<boolean>;
}

/**
 * For whatever takes a form away without a change of page: another record in
 * the side panel, closing the panel, sign-out. A change of page asks by itself
 * (`UnsentGuard`).
 */
export function useLeave(): Leave {
  const { t } = useTranslation();
  const store = useContext(UnsentContext);
  const confirm = useConfirm();

  return useMemo(() => {
    if (store === null) {
      return { unsent: () => false, leave: () => Promise.resolve(true) };
    }
    const ask = async (): Promise<boolean> => {
      // A save on its way is waited for first: the question must be true.
      // Saved, there is nothing to lose and nothing is asked; refused, the
      // question names it. One turn more lets the forms say where they stand.
      await Promise.all(store.snapshot().map((entry) => entry.settled()));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      if (store.snapshot().length === 0) {
        return true;
      }
      const leaves = await confirm({
        title: t('unsent.leaveTitle'),
        text: t('unsent.leaveText'),
        names: store.snapshot().map((entry) => entry.label),
        action: t('unsent.leave'),
        cancel: t('unsent.stay'),
        destructive: true,
      });
      if (leaves) {
        store.discardAll();
      }
      return leaves;
    };
    return {
      unsent: () => store.snapshot().length > 0,
      leave: () => {
        if (store.snapshot().length === 0) {
          return Promise.resolve(true);
        }
        // Asked twice at once, by whoever: one question, one answer for both.
        store.asking ??= ask().finally(() => {
          store.asking = null;
        });
        return store.asking;
      },
    };
  }, [store, confirm, t]);
}

/** The record open in a side panel is part of where a person is (`ListSearch.open`). */
const openOf = (search: unknown): unknown =>
  typeof search === 'object' && search !== null && 'open' in search ? search.open : undefined;

/**
 * Decided by the owner (task 0.8b): a warning before leaving with typed
 * changes. A move to another page or to another record asks first; a search,
 * a filter or an order of the list behind an open record does not, the record
 * stays. Closing or reloading the tab is asked by the browser in its own words.
 */
export function UnsentGuard() {
  const { unsent, leave } = useLeave();
  useBlocker({
    shouldBlockFn: async ({ current, next }) => {
      if (current.pathname === next.pathname && openOf(current.search) === openOf(next.search)) {
        return false;
      }
      return !(await leave());
    },
    enableBeforeUnload: unsent,
  });
  return null;
}

/**
 * The sign in the top bar that something is typed and not saved, or that a
 * save failed. Always in its place, so nothing moves when the first letter is
 * typed; an icon and words, not a colour alone. Its button leads to the form.
 */
export function UnsentBanner() {
  const { t } = useTranslation();
  const entries = useUnsent();
  const failed = entries.find((entry) => entry.state === 'failed');
  const first = failed ?? entries[0];

  return (
    <div role="status" className="min-w-0">
      {first !== undefined && (
        <Button
          variant="outline"
          size="sm"
          className="max-w-full"
          onClick={() => {
            first.focus();
          }}
        >
          <TriangleAlertIcon
            aria-hidden
            className={failed === undefined ? '' : 'text-destructive'}
          />
          <span className="truncate">
            {failed === undefined ? t('unsent.typed') : t('unsent.failed')}
          </span>
        </Button>
      )}
    </div>
  );
}
