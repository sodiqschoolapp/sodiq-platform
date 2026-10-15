import { useRouter } from '@tanstack/react-router';
import { useLeave } from '@/components/unsent/unsent-changes';
import { useView } from './use-view';

/** The pages a branch switch may open after it (the banner, the Branches list). */
type AfterSwitch = '/people/staff' | '/setup/branch';

/**
 * Every change of the tab's branch (task 3.5b, H32 of issue #105): a form
 * with typed changes asks first; then the page leaves the old branch's
 * record (the `open` record of its side panel, or the whole page when \`to\`
 * names another), and only then is the branch chosen, so nothing of the old
 * record is on screen and no request for it can go with the new branch.
 * Answers whether the branch changed.
 */
export function useSwitchBranch(): (next: string, to?: AfterSwitch) => Promise<boolean> {
  const { chooseBranch } = useView();
  const { leave } = useLeave();
  const router = useRouter();
  return async (next, to) => {
    if (!(await leave())) {
      return false;
    }
    if (to !== undefined) {
      await router.navigate({ to, ignoreBlocker: true });
    } else {
      const search: Record<string, unknown> = { ...router.state.location.search };
      if (search.open !== undefined) {
        delete search.open;
        await router.navigate({ to: '.', search, ignoreBlocker: true });
      }
    }
    chooseBranch(next);
    return true;
  };
}
