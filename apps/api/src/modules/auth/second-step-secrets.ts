import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/config.js';

/**
 * The version of the key that new secrets are encrypted with. Every stored
 * secret starts with the version of its key (`v1:`), so the key can be changed
 * later without a migration: the new key gets the next number and a variable of
 * its own, the old one stays readable under its number until no secret has it.
 */
const CURRENT_KEY_VERSION = 1;

const IV_BYTES = 12;
const TAG_BYTES = 16;

const STORED = /^v([1-9][0-9]*):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/;

/**
 * The secret of an authenticator app at rest (task 0.6c, decided by the
 * owner): AES-256-GCM from Node's own `crypto`, with the key of
 * `SECOND_STEP_KEY`, which is not in the database. A copy of the database or a
 * backup gives nobody the second step. The account is bound into each secret,
 * so the row of one account opens nothing when it is copied to another.
 */
@Injectable()
export class SecondStepSecrets {
  private readonly keys: ReadonlyMap<number, Buffer>;

  constructor(@Inject(CONFIG) config: Pick<AppConfig, 'secondStepKey'>) {
    this.keys = new Map([[CURRENT_KEY_VERSION, Buffer.from(config.secondStepKey, 'base64')]]);
  }

  /** The text to store for a secret: `v<key version>:<iv>:<encrypted secret and tag>`. */
  seal(accountId: string, secret: Buffer): string {
    const key = this.keys.get(CURRENT_KEY_VERSION);
    if (key === undefined) {
      throw new Error('The key of the second step is missing.');
    }
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(accountId, 'utf8'));
    const sealed = Buffer.concat([cipher.update(secret), cipher.final(), cipher.getAuthTag()]);
    return `v${String(CURRENT_KEY_VERSION)}:${iv.toString('base64')}:${sealed.toString('base64')}`;
  }

  /**
   * The secret of a stored text, or `undefined` when it cannot be read: a key
   * version we do not have, another key, another account, or a text that was
   * changed. Never an error: the caller decides what an unreadable secret means.
   */
  open(accountId: string, stored: string): Buffer | undefined {
    const parts = STORED.exec(stored);
    if (parts === null) {
      return undefined;
    }
    const key = this.keys.get(Number(parts[1]));
    // Safe: the pattern matched, so both groups are there.
    const iv = Buffer.from(parts[2] as string, 'base64');
    const sealed = Buffer.from(parts[3] as string, 'base64');
    if (key === undefined || iv.length !== IV_BYTES || sealed.length <= TAG_BYTES) {
      return undefined;
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from(accountId, 'utf8'));
      decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
      return Buffer.concat([
        decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)),
        decipher.final(),
      ]);
    } catch {
      // The tag does not fit: not our key, not this account, or not what we stored.
      return undefined;
    }
  }
}
