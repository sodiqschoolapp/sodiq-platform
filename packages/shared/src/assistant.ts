import { z } from 'zod';
import { MENU_ITEMS } from './menu.js';
import type { Role } from './roles.js';

/**
 * The assistant (docs/spec/02-roles-and-access.md, Assistant; task 11.12, pull request #374):
 * a person works by writing in plain words; the assistant reads through the platform's own
 * actions, with the person's session and chosen role, on a list fixed in code per role.
 */

/** `02`: "It is given to the Super Admin, the Academic Vice Principal and the Teacher". */
export const ASSISTANT_ROLES = [
  'super_admin',
  'academic_vice_principal',
  'teacher',
] as const satisfies readonly Role[];

export type AssistantRole = (typeof ASSISTANT_ROLES)[number];

export const assistantRoleSchema = z.enum(ASSISTANT_ROLES);

export function isAssistantRole(role: string): role is AssistantRole {
  return (ASSISTANT_ROLES as readonly string[]).includes(role);
}

/**
 * The two headers of a read the assistant makes as the person (plan decision 6): the secret of
 * the server process, which no browser knows, and the chosen role, to which the request's rights
 * are narrowed. Both only narrow what the session may do.
 */
export const ASSISTANT_CALL_HEADER = 'X-Assistant-Call';
export const ASSISTANT_ROLE_HEADER = 'X-Assistant-Role';

/** The longest question (plan, `POST /api/assistant/questions`). */
export const ASSISTANT_QUESTION_MAX_LENGTH = 2000;

/** `02`, Audit: "90 days after its last message a conversation is archived". */
export const ASSISTANT_ARCHIVE_DAYS = 90;

/** The bounds of the daily limit per person (plan decision 10; the check of 0178). */
export const ASSISTANT_DAILY_LIMIT_MIN = 1;
export const ASSISTANT_DAILY_LIMIT_MAX = 500;
export const ASSISTANT_DAILY_LIMIT_DEFAULT = 30;

/** The bounds of the monthly cap in whole dollars; `02`: "$300 at the start". */
export const ASSISTANT_CAP_MIN_DOLLARS = 1;
export const ASSISTANT_CAP_MAX_DOLLARS = 100_000;
export const ASSISTANT_CAP_DEFAULT_DOLLARS = 300;

/** The time zone of the school day of the daily limit and of the month of the cap (decision 10). */
export const ASSISTANT_TIME_ZONE = 'Asia/Tashkent';

/**
 * The groups a read belongs to, so that the panel names what was read in plain words
 * ("Read: Classes and groups") in the person's language.
 */
export const ASSISTANT_READ_GROUPS = [
  'setup',
  'calendar',
  'staff',
  'students',
  'classes',
  'timetable',
  'journal',
  'plans',
  'results',
  'announcements',
  'search',
] as const;

export type AssistantReadGroup = (typeof ASSISTANT_READ_GROUPS)[number];

export const assistantReadGroupSchema = z.enum(ASSISTANT_READ_GROUPS);

/** Why the panel cannot take a question now (`02`, Limits). */
export const ASSISTANT_REFUSALS = [
  'assistant_off',
  'assistant_daily_limit',
  'assistant_cap_reached',
  'assistant_model_unavailable',
] as const;

export type AssistantRefusal = (typeof ASSISTANT_REFUSALS)[number];

const moment = z.iso.datetime({ offset: true });

export const assistantStatusQuerySchema = z.strictObject({ role: assistantRoleSchema });

export type AssistantStatusQuery = z.infer<typeof assistantStatusQuerySchema>;

export const assistantStatusSchema = z.object({
  /** True when a question would be taken now. */
  available: z.boolean(),
  refusal: z.enum(ASSISTANT_REFUSALS).nullable(),
  /** Questions the person may still ask today, every branch together. */
  questionsLeftToday: z.int().nonnegative(),
});

export type AssistantStatus = z.infer<typeof assistantStatusSchema>;

export const assistantQuestionSchema = z.strictObject({
  role: assistantRoleSchema,
  /** Left out: a new conversation. */
  conversationId: z.uuid().optional(),
  text: z.string().trim().min(1).max(ASSISTANT_QUESTION_MAX_LENGTH),
});

export type AssistantQuestion = z.infer<typeof assistantQuestionSchema>;

const messageBase = { id: z.uuid(), seq: z.int().positive(), at: moment };

