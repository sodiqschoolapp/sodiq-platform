/**
 * The source of "now". Business code never reads the system clock; it is given
 * a clock, so a test can set the time (docs/spec/edge-cases/developer-rules.md,
 * Time-based state).
 */
export interface Clock {
  /** The present moment. Each call returns a new object. */
  now(): Date;
}
