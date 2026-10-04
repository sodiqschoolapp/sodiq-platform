import { createHmac } from 'node:crypto';

// What an authenticator app does with the key it is shown (RFC 6238:
// HMAC-SHA-1, six digits, a new code every 30 seconds). Written here on its
// own, not taken from the API, so the test checks the server against the
// standard and not against itself.

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(text: string): Buffer {
  let bits = '';
  for (const character of text) {
    const value = BASE32.indexOf(character);
    if (value === -1) {
      throw new Error('The key is not base32.');
    }
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

/** The code the app shows now for a key as the set-up page prints it (spaces allowed). */
export function codeNow(key: string): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const mac = createHmac('sha1', base32Decode(key.replaceAll(/\s/g, '')))
    .update(counter)
    .digest();
  const offset = mac.readUInt8(mac.length - 1) & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
