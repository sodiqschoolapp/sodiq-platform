import { Select } from '@/components/ui/select';
import { isRole } from './view';
import { useTranslation } from 'react-i18next';
import { useView } from './use-view';

/**
 * The role switcher of the top bar (`02`: "a role switcher in the top bar
 * changes the menu and home page"). Shown with more than one role. It changes
 * what is displayed only: the server allows an action when any current
 * assignment permits it.
 */
export function RoleSwitcher() {
  const { t } = useTranslation();
  const { roles, role, chooseRole } = useView();
  if (roles.length < 2 || role === null) {
    return null;
  }
  return (
    <label className="flex items-center gap-1.5 text-sm">
      <span className="sr-only">{t('switcher.role')}</span>
      <Select
        className="max-w-48"
        value={role}
        onChange={(event) => {
          if (isRole(event.target.value)) {
            chooseRole(event.target.value);
          }
        }}
      >
        {roles.map((option) => (
          <option key={option} value={option}>
            {t(`roles.${option}`)}
          </option>
        ))}
      </Select>
    </label>
  );
}

/**
 * The branch switcher, beside the role switcher (`edge/people-roles-accounts`:
 * "one person works in two branches"). Shown with more than one branch to
 * choose. Every request names its one branch and is checked against it.
 */
export function BranchSwitcher() {
  const { t } = useTranslation();
  const { branches, branchId, chooseBranch } = useView();
  if (branches.length < 2 || branchId === null) {
    return null;
  }
  return (
    <label className="flex items-center gap-1.5 text-sm">
      <span className="sr-only">{t('switcher.branch')}</span>
      <Select
        className="max-w-48"
        value={branchId}
        onChange={(event) => {
          chooseBranch(event.target.value);
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
