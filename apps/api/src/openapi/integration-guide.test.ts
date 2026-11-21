import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repositoryRoot } from '../database/config.js';
import {
  INTEGRATION_GUIDE,
  KEY_OPERATION_TEXTS,
  OPERATIONS_END,
  OPERATIONS_START,
  keyOperations,
  renderKeyOperations,
  withKeyOperations,
  type GuideDocument,
} from './integration-guide.js';

/**
 * The owner, 21 November 2026: the guide for the department platforms stays up to
 * date with the code. Its operations are written from `openapi.generated.json`,
 * which `openapi.test.ts` keeps equal to the routes; `pnpm api:client` writes both.
 */
describe('the integration guide', () => {
  const document = JSON.parse(
    readFileSync(new URL('../../openapi.generated.json', import.meta.url), 'utf8'),
  ) as GuideDocument;
  const guide = readFileSync(path.join(repositoryRoot, INTEGRATION_GUIDE), 'utf8').replaceAll(
    '\r\n',
    '\n',
  );

  it('lists the operations open to keys as the code has them (run "pnpm api:client" if this fails)', () => {
    expect(guide).toBe(withKeyOperations(guide, renderKeyOperations(document)));
  });

  it('has a text for every operation open to keys, and none for another operation', () => {
    const open = keyOperations(document).map(({ operation }) => operation.operationId);

    expect(Object.keys(KEY_OPERATION_TEXTS).sort()).toEqual([...open].sort());
  });

  it('names every operation open to keys with its method and path', () => {
    const generated = renderKeyOperations(document);

    for (const { method, path: route } of keyOperations(document)) {
      expect(generated).toContain(`\`${method} ${route}\``);
    }
  });

  it('refuses an operation open to keys without a text', () => {
    const unknown: GuideDocument = {
      paths: {
        '/api/integration/new': {
          get: {
            operationId: 'NewController_read',
            responses: {},
            'x-open-to-integration-keys': true,
          },
        },
      },
    };

    expect(() => renderKeyOperations(unknown)).toThrow('NewController_read');
  });

  it('keeps the hand-written text around the generated part', () => {
    const text = `before\n${OPERATIONS_START}\nold\n${OPERATIONS_END}\nafter\n`;

    expect(withKeyOperations(text, `${OPERATIONS_START}\nnew\n${OPERATIONS_END}`)).toBe(
      `before\n${OPERATIONS_START}\nnew\n${OPERATIONS_END}\nafter\n`,
    );
    expect(() => withKeyOperations('no markers', 'x')).toThrow('lost its generated markers');
  });
});
