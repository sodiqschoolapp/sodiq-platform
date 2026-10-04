import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * docs/spec/13-technology.md, Security: passwords stored with Argon2id.
 * Argon2 comes from Node itself (docs/decisions.md, task 0.6a). The stored text
 * is the usual PHC form, with its own salt and parameters:
 *
 *     $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
 *
 * so the parameters can be raised later without losing the old hashes.
 */

/** The smallest setting OWASP recommends for Argon2id: 19 MiB, 2 passes, 1 lane. */
const MEMORY_KIB = 19456;
const PASSES = 2;
const PARALLELISM = 1;
const SALT_BYTES = 16;
const TAG_BYTES = 32;

/** Argon2 version 1.3, the only one Node computes. */
const VERSION = 19;

const PHC =
  /^\$argon2id\$v=(\d{1,3})\$m=(\d{1,8}),t=(\d{1,3}),p=(\d{1,3})\$([A-Za-z0-9+/]{11,86})\$([A-Za-z0-9+/]{22,86})$/;

interface Cost {
  memory: number;
  passes: number;
  parallelism: number;
}

function derive(password: string, salt: Buffer, cost: Cost, tagLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      { message: Buffer.from(password, 'utf8'), nonce: salt, tagLength, ...cost },
      (error, tag) => {
        if (error) {
          reject(error);
        } else {
          resolve(tag);
        }
      },
    );
  });
}

/** PHC text uses base64 without padding. */
const encode = (bytes: Buffer): string => bytes.toString('base64').replace(/=+$/, '');

/** The text to store for a password. Two calls give different texts: each has its own salt. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const cost = { memory: MEMORY_KIB, passes: PASSES, parallelism: PARALLELISM };
  const tag = await derive(password, salt, cost, TAG_BYTES);
  return `$argon2id$v=${String(VERSION)}$m=${String(MEMORY_KIB)},t=${String(PASSES)},p=${String(PARALLELISM)}$${encode(salt)}$${encode(tag)}`;
}

/**
 * Whether `password` is the one that `stored` was made from. A stored text
 * that cannot be read, or that asks for more work than we ever store, is "no".
 */
export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const parts = PHC.exec(stored);
  if (parts === null) {
    return false;
  }
  const [, version, memory, passes, parallelism, salt, tag] = parts;
  const cost = { memory: Number(memory), passes: Number(passes), parallelism: Number(parallelism) };
  if (
    Number(version) !== VERSION ||
    cost.memory < 8 * cost.parallelism ||
    cost.memory > 16 * MEMORY_KIB ||
    cost.passes < 1 ||
    cost.passes > 16 ||
    cost.parallelism < 1 ||
    cost.parallelism > 16
  ) {
    return false;
  }
  // Safe: the pattern matched, so every group is there.
  const expected = Buffer.from(tag as string, 'base64');
  const actual = await derive(
    password,
    Buffer.from(salt as string, 'base64'),
    cost,
    expected.length,
  );
  return timingSafeEqual(actual, expected);
}
