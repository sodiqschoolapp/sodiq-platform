// The calculation module. Every percentage, average, result and grade comes from here.
export { attendanceValue, type AttendanceMark, type AttendanceValues } from './attendance.js';
export {
  lessonScore,
  type DailyWeights,
  type LessonParts,
  type LessonScore,
  type LessonScoreInput,
  type Work,
} from './daily.js';
export { Fraction } from './fraction.js';
export { groupAverage, type GroupAverage } from './group.js';
export { GRADE_BANDS, gradeOf, type Grade, type GradeBand } from './grade.js';
export { CalcInputError, type CalcInputErrorCode } from './input.js';
export {
  quarterAttendanceAverage,
  quarterResult,
  type LeftOutPart,
  type QuarterAverages,
  type QuarterLesson,
  type QuarterPart,
  type QuarterResult,
  type QuarterResultInput,
  type QuarterWeights,
  type RatingExamEntry,
} from './quarter.js';
export {
  outcomeForYear,
  studentQuarterOutcome,
  type FlagDecision,
  type QuarterNumber,
  type ResultFlag,
  type StudentQuarterInput,
  type StudentQuarterOutcome,
} from './outcome.js';
export {
  finalQuarterRecord,
  recalculateAndCompare,
  storedQuarterInputs,
  storedQuarterOutcome,
  type Comparison,
  type FinalQuarterRecord,
  type RecordKind,
  type StoredValue,
} from './record.js';
export {
  classFigure,
  oneDecimal,
  ratingPlaces,
  subjectsFigure,
  type RatingEntry,
  type RatingPlace,
  type SubjectsFigure,
} from './rating.js';
export { CALC_VERSION } from './version.js';
export { shownPercent, workPercent } from './work.js';
export { yearResult, type QuarterOutcome, type YearResult } from './year.js';
