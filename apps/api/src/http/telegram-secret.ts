import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** The header in which Telegram sends the webhook's secret with each update (`setWebhook`). */
export const TELEGRAM_SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/**
 * Task 11.4: the secret a caller of the bot's webhook sent, or `undefined`. Only the webhook
 * reads it, to compare with the configured secret (`02`: the webhook "checks the secret
 * Telegram sends with each update"). Never logged.
 */
export const TelegramSecret = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined => {
    const header = context.switchToHttp().getRequest<Request>().headers[TELEGRAM_SECRET_HEADER];
    return typeof header === 'string' && header !== '' ? header : undefined;
  },
);
