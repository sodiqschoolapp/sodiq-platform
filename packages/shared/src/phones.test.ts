import { describe, expect, it } from 'vitest';
import { phoneDigits, phoneText } from './phones.js';

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
