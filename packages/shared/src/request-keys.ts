import { z } from 'zod';

/** The header that carries the key of a repeat-safe action. */
export const REQUEST_KEY_HEADER = 'Idempotency-Key';

/**
 * The key of a repeat-safe action: a uuid that the caller makes once per
 * action and sends again on every retry of it.
 */
export const requestKeySchema = z.uuid();
