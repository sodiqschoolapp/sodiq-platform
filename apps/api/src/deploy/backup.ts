import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { metricsBody } from '../monitoring/otlp.js';
import { MEASUREMENTS } from '../monitoring/series.js';

/**
 * The two steps of the daily export after its restore proof (task 10.2a; `13`, Backups: "a
 * daily full export kept in a second location (Cloudflare R2)"), run by
 * `.github/workflows/backup.yml`. Nothing here reads the dump: it is stored as it is, and what
 * the log prints is a key, a size and a moment.
 */

export class BackupError extends Error {}

/** The part of the S3 client the upload uses; a fake in the tests. */
export interface ObjectStore {
  send(command: PutObjectCommand | HeadObjectCommand): Promise<{ ContentLength?: number }>;
}

/** The key of the day's dump: one a day, a run again the same day replaces it. */
export function backupKey(now: Date): string {
  return `daily/${now.toISOString().slice(0, 10)}.dump`;
}

/** The bucket of the backups, as the token of the environment `backup` reaches it. */
export function backupStore(input: {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
}): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${input.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: input.accessKeyId, secretAccessKey: input.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

/** Puts the file under the day's key and checks that the stored size is the file's. */
export async function uploadBackup(input: {
  store: ObjectStore;
  bucket: string;
  file: string;
  now: Date;
}): Promise<{ key: string; bytes: number }> {
  const { size } = await stat(input.file);
  if (size === 0) {
    throw new BackupError('The dump is empty; nothing was stored.');
  }
  const key = backupKey(input.now);
  await input.store.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: key,
      Body: createReadStream(input.file),
      ContentLength: size,
      ContentType: 'application/octet-stream',
    }),
  );
  const stored = await input.store.send(new HeadObjectCommand({ Bucket: input.bucket, Key: key }));
  if (stored.ContentLength !== size) {
    throw new BackupError(
      `The stored dump has ${String(stored.ContentLength)} bytes, the file ${String(size)}.`,
    );
  }
  return { key, bytes: size };
}

export type Post = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;

/**
 * Tells Grafana the moment of the last export that was proved and stored
 * (`sodiq_backup_last_success`): the rule "a backup older than 24 hours" reads it. Unlike the
 * pushes of the services, a failure here fails the run, so the owner hears of it from GitHub.
 */
export async function markBackup(input: {
  url: string;
  user: string;
  token: string;
  now: Date;
  post?: Post;
}): Promise<void> {
  const post: Post = input.post ?? ((url, init) => fetch(url, init));
  const body = metricsBody([
    {
      measurement: MEASUREMENTS.backup.name,
      tags: { service: 'backup' },
      fields: { last_success: Math.floor(input.now.getTime() / 1000) },
      at: input.now.getTime(),
    },
  ]);
  const answer = await post(input.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${input.user}:${input.token}`).toString('base64')}`,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!answer.ok) {
    throw new BackupError(`Grafana answered ${String(answer.status)} to the mark of the backup.`);
  }
}
