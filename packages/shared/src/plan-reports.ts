import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { preparedStampSchema } from './prepared.js';
import {
  PLAN_FLAGS,
  PLAN_STATES,
  planMinimumMarkSchema,
  planQuarterSchema,
  planSubjectSchema,
  planUnitSchema,
} from './plans.js';

/**
 * The minimum works of a subject and the plan reports (task 8.8, pull request
 * #226; `09`, Reports; `edge/lesson-plans`, "A plan has 40 topics and not one
 * graded work": "Each subject can have a minimum number of classworks and
 * homeworks per quarter, set by the Academic Vice Principal. Falling below it
 * is a warning at the end of the window ... The progress report shows each
 * teacher's share of 'not held'.").
 */

/** A minimum is a typed whole number from 0 (no minimum) to 100 (decision 11). */
export const PLAN_MINIMUM_MAX = 100;

export const planMinimumsSchema = z.object({
  subjects: z.array(
    z.object({
      subject: planSubjectSchema,
      classworks: z.int().min(0).max(PLAN_MINIMUM_MAX),
      homeworks: z.int().min(0).max(PLAN_MINIMUM_MAX),
      /** `null` before the first save. */
      version: z.int().min(1).nullable(),
    }),
  ),
  /** The reader sets them (the Academic Vice Principal, the Super Admin). */
  canEdit: z.boolean(),
});

export type PlanMinimums = z.infer<typeof planMinimumsSchema>;

export const planMinimumSaveSchema = z.strictObject({
  subjectId: z.uuid(),
  classworks: z.int().min(0).max(PLAN_MINIMUM_MAX),
  homeworks: z.int().min(0).max(PLAN_MINIMUM_MAX),
  version: z.int().min(1).nullable(),
});

export type PlanMinimumSave = z.infer<typeof planMinimumSaveSchema>;

export const planReportQuerySchema = z.strictObject({
  quarterId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
  teacherId: z.uuid().optional(),
});

export type PlanReportQuery = z.infer<typeof planReportQuerySchema>;

const teacherSchema = z.object({ id: z.uuid(), name: z.string() }).nullable();
const namesSchema = z.object({ uz: z.string(), ru: z.string(), en: z.string() });
const departmentSchema = z.object({ id: z.uuid(), names: namesSchema }).nullable();

/** The counts of one teacher, department or the branch. */
export const completenessCountsSchema = z.object({
  plans: z.int().min(0),
  complete: z.int().min(0),
  incomplete: z.int().min(0),
  /** Lessons with no topic over the incomplete plans. */
  noTopic: z.int().min(0),
  notStarted: z.int().min(0),
  overdue: z.int().min(0),
  windowNotOpened: z.int().min(0),
  belowMinimum: z.int().min(0),
  /** The share of complete plans, `null` with none (`packages/calc`, `shownPercent`). */
  percentComplete: z.int().min(0).max(100).nullable(),
});

export const planCompletenessSchema = z.object({
  quarters: z.array(planQuarterSchema),
  quarterId: z.uuid().nullable(),
  departments: z.array(z.object({ id: z.uuid(), names: namesSchema })),
  plans: z.array(
    z.object({
      journalId: z.uuid(),
      unit: planUnitSchema,
      subject: planSubjectSchema,
      teacher: teacherSchema,
      department: departmentSchema,
      state: z.enum(PLAN_STATES),
      rows: z.int().min(0),
      /** Lessons with no topic. */
      empty: z.int().min(0),
      flag: z.enum(PLAN_FLAGS).nullable(),
      belowMinimum: planMinimumMarkSchema.nullable(),
    }),
  ),
  teachers: z.array(z.object({ teacher: teacherSchema, counts: completenessCountsSchema })),
  byDepartment: z.array(
    z.object({ department: departmentSchema, counts: completenessCountsSchema }),
  ),
  branch: completenessCountsSchema,
  /** The plans of the branch's other subjects, counted and never named (decision 1; `.claude/rules/api.md`). */
  otherSubjects: z.int().min(0),
});

export type PlanCompleteness = z.infer<typeof planCompletenessSchema>;

export const planProgressSchema = z.object({
  quarters: z.array(planQuarterSchema),
  quarterId: z.uuid().nullable(),
  departments: z.array(z.object({ id: z.uuid(), names: namesSchema })),
  plans: z.array(
    z.object({
      journalId: z.uuid(),
      unit: planUnitSchema,
      subject: planSubjectSchema,
      teacher: teacherSchema,
      department: departmentSchema,
      /** Lessons of the quarter not cancelled. */
      rows: z.int().min(0),
      /** Rows with a topic: "lessons planned". */
      planned: z.int().min(0),
      held: z.int().min(0),
      /** Held lessons with a topic not marked "topic not delivered". */
      delivered: z.int().min(0),
      notCovered: z.int().min(0),
      /** "classes behind the plan": delivered below held, or items not covered. */
      behind: z.boolean(),
    }),
  ),
  /** `edge/lesson-plans`: "The progress report shows each teacher's share of 'not held'". */
  teachers: z.array(
    z.object({
      teacher: teacherSchema,
      plannedWorks: z.int().min(0),
      notHeld: z.int().min(0),
      /** `null` with no planned work at a held lesson. */
      percentNotHeld: z.int().min(0).max(100).nullable(),
    }),
  ),
  /** The plans of the branch's other subjects, counted and never named. */
  otherSubjects: z.int().min(0),
  /** Task 10.1b: the prepared totals each journal's counts were read from. */
  prepared: preparedStampSchema,
});

export type PlanProgress = z.infer<typeof planProgressSchema>;

export const PLAN_REQUEST_KINDS_REPORTED = ['text', 'replan', 'extension'] as const;

export const planRequestsReportSchema = z.object({
  quarters: z.array(planQuarterSchema),
  quarterId: z.uuid().nullable(),
  departments: z.array(z.object({ id: z.uuid(), names: namesSchema })),
  teachers: z.array(
    z.object({
      teacher: teacherSchema,
      total: z.int().min(0),
      requests: z.array(
        z.object({
          id: z.uuid(),
          journalId: z.uuid(),
          unit: planUnitSchema,
          subject: planSubjectSchema,
          kind: z.enum(PLAN_REQUEST_KINDS_REPORTED),
          status: z.enum(['prepared', 'sent', 'approved', 'refused', 'void']),
          decidedBy: z.string().nullable(),
          decidedOn: schoolDateSchema.nullable(),
          /** `09`: "what was changed": the plan writes made under the request. */
          changes: z.array(
            z.object({
              action: z.string(),
              on: schoolDateSchema,
              topicBefore: z.string().nullable(),
              topicAfter: z.string().nullable(),
            }),
          ),
        }),
      ),
    }),
  ),
});

export type PlanRequestsReport = z.infer<typeof planRequestsReportSchema>;

export const PLAN_REPORTS = ['completeness', 'progress', 'requests'] as const;

export const planReportExportSchema = z.strictObject({
  report: z.enum(PLAN_REPORTS),
  quarterId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
  teacherId: z.uuid().optional(),
});

export type PlanReportExport = z.infer<typeof planReportExportSchema>;

export const planExportSchema = z.strictObject({
  quarterId: z.uuid(),
  format: z.enum(['pdf', 'xlsx']),
});

export type PlanExport = z.infer<typeof planExportSchema>;
