import { Injectable, Logger, type BeforeApplicationShutdown } from '@nestjs/common';
import { reportFault } from '../../reporting/reporting.js';

/** How long the shutdown of the process waits for answers still being written (plan decision 3). */
export const SHUTDOWN_WAIT_MS = 25_000;

/**
 * The answers being written in this process (task 11.16; `02`, While it works: "The person can go
 * on with other work: closing the panel or leaving the page loses nothing"). A question's work
 * runs here after its request answered, whatever the browser does; it is not a job of the queue,
 * because its reads go through the API's own routes with the person's session (plan decision 3,
 * Look first). A work that throws is logged by its error's name only and reported; it never
 * rejects unhandled. The shutdown waits for the works for a while; one cut off then leaves its
 * question with no answer, which shows "No answer came" once its window is past.
 */
@Injectable()
export class AssistantWork implements BeforeApplicationShutdown {
  private readonly logger = new Logger('Assistant');
  private readonly running = new Set<Promise<void>>();

  /** Starts a work now; the caller does not wait for it. */
  run(work: () => Promise<void>): void {
    const promise: Promise<void> = Promise.resolve()
      .then(work)
      .catch((error: unknown) => {
        // The error's name only: its message can quote the question or a read.
        this.logger.error(
          `An answer of the assistant failed: ${error instanceof Error ? error.name : 'unknown error'}`,
        );
        reportFault(error, { part: 'assistant' });
      })
      .finally(() => {
        this.running.delete(promise);
      });
    this.running.add(promise);
  }

  /** The number of works running. */
  get size(): number {
    return this.running.size;
  }

  /** Settles once no work runs, also those a work started. For the tests and the shutdown. */
  async whenIdle(): Promise<void> {
    while (this.running.size > 0) {
      await Promise.allSettled([...this.running]);
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (this.running.size === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.whenIdle(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SHUTDOWN_WAIT_MS);
        timer.unref();
      }),
    ]);
    clearTimeout(timer);
  }
}
