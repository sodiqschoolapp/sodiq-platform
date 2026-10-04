import { healthResponseSchema } from '@sodiq/shared';
import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';

type ApiStatus = 'checking' | 'reachable' | 'unreachable';

// Placeholder texts. They move to i18n keys in three languages in task 0.8a.
const STATUS_TEXT: Record<ApiStatus, string> = {
  checking: 'API: checking…',
  reachable: 'API: reachable',
  unreachable: 'API: not reachable',
};

async function checkApi(signal: AbortSignal): Promise<ApiStatus> {
  try {
    const { data } = await api.GET('/api/health', { signal });
    return healthResponseSchema.safeParse(data).success ? 'reachable' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

/** Placeholder page of task 0.1: shows that the web app can call the API. */
export function App() {
  const [status, setStatus] = useState<ApiStatus>('checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void checkApi(controller.signal).then((next) => {
      if (!controller.signal.aborted) setStatus(next);
    });
    return () => {
      controller.abort();
    };
  }, [attempt]);

  function checkAgain() {
    setStatus('checking');
    setAttempt((current) => current + 1);
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-start justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Sodiq School platform</h1>
      <p role="status" className="text-lg">
        {STATUS_TEXT[status]}
      </p>
      {status === 'unreachable' && (
        <p className="text-muted-foreground">
          The API did not answer. Start it with &quot;pnpm dev&quot;, then check again.
        </p>
      )}
      <Button onClick={checkAgain} disabled={status === 'checking'}>
        Check again
      </Button>
    </main>
  );
}
