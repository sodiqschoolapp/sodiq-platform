import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
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

/**
 * The bounds of the daily limit per person (the check of 0184); 0 is "none" (task 11.21; `02`,
 * Limits: "requests per person per day (none at the start)").
 */
export const ASSISTANT_DAILY_LIMIT_MIN = 0;
export const ASSISTANT_DAILY_LIMIT_MAX = 500;
export const ASSISTANT_DAILY_LIMIT_DEFAULT = 0;

/**
 * Task 11.21 (`02`, Limits; plan decision 4): reads and changes in one question, changes in one
 * proposal and the minutes of one question, with the bounds of the checks of 0184.
 */
export const ASSISTANT_QUESTION_ACTIONS_MIN = 1;
export const ASSISTANT_QUESTION_ACTIONS_MAX = 200;
export const ASSISTANT_QUESTION_ACTIONS_DEFAULT = 40;
export const ASSISTANT_PROPOSAL_STEPS_MIN = 1;
export const ASSISTANT_PROPOSAL_STEPS_MAX = 200;
export const ASSISTANT_PROPOSAL_STEPS_DEFAULT = 100;
export const ASSISTANT_QUESTION_MINUTES_MIN = 1;
export const ASSISTANT_QUESTION_MINUTES_MAX = 30;
export const ASSISTANT_QUESTION_MINUTES_DEFAULT = 10;

/**
 * The answer window of a question is its time limit and this margin (task 11.21, plan decision 5;
 * 240 s and 30 s before), stored with the question (`answer_until`).
 */
export const ASSISTANT_ANSWER_MARGIN_MS = 30_000;

/** The window of a question stored before 0184, which has no `answer_until` (task 11.16). */
export const ASSISTANT_LEGACY_WINDOW_MS = 270_000;

/** Task 11.21 (plan decision 12): the choices of a question the assistant asks. */
export const ASSISTANT_CHOICES_MIN = 2;
export const ASSISTANT_CHOICES_MAX = 8;
export const ASSISTANT_CHOICE_MAX_LENGTH = 80;

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
  /** Task 11.15: the model is busy or did not answer in time, after its retries and fallback. */
  'assistant_model_busy',
] as const;

export type AssistantRefusal = (typeof ASSISTANT_REFUSALS)[number];

/**
 * The notices a question can end in, stored in the conversation (task 11.16): the model busy or
 * out of reach, as in 11.15, or the work failed on the server for another reason.
 */
export const ASSISTANT_NOTICES = [
  'assistant_model_unavailable',
  'assistant_model_busy',
  'assistant_answer_failed',
  /** Task 11.21: the monthly cap was reached while the question was answered. */
  'assistant_cap_reached',
] as const;

export type AssistantNotice = (typeof ASSISTANT_NOTICES)[number];

const moment = z.iso.datetime({ offset: true });

export const assistantStatusQuerySchema = z.strictObject({ role: assistantRoleSchema });

export type AssistantStatusQuery = z.infer<typeof assistantStatusQuerySchema>;

export const assistantStatusSchema = z.object({
  /** True when a question would be taken now. */
  available: z.boolean(),
  refusal: z.enum(ASSISTANT_REFUSALS).nullable(),
  /** Questions the person may still ask today, every branch together; `null`: no daily limit. */
  questionsLeftToday: z.int().nonnegative().nullable(),
});

export type AssistantStatus = z.infer<typeof assistantStatusSchema>;

/** A search value of an address: a text, or the filters of a list (`f`, a key to a value). */
const placeValueSchema = z.union([
  z.string().max(200),
  z
    .record(z.string().max(40), z.string().max(100))
    .refine((value) => Object.keys(value).length <= 12),
]);

/**
 * Task 11.19 (`02`, Assistant, "Knows where the person is"): the page the person asks from, as
 * the router names it (`/journal/$journalId`), with its path parameters and search values. The
 * engine keeps only what the map of the platform records for that page (plan, review must fix 1;
 * note 8); a page it does not know is left out (plan decision 7).
 */
export const assistantPlaceSchema = z.strictObject({
  page: z.string().min(1).max(200),
  params: z
    .record(z.string().max(40), z.string().max(100))
    .refine((value) => Object.keys(value).length <= 4)
    .optional(),
  search: z
    .record(z.string().max(40), placeValueSchema)
    .refine((value) => Object.keys(value).length <= 12)
    .optional(),
});

