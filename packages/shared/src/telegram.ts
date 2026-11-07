import { z } from 'zod';
import type { Language } from './language.js';

/**
 * Task 11.4: the texts the school's Telegram bot sends (`10`, Language: "Messages come from
 * templates in the three languages"), in the parent's language, Uzbek until chosen. They hold
 * no name, phone or other personal data.
 */
export interface TelegramTexts {
  /** The answer to /start, above the button that opens the portal. */
  start: string;
  /** The button that opens the mini app. */
  openPortal: string;
  /** To the earlier chat when the link moved to another chat (plan of #298, decision 9). */
  moved: string;
}

const uz: TelegramTexts = {
  start:
    'Assalomu alaykum! Bu Sodiq maktabining ota-onalar uchun boti. Farzandingizning dars jadvali, uy vazifalari, baholari va davomatini koʻrish uchun portalni oching. Birinchi marta maktab bergan login va parol bilan kiring.',
  openPortal: 'Portalni ochish',
  moved:
    'Maktab akkauntingiz endi boshqa Telegram akkauntiga bogʻlandi va bu chatdan portal parolsiz ochilmaydi. Agar buni siz qilmagan boʻlsangiz, maktab maʼmuriyatiga murojaat qiling.',
};

const ru: TelegramTexts = {
  start:
    'Здравствуйте! Это бот школы Sodiq для родителей. Откройте портал, чтобы видеть расписание, домашние задания, оценки и посещаемость ребёнка. В первый раз войдите с логином и паролем, которые выдала школа.',
  openPortal: 'Открыть портал',
  moved:
    'Ваш школьный аккаунт теперь привязан к другому аккаунту Telegram, и из этого чата портал больше не откроется без пароля. Если это сделали не вы, обратитесь в администрацию школы.',
};

const en: TelegramTexts = {
  start:
    "Hello! This is Sodiq School's bot for parents. Open the portal to see your child's timetable, homework, grades and attendance. The first time, sign in with the login and password the school gave you.",
  openPortal: 'Open the portal',
  moved:
    'Your school account is now linked to another Telegram account, and the portal no longer opens from this chat without the password. If this was not you, contact the school office.',
};

export const TELEGRAM_TEXTS: Readonly<Record<Language, TelegramTexts>> = { uz, ru, en };

/** The page of the web app that the bot's button and menu open (plan of #298). */
export const MINI_APP_PATH = '/portal/telegram';

/**
 * Task 11.4: the part of a Telegram update (Bot API, `Update`) that the webhook reads: a message
 * in a chat, its text and its sender's language. Telegram sends many more fields, and new ones
 * over time; they are let through and not read.
 */
export const telegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      chat: z.object({ id: z.number().int(), type: z.string().max(32) }),
      from: z
        .object({
          id: z.number().int(),
          language_code: z.string().max(35).optional(),
        })
        .optional(),
      text: z.string().max(4096).optional(),
    })
    .optional(),
});

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

/**
 * What the webhook takes before its secret is checked: any JSON object. The update is read with
 * `telegramUpdateSchema` only once the secret matched, so a caller without it learns nothing of
 * what the webhook reads.
 */
export const telegramWebhookBodySchema = z.record(z.string(), z.unknown());

/**
 * What the webhook answers: nothing, or one Bot API call in the body of the reply, which
 * Telegram makes for the bot ("Making requests when getting updates").
 */
export const telegramWebhookAnswerSchema = z.union([
  z.strictObject({}),
  z.strictObject({
    method: z.literal('sendMessage'),
    chat_id: z.number().int(),
    text: z.string(),
    reply_markup: z.strictObject({
      inline_keyboard: z.array(
        z.array(z.strictObject({ text: z.string(), web_app: z.strictObject({ url: z.string() }) })),
      ),
    }),
  }),
]);

export type TelegramWebhookAnswer = z.infer<typeof telegramWebhookAnswerSchema>;
