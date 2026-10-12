import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The mail of the browser tests (task 2.3c-2): the API of the tests writes
// each mail as a file into this directory (`MAIL_OUTBOX_DIR`, refused on a
// server), and the test of the reset by email reads its link from there.

/** The outbox of the browser tests; the browser test names the same path. */
export const E2E_MAIL_OUTBOX = join(tmpdir(), 'sodiq-e2e-mail');

/** The invented address of the seeded teacher of the reset test. */
export const E2E_RESET_EMAIL = 'madina.xolmatova@example.test';
