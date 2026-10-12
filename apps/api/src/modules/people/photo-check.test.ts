import { PHOTO_MAX_SIDE } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import { jpegOf, pngOf } from '../../testing/photos-kit.js';
import { photoSizeOf } from './photo-check.js';

// Task 2.2c-2, the owner's answer 2 and decision 4: JPEG or PNG, at most 800
// pixels a side, read from the header of the file the server receives.
describe('photoSizeOf', () => {
  it('reads the size of a PNG', () => {
    expect(photoSizeOf(pngOf(600, 800), 'image/png')).toEqual({ width: 600, height: 800 });
  });

  it.each([false, true])('reads the size of a JPEG (progressive: %s)', (progressive) => {
    expect(photoSizeOf(jpegOf(800, 533, progressive), 'image/jpeg')).toEqual({
      width: 800,
      height: 533,
    });
  });

  it('reads a JPEG with fill bytes and stand-alone markers before the frame', () => {
    const plain = jpegOf(40, 30);
    const withFill = Buffer.concat([
      plain.subarray(0, 2),
      Buffer.from([0xff, 0xd0, 0xff, 0xff]),
      plain.subarray(3),
    ]);
    expect(photoSizeOf(withFill, 'image/jpeg')).toEqual({ width: 40, height: 30 });
  });

  it.each([
    [PHOTO_MAX_SIDE + 1, 600],
    [600, PHOTO_MAX_SIDE + 1],
    [0, 10],
    [10, 0],
  ])('refuses %i by %i pixels', (width, height) => {
    expect(photoSizeOf(pngOf(width, height), 'image/png')).toBeNull();
    expect(photoSizeOf(jpegOf(width, height), 'image/jpeg')).toBeNull();
  });

  it('takes 800 by 800 pixels', () => {
    expect(photoSizeOf(jpegOf(800, 800), 'image/jpeg')).toEqual({ width: 800, height: 800 });
    expect(photoSizeOf(pngOf(800, 1), 'image/png')).toEqual({ width: 800, height: 1 });
  });

  it('refuses a JPEG sent as PNG and a PNG sent as JPEG', () => {
    expect(photoSizeOf(jpegOf(10, 10), 'image/png')).toBeNull();
    expect(photoSizeOf(pngOf(10, 10), 'image/jpeg')).toBeNull();
  });

  it('refuses a header cut short, and a scan before any frame', () => {
    const jpeg = jpegOf(10, 10);
    for (let end = 0; end < 120; end += 1) {
      if (end < jpeg.indexOf(Buffer.from([0xff, 0xc0])) + 9) {
        expect(photoSizeOf(jpeg.subarray(0, end), 'image/jpeg')).toBeNull();
      }
    }
    expect(photoSizeOf(pngOf(10, 10).subarray(0, 23), 'image/png')).toBeNull();
    expect(
      photoSizeOf(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9]), 'image/jpeg'),
    ).toBeNull();
    expect(photoSizeOf(Buffer.from('<html></html>'), 'image/jpeg')).toBeNull();
  });

  it('never throws on any bytes, only refuses or reads a size within the bounds', () => {
    // A fixed sequence of pseudo-random bytes (a linear congruential
    // generator), so that a failure is the same on every run.
    let seed = 2_2;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed % 256;
    };
    for (let run = 0; run < 3000; run += 1) {
      const type = run % 2 === 0 ? ('image/jpeg' as const) : ('image/png' as const);
      const prefix =
        type === 'image/png'
          ? Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
          : Buffer.from([0xff, 0xd8, 0xff]);
      const random = Buffer.from(Array.from({ length: next() }, next));
      const bytes = run % 3 === 0 ? random : Buffer.concat([prefix, random]);
      const size = photoSizeOf(bytes, type);
      if (size !== null) {
        expect(size.width).toBeGreaterThanOrEqual(1);
        expect(size.width).toBeLessThanOrEqual(PHOTO_MAX_SIDE);
        expect(size.height).toBeGreaterThanOrEqual(1);
        expect(size.height).toBeLessThanOrEqual(PHOTO_MAX_SIDE);
      }
    }
  });
});
