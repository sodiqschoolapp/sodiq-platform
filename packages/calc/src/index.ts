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
export { CalcInputError, type CalcInputErrorCode } from './input.js';
export { shownPercent, workPercent } from './work.js';
