import { describe, expect, it } from 'vitest';
import { wholeNumber } from './form-messages';

// CLAUDE.md: typed scores and totals are whole numbers.
describe('what is typed into a field for a whole number', () => {
  it('is the number when it is written in digits', () => {
    expect(wholeNumber('7')).toBe(7);
    expect(wholeNumber(' 100 ')).toBe(100);
    expect(wholeNumber('-3')).toBe(-3);
    expect(wholeNumber('007')).toBe(7);
  });

  it('is nothing when the field is empty', () => {
    expect(wholeNumber('')).toBeUndefined();
    expect(wholeNumber('   ')).toBeUndefined();
  });

  it('stays a text, which a schema refuses, when it is anything else', () => {
    for (const text of ['6.5', '6,5', '1e3', '0x10', '१२', 'six', '1 000', '+5', '--1']) {
      expect(wholeNumber(text)).toBe(text);
    }
    // Too long to be held exactly.
    expect(wholeNumber('1234567890123456')).toBe('1234567890123456');
  });
});
