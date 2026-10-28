import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BackupError, backupKey, markBackup, uploadBackup, type ObjectStore } from './backup.js';

const NOW = new Date('2026-10-28T21:40:00Z');

/** A bucket in memory that keeps the size of each object it was given. */
class SizedStore implements ObjectStore {
  readonly sizes = new Map<string, number>();
  shortBy = 0;

  async send(command: PutObjectCommand | HeadObjectCommand): Promise<{ ContentLength?: number }> {
    const key = command.input.Key ?? '';
    if (command instanceof PutObjectCommand) {
      let bytes = 0;
      for await (const chunk of command.input.Body as AsyncIterable<Buffer>) {
        bytes += chunk.length;
      }
      this.sizes.set(key, bytes - this.shortBy);
      return {};
    }
    const size = this.sizes.get(key);
    return size === undefined ? {} : { ContentLength: size };
  }
}

// Task 10.2a, pull request #256 (`13`, Backups: "a daily full export kept in a second location
// (Cloudflare R2)"; `edge/system-behaviour`: "a backup older than 24 hours").
describe('the daily export', () => {
  let folder: string;
  let dump: string;

  beforeAll(async () => {
    folder = await mkdtemp(path.join(tmpdir(), 'backup-test-'));
    dump = path.join(folder, 'production.dump');
    await writeFile(dump, Buffer.alloc(70_000, 7));
  });

  afterAll(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it('stores the dump under the day of the run and checks the stored size', async () => {
    const store = new SizedStore();
    expect(await uploadBackup({ store, bucket: 'sodiq-backups', file: dump, now: NOW })).toEqual({
      key: 'daily/2026-10-28.dump',
      bytes: 70_000,
    });
    expect(store.sizes.get('daily/2026-10-28.dump')).toBe(70_000);
    expect(backupKey(new Date('2026-10-28T23:59:59Z'))).toBe('daily/2026-10-28.dump');
  });

  it('fails when the stored size differs or the dump is empty', async () => {
    const store = new SizedStore();
    store.shortBy = 1;
    await expect(
      uploadBackup({ store, bucket: 'sodiq-backups', file: dump, now: NOW }),
    ).rejects.toThrow(BackupError);
    const empty = path.join(folder, 'empty.dump');
    await writeFile(empty, '');
    await expect(
      uploadBackup({ store: new SizedStore(), bucket: 'sodiq-backups', file: empty, now: NOW }),
    ).rejects.toThrow('The dump is empty');
  });

  it('tells Grafana the moment of the backup, and fails the run when Grafana refuses', async () => {
    const posts: { url: string; body: string; authorization: string | undefined }[] = [];
    await markBackup({
      url: 'https://metrics.example.test/push',
      user: '1001',
      token: 'token',
      now: NOW,
      post: (url, init) => {
        posts.push({ url, body: init.body, authorization: init.headers.Authorization });
        return Promise.resolve({ ok: true, status: 204 });
      },
    });
    expect(posts).toEqual([
      {
        url: 'https://metrics.example.test/push',
        body: `sodiq_backup,service=backup last_success=${String(NOW.getTime() / 1000)}i ${String(NOW.getTime())}000000`,
        authorization: `Basic ${Buffer.from('1001:token').toString('base64')}`,
      },
    ]);
    await expect(
      markBackup({
        url: 'https://metrics.example.test/push',
        user: '1001',
        token: 'token',
        now: NOW,
        post: () => Promise.resolve({ ok: false, status: 401 }),
      }),
    ).rejects.toThrow('Grafana answered 401');
  });
});
