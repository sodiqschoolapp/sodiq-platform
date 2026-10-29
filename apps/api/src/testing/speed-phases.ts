import { performance } from 'node:perf_hooks';

/**
 * Task 10.1b: the speed run in two phases and its time. The Speed workflow builds the school in
 * one job (`SPEED_PHASE=build`), hands the database and the state of the run to a second job
 * (`SPEED_PHASE=measure`), and each job has GitHub's limit of its own; on a pull request both
 * phases run in one process (`both`).
 */
export type SpeedPhase = 'build' | 'measure' | 'both';

export function speedPhaseOf(value: string | undefined): SpeedPhase {
  return value === 'build' || value === 'measure' ? value : 'both';
}

/** A step not reached before the run's deadline: the run fails, it never passes unmeasured. */
export class OutOfTime extends Error {
  constructor(readonly step: string) {
    super(
      `Not measured: time. The run reached its deadline before "${step}"; that step and every step after it were not measured.`,
    );
    this.name = 'OutOfTime';
  }
}

/**
 * The moment a run stops itself, ahead of the Vitest limit, so that it writes its report and fails
 * with the steps it did not reach (a Vitest timeout ends the test without either).
 */
export class Deadline {
  constructor(
    private readonly endsAt: number,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Throws `OutOfTime` naming `step` once the deadline has passed. */
  check(step: string): void {
    if (this.now() >= this.endsAt) throw new OutOfTime(step);
  }

  /** Throws when less than `needMs` is left for `step` (a step of a known length, the load). */
  checkFor(step: string, needMs: number): void {
    if (this.now() + needMs >= this.endsAt) throw new OutOfTime(step);
  }
}
