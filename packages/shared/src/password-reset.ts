import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './auth.js';
import type { Language } from './language.js';

/**
 * Password reset by email (docs/spec/02-roles-and-access.md, Accounts and
 * sign-in: build order; task 2.3c-2, pull request #66). Asked for by login
 * (decision 7); the answer is the same for every login (decision 8), so the
 * schema takes any short text: a text that cannot be a login is answered as
 * an unknown one, never with a refusal of its own.
 */
export const passwordResetRequestSchema = z.object({
  login: z.string().max(64),
});

export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;

/** A link works for one hour from the moment it is made (decision 9). */
export const RESET_LINK_VALID_MS = 60 * 60 * 1000;

/** A new link is made at most once in 5 minutes per account (decision 10). */
export const RESET_LINK_INTERVAL_MS = 5 * 60 * 1000;

/** The token of a link: 32 random bytes as base64url, 43 characters. */
export const RESET_TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/**
 * The new password chosen with a link. The token is any bounded text: one of
 * the wrong form is answered `reset_link_invalid` by the service, as an
 * unknown one, not `validation_failed`.
 */
export const passwordResetConfirmSchema = z.object({
  token: z.string().max(128),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

export type PasswordResetConfirm = z.infer<typeof passwordResetConfirmSchema>;

/** The parts of the reset mail; `{link}` and `{minutes}` are filled in. */
export interface PasswordResetMailTexts {
  subject: string;
  greeting: string;
  body: string;
  validity: string;
  ignore: string;
}

export interface MailTexts {
  passwordReset: PasswordResetMailTexts;
}

const uz: MailTexts = {
  passwordReset: {
    subject: 'Yangi parol tanlash',
    greeting: 'Assalomu alaykum!',
    body: 'Sodiq School platformasidagi hisobingiz uchun yangi parol tanlash soʻraldi. Yangi parolni ushbu havola orqali tanlang: {link}',
    validity: 'Havola {minutes} daqiqa ishlaydi va faqat bir marta ishlatiladi.',
    ignore:
      'Agar buni siz soʻramagan boʻlsangiz, xatni eʼtiborsiz qoldiring: parolingiz oʻzgarmaydi.',
  },
};

const ru: MailTexts = {
  passwordReset: {
    subject: 'Выбор нового пароля',
    greeting: 'Здравствуйте!',
    body: 'Для вашей учётной записи на платформе Sodiq School запрошен новый пароль. Выберите новый пароль по этой ссылке: {link}',
    validity: 'Ссылка действует {minutes} минут и работает только один раз.',
    ignore:
      'Если вы этого не запрашивали, просто не обращайте внимания на письмо: пароль не изменится.',
  },
};

const en: MailTexts = {
  passwordReset: {
    subject: 'Choose a new password',
    greeting: 'Hello,',
    body: 'A new password was asked for your account on the Sodiq School platform. Choose the new password with this link: {link}',
    validity: 'The link works for {minutes} minutes and only once.',
    ignore: 'If you did not ask for this, ignore this email: your password stays as it is.',
  },
};

/**
 * The texts of the emails the server writes, in the account's language
 * (docs/spec/12-ux-standards.md: "every label, message, email ... complete"
 * in three languages; decision 16 of #66). A web test ties the subject to the
 * title of the reset page, as the export texts are tied (2.2c-1).
 */
export const MAIL_TEXTS: Readonly<Record<Language, MailTexts>> = { uz, ru, en };
