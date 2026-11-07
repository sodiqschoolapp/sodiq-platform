import {
  digestFrequencyAnswerSchema,
  digestLogSchema,
  digestSettingsSchema,
  type DigestFrequency,
  type DigestSettingsChange,
} from '@sodiq/shared';
import { queryOptions } from '@tanstack/react-query';
import { api } from '@/api/client';
import { answerOf } from '@/api/failure';

/**
 * The calls of the parents' digest (task 11.5): the Super Admin's settings and send log, school-wide
 * (no branch header), and the parent's own frequency.
 */

export const DIGEST_KEY = ['digest'] as const;

export const digestSettingsQuery = (enabled: boolean) =>
  queryOptions({
    queryKey: [...DIGEST_KEY, 'settings'],
    queryFn: async () =>
      digestSettingsSchema.parse(await answerOf(api.GET('/api/setup/school-settings/digest'))),
    enabled,
  });

export async function saveDigestSettings(change: DigestSettingsChange) {
  return digestSettingsSchema.parse(
    await answerOf(api.PUT('/api/setup/school-settings/digest', { body: change })),
  );
}

export const digestLogQuery = (date: string | null) =>
  queryOptions({
    queryKey: [...DIGEST_KEY, 'log', date],
    queryFn: async () =>
      digestLogSchema.parse(
        await answerOf(
          api.GET('/api/digest-log', {
            params: { query: date === null ? {} : { from: date, to: date } },
          }),
        ),
      ),
  });

export const digestFrequencyQuery = queryOptions({
  queryKey: [...DIGEST_KEY, 'frequency'],
  queryFn: async () =>
    digestFrequencyAnswerSchema.parse(await answerOf(api.GET('/api/auth/digest-frequency'))),
});

export async function chooseDigestFrequency(frequency: DigestFrequency) {
  return digestFrequencyAnswerSchema.parse(
    await answerOf(api.PUT('/api/auth/digest-frequency', { body: { frequency } })),
  );
}
