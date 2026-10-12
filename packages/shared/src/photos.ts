import { z } from 'zod';

/**
 * Photos of people (task 2.2c-2; the owner's answer 2 in docs/decisions.md,
 * "Decided ahead for tasks 2.1 to 2.6"): "JPEG or PNG, at most 5 MB as chosen
 * by the user; the browser shrinks the photo to at most 800 pixels on the
 * long side before upload". The browser and the server read the same bounds.
 */
export const PHOTO_TYPES = ['image/jpeg', 'image/png'] as const;

export const photoTypeSchema = z.enum(PHOTO_TYPES);

export type PhotoType = z.infer<typeof photoTypeSchema>;

/** 5 MB, read as decimal (decision 10 of pull request #59): 5,000,000 bytes is taken, one more is refused. */
export const PHOTO_MAX_BYTES = 5_000_000;

/** The longest side of a stored photo, in pixels; the browser shrinks to it and the server refuses more. */
export const PHOTO_MAX_SIDE = 800;
