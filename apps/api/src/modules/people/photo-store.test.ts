import { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import {
  MemoryPhotoStore,
  NoPhotoStore,
  photoStoreOf,
  R2_CONNECTION_TIMEOUT_MS,
  R2_REQUEST_TIMEOUT_MS,
  r2ClientConfig,
  R2PhotoStore,
  staffPhotoKey,
} from './photo-store.js';

const R2 = {
  store: 'r2',
  accountId: 'b'.repeat(32),
  accessKeyId: 'invented-key-id',
  secretAccessKey: 'invented-secret',
  bucket: 'sodiq-photos-test',
} as const;

/**
 * A real client whose requests stop before the network: each command's input
 * is kept, and the answer is made here.
 */
function capturingClient(answer: Record<string, unknown> = {}) {
  const client = new S3Client(r2ClientConfig(R2));
  const sent: { command: string; input: Record<string, unknown> }[] = [];
  client.middlewareStack.add(
    (_next, context) => (args) => {
      sent.push({
        command: String(context.commandName),
        input: args.input as Record<string, unknown>,
      });
      return Promise.resolve({ output: { $metadata: {}, ...answer }, response: {} });
    },
    { step: 'initialize', name: 'capture', priority: 'high' },
  );
  return { client, sent };
}

// Task 2.2c-2, the owner's answer 2: R2 through the S3 API, never reached by
// tests or CI (the commands are caught before the network).
describe('the photo stores', () => {
  it('chooses the store the configuration names', () => {
    expect(photoStoreOf(R2)).toBeInstanceOf(R2PhotoStore);
    expect(photoStoreOf({ store: 'memory' })).toBeInstanceOf(MemoryPhotoStore);
    expect(photoStoreOf({ store: 'none' }).configured).toBe(false);
  });

  it('sets up the R2 client for Cloudflare: endpoint, region, checksums when required, one attempt, timeouts', async () => {
    const config = r2ClientConfig(R2);
    expect(config).toMatchObject({
      region: 'auto',
      endpoint: `https://${R2.accountId}.r2.cloudflarestorage.com`,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      maxAttempts: 1,
      requestHandler: {
        connectionTimeout: R2_CONNECTION_TIMEOUT_MS,
        requestTimeout: R2_REQUEST_TIMEOUT_MS,
        throwOnRequestTimeout: true,
      },
    });
    const client = new S3Client(config);
    expect(await client.config.requestChecksumCalculation()).toBe('WHEN_REQUIRED');
    expect(await client.config.responseChecksumValidation()).toBe('WHEN_REQUIRED');
    expect(await client.config.maxAttempts()).toBe(1);
  });

  it('puts and gets an object in the bucket under its key', async () => {
    const bytes = Buffer.from([1, 2, 3]);
    const { client, sent } = capturingClient({
      Body: { transformToByteArray: () => Promise.resolve(new Uint8Array(bytes)) },
    });
    const store = new R2PhotoStore(client, R2.bucket);
    const key = staffPhotoKey('staff-row', 'photo-id');
    expect(key).toBe('staff/staff-row/photo-id');
    await store.put(key, bytes, 'image/png');
    expect(Buffer.compare(await store.get(key), bytes)).toBe(0);
    expect(sent).toEqual([
      {
        command: 'PutObjectCommand',
        input: { Bucket: R2.bucket, Key: key, Body: bytes, ContentType: 'image/png' },
      },
      { command: 'GetObjectCommand', input: { Bucket: R2.bucket, Key: key } },
    ]);
  });

  it('fails a get with no body', async () => {
    const { client } = capturingClient();
    await expect(new R2PhotoStore(client, R2.bucket).get('staff/a/b')).rejects.toThrow();
  });

  it('keeps photos in memory, and refuses everything with no store', async () => {
    const memory = new MemoryPhotoStore();
    await memory.put('staff/a/b', Buffer.from('x'), 'image/jpeg');
    expect((await memory.get('staff/a/b')).toString()).toBe('x');
    await expect(memory.get('staff/a/c')).rejects.toThrow();
    const none = new NoPhotoStore();
    await expect(none.put()).rejects.toThrow();
    await expect(none.get()).rejects.toThrow();
  });
});
