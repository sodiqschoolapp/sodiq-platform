import { z } from 'zod';
import { roleSchema } from './roles.js';

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

/**
 * The Feedback reports page of the Super Admin (pull request #361; owner, 19 November 2026):
 * every new report, and the newest `FEEDBACK_HANDLED_LISTED` handled ones, so a new report is
 * never out of reach whatever its age.
 */
export const FEEDBACK_HANDLED_LISTED = 1000;

const reader = z.object({
  id: z.uuid(),
  /** The staff name of the account in any branch; empty when the account has no staff record. */
  name: z.string(),
});

/** One report as the page shows it. */
export const feedbackReportEntrySchema = z.object({
  id: z.uuid(),
  sender: reader,
  /** The roles of the session that sent it, each once, in the order of `ROLES`. */
  roles: z.array(roleSchema),
  page: z.string(),
  text: z.string(),
  /** The version of the page that sent it, when the request named one. */
  appVersion: z.int().min(0).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  /** When and by whom the report was marked handled; both null for a new report. */
  handledAt: z.iso.datetime({ offset: true }).nullable(),
  handledBy: reader.nullable(),
});

export type FeedbackReportEntry = z.infer<typeof feedbackReportEntrySchema>;

export const feedbackReportListSchema = z.object({
  /** Newest first. */
  entries: z.array(feedbackReportEntrySchema),
  /** True when more handled reports exist than the newest `FEEDBACK_HANDLED_LISTED` answered. */
  handledTruncated: z.boolean(),
});

export type FeedbackReportList = z.infer<typeof feedbackReportListSchema>;

export const feedbackReportParamsSchema = z.strictObject({ id: z.uuid() });

export type FeedbackReportParams = z.infer<typeof feedbackReportParamsSchema>;
