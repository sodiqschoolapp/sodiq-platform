import { SunMoonIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isTheme, THEMES, useTheme } from '@/theme/theme';

/**
 * docs/spec/12-ux-standards.md, Look and feel: "Light and dark themes". On
 * every page, before and after sign-in, beside the language chooser: light,
 * dark, or as the device prefers; the choice is kept in the browser (decided
 * by the owner, task 0.8b-3).
 */
export function ThemeSwitch() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <label className="flex items-center gap-1.5 text-sm">
      <SunMoonIcon aria-hidden className="size-4 text-muted-foreground" />
      <span className="sr-only">{t('theme.label')}</span>
      <select
        className="h-8 rounded-lg border border-input bg-background px-2 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        value={theme}
        onChange={(event) => {
          if (isTheme(event.target.value)) {
            setTheme(event.target.value);
          }
        }}
      >
        {THEMES.map((option) => (
          <option key={option} value={option}>
            {t(`theme.${option}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
