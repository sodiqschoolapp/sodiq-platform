import { ANNOUNCEMENT_TEXTS, type Language } from '@sodiq/shared';

/**
 * Task 11.7 (pull request #306): the text of the bot's message of an announcement, in the
 * parent's language (plan decision 8): the frame from the templates, the author's title and body
 * as typed. Plain text: the send names no parse mode, so a `<` or `*` an author typed is sent as
 * it is (spec review of the plan, note). It names no child. Pure.
 */

export interface MessageAnnouncement {
  readonly kind: 'news' | 'event';
  readonly title: string;
  readonly body: string;
  readonly firstDate: string | null;
  readonly lastDate: string | null;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly place: string | null;
}

/** `2026-11-20` as `20.11.2026`, the way the school writes a date in all three languages. */
export const dottedDate = (date: string): string => {
  const [year, month, day] = date.split('-');
  return `${day ?? ''}.${month ?? ''}.${year ?? ''}`;
};

/** `09:00:00` (as PostgreSQL gives a `time`) or `09:00` as `09:00`. */
export const clockTime = (time: string): string => time.slice(0, 5);

export function announcementText(language: Language, announcement: MessageAnnouncement): string {
  const texts = ANNOUNCEMENT_TEXTS[language];
  const lines = [
    announcement.kind === 'event' ? texts.event : texts.news,
    '',
    announcement.title,
    '',
    announcement.body,
  ];
  if (
    announcement.kind === 'event' &&
    announcement.firstDate !== null &&
    announcement.lastDate !== null
  ) {
    const dates =
      announcement.firstDate === announcement.lastDate
        ? dottedDate(announcement.firstDate)
        : `${dottedDate(announcement.firstDate)} – ${dottedDate(announcement.lastDate)}`;
    const times =
      announcement.startsAt === null
        ? ''
        : announcement.endsAt === null
          ? `, ${clockTime(announcement.startsAt)}`
          : `, ${clockTime(announcement.startsAt)}–${clockTime(announcement.endsAt)}`;
    lines.push('', `${texts.when}: ${dates}${times}`);
    if (announcement.place !== null) lines.push(`${texts.where}: ${announcement.place}`);
  }
  return lines.join('\n');
}