/** One message of a conversation, as the person and the Super Admin read it. */
export const assistantMessageSchema = z.discriminatedUnion('kind', [
  z.object({ ...messageBase, kind: z.literal('question'), text: z.string() }),
  z.object({
    ...messageBase,
    kind: z.literal('answer'),
    text: z.string(),
    /** Pages the answer links: menu items of the conversation's role. */
    pages: z.array(z.enum(MENU_ITEMS)),
  }),
  z.object({
    ...messageBase,
    kind: z.literal('read'),
    /** `null`: the model asked for something not open to it, and nothing was read. */
    group: assistantReadGroupSchema.nullable(),
    /** The HTTP status the platform answered, or 0 when the read was not sent. */
    status: z.int().nonnegative(),
  }),
  z.object({ ...messageBase, kind: z.literal('notice'), code: z.enum(ASSISTANT_REFUSALS) }),
]);

export type AssistantMessage = z.infer<typeof assistantMessageSchema>;

/** A conversation in the person's list. */
export const assistantConversationSummarySchema = z.object({
  id: z.uuid(),
  branchId: z.uuid(),
  branchName: z.string(),
  role: assistantRoleSchema,
  title: z.string(),
  createdAt: moment,
  lastActivityAt: moment,
});

export type AssistantConversationSummary = z.infer<typeof assistantConversationSummarySchema>;

export const assistantConversationListSchema = z.object({
  conversations: z.array(assistantConversationSummarySchema),
});

export type AssistantConversationList = z.infer<typeof assistantConversationListSchema>;

/** Task 11.13: the header naming the step of a proposal that a change runs for. */
export const ASSISTANT_STEP_HEADER = 'X-Assistant-Step';

/** At most this many steps in one proposal (plan decision 8). */
export const ASSISTANT_MAX_STEPS = 10;

/** How long a proposal may be confirmed (`02`: "not confirmed within 15 minutes expires"). */
export const ASSISTANT_PROPOSAL_MINUTES = 15;

/** The state of a proposal, read from its stored moments and decision (plan decisions 8, 17). */
export const ASSISTANT_PROPOSAL_STATES = [
  'waiting',
  'confirmed',
  'declined',
  'expired',
  'superseded',
] as const;

export type AssistantProposalState = (typeof ASSISTANT_PROPOSAL_STATES)[number];

/**
 * The state of a step: `waiting` before Confirm; `unknown` when Confirm started it and no outcome
 * was stored (a crash: plan decision 10).
 */
export const ASSISTANT_STEP_STATES = [
  'waiting',
  'done',
  'refused',
  'outdated',
  'not_run',
  'unknown',
] as const;

export type AssistantStepState = (typeof ASSISTANT_STEP_STATES)[number];

/** A field of a step's request, as the panel shows it: the value as text. */
export const assistantStepFieldSchema = z.object({ name: z.string(), value: z.string() });

/** A lesson a step's preview names, in plain words (`edge/people-roles-accounts`, first row). */
export const assistantPreviewLessonSchema = z.object({
  /** The list of the preview it is in (`cancel`, `withData`, `held` …). */
  list: z.string(),
  date: z.string(),
  /** Clock minutes of the day in branch time. */
  start: z.int().nonnegative(),
  unitName: z.string(),
  subjectNames: z.object({ uz: z.string(), ru: z.string(), en: z.string() }).nullable(),
  teacherName: z.string().nullable(),
  roomName: z.string().nullable(),
  /** The lesson already holds attendance or marks (the bulk cancel's `withData`). */
  hasData: z.boolean(),
  /**
   * What the step sends for this lesson where the person chooses (a lesson with data, a shared
   * block of a bulk cancel): "keep" (as held) or "cancel"; `null` where nothing is chosen.
   */
  choice: z.enum(['keep', 'cancel']).nullable(),
});

export type AssistantPreviewLesson = z.infer<typeof assistantPreviewLessonSchema>;

export const assistantStepSchema = z.object({
  id: z.uuid(),
  seq: z.int().positive(),
  /** The operation of the route, the key of its name in the panel's texts. */
  action: z.string(),
  group: assistantReadGroupSchema,
  /** The model's own sentence, shown beside the platform's words, never instead (decision 5). */
  summary: z.string(),
  /** The record the step changes, by the name its basis read gives, or `null`. */
  recordName: z.string().nullable(),
  /** The same in the three languages when the record is named so (a subject). */
  recordNames: z.object({ uz: z.string(), ru: z.string(), en: z.string() }).nullable(),
  /** The warnings and blocks of the step's check or preview, by code (plan decision 6). */
  previewIssues: z.array(z.object({ kind: z.enum(['warning', 'blocked']), code: z.string() })),
  /** How many entries each list of the preview holds (its impact beyond lessons). */
  previewCounts: z.array(z.object({ list: z.string(), count: z.int().nonnegative() })),
  fields: z.array(assistantStepFieldSchema),
  /** The lessons of the step's preview, and how many more it names. */
  previewLessons: z.array(assistantPreviewLessonSchema),
  previewMore: z.int().nonnegative(),
  state: z.enum(ASSISTANT_STEP_STATES),
  /** The HTTP status of the step's route, 0 when not sent or not run. */
  status: z.int().nonnegative(),
  /** The refusal code when refused or outdated. */
  code: z.string().nullable(),
});

