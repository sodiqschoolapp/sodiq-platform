import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { failureText } from '@/api/failure-text';
import { Button, buttonVariants } from '@/components/ui/button';

/**
 * The home page of every role until task 0.8c gives each role its own
 * (docs/spec/12-ux-standards.md: an empty page says what the page is for).
 */
export function HomePage() {
  const { t } = useTranslation();
  return (
    <section className="max-w-prose">
      <h1 className="text-xl font-semibold">{t('home.title')}</h1>
      <p className="mt-2 text-muted-foreground">{t('home.empty')}</p>
    </section>
  );
}

/** Shown while a page waits for its data: the outline at once, then the page. */
export function PendingPage() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-busy="true" className="flex min-h-svh flex-col">
      <span className="sr-only">{t('app.loading')}</span>
      <div className="h-12 border-b" />
      <div className="grid flex-1 content-start gap-3 p-6">
        <div className="h-6 w-48 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full max-w-prose animate-pulse rounded bg-muted" />
        <div className="h-4 w-2/3 max-w-prose animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

/** A page that could not be opened: what happened and what to do next. */
export function ErrorPage({ error }: ErrorComponentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <main className="mx-auto grid max-w-prose gap-3 p-6">
      <h1 className="text-xl font-semibold">{t('problems.title')}</h1>
      <p role="alert">{failureText(t, error)}</p>
      <div>
        <Button
          onClick={() => {
            void router.invalidate();
          }}
        >
          {t('problems.retry')}
        </Button>
      </div>
    </main>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto grid max-w-prose gap-3 p-6">
      <h1 className="text-xl font-semibold">{t('problems.notFoundTitle')}</h1>
      <p>{t('problems.notFoundText')}</p>
      <div>
        <Link to="/" className={buttonVariants()}>
          {t('problems.toHome')}
        </Link>
      </div>
    </main>
  );
}
