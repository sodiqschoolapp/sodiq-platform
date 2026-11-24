import { ASSISTANT_TEXT_PIECE, type AssistantProgress } from '@sodiq/shared';

/** The largest JSON of one piece of text in a payload, in bytes, well under PostgreSQL's 8 000. */
export const PIECE_MAX_BYTES = 6_000;

/**
 * A text cut into pieces of at most `ASSISTANT_TEXT_PIECE` characters whose JSON is at most
 * `PIECE_MAX_BYTES` bytes (task 11.16: a payload of the live channel stays under 8 000 bytes in
 * any script, also text full of characters JSON writes as `\u…`). Never cuts a character in two.
 */
export function piecesOf(text: string): string[] {
  const pieces: string[] = [];
  let piece = '';
  let bytes = 2;
  let length = 0;
  for (const character of text) {
    const size = Buffer.byteLength(JSON.stringify(character)) - 2;
    if (length + character.length > ASSISTANT_TEXT_PIECE || bytes + size > PIECE_MAX_BYTES) {
      pieces.push(piece);
      piece = '';
      bytes = 2;
      length = 0;
    }
    piece += character;
    bytes += size;
    length += character.length;
  }
  if (piece !== '') pieces.push(piece);
  return pieces;
}

type Event = AssistantProgress['event'];

/**
 * The text of a question's answer as the model writes it (task 11.16; `02`, While it works: "the
 * answer as it is written"), sent to the asking account's tabs in order. The model gives pieces
 * as they come, without waiting; each is sent after the one before. A failure of a send is kept
 * and thrown at the next `flush`, so the work stops there as it would at any write.
 */
export class TextProgress {
  private chain: Promise<void> = Promise.resolve();
  private failure: { error: unknown } | undefined;
  private seq = 0;

  constructor(private readonly send: (event: Event) => Promise<void>) {}

  /** A piece of the text, as the model wrote it. */
  readonly text = (written: string): void => {
    for (const delta of piecesOf(written)) {
      this.seq += 1;
      const seq = this.seq;
      this.queue({ kind: 'text', seq, delta });
    }
  };

  /** Drops the text sent so far (a call tried again, a turn that read instead of answering). */
  async reset(): Promise<void> {
    if (this.seq === 0) {
      await this.flush();
      return;
    }
    this.seq = 0;
    this.queue({ kind: 'reset' });
    await this.flush();
  }

  /** Waits for every piece sent; throws the first failure of a send. */
  async flush(): Promise<void> {
    await this.chain;
    if (this.failure !== undefined) throw this.failure.error;
  }

  private queue(event: Event): void {
    this.chain = this.chain.then(async () => {
      if (this.failure !== undefined) return;
      try {
        await this.send(event);
      } catch (error) {
        this.failure = { error };
      }
    });
  }
}