export type AssistantPlace = z.infer<typeof assistantPlaceSchema>;

export const assistantQuestionSchema = z
  .strictObject({
    role: assistantRoleSchema,
    /** Left out: a new conversation. */
    conversationId: z.uuid().optional(),
    text: z.string().trim().min(1).max(ASSISTANT_QUESTION_MAX_LENGTH),
    /** Task 11.19: the page the question is asked from; none from the Assistant page. */
    place: assistantPlaceSchema.optional(),
    /**
     * Task 11.21 (`02`, Answers: "offers Continue"): the next part of the newest answer, which a
     * limit cut; only in a conversation (review of the plan, should fix 6).
     */
    continue: z.literal(true).optional(),
  })
  .refine((question) => question.continue !== true || question.conversationId !== undefined, {
    message: 'Continue goes on in a conversation.',
    path: ['conversationId'],
  });

export type AssistantQuestion = z.infer<typeof assistantQuestionSchema>;

const messageBase = { id: z.uuid(), seq: z.int().positive(), at: moment };

/**
 * Task 11.14 (plan decision 1, Look first): a link to the journal column of one lesson
 * (`edge/people-roles-accounts`, The assistant: "A Teacher asks the assistant to mark everyone
 * present. Refused: journal data is never entered through the assistant. It opens the lesson's
 * journal column"). Given only for a lesson whose card the person's own read answered.
 */
export const assistantLessonLinkSchema = z.object({
  journalId: z.uuid(),
  quarterId: z.uuid(),
  date: schoolDateSchema,
});

export type AssistantLessonLink = z.infer<typeof assistantLessonLinkSchema>;

/**
 * Task 11.19 (build plan item 4; plan review, correction 3): a link of an answer to the exact
 * place, a page of the map with its path parameters and search values, each checked by
 * `link_place` against the map before it is stored. The web draws it with the router's `Link`
 * (`to`, `params`, `search`), never as a typed address.
 */
export const assistantPlaceLinkSchema = z.object({
  /** The map's id of the page or control linked. */
  nodeId: z.string(),
  /** The route's template, `/people/students`. */
  to: z.string(),
  params: z.record(z.string(), z.string()),
  search: z.record(z.string(), z.union([z.string(), z.record(z.string(), z.string())])),
  /** The name the link shows: the page's title, or the control's label, in three languages. */
  label: z.object({ uz: z.string(), ru: z.string(), en: z.string() }),
});

export type AssistantPlaceLink = z.infer<typeof assistantPlaceLinkSchema>;

