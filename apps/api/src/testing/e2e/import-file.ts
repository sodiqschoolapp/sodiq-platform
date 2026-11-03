import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The filled template of the import browser test (task 9.4g): the seed writes it, the test
 * uploads it. Both run on the same machine.
 */
export const STUDENT_IMPORT_FILE = path.join(tmpdir(), 'sodiq-e2e-student-import.xlsx');
