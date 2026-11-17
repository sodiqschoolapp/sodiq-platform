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
import { isRole } from './view';
import { useSwitchBranch } from './use-switch-branch';
import { useView } from './use-view';

/**
 * The role switcher of the top bar (`02`: "a role switcher in the top bar
 * changes the menu and home page"). Shown with more than one role. It changes
 * what is displayed only: the server allows an action when any current
 * assignment permits it. So the button's name says what it changes ("Menu and home
 * page: Tutor") and its menu says that the rights stay (issue #105, H11b): a
 * menu button like the person menu, since a select can carry neither. The button
 * shows the role alone at every width, its whole name in the tooltip and as the
 * menu's heading: the long prefix cut the role to "Tyu…" and pushed the bar past
 * the window (design review of 17 November 2026, T1; owner, 17 November 2026).
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
            title={t('switcher.roleButton', { role: roleName })}
            // A quiet button: only a field has a border (docs/design-system.md, Buttons).
            className={cn(
              'flex h-10 max-w-60 min-w-0 shrink-0 items-center gap-1 rounded-lg pr-2 pl-3 text-left text-sm font-semibold whitespace-nowrap text-foreground hover:bg-accent aria-expanded:bg-accent max-sm:h-11',
              QUICK,
              FOCUS_RING,
            )}
          />
        }
      >
        <span className="min-w-0 truncate">{roleName}</span>
        <ExpandMoreIcon className="shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="whitespace-normal">
            <span className="block font-semibold text-foreground">{t('switcher.menuTitle')}</span>
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
  const { branches, branchId } = useView();
  const switchTo = useSwitchBranch();
  if (branchId === null) {
    return null;
  }
  if (branches.length < 2) {
    const branch = branches.find((option) => option.id === branchId);
    return branch === undefined ? null : (
      <span
        title={t('switcher.branch')}
        className="max-w-full shrink-0 truncate text-sm font-semibold"
      >
        <span className="sr-only">{t('switcher.branch')} </span>
        {branch.name}
      </span>
    );
  }
  return (
    <label className="flex max-w-full shrink-0 items-center gap-1.5 text-sm">
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
