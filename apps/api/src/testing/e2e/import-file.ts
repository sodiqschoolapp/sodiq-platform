import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The filled template of the import browser test (task 9.4g): the seed writes it, the test
 * uploads it. Both run on the same machine.
 */
export const STUDENT_IMPORT_FILE = path.join(tmpdir(), 'sodiq-e2e-student-import.xlsx');

/** The filled staff template of the staff import step of the browser tests (task 9.4h). */
export const STAFF_IMPORT_FILE = path.join(tmpdir(), 'sodiq-e2e-staff-import.xlsx');

/** The filled load template of the load import browser test (task 5.13), made for its seeded draft. */
export const LOAD_IMPORT_FILE = path.join(tmpdir(), 'sodiq-e2e-load-import.xlsx');

/** The filled timetable template of the timetable import browser test (task 5.14), made for its seeded draft. */
export const PATTERN_IMPORT_FILE = path.join(tmpdir(), 'sodiq-e2e-pattern-import.xlsx');

/** The files of the past-marks browser test (task 11.26): one with a comma in a score, one clean. */
export const PAST_MARKS_BAD_FILE = path.join(tmpdir(), 'sodiq-e2e-past-marks-bad.xlsx');
export const PAST_MARKS_FILE = path.join(tmpdir(), 'sodiq-e2e-past-marks.xlsx');

/** The date of the past marks the seed wrote, `yyyy-mm-dd`. */
export const PAST_MARKS_DATE_FILE = path.join(tmpdir(), 'sodiq-e2e-past-marks-date.txt');
