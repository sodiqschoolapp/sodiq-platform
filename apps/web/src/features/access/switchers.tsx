import { useRouter } from '@tanstack/react-router';
import { cn } from 'cn';
import { useTranslation } from 'react-i18next';
import { ExpandMoreIcon } from '@/components/icons';
import { FOCUS_RING, QUICK } from '@/components/ui/control';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select } from '@/components/ui/select';
import { useLeave } from '@/components/unsent/unsent-changes';
import { isRole } from './view';
import { useView } from './use-view';

/**
 * The role switcher of the top bar (`02`: "a role switcher in the top bar
 * changes the menu and home page"). Shown with more than one role. It changes
 * what is displayed only: the server allows an action when any current
 * assignment permits it. So the button says what it changes ("Menu and home
 * page: Tutor") and its menu says that the rights stay (issue #105, H11b): a
 * menu button like the person menu, since a select can carry neither. Below
 * 640 px the button shows the role alone; its name keeps the whole text.
 */
export function RoleSwitcher() {
  const { t } = useTranslation();
  const { roles, role, chooseRole } = useView();
  if (roles.length < 2 || role === null) {
    return null;
  }
  const roleName = t(`roles.${role}`);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={t('switcher.roleButton', { role: roleName })}
            className={cn(
              'flex h-10 max-w-96 min-w-0 items-center gap-1.5 rounded-lg border border-input bg-card pr-2.5 pl-3 text-left text-sm text-foreground max-sm:h-11',
              QUICK,
              FOCUS_RING,
            )}
          />
        }
      >
        {/* The prefix never shortens; the role does when the bar has no room. */}
        <span className="shrink-0 max-sm:hidden">{t('switcher.rolePrefix')}</span>
        <span className="min-w-0 truncate font-semibold">{roleName}</span>
        <ExpandMoreIcon className="shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="whitespace-normal">
            {t('switcher.roleHint')}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={role}
            onValueChange={(value: unknown) => {
              if (isRole(value)) {
                chooseRole(value);
              }
            }}
          >
            {roles.map((option) => (
              <DropdownMenuRadioItem key={option} value={option} closeOnClick>
                {t(`roles.${option}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The branch switcher, at the left of the top bar (`edge/people-roles-accounts`:
 * "one person works in two branches"; `12`, Context: the branch in use is
 * always shown). A select with more than one branch to choose, the branch's
 * name as text with one. Every request names its one branch and is checked
 * against it.
 */
export function BranchSwitcher() {
  const { t } = useTranslation();
  const { branches, branchId, chooseBranch } = useView();
  const { leave } = useLeave();
  const router = useRouter();
  /**
   * Task 3.5b, H32 of issue #105: a form with typed changes asks first; then
   * the record open in the side panel, of the old branch, is closed, and only
   * then is the branch chosen, so nothing of the old record is on screen and
   * no request for it can go with the new branch.
   */
  const switchTo = async (next: string) => {
    if (!(await leave())) {
      return;
    }
    const search: Record<string, unknown> = { ...router.state.location.search };
    if (search.open !== undefined) {
      delete search.open;
      await router.navigate({ to: '.', search, ignoreBlocker: true });
    }
    chooseBranch(next);
  };
  if (branchId === null) {
    return null;
  }
  if (branches.length < 2) {
    const branch = branches.find((option) => option.id === branchId);
    return branch === undefined ? null : (
      <span title={t('switcher.branch')} className="min-w-0 truncate text-sm font-semibold">
        <span className="sr-only">{t('switcher.branch')} </span>
        {branch.name}
      </span>
    );
  }
  return (
    <label className="flex min-w-0 items-center gap-1.5 text-sm">
      <span className="sr-only">{t('switcher.branch')}</span>
      <Select
        className="max-w-48 min-w-0"
        value={branchId}
        onChange={(event) => {
          void switchTo(event.target.value);
        }}
      >
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
          </option>
        ))}
      </Select>
    </label>
  );
}