/** One message of a conversation, as the person and the Super Admin read it. */
export const assistantMessageSchema = z.discriminatedUnion('kind', [
  z.object({
    ...messageBase,
    kind: z.literal('question'),
    text: z.string(),
    /** Task 11.21: Continue was pressed (the next part of a cut answer). */
    continued: z.boolean().default(false),
    /** Task 11.21: an Undo of this proposal, asked with its button. */
    undoOf: z.uuid().nullable().default(null),
  }),
  z.object({
    ...messageBase,
    kind: z.literal('answer'),
    text: z.string(),
    /** Pages the answer links: menu items of the conversation's role (11.12 to 11.18). */
    pages: z.array(z.enum(MENU_ITEMS)),
    /** Task 11.19: the places the answer links; none in an answer stored before 11.19. */
    links: z.array(assistantPlaceLinkSchema).default([]),
    /** Lessons whose journal column the answer opens (task 11.14); none before 11.14. */
    lessons: z.array(assistantLessonLinkSchema),
    /** Task 11.21: a limit cut the work; the answer offers Continue. */
    continues: z.boolean().default(false),
    /** Task 11.21: the options of the question the assistant asks, drawn as buttons. */
    choices: z.array(z.string()).default([]),
    /**
     * Task 11.21: the answer of an Undo: the proposal undone, and each change of it that has no
     * reverse proposed, with the reason (`no_reverse`, `action_off`, `over_step_limit`, or the
     * refusal code of its drafting).
     */
    undo: z
      .object({
        proposalId: z.uuid(),
        none: z.array(
          z.object({
            seq: z.int().positive(),
            action: z.string(),
            summary: z.string(),
            reason: z.string(),
          }),
        ),
      })
      .nullable()
      .default(null),
  }),
  z.object({
    ...messageBase,
    kind: z.literal('read'),
    /** `null`: the model asked for something not open to it, and nothing was read. */
    group: assistantReadGroupSchema.nullable(),
    /** The HTTP status the platform answered, or 0 when the read was not sent. */
    status: z.int().nonnegative(),
  }),
  z.object({ ...messageBase, kind: z.literal('notice'), code: z.enum(ASSISTANT_NOTICES) }),
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
   * What Confirm does to this lesson where the person chooses (a lesson with data, a shared block
   * of a bulk cancel): `keep` (kept as held, the data choice), `cancel`, or `held` (a lesson of a
   * shared block kept for the other classes); `null` where nothing is chosen.
   */
  choice: z.enum(['keep', 'cancel', 'held']).nullable(),
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
  /**
   * Task 11.20 (build plan: "The proposal of many entries of one kind (attendance for a lesson)
   * shows them as one grouped step list"): each entry of the step, by the student it names
   * (`null` when the student is not one of the lesson's), with what is entered.
   */
  entries: z.array(z.object({ name: z.string().nullable(), value: z.string() })),
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

/** Task 11.21: Undo of a confirmed proposal, in the role chosen in the tab. */
export const assistantUndoSchema = z.strictObject({ role: assistantRoleSchema });

export type AssistantUndo = z.infer<typeof assistantUndoSchema>;

export const assistantConversationSchema = assistantConversationSummarySchema.extend({
  archived: z.boolean(),
  /** When it is archived, or will be without a new question or a restore. */
  archivesAt: moment,
  messages: z.array(assistantMessageSchema),
  /** Task 11.13: the proposals of the conversation, oldest first. */
  proposals: z.array(assistantProposalSchema),
  /**
   * Task 11.16: the question being answered now, read from its stored moment, or `null`. Past
   * `until` nothing more is written for it.
   */
  working: z.object({ questionId: z.uuid(), askedAt: moment, until: moment }).nullable(),
});

export type AssistantConversation = z.infer<typeof assistantConversationSchema>;

/**
 * Task 11.20 (`02`, Never, whatever the switches: "An action that gives one out still runs on
 * Confirm, and the secret is shown to the person in the conversation once, as the screen shows
 * it, never to the model and never stored in the conversation"): the secrets the steps of a
 * confirmed proposal gave out (a first-password slip, a key's secret), in this answer only.
 */
export const assistantStepSecretSchema = z.object({
  stepId: z.uuid(),
  /** Each object of the answer that held a secret, with its plain values (login, password, …). */
  items: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
});

export type AssistantStepSecret = z.infer<typeof assistantStepSecretSchema>;

/** The answer of Confirm: the conversation, and the secrets given out, once. */
export const assistantConfirmedSchema = assistantConversationSchema.extend({
  secrets: z.array(assistantStepSecretSchema),
});

export type AssistantConfirmed = z.infer<typeof assistantConfirmedSchema>;

export const assistantConversationParamsSchema = z.strictObject({ id: z.uuid() });

export type AssistantConversationParams = z.infer<typeof assistantConversationParamsSchema>;

/** What a question answers: the conversation with its new messages. */
export const assistantAnswerSchema = z.object({
  conversation: assistantConversationSchema,
});

export type AssistantAnswer = z.infer<typeof assistantAnswerSchema>;

/**
 * Task 11.16 (`02`, While it works): what the live connection tells the asking account's tabs
 * while a question is answered. Every message names the conversation and the question; the
 * reader shows only those of the conversation it shows. A read names its group and status,
 * never its data.
 */
export const ASSISTANT_MESSAGES = { progress: 'assistant.progress' } as const;

/** The longest piece of the answer's text in one message (under PostgreSQL's 8 000 bytes). */
export const ASSISTANT_TEXT_PIECE = 1_500;

export const assistantProgressSchema = z.object({
  conversationId: z.uuid(),
  questionId: z.uuid(),
  event: z.discriminatedUnion('kind', [
    /** The question is stored: other tabs read the conversation again. */
    z.object({ kind: z.literal('question') }),
    z.object({
      kind: z.literal('read'),
      group: assistantReadGroupSchema.nullable(),
      status: z.int().nonnegative(),
    }),
    /** A piece of the answer as it is written; `seq` counts from 1 after each reset. */
    z.object({
      kind: z.literal('text'),
      seq: z.int().positive(),
      delta: z.string().max(ASSISTANT_TEXT_PIECE),
    }),
    /** The text so far is dropped: a call tried again, or a turn that read instead of answering. */
    z.object({ kind: z.literal('reset') }),
    /** The answer, proposal or notice is stored: read the conversation again. */
    z.object({ kind: z.literal('done') }),
  ]),
});

export type AssistantProgress = z.infer<typeof assistantProgressSchema>;

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

/**
 * Task 11.20, the personal-data groups.
 * `02`, Personal data and the model: "contact (phones, emails, addresses), identity (passport,
 * ID and birth certificate numbers, JSHSHIR, dates of birth), financial (contracts,
 * scholarships, stipends), the diagnostic score, medical data, and relatives' details … All are
 * on at the start."
 */
export const ASSISTANT_DATA_GROUPS = [
  'contact',
  'identity',
  'financial',
  'diagnostic',
  'medical',
  'relatives',
] as const;

export type AssistantDataGroup = (typeof ASSISTANT_DATA_GROUPS)[number];

export const assistantDataGroupSchema = z.enum(ASSISTANT_DATA_GROUPS);

/** What the Super Admin sets (`02`: "switch it off for the whole school or for one of the three roles"; Limits). */
export const assistantSettingsRecordSchema = z.strictObject({
  schoolOn: z.boolean(),
  rolesOn: z
    .array(assistantRoleSchema)
    .max(ASSISTANT_ROLES.length)
    .refine((roles) => new Set(roles).size === roles.length, { message: 'Each role once.' }),
  dailyLimit: z.int().min(ASSISTANT_DAILY_LIMIT_MIN).max(ASSISTANT_DAILY_LIMIT_MAX),
  monthlyCapDollars: z.int().min(ASSISTANT_CAP_MIN_DOLLARS).max(ASSISTANT_CAP_MAX_DOLLARS),
  /** Task 11.15: the worldwide fallback (`02`, Where the model runs: "on until switched off"). */
  fallbackOn: z.boolean(),
  /** Task 11.21: reads and changes in one question (`02`, Limits: "40 at the start"). */
  questionActions: z
    .int()
    .min(ASSISTANT_QUESTION_ACTIONS_MIN)
    .max(ASSISTANT_QUESTION_ACTIONS_MAX),
  /** Task 11.21: changes in one proposal ("100 at the start"). */
  proposalSteps: z.int().min(ASSISTANT_PROPOSAL_STEPS_MIN).max(ASSISTANT_PROPOSAL_STEPS_MAX),
  /** Task 11.21: the minutes of one question ("10 minutes at the start"). */
  questionMinutes: z
    .int()
    .min(ASSISTANT_QUESTION_MINUTES_MIN)
    .max(ASSISTANT_QUESTION_MINUTES_MAX),
  /** Task 11.20: the personal-data groups that reach the model (`02`: "All are on at the start"). */
  dataGroupsOn: z
    .array(assistantDataGroupSchema)
    .max(ASSISTANT_DATA_GROUPS.length)
    .refine((groups) => new Set(groups).size === groups.length, { message: 'Each group once.' }),
});

export type AssistantSettingsRecord = z.infer<typeof assistantSettingsRecordSchema>;

export const assistantSettingsSchema = assistantSettingsRecordSchema.extend({
  /** The roles the permission table gives the panel now: the switches the page shows. */
  roles: z.array(assistantRoleSchema),
  /** This calendar month's spend in Asia/Tashkent, in whole cents rounded down (display only). */
  spentThisMonthCents: z.int().nonnegative(),
  /** Task 11.15: this calendar month's questions with a call through the worldwide endpoint. */
  fallbackQuestionsThisMonth: z.int().nonnegative(),
  /** Whether the server has a model to call, and which. */
  modelConfigured: z.boolean(),
  model: z.string().nullable(),
});

export type AssistantSettings = z.infer<typeof assistantSettingsSchema>;
