import { PHOTO_MAX_SIDE, type PhotoType } from '@sodiq/shared';

export interface PhotoSize {
  width: number;
  height: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The size of a photo read from its header, or `null` when the bytes are not
 * a photo the school keeps (task 2.2c-2; the owner's answer 2): the signature
 * of the declared type, and both sides from 1 to 800 pixels. The browser
 * shrinks every photo to that size; the server keeps the rule for a client
 * that does not (decision 4). No image library: only the header is read, the
 * file is stored as sent.
 */
export function photoSizeOf(bytes: Buffer, type: PhotoType): PhotoSize | null {
  const size = type === 'image/png' ? pngSize(bytes) : jpegSize(bytes);
  if (size === null) {
    return null;
  }
  const fits = (side: number) => side >= 1 && side <= PHOTO_MAX_SIDE;
  return fits(size.width) && fits(size.height) ? size : null;
}

/** PNG: the signature, then the `IHDR` chunk of 13 bytes with width and height. */
function pngSize(bytes: Buffer): PhotoSize | null {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return null;
  }
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString('latin1', 12, 16) !== 'IHDR') {
    return null;
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** The markers that start a frame and hold its size: SOF0–SOF15 without DHT (C4), JPG (C8) and DAC (CC). */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** Markers that stand alone, with no length after them. */
function standsAlone(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

/**
 * JPEG: start of image, then segments up to the first start of frame, which
 * holds the height and width. The start of the scan or the end of the image
 * before any frame, or a segment that runs past the end, is not a photo.
 */
function jpegSize(bytes: Buffer): PhotoSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return null;
  }
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      return null;
    }
    // Any number of fill bytes may come before a marker.
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1;
    }
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd8 || marker === 0xd9 || marker === 0xda) {
      return null;
    }
    if (standsAlone(marker)) {
      continue;
    }
    if (offset + 2 > bytes.length) {
      return null;
    }
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) {
      return null;
    }
    if (isStartOfFrame(marker)) {
      // Length (2), precision (1), height (2), width (2).
      if (length < 7) {
        return null;
      }
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return null;
}
