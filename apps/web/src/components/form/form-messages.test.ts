import { describe, expect, it } from 'vitest';
import { createI18n } from '@/i18n/i18n';
import { en } from '@/i18n/locales/en';
import { formMessage, wholeNumber } from './form-messages';

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

// Issue #39, hand test of 13 October 2026, finding 21: a checkbox group with
// too few choices said "Fill in this field." or "Enter at least … characters".
describe('the message of a group of choices with too few', () => {
  it('says to choose at least one', () => {
    const t = createI18n('en').t;
    const issue = { code: 'too_small', origin: 'array', minimum: 1, path: ['grades'] };
    expect(formMessage(t, 'en', issue, '')).toBe(en.form.chooseOne);
    expect(formMessage(t, 'en', { ...issue, minimum: 2 }, '5')).toBe(en.form.chooseOne);
  });
});
