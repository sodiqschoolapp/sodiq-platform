import type { AssistantModel, ModelReply, ModelRequest, ModelPlace, TextSink } from './model.js';
import type { AssistantWait } from './model-caller.js';

const CLASSES = 'ClassesController_list';

/**
 * The model of the browser tests (task 11.12, `ASSISTANT_SCRIPTED_MODEL=1`, refused by the
 * configuration outside the test and development environments): it never leaves the server.
 * To any question it reads the classes, then answers with the names of those with no Tutor,
 * from the platform's own list; nothing else. The API tests use `FakeModel` instead. Task 11.16:
 * before its answer it waits `delayMs` through the injected wait (`ASSISTANT_SCRIPTED_DELAY_MS`),
 * so a browser test sees "Reading: …" while it works, and streams the answer in two pieces.
 */
export class ScriptedModel implements AssistantModel {
  readonly name = 'scripted';

  constructor(
    private readonly wait: AssistantWait = () => Promise.resolve(),
    private readonly delayMs = 0,
  ) {}

  locationOf(place: ModelPlace): string {
    return place === 'global' ? 'global' : 'europe-west3';
  }

  async generate(
    request: ModelRequest,
    _place?: ModelPlace,
    onText?: TextSink,
  ): Promise<ModelReply> {
    const last = request.turns.at(-1);
    const result = last?.parts.find((part) => part.kind === 'result' && part.name === CLASSES);
    if (result === undefined || result.kind !== 'result') {
      const canRead = request.tools.some((tool) => tool.name === CLASSES);
      return canRead
        ? {
            text: '',
            calls: [{ name: CLASSES, args: {} }],
            tokensIn: 0,
            tokensOut: 0,
            model: this.name,
          }
        : { text: '', calls: [], tokensIn: 0, tokensOut: 0, model: this.name };
    }
    const data = (result.result as { data?: { classes?: { name: string; tutor: unknown }[] } })
      .data;
    const names = (data?.classes ?? []).filter((one) => one.tutor === null).map((one) => one.name);
    if (this.delayMs > 0) await this.wait(this.delayMs);
    const text = names.join(', ');
    const half = Math.ceil(text.length / 2);
    for (const piece of [text.slice(0, half), text.slice(half)]) {
      if (piece !== '') onText?.(piece);
    }
    return { text, calls: [], tokensIn: 0, tokensOut: 0, model: this.name };
  }
}
