import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { failureText } from '@/api/failure-text';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PANEL } from '@/components/ui/control';
import { HexagonDrawing } from '@/components/brand/hexagons';

interface EmptyStateProps {
  /**
   * What is missing, for an empty page: with a title the empty state is the
   * brand moment. Without one it is a quiet line in a part of a page (a
   * popover, a section; pull request #61, decision 1).
   */
  title?: string | undefined;
  /** What the page is for. */
  text: string;
  /** The first action, for a person who may take it: a primary button. */
  action?: ReactNode;
  /** At most one quiet second action. */
  secondAction?: ReactNode;
}

/**
 * The brand moment of an empty page or a full-page error
 * (docs/design-system.md, Brand moments, Empty page): in a white panel, a
 * Bitter title, one short line, the actions, and the hexagon drawing at the
 * right, hidden at phone width.
 */
export function BrandMoment({
  title,
  text,
  action,
  secondAction,
  heading = 'h2',
  alert = false,
}: Required<Pick<EmptyStateProps, 'title' | 'text'>> &
  Pick<EmptyStateProps, 'action' | 'secondAction'> & {
    heading?: 'h1' | 'h2';
    /** The line says what went wrong: read out as an alert. */
    alert?: boolean;
  }) {
  const Heading = heading;
  return (
    <div className={`flex items-center justify-between gap-8 ${PANEL}`}>
      <div className="grid max-w-prose justify-items-start gap-3">
        <Heading className="font-brand text-[1.75rem]/[2.125rem] font-bold sm:text-[2.5rem]/[2.75rem]">
          {title}
        </Heading>
        <p {...(alert ? { role: 'alert' } : {})} className="text-muted-foreground">
          {text}
        </p>
        {(action !== undefined || secondAction !== undefined) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {action}
            {secondAction}
          </div>
        )}
      </div>
      <HexagonDrawing className="max-sm:hidden" />
    </div>
  );
}

/**
 * docs/spec/12-ux-standards.md, Look and feel: "Empty pages say what the page
 * is for and offer the first action."
 */
export function EmptyState({ title, text, action, secondAction }: EmptyStateProps) {
  if (title !== undefined) {
    return <BrandMoment title={title} text={text} action={action} secondAction={secondAction} />;
  }
  return (
    <div className="grid justify-items-start gap-3">
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

/**
 * "Error messages say what happened and what to do next." A refusal of the
 * role says so with no "Try again", which cannot help (issue #39, hand test of
 * 13 October 2026, finding 4).
 */
export function ErrorState({ error, onRetry }: ErrorStateProps) {
  const { t } = useTranslation();
  const refused = error instanceof ApiFailure && error.code === 'permission_denied';
  return (
    <div className="grid justify-items-start gap-3">
      <p role="alert">{refused ? t('problems.noAccessText') : failureText(t, error)}</p>
      {onRetry !== undefined && !refused && (
        <Button onClick={onRetry}>{t('problems.retry')}</Button>
      )}
    </div>
  );
}
