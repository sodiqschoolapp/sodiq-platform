import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import type { PhotoType, PlanFileType } from '@sodiq/shared';
import type { PhotosConfig } from '../../config/config.js';

/** Injection token of the `PhotoStore` the configuration chose. */
export const PHOTO_STORE = Symbol('PHOTO_STORE');

/**
 * Where the bytes of photos live (task 2.2c-2; the owner's answer 2): the R2
 * bucket on a server, memory in tests and the browser tests, nothing when
 * neither is configured. The database keeps which photo is current; the store
 * keeps the files under keys that are never reused. A call to a store is never
 * made while a transaction is open (spec review of pull request #59): a store
 * that hangs must not hold pooled connections or row locks.
 */
export interface PhotoStore {
  /** `false`: the photo routes answer `photos_not_configured`. */
  readonly configured: boolean;
  /**
   * Throws when the store fails or does not answer in time. `type` is one of
   * the types its route declares: a photo's, or a plan file's (task 7.1a,
   * decision 1: the files of plan items go to the same store under `plans/`).
   */
  put(key: string, bytes: Buffer, type: PhotoType | PlanFileType): Promise<void>;
  /** The bytes under the key; throws when the store fails or holds nothing there. */
  get(key: string): Promise<Buffer>;
  /**
   * Removes every file whose key starts with `prefix` (task 10.2a: the files of
   * an expired or failed branch export, `exports/<id>/`). Nothing there is no
   * error; throws when the store fails.
   */
  deletePrefix(prefix: string): Promise<void>;
}

/** The key of a staff member's photo: one per upload, never reused. */
export function staffPhotoKey(staffId: string, photoId: string): string {
  return `staff/${staffId}/${photoId}`;
}

/** The key of a student's photo (task 2.4b-2): one per upload, never reused. */
export function studentPhotoKey(studentId: string, photoId: string): string {
  return `students/${studentId}/${photoId}`;
}

/** The key of a file of a plan item (task 7.1a, decision 1): one per upload, never reused. */
export function planFileKey(itemId: string, fileId: string): string {
  return `plans/${itemId}/${fileId}`;
}

/** No store on this server: nothing is read or written. */
export class NoPhotoStore implements PhotoStore {
  readonly configured = false;

  put(): Promise<void> {
    return Promise.reject(new Error('No photo store is configured.'));
  }

  get(): Promise<Buffer> {
    return Promise.reject(new Error('No photo store is configured.'));
  }

  /** No store holds no file: nothing to remove (the daily cleanup never fails for it). */
  deletePrefix(): Promise<void> {
    return Promise.resolve();
  }
}

/** Photos in the memory of the process, lost on a restart: tests, the browser tests, a laptop. */
export class MemoryPhotoStore implements PhotoStore {
  readonly configured = true;
  private readonly objects = new Map<string, { bytes: Buffer; type: PhotoType | PlanFileType }>();

  put(key: string, bytes: Buffer, type: PhotoType | PlanFileType): Promise<void> {
    this.objects.set(key, { bytes: Buffer.from(bytes), type });
    return Promise.resolve();
  }

  get(key: string): Promise<Buffer> {
    const found = this.objects.get(key);
    return found === undefined
      ? Promise.reject(new Error('No photo is stored under the key.'))
      : Promise.resolve(Buffer.from(found.bytes));
  }

  deletePrefix(prefix: string): Promise<void> {
    for (const key of [...this.objects.keys()]) {
      if (key.startsWith(prefix)) this.objects.delete(key);
    }
    return Promise.resolve();
  }

  /** The keys stored so far, in order, for tests that check nothing was written. */
  keys(): string[] {
    return [...this.objects.keys()];
  }
}

/** How long a call to R2 may take before the photo route answers `photos_unavailable`. */
export const R2_REQUEST_TIMEOUT_MS = 10_000;
export const R2_CONNECTION_TIMEOUT_MS = 5_000;

type R2Config = Extract<PhotosConfig, { store: 'r2' }>;

/**
 * The client settings for R2 (Cloudflare's S3 API). Checksums only when an
 * operation requires them, as Cloudflare advises for R2 with recent versions
 * of the SDK; one attempt, with a timeout, so that a store that is down fails
 * one photo request quickly (`edge/system-behaviour`: "Only that function fails").
 */
export function r2ClientConfig(config: R2Config): S3ClientConfig {
  return {
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 1,
    requestHandler: {
      connectionTimeout: R2_CONNECTION_TIMEOUT_MS,
      requestTimeout: R2_REQUEST_TIMEOUT_MS,
      throwOnRequestTimeout: true,
    },
  };
}

/** The R2 bucket of the owner's answer 2. */
export class R2PhotoStore implements PhotoStore {
  readonly configured = true;

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async put(key: string, bytes: Buffer, type: PhotoType | PlanFileType): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: type }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const answer = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (answer.Body === undefined) {
      throw new Error('R2 answered without a body.');
    }
    return Buffer.from(await answer.Body.transformToByteArray());
  }

  async deletePrefix(prefix: string): Promise<void> {
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const object of page.Contents ?? []) {
        if (object.Key === undefined) continue;
        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: object.Key }));
      }
      token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
    } while (token !== undefined);
  }
}

/** The store the configuration names. */
let memoryStore: MemoryPhotoStore | undefined;

export function photoStoreOf(config: PhotosConfig): PhotoStore {
  switch (config.store) {
    case 'r2':
      return new R2PhotoStore(new S3Client(r2ClientConfig(config)), config.bucket);
    case 'memory':
      // One store for the process, as one bucket on a server (task 8.9): the browser tests run
      // the API and the worker in one process, and a file the worker writes is read by the API.
      memoryStore ??= new MemoryPhotoStore();
      return memoryStore;
    case 'none':
      return new NoPhotoStore();
  }
}
