import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { cn } from 'cn';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { failureText } from '@/api/failure-text';
import { BrandMoment } from '@/components/states';
import { Button, buttonVariants } from '@/components/ui/button';
import { useMenuShape } from '@/features/access/menu-state';

/** A grey bar of the outline, where text will be. */
function Bar({ className }: { className: string }) {
  return <div className={cn('animate-pulse rounded bg-muted', className)} />;
}

/**
 * Shown while a page of the app waits for its data: the outline of the shell
 * at once (the navy menu or its rail, the 64-high top bar; below 640 px the
 * top bar and the tab bar), then the page, so nothing jumps
 * (docs/spec/12-ux-standards.md, Look and feel).
 */
export function PendingPage() {
  const { t } = useTranslation();
  const { shape } = useMenuShape();
  return (
    <div role="status" aria-busy="true" data-outline="shell" className="flex min-h-svh">
      <span className="sr-only">{t('app.loading')}</span>
      <div
        className={cn(
          'hidden shrink-0 bg-sidebar sm:block',
          shape === 'rail' ? 'w-[72px]' : 'w-60',
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-16 border-b bg-top-bar" />
        <div className="grid content-start gap-3 p-8 max-sm:p-4">
          <Bar className="h-8 w-64" />
          <Bar className="h-4 w-full max-w-prose" />
          <Bar className="h-4 w-2/3 max-w-prose" />
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 h-16 bg-sidebar sm:hidden" />
    </div>
  );
}

/**
 * Shown while a page before the app waits (sign-in and its steps): the outline
 * of their frame, the form column and the navy panel (hidden at phone width).
 */
export function AuthPendingPage() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-busy="true" data-outline="sign-in" className="flex min-h-svh bg-card">
      <span className="sr-only">{t('app.loading')}</span>
      <div className="flex flex-1 items-center justify-center p-8 max-sm:p-4">
        <div className="grid w-full max-w-100 gap-4">
          <Bar className="h-10 w-48" />
          <Bar className="h-12 w-full" />
          <Bar className="h-12 w-full" />
        </div>
      </div>
      <div className="hidden w-[42%] max-w-160 min-w-0 bg-sidebar sm:block" />
    </div>
  );
}

/** A full-page error drawn inside the layout's `main`. */
function InLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto grid max-w-5xl content-start">{children}</div>;
}

/** A full-page error on the canvas: the brand moment of the design system. */
function FullPage({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto grid max-w-5xl content-start p-8 max-sm:p-4">{children}</main>;
}

/**
 * A page that could not be opened: what happened and what to do next
 * (docs/design-system.md, Brand moments, Full-page error). A refusal of the
 * role is the "no access" page.
 */
export function ErrorPage({ error }: ErrorComponentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const toHome = (
    <Link to="/" className={buttonVariants({ variant: 'ghost' })}>
      {t('problems.toHome')}
    </Link>
  );
  if (error instanceof ApiFailure && error.code === 'permission_denied') {
    return <NoAccessPage />;
  }
  return (
    <FullPage>
      <BrandMoment
        heading="h1"
        title={t('problems.title')}
        text={failureText(t, error)}
        alert
        action={
          <Button
            onClick={() => {
              void router.invalidate();
            }}
          >
            {t('problems.retry')}
          </Button>
        }
        secondAction={toHome}
      />
    </FullPage>
  );
}

/**
 * The full-page "no access" screen: a page the role may not open (task 2.7a,
 * finding 4: "Try again" cannot help a refusal of the role).
 */
export function NoAccessPage({ inLayout = false }: { inLayout?: boolean }) {
  const { t } = useTranslation();
  // Inside the layout the page already stands in its `main`, with its padding.
  const Frame = inLayout ? InLayout : FullPage;
  return (
    <Frame>
      <BrandMoment
        heading="h1"
        title={t('problems.noAccessTitle')}
        text={t('problems.noAccessText')}
        action={
          <Link to="/" className={buttonVariants()}>
            {t('problems.toHome')}
          </Link>
        }
      />
    </Frame>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <FullPage>
      <BrandMoment
        heading="h1"
        title={t('problems.notFoundTitle')}
        text={t('problems.notFoundText')}
        action={
          <Link to="/" className={buttonVariants()}>
            {t('problems.toHome')}
          </Link>
        }
      />
    </FullPage>
  );
}
