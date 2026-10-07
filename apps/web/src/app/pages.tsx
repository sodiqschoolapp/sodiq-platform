import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '@/components/states';
import { buttonVariants } from '@/components/ui/button';

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
      <ErrorState
        error={error}
        onRetry={() => {
          void router.invalidate();
        }}
      />
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
