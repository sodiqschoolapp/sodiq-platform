import { isRole, type Chosen } from './view';

export const ROLE_STORAGE_KEY = 'sodiq.role';
export const BRANCH_STORAGE_KEY = 'sodiq.branch';

// A browser may refuse storage: the choice then lasts while the page is open.
function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) {
      window.sessionStorage.removeItem(key);
    } else {
      window.sessionStorage.setItem(key, value);
    }
  } catch {
    // Nothing to do: see above.
  }
}

/**
 * The role and the branch chosen in this tab. `sessionStorage` is per tab: a
 * new tab starts with the defaults, and nothing is kept on the account
 * (`edge/people-roles-accounts`, sessions: "Role and branch on display are
 * kept per tab"). Sign-out clears both.
 */
export class ViewStore {
  private chosen: Chosen;
  private readonly listeners = new Set<() => void>();

  constructor() {
    const role = read(ROLE_STORAGE_KEY);
    this.chosen = { role: isRole(role) ? role : null, branchId: read(BRANCH_STORAGE_KEY) };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly snapshot = (): Chosen => this.chosen;

  private set(chosen: Chosen): void {
    this.chosen = chosen;
    write(ROLE_STORAGE_KEY, chosen.role);
    write(BRANCH_STORAGE_KEY, chosen.branchId);
    this.listeners.forEach((listener) => {
      listener();
    });
  }

  chooseRole(role: Chosen['role']): void {
    this.set({ ...this.chosen, role });
  }

  chooseBranch(branchId: string): void {
    this.set({ ...this.chosen, branchId });
  }

  clear(): void {
    this.set({ role: null, branchId: null });
  }
}
