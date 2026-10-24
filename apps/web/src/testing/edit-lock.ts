import type { EditLock } from '@sodiq/shared';

/**
 * The edit period of a lesson or rating exam that is still open for the reader
 * (task 8.4), for the fixtures of the journal tests.
 */
export const OPEN_LOCK: EditLock = {
  locksAt: '2026-11-03T19:00:00.000Z',
  window: 'open',
  unlockedUntil: null,
  unlockedBy: null,
  request: null,
  canRequest: false,
  canCorrect: false,
};
