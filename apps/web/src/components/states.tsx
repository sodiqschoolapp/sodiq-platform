import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { failureText } from '@/api/failure-text';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

interface EmptyStateProps {
  /** What the page is for. */
  text: string;
  /** The first action, for a person who may take it. */
  action?: ReactNode;
}

/**
 * docs/spec/12-ux-standards.md, Look and feel: "Empty pages say what the page
 * is for and offer the first action."
 */
export function EmptyState({ text, action }: EmptyStateProps) {
  return (
    <div className="grid justify-items-start gap-3 rounded-lg border border-dashed p-6">
      <p className="max-w-prose text-muted-foreground">{text}</p>
      {action}
    </div>
  );
}

/**
 * "Loading shows the page outline at once, then the data." For a part of a
 * page that is not a list; a list draws its own outline with its row height.
 */
export function LoadingOutline({ lines = 3 }: { lines?: number }) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-busy="true" className="grid gap-3">
      <span className="sr-only">{t('app.loading')}</span>
      {Array.from({ length: lines }, (_, line) => (
        <Skeleton key={line} className={line === 0 ? 'h-5 w-2/3 max-w-prose' : 'h-5 max-w-prose'} />
      ))}
    </div>
  );
}

interface ErrorStateProps {
  error: unknown;
  /** Asks again for what failed. */
  onRetry?: () => void;
}

/** "Error messages say what happened and what to do next." */
export function ErrorState({ error, onRetry }: ErrorStateProps) {
  const { t } = useTranslation();
  return (
    <div className="grid justify-items-start gap-3">
      <p role="alert">{failureText(t, error)}</p>
      {onRetry !== undefined && <Button onClick={onRetry}>{t('problems.retry')}</Button>}
    </div>
  );
}
