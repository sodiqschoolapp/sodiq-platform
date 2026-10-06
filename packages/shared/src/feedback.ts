import { z } from 'zod';

/**
 * A feedback report about the app (docs/spec/14-quality-plan.md, Whole system,
 * Monitoring: "A feedback button on every page sends a report with the page
 * and role attached"). The server adds the account and the roles of the
 * session; nothing here names either, so a body cannot claim a role.
 */

/** The longest text of a report. */
export const FEEDBACK_TEXT_MAX_LENGTH = 2000;

/** The longest path of a page a report names. */
export const FEEDBACK_PAGE_MAX_LENGTH = 500;

/**
 * How many reports one account may send within `FEEDBACK_WINDOW_MS`; the next
 * one is refused with `too_many_attempts` (decided by the owner, task 0.8b-3:
 * "at most 20 reports a day per account").
 */
export const FEEDBACK_REPORTS_PER_DAY = 20;

/** The "day" of the limit: the last 24 hours, counted from stored moments. */
export const FEEDBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The path of a page, without the query or the fragment (decided by the owner):
 * a search typed into a list is not part of a report.
 */
export const FEEDBACK_PAGE_FORMAT = /^\/[^?#]*$/;

export const feedbackReportSchema = z.object({
  /** The page the person was on, for example `/dev/patterns`. */
  page: z.string().regex(FEEDBACK_PAGE_FORMAT).max(FEEDBACK_PAGE_MAX_LENGTH),
  /** What the person wrote. Stored as trimmed. */
  text: z.string().trim().min(1).max(FEEDBACK_TEXT_MAX_LENGTH),
});

export type FeedbackReport = z.infer<typeof feedbackReportSchema>;
