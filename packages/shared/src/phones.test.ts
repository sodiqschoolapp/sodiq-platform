import { describe, expect, it } from 'vitest';
import {
  PHONE_FORMAT,
  phoneDigits,
  phoneLeftEmpty,
  phoneText,
  storedPhone,
  typedPhoneText,
} from './phones.js';

describe('phoneText (finding 24)', () => {
  it('groups an Uzbek number', () => {
    expect(phoneText('+998901112233')).toBe('+998 90 111 22 33');
    expect(phoneText('+998711234567')).toBe('+998 71 123 45 67');
  });

  it('groups an Uzbek number typed with spaces, brackets and hyphens the same way', () => {
    expect(phoneText('+998 (90) 111-22-33')).toBe('+998 90 111 22 33');
  });

  it('shows a foreign number as stored', () => {
    expect(phoneText('+447700900123')).toBe('+447700900123');
  });

  it('shows "+998" with eight or ten digits as stored', () => {
    expect(phoneText('+99890111223')).toBe('+99890111223');
    expect(phoneText('+9989011122334')).toBe('+9989011122334');
  });
});

describe('phoneDigits', () => {
  it('drops the spacing', () => {
    expect(phoneDigits('+998 90 111-22 33')).toBe('+998901112233');
  });
});

describe('storedPhone and PHONE_FORMAT (task 3.5b, H25)', () => {
  const stored = (typed: string): string | null => {
    const phone = storedPhone(typed);
    return PHONE_FORMAT.test(phone) ? phone : null;
  };

  it('reads an Uzbek number written with or without "+998" and with any separators', () => {
    for (const typed of [
      '+998901234501',
      '+998 90 123 45 01',
      '+998-90-123-45-01',
      '+998 (90) 123-45-01',
      '+998.90.123.45.01',
      '998901234501',
      '998 90 123 45 01',
      '901234501',
      '90 123 45 01',
      '(90) 123-45-01',
      '00998901234501',
      '00 998 90 123 45 01',
    ]) {
      expect(stored(typed), typed).toBe('+998901234501');
    }
  });

  it('reads a number pasted after the prefilled "+998 " in every written form', () => {
    expect(stored('+998 +998901234501')).toBe('+998901234501');
    expect(stored('+998 998901234501')).toBe('+998901234501');
    expect(stored('+998 00998901234501')).toBe('+998901234501');
    expect(stored('+998 901234501')).toBe('+998901234501');
    expect(stored('+998 +74951234567')).toBe('+74951234567');
    expect(stored('+998 0074951234567')).toBe('+74951234567');
  });

  it('accepts a number of another country with 7 to 15 digits', () => {
    expect(stored('+44 7700 900123')).toBe('+447700900123');
    expect(stored('0044 7700 900123')).toBe('+447700900123');
    expect(stored('+1234567')).toBe('+1234567');
    expect(stored('+123456789012345')).toBe('+123456789012345');
  });

  it('refuses an Uzbek number with eight or ten digits', () => {
    expect(stored('+998 90 123 45')).toBeNull();
    expect(stored('+99890123450')).toBeNull();
    expect(stored('+9989012345012')).toBeNull();
  });

  it('refuses a number too short, too long, without a code, or with letters', () => {
    expect(stored('+123456')).toBeNull();
    expect(stored('+1234567890123456')).toBeNull();
    expect(stored('12345678')).toBeNull();
    expect(stored('+998 90 ABC 45 01')).toBeNull();
    expect(stored('')).toBeNull();
    expect(stored('+998')).toBeNull();
  });

  it('counts a field left at the prefilled "+998" as empty', () => {
    expect(phoneLeftEmpty('+998 ')).toBe(true);
    expect(phoneLeftEmpty('  ')).toBe(true);
    expect(phoneLeftEmpty('+998 9')).toBe(false);
  });

  it('groups a typed whole number and leaves anything else as typed', () => {
    expect(typedPhoneText('+998 +998901234501')).toBe('+998 90 123 45 01');
    expect(typedPhoneText('+998 90 12')).toBe('+998 90 12');
  });
});
