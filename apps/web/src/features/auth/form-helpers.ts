import { useEffect, useState } from 'react';
import { ApiFailure } from '@/api/failure';

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
