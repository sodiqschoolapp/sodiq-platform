import type { AssistantModel, ModelReply, ModelRequest } from './model.js';

const CLASSES = 'ClassesController_list';

/**
 * The model of the browser tests (task 11.12, `ASSISTANT_SCRIPTED_MODEL=1`, refused by the
 * configuration outside the test and development environments): it never leaves the server.
 * To any question it reads the classes, then answers with the names of those with no Tutor,
 * from the platform's own list; nothing else. The API tests use `FakeModel` instead.
 */
export class ScriptedModel implements AssistantModel {
  readonly name = 'scripted';

  generate(request: ModelRequest): Promise<ModelReply> {
    const last = request.turns.at(-1);
    const result = last?.parts.find((part) => part.kind === 'result' && part.name === CLASSES);
    if (result === undefined || result.kind !== 'result') {
      const canRead = request.tools.some((tool) => tool.name === CLASSES);
      return Promise.resolve(
        canRead
          ? {
              text: '',
              calls: [{ name: CLASSES, args: {} }],
              tokensIn: 0,
              tokensOut: 0,
              model: this.name,
            }
          : { text: '', calls: [], tokensIn: 0, tokensOut: 0, model: this.name },
      );
    }
    const data = (result.result as { data?: { classes?: { name: string; tutor: unknown }[] } })
      .data;
    const names = (data?.classes ?? []).filter((one) => one.tutor === null).map((one) => one.name);
    return Promise.resolve({
      text: names.join(', '),
      calls: [],
      tokensIn: 0,
      tokensOut: 0,
      model: this.name,
    });
  }
}
