import { describe, expect, it } from 'vitest';
import { PHOTO_MAX_BYTES, PHOTO_MAX_SIDE, PHOTO_TYPES, photoTypeSchema } from './photos.js';

// Task 2.2c-2, the owner's answer 2: "JPEG or PNG, at most 5 MB ... at most
// 800 pixels on the long side"; 5 MB read as 5,000,000 bytes (decision 10).
describe('photo bounds', () => {
  it('are those of answer 2', () => {
    expect(PHOTO_TYPES).toEqual(['image/jpeg', 'image/png']);
    expect(PHOTO_MAX_BYTES).toBe(5_000_000);
    expect(PHOTO_MAX_SIDE).toBe(800);
  });

  it('take only the two types', () => {
    expect(photoTypeSchema.safeParse('image/png').success).toBe(true);
    expect(photoTypeSchema.safeParse('image/gif').success).toBe(false);
  });
});
