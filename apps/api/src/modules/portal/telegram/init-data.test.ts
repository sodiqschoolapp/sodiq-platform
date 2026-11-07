import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { signedLaunch, TEST_BOT_TOKEN } from '../../../testing/telegram-kit.js';
import { checkLaunchData, launchHashOf, LAUNCH_AHEAD_MS, LAUNCH_VALID_MS } from './init-data.js';

// Task 11.4: `10`, Telegram: "the server checks Telegram's signature every time it is opened";
// the Release 2 plan, reading 5: accepted for 24 hours after Telegram signed it.
const NOW = new Date('2026-11-09T10:00:00Z');
const at = (offsetMs: number): Date => new Date(NOW.getTime() + offsetMs);
const check = (data: string) => checkLaunchData(data, TEST_BOT_TOKEN, NOW);

describe('the launch data of the mini app', () => {
  it('is accepted when Telegram signed it with the bot token', () => {
    const result = check(
      signedLaunch({ telegramUserId: 7001, signedAt: at(-60_000), languageCode: 'ru' }),
    );
    expect(result).toEqual({
      ok: true,
      launch: {
        telegramUserId: '7001',
        languageCode: 'ru',
        signedAt: new Date(Math.floor(at(-60_000).getTime() / 1000) * 1000),
      },
    });
  });

  it('is accepted exactly 24 hours after signing and refused one second later', () => {
    expect(check(signedLaunch({ telegramUserId: 7001, signedAt: at(-LAUNCH_VALID_MS) })).ok).toBe(
      true,
    );
    expect(
      check(signedLaunch({ telegramUserId: 7001, signedAt: at(-LAUNCH_VALID_MS - 1000) })),
    ).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('is accepted 5 minutes ahead of the clock and refused one second further', () => {
    expect(check(signedLaunch({ telegramUserId: 7001, signedAt: at(LAUNCH_AHEAD_MS) })).ok).toBe(
      true,
    );
    expect(
      check(signedLaunch({ telegramUserId: 7001, signedAt: at(LAUNCH_AHEAD_MS + 1000) })),
    ).toEqual({
      ok: false,
      reason: 'ahead',
    });
  });

  it('is refused when another token signed it', () => {
    const forged = signedLaunch({
      telegramUserId: 7001,
      signedAt: at(0),
      botToken: '987654321:AAanotherInventedTokenNotTheBots_98765',
    });
    expect(check(forged)).toEqual({ ok: false, reason: 'signature' });
  });

  it('is refused when a field was added after signing', () => {
    const changed = signedLaunch({
      telegramUserId: 7001,
      signedAt: at(0),
      extra: { start_param: 'x' },
    });
    expect(check(changed)).toEqual({ ok: false, reason: 'signature' });
  });

  it('is refused when a signed field is changed', () => {
    const data = new URLSearchParams(signedLaunch({ telegramUserId: 7001, signedAt: at(0) }));
    data.set('user', JSON.stringify({ id: 7002, first_name: 'Invented' }));
    expect(check(data.toString())).toEqual({ ok: false, reason: 'signature' });
  });

  it('is refused without a hash, with a hash that is not hex, or empty', () => {
    const data = new URLSearchParams(signedLaunch({ telegramUserId: 7001, signedAt: at(0) }));
    data.delete('hash');
    expect(check(data.toString())).toEqual({ ok: false, reason: 'malformed' });
    data.set('hash', 'z'.repeat(64));
    expect(check(data.toString())).toEqual({ ok: false, reason: 'malformed' });
    expect(check('')).toEqual({ ok: false, reason: 'malformed' });
  });

  it('is refused when a key repeats, even a key the hash covers', () => {
    const data = signedLaunch({ telegramUserId: 7001, signedAt: at(0) });
    expect(check(`${data}&user=${encodeURIComponent('{"id":7002}')}`)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('is refused without a user, or with a user id that is not a positive whole number', () => {
    for (const user of [
      undefined,
      '{"id":0}',
      '{"id":-5}',
      '{"id":"7001"}',
      '{"id":1.5}',
      'not json',
    ]) {
      const fields: [string, string][] = [['auth_date', String(Math.floor(NOW.getTime() / 1000))]];
      if (user !== undefined) fields.push(['user', user]);
      const params = new URLSearchParams(fields);
      params.set('hash', launchHashOf(fields, TEST_BOT_TOKEN));
      expect(check(params.toString())).toEqual({ ok: false, reason: 'malformed' });
    }
  });

  it('counts a signature field as a signed field', () => {
    const fields: [string, string][] = [
      ['auth_date', String(Math.floor(NOW.getTime() / 1000))],
      ['signature', 'inventedEd25519Signature'],
      ['user', '{"id":7001}'],
    ];
    const params = new URLSearchParams(fields);
    params.set('hash', launchHashOf(fields, TEST_BOT_TOKEN));
    expect(check(params.toString()).ok).toBe(true);
    params.set('signature', 'changed');
    expect(check(params.toString())).toEqual({ ok: false, reason: 'signature' });
  });

  it('is refused when any one character of the data is changed in what it says', () => {
    const data = signedLaunch({ telegramUserId: 7001, signedAt: at(0) });
    fc.assert(
      fc.property(
        fc.nat({ max: data.length - 1 }),
        fc.constantFrom(...'0123456789abcdefABCDEF%=&_'),
        (index, character) => {
          fc.pre(data[index] !== character);
          const changed = data.slice(0, index) + character + data.slice(index + 1);
          // `%7B` and `%7b` read the same: a change of the spelling only is no change.
          fc.pre(new URLSearchParams(changed).toString() !== new URLSearchParams(data).toString());
          expect(check(changed).ok).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });
});