export type AssistantStep = z.infer<typeof assistantStepSchema>;

export const assistantProposalSchema = z.object({
  id: z.uuid(),
  /** The question the proposal answers. */
  questionId: z.uuid(),
  createdAt: moment,
  expiresAt: moment,
  state: z.enum(ASSISTANT_PROPOSAL_STATES),
  decidedAt: moment.nullable(),
  steps: z.array(assistantStepSchema),
});

export type AssistantProposal = z.infer<typeof assistantProposalSchema>;

/** Confirm or Decline, in the role chosen in the tab (`02`: "with the person's session and chosen role"). */
export const assistantDecisionSchema = z.strictObject({ role: assistantRoleSchema });

export type AssistantDecision = z.infer<typeof assistantDecisionSchema>;

export const assistantConversationSchema = assistantConversationSummarySchema.extend({
  archived: z.boolean(),
  /** When it is archived, or will be without a new question or a restore. */
  archivesAt: moment,
  messages: z.array(assistantMessageSchema),
  /** Task 11.13: the proposals of the conversation, oldest first. */
  proposals: z.array(assistantProposalSchema),
});

export type AssistantConversation = z.infer<typeof assistantConversationSchema>;

export const assistantConversationParamsSchema = z.strictObject({ id: z.uuid() });

export type AssistantConversationParams = z.infer<typeof assistantConversationParamsSchema>;

/** What a question answers: the conversation with its new messages. */
export const assistantAnswerSchema = z.object({
  conversation: assistantConversationSchema,
});

export type AssistantAnswer = z.infer<typeof assistantAnswerSchema>;

/** A conversation in the Super Admin's list of every conversation. */
export const assistantAnyConversationSchema = assistantConversationSummarySchema.extend({
  archived: z.boolean(),
  /** "Last first", as the audit log names its actors. */
  personName: z.string(),
});

export type AssistantAnyConversation = z.infer<typeof assistantAnyConversationSchema>;

export const assistantAllConversationsQuerySchema = z.strictObject({
  archived: z.enum(['true', 'false']).optional(),
});

export type AssistantAllConversationsQuery = z.infer<typeof assistantAllConversationsQuerySchema>;

export const assistantAllConversationsSchema = z.object({
  conversations: z.array(assistantAnyConversationSchema),
});

export type AssistantAllConversations = z.infer<typeof assistantAllConversationsSchema>;

export const assistantAnyConversationDetailSchema = assistantConversationSchema.extend({
  /** "Last first", as the audit log names its actors. */
  personName: z.string(),
});

export type AssistantAnyConversationDetail = z.infer<typeof assistantAnyConversationDetailSchema>;

/** What the Super Admin sets (`02`: "switch it off for the whole school or for one of the three roles"; Limits). */
export const assistantSettingsRecordSchema = z.strictObject({
  schoolOn: z.boolean(),
  rolesOn: z
    .array(assistantRoleSchema)
    .max(ASSISTANT_ROLES.length)
    .refine((roles) => new Set(roles).size === roles.length, { message: 'Each role once.' }),
  dailyLimit: z.int().min(ASSISTANT_DAILY_LIMIT_MIN).max(ASSISTANT_DAILY_LIMIT_MAX),
  monthlyCapDollars: z.int().min(ASSISTANT_CAP_MIN_DOLLARS).max(ASSISTANT_CAP_MAX_DOLLARS),
});

export type AssistantSettingsRecord = z.infer<typeof assistantSettingsRecordSchema>;

export const assistantSettingsSchema = assistantSettingsRecordSchema.extend({
  /** The roles the permission table gives the panel now: the switches the page shows. */
  roles: z.array(assistantRoleSchema),
  /** This calendar month's spend in Asia/Tashkent, in whole cents rounded down (display only). */
  spentThisMonthCents: z.int().nonnegative(),
  /** Whether the server has a model to call, and which. */
  modelConfigured: z.boolean(),
  model: z.string().nullable(),
});

export type AssistantSettings = z.infer<typeof assistantSettingsSchema>;
