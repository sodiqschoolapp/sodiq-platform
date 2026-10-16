// The timetable rule engine, used by the API, the grid and to re-check the solver's output.
// Task 1.5 adds the times of a day and the template of a class on a date, task
// 1.4 the calendar (what a grade has on a date), task 3.4a the rules of one
// teaching load row, task 3.4b the blocks and weekly totals of a load, task
// 5.2 every rule of a placed timetable (check.ts).
export {
  dayEndsAfterMidnight,
  dayTimes,
  lessonSlotProblem,
  lessonTimeProblem,
  MINUTES_PER_DAY,
  type Day,
  type DaySlot,
  type DaySlotInput,
  type SlotKind,
} from './day.js';
export {
  dayOn,
  entryCovers,
  isSchoolDay,
  type CalendarEntry,
  type CalendarEntryKind,
  type CalendarSettings,
  type DayResult,
  type ExamWeek,
} from './calendar.js';
export {
  firstOn,
  inForceOn,
  isInForceOn,
  specialDateFor,
  templateFor,
  weekdayOf,
  type DatedRow,
  type SpecialDateTemplate,
  type TemplateAssignment,
  type TemplateLevel,
  type TemplateSettings,
} from './templates.js';
export {
  sharedLessonSlots,
  twoGradeSlots,
  type SharedSlot,
  type TwoGradeDay,
} from './two-grades.js';
export {
  LISTED_PROBLEMS,
  LOAD_PROBLEM_ORDER,
  loadRowProblems,
  refusingProblems,
  ROOM_PROBLEMS,
  isTutorRow,
  TEACHER_PROBLEMS,
  teacherProblems,
  type LoadProblem,
  type LoadRowFacts,
  type LoadSubject,
  type LoadTeacher,
  type LoadUnit,
} from './load.js';
export {
  BLOCK_PROBLEM_ORDER,
  blockOf,
  blockProblems,
  groupsLinked,
  loadBlocks,
  splitAndWhole,
  splitClassOf,
  type BlockGroup,
  type BlockProblem,
  type BlockRow,
} from './blocks.js';
export {
  classWeekLessons,
  freeSlots,
  lessonIntervals,
  teacherWeekLessons,
  weekDaysOf,
  weekLessonSlots,
  type Interval,
  type TotalsRow,
  type WeekDay,
} from './totals.js';
export {
  RELAXED_WHEN_NO_TEACHER_FREE,
  RULE_ORDER,
  slotStatus,
  WARNINGS,
  type RuleCode,
  type RuleResult,
  type Severity,
  type SlotStatus,
} from './rules.js';
export type {
  AvailabilityEntry,
  CheckOptions,
  EngineDay,
  EngineLoadRow,
  EngineRoom,
  EngineSubject,
  EngineTeacher,
  EngineUnit,
  EngineYear,
  Facts,
  Placement,
} from './placement.js';
export { tutorAt, type TutorRow } from './tutors.js';
export { checkCandidate, checkTimetable, overlappingPairs } from './check.js';
