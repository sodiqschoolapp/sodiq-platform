import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HexagonColumn, LineOrnament } from '@/components/brand/hexagons';
import { Logo } from '@/components/brand/logo';
import { DarkModeIcon, LightModeIcon } from '@/components/icons';
import { LanguageChooser } from '@/components/language-chooser';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/theme/theme';
import { rememberLanguageChosen } from './language-mark';

/**
 * The theme button of the sign-in page (docs/design-system.md, Brand moments,
 * Sign-in): it sets the other theme of the one drawn now. "As the device"
 * stays the default and is chosen again in the app (pull request #61,
 * decision 2). Through `useTheme()` like every theme choice.
 */
export function ThemeButton() {
  const { t } = useTranslation();
  const { setTheme, dark } = useTheme();
  const label = t(dark ? 'theme.toLight' : 'theme.toDark');
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={() => {
        setTheme(dark ? 'light' : 'dark');
      }}
    >
      {dark ? <LightModeIcon /> : <DarkModeIcon />}
    </Button>
  );
}

interface AuthPageProps {
  title: string;
  /** One line under the title, on the steps that need it (not used every day). */
  text?: string | undefined;
  children: ReactNode;
}

/**
 * The frame of the pages before the app itself: sign-in and the steps a
 * session owes (docs/design-system.md, Brand moments, Sign-in; pull request
 * #61, decision 8). The form on the left with the colour logo, the language
 * and the theme at the top and a Bitter title; on the right the navy panel
 * with the slogan and the column of hexagons, hidden at phone width. A
 * language chosen here changes the browser and is saved to the account at the
 * first complete answer (decided by the owner, task 0.8d).
 */
export function AuthPage({ title, text, children }: AuthPageProps) {
  const { t, i18n } = useTranslation();

  return (
    <div className="flex min-h-svh bg-card">
      <div className="flex min-w-0 flex-1 flex-col px-8 py-6 max-sm:px-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          {/* The colour logo on white; the on-dark one on the dark theme's navy (Logo). */}
          <Logo variant="horizontal" className="h-8 dark:hidden" />
          <Logo variant="horizontal-on-dark" className="hidden h-8 dark:block" />
          <div className="ml-auto flex items-center gap-2">
            <LanguageChooser
              onChange={(language) => {
                rememberLanguageChosen(language);
                void i18n.changeLanguage(language);
              }}
            />
            <ThemeButton />
          </div>
        </header>
        <main className="flex flex-1 items-center justify-center py-8">
          <div className="grid w-full max-w-100 gap-6">
            <div className="grid gap-2">
              <h1 className="font-brand text-[1.75rem]/[2.125rem] font-bold sm:text-[2.5rem]/[2.75rem]">
                {title}
              </h1>
              {text !== undefined && <p className="text-muted-foreground">{text}</p>}
            </div>
            <div className="grid gap-4">{children}</div>
          </div>
        </main>
      </div>
      {/* The brand book's cover: navy in both themes, hidden at phone width.
          It never makes the page wider than the window (issue #39, hand test of
          13 October 2026, finding 1): the panel may shrink; the slogan steps
          between sizes of the type table, chosen by the room its panel gives
          it, so its longest word always fits (56 / 58 from 424 px, 40 / 44
          from 304 px, else 28 / 34); the hexagon column is narrower below
          1280 px and hidden below 768 px, where it would leave no room. */}
      <div className="hidden w-[42%] max-w-160 min-w-0 bg-sidebar sm:flex">
        <div className="@container flex min-w-0 flex-1 flex-col justify-center gap-6 p-6 lg:p-8 xl:p-12">
          <p className="font-brand text-[1.75rem]/[2.125rem] font-extrabold text-primary uppercase @[19rem]:text-[2.5rem]/[2.75rem] @[26.5rem]:text-[3.5rem]/[3.625rem]">
            {t('brand.slogan')}
          </p>
          <LineOrnament />
        </div>
        <HexagonColumn className="hidden md:block md:w-12 xl:w-20" />
      </div>
    </div>
  );
}
