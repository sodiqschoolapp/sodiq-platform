import { describe, expect, it } from 'vitest';
import { fitWithin, photoRefusalOf } from './shrink-photo';

// Task 2.2c-2, the owner's answer 2: JPEG or PNG, at most 5 MB as chosen,
// shrunk to at most 800 pixels on the long side.
describe('shrinking a photo', () => {
  it('fits the long side into 800 pixels and keeps the proportions', () => {
    expect(fitWithin(1600, 1200)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 600, height: 800 });
    expect(fitWithin(800, 800)).toEqual({ width: 800, height: 800 });
    expect(fitWithin(10000, 3)).toEqual({ width: 800, height: 1 });
  });

  it('never enlarges a smaller photo', () => {
    expect(fitWithin(320, 240)).toEqual({ width: 320, height: 240 });
    expect(fitWithin(1, 1)).toEqual({ width: 1, height: 1 });
  });

  it('takes a JPEG or PNG of up to 5,000,000 bytes and refuses the rest', () => {
    expect(photoRefusalOf({ type: 'image/jpeg', size: 5_000_000 })).toBeNull();
    expect(photoRefusalOf({ type: 'image/png', size: 1 })).toBeNull();
    expect(photoRefusalOf({ type: 'image/jpeg', size: 5_000_001 })).toBe('photo_too_large');
    expect(photoRefusalOf({ type: 'image/gif', size: 10 })).toBe('photo_invalid');
    expect(photoRefusalOf({ type: 'image/heic', size: 10 })).toBe('photo_invalid');
    expect(photoRefusalOf({ type: '', size: 10 })).toBe('photo_invalid');
  });
});
