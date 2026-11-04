import { z } from 'zod';

/**
 * The demo clock of the test environment (task 10.5, pull request #280; the owner, 4 November
 * 2026): the Super Admin moves the platform's "now" forward so that the role tutorials can show
 * what needs days to pass. Demo time is real time plus an offset that only grows; it runs only
 * where the server sets `DEMO_CLOCK=1`, which is the test environment alone.
 */

/** The largest jump, in days (decision 7): a school year and room to spare. */
export const DEMO_CLOCK_MAX_JUMP_DAYS = 400;

/** `GET /api/setup/demo-clock` and the answer of a jump. */
export const demoClockSchema = z.object({
  /** Whether the server runs the demo clock (`DEMO_CLOCK=1`). */
  enabled: z.boolean(),
  /** Real time at the server. */
  realNow: z.iso.datetime({ offset: true }),
  /** Demo time at the server: what every business rule sees. */
  demoNow: z.iso.datetime({ offset: true }),
  /** How far demo time is ahead of real time from `effectiveAt` on, in milliseconds. */
  offsetMs: z.int().min(0),
  /** The real moment the last jump took effect, or `null` before the first jump. */
  effectiveAt: z.iso.datetime({ offset: true }).nullable(),
  /** The real moment of the last jump, or `null` before the first. */
  changedAt: z.iso.datetime({ offset: true }).nullable(),
});

export type DemoClockState = z.infer<typeof demoClockSchema>;

/** `POST /api/setup/demo-clock/jumps`: the demo moment to move to, with its offset. */
export const demoClockJumpSchema = z.strictObject({
  to: z.iso.datetime({ offset: true }),
});

export type DemoClockJump = z.infer<typeof demoClockJumpSchema>;
