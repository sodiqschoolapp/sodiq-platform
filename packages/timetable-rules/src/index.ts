// The timetable rule engine, used by the API, the grid and to re-check the solver's output.
// Task 1.5 adds the times of a day and the template of a class on a date, task
// 1.4 the calendar (what a grade has on a date), task 3.4a the rules of one
// teaching load row, task 3.4b the blocks and weekly totals of a load, task
// 5.2 every rule of a placed timetable (check.ts), task 5.3a the readiness of
// the draft builder, task 5.3b-1 its step 5 (preferences.ts), task 5.3b-2
// the pinned lessons (pins.ts), task 5.4a the pattern facts as data and the
// lessons of a block at a slot (facts-data.ts, pattern-place.ts), task 5.4b-2a
// the room of a lesson (rooms-pick.ts), task 5.4c-1 the locks (locks.ts), task
// 5.5a-2a the lessons of a pattern on its dates (dated.ts).
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
  FIXED_RULES,
  RELAXED_WHEN_NO_TEACHER_FREE,
  RULE_ORDER,
  slotStatus,
  WARNINGS,
  WEEK_COUNT_RULES,
  type FixedRule,
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
export {
  PIN_PROBLEMS,
  pinnedPlacements,
  tutorPinClashes,
  type Pin,
  type PinnedLessons,
  type PinProblem,
  type PinProblemCode,
  type PinRow,
  type PinSlot,
} from './pins.js';
export { tutorAt, type TutorRow } from './tutors.js';
export {
  checkCandidate,
  checkCandidates,
  checkTeacherTime,
  checkTimetable,
  overlappingPairs,
} from './check.js';
export {
  elsewherePlacement,
  factsFromData,
  partnersIn,
  patternModel,
  type ElsewhereLessonData,
  type PatternAt,
  type PatternFactsData,
  type PatternModel,
  type PatternRoomData,
  type PatternRowData,
  type PatternUnitData,
} from './facts-data.js';
export {
  blockPlacements,
  checkedPlacements,
  NEW_BLOCK_ID,
  NEW_SECOND_HALF_ID,
  mixedPartners,
  newBlockOf,
  newPairOf,
  otherHalf,
  pairAt,
  pairingOf,
  pairingProblem,
  patternPlacements,
  placeRowsOf,
  slotAt,
  type BlockLesson,
  type PairingProblem,
  type PatternBlock,
} from './pattern-place.js';
export {
  addedResults,
  roomLessons,
  roomChange,
  roomChoices,
  type RoomChange,
  type RoomChoice,
} from './rooms-pick.js';
export {
  FREE_SHOWN,
  MOST_BLOCKS_CHANGED,
  REARRANGEMENTS_SHOWN,
  ROOM_RULES,
  SUGGEST_BUDGET,
  suggestPlaces,
  type SuggestedChange,
  type Suggestion,
  type Suggestions,
  type SuggestOptions,
} from './suggest.js';
export { lockedBy, type PatternLock } from './locks.js';
export {
  draftReady,
  loadReadiness,
  roomsReadiness,
  rulesReadiness,
  teachersReadiness,
  templatesReadiness,
  type CellKey,
  type CellSlot,
  type LoadReadiness,
  type RoomsReadiness,
  type RulesReadiness,
  type TeachersReadiness,
  type TemplateCell,
  type TemplatesReadiness,
} from './readiness.js';
export {
  DEFAULT_WEIGHT,
  MAX_WEIGHT,
  PREFERENCES,
  type Preference,
  type Weights,
} from './preferences.js';
export {
  datedPublishResults,
  publishRefusals,
  startChoices,
  type DatedPublishInput,
  type DatedPublishResults,
  type NeedsTeacher,
  type NeedsTeacherReason,
  type PublishResults,
  type StartChoices,
} from './publish.js';
export {
  addDays,
  datedId,
  datedPattern,
  patternIdOf,
  type DatedBlock,
  type DatedCancelled,
  type DatedCancelReason,
  type DatedDay,
  type DatedEntry,
  type DatedLesson,
  type DatedNoTutor,
  type DatedPattern,
  type DatedPatternInput,
  type DatedShortened,
  type DatedUnusedKeep,
} from './dated.js';
// Task 5.5a-2b-1: the impact preview and the transition week of a publish.
export {
  impactLessonOf,
  mondayOf,
  publishImpact,
  transitionWeek,
  type ImpactChange,
  type ImpactKind,
  type ImpactLesson,
  type ImpactSlot,
  type PublishImpact,
  type TransitionRow,
  type TransitionWeek,
} from './impact.js';
// Task 5.5a-3a: "carry the change into them" of a publish before a later version.
export {
  carryChanges,
  carryInto,
  type CarriedInto,
  type CarryChange,
  type CarryEntry,
  type CarryOffer,
  type CarryRow,
  type CarryVersion,
} from './carry.js';
// Task 5.5a-3b-2: bringing a draft up to date after a publish.
export {
  draftDifferences,
  mergeRowKey,
  pickedItems,
  takenPlan,
  type MergeEntry,
  type MergeItem,
  type MergeItemRow,
  type MergePick,
  type MergePin,
  type MergePlacement,
  type MergeRow,
  type MergeSide,
  type MergeValues,
  type MergeVersion,
  type PickedItems,
  type TakenPlan,
} from './up-to-date.js';
