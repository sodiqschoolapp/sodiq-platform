import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageChooser } from '@/components/language-chooser';
import { ThemeSwitch } from '@/components/theme-switch';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';

interface AuthPageProps {
  title: string;
  /** What the page is for, under the title. */
  text?: string | undefined;
  children: ReactNode;
}

/** The frame of the pages before the app itself: sign-in and the steps a session owes. */
export function AuthPage({ title, text, children }: AuthPageProps) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="font-semibold">{t('app.name')}</span>
        <div className="flex items-center gap-2">
          <ThemeSwitch />
          <LanguageChooser />
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center p-4 sm:pt-16">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <h1 className="font-heading text-lg leading-snug font-semibold">{title}</h1>
            {text !== undefined && <CardDescription>{text}</CardDescription>}
          </CardHeader>
          <CardContent className="grid gap-4">{children}</CardContent>
        </Card>
      </main>
    </div>
  );
}
