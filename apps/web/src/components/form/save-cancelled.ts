/**
 * The person stopped a save before it was sent, for example at the preview of
 * a change (task 1.5): nothing was written. A record form keeps what was typed
 * and says that it was not saved, as after a refusal.
 */
export class SaveCancelled extends Error {
  constructor() {
    super('The save was cancelled before it was sent.');
  }
}
