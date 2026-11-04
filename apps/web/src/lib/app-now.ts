/**
 * The platform's "now" in the browser (task 10.5): the browser's clock plus the demo offset of
 * the test environment, so that a date a page fills in by itself (this week, today) is the demo
 * date. The offset comes with the top bar's period (`demoNow`, the moment the server's clock
 * showed when it answered, less the moment the answer arrived); it is 0 where the demo clock is
 * off, which is everywhere but the test environment.
 */
let demoOffsetMs = 0;

/** Keeps the offset of a `demoNow` that arrived at `receivedAt`; `null` is no demo clock. */
export function keepDemoNow(demoNow: string | null, receivedAt: number = Date.now()): void {
  demoOffsetMs = demoNow === null ? 0 : Date.parse(demoNow) - receivedAt;
}

/** The browser's clock plus the demo offset. */
export function appNow(): Date {
  return new Date(Date.now() + demoOffsetMs);
}
