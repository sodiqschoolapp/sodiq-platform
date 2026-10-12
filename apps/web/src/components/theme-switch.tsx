import { useTranslation } from 'react-i18next';
import { Segmented } from '@/components/ui/segmented';
import { THEMES, useTheme } from '@/theme/theme';

/**
 * docs/spec/12-ux-standards.md, Look and feel: "Light and dark themes". On
 * every page, before and after sign-in, beside the language chooser: light,
 * dark, or as the device prefers; the choice is kept in the browser (decided
 * by the owner, task 0.8b-3). Three choices: the segmented control of
 * docs/design-system.md (pull request #60, decision 7).
 */
export function ThemeSwitch() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <Segmented
      label={t('theme.label')}
      options={THEMES.map((option) => ({ value: option, label: t(`theme.${option}`) }))}
      value={theme}
      onChange={setTheme}
    />
  );
}
