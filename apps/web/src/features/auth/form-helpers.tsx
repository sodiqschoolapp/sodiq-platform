import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { failureText } from '@/api/failure-text';
import { Alert, AlertDescription } from '@/components/ui/alert';

/** The refusal or failure of a call, in the language of the person. Nothing while there is none. */
export function FailureAlert({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (error === null || error === undefined) {
    return null;
  }
  return (
    <Alert variant="destructive">
      <AlertDescription>{failureText(t, error)}</AlertDescription>
    </Alert>
  );
}

/**
 * Edge cases, "Accounts and sign-in": after five failures each further attempt
 * is delayed. True while the wait that the answer named (`Retry-After`) lasts;
 * the form keeps its button off until then.
 */
export function useWaiting(error: unknown): boolean {
  const seconds = error instanceof ApiFailure ? error.retryAfterSeconds : undefined;
  // The failure whose wait is over.
  const [over, setOver] = useState<unknown>(null);

  useEffect(() => {
    if (seconds === undefined) {
      return;
    }
    const timer = window.setTimeout(() => {
      setOver(error);
    }, seconds * 1000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [error, seconds]);

  return seconds !== undefined && over !== error;
}
