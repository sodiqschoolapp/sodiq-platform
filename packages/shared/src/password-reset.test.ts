import { describe, expect, it } from 'vitest';
import { LANGUAGES } from './language.js';
import {
  MAIL_TEXTS,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  RESET_TOKEN_FORMAT,
} from './password-reset.js';

describe('the request of a password reset by email', () => {
  it('takes any short text as the login, so a text that is no login is not refused', () => {
    expect(passwordResetRequestSchema.safeParse({ login: 'Not a login!' }).success).toBe(true);
    expect(passwordResetRequestSchema.safeParse({ login: '' }).success).toBe(true);
    expect(passwordResetRequestSchema.safeParse({ login: 'a'.repeat(64) }).success).toBe(true);
    expect(passwordResetRequestSchema.safeParse({ login: 'a'.repeat(65) }).success).toBe(false);
    expect(passwordResetRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('the new password chosen with a link', () => {
  const token = 'A'.repeat(43);

  it('needs at least ten characters', () => {
    expect(passwordResetConfirmSchema.safeParse({ token, newPassword: '123456789' }).success).toBe(
      false,
    );
    expect(passwordResetConfirmSchema.safeParse({ token, newPassword: '1234567890' }).success).toBe(
      true,
    );
  });

  it('takes a token of any form up to 128 characters; the service refuses a wrong one', () => {
    expect(
      passwordResetConfirmSchema.safeParse({ token: 'short', newPassword: '1234567890' }).success,
    ).toBe(true);
    expect(
      passwordResetConfirmSchema.safeParse({ token: 'a'.repeat(129), newPassword: '1234567890' })
        .success,
    ).toBe(false);
    expect(RESET_TOKEN_FORMAT.test('short')).toBe(false);
    expect(RESET_TOKEN_FORMAT.test(token)).toBe(true);
  });
});

describe('the texts of the mails', () => {
  it('have every part in the three languages, the link and the minutes in their places', () => {
    for (const language of LANGUAGES) {
      const texts = MAIL_TEXTS[language].passwordReset;
      for (const text of Object.values(texts)) {
        expect(text.trim(), language).not.toBe('');
      }
      expect(texts.body, language).toContain('{link}');
      expect(texts.validity, language).toContain('{minutes}');
    }
  });

  it('write Uzbek oʻ and gʻ with U+02BB, never the keyboard apostrophe', () => {
    for (const text of Object.values(MAIL_TEXTS.uz.passwordReset)) {
      expect(text, text).not.toMatch(/['`’‘]/);
    }
  });
});
