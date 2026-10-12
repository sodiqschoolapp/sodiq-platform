import { PHOTO_MAX_BYTES, PHOTO_MAX_SIDE, PHOTO_TYPES } from '@sodiq/shared';

/** Why a chosen file is not sent: not a JPEG or PNG, or more than 5 MB (answer 2). */
export type PhotoRefusal = 'photo_invalid' | 'photo_too_large';

/**
 * The size a photo is drawn at: the longest side at most 800 pixels, the
 * proportions kept, never larger than the original (task 2.2c-2).
 */
export function fitWithin(
  width: number,
  height: number,
  limit = PHOTO_MAX_SIDE,
): { width: number; height: number } {
  const scale = Math.min(1, limit / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** The refusal of a chosen file before it is read, or `null` when it may be shrunk. */
export function photoRefusalOf(file: Pick<File, 'type' | 'size'>): PhotoRefusal | null {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) {
    return 'photo_invalid';
  }
  return file.size > PHOTO_MAX_BYTES ? 'photo_too_large' : null;
}

/**
 * The owner's answer 2: "the browser shrinks the photo to at most 800 pixels
 * on the long side before upload (canvas, no library)". Always a JPEG at
 * quality 0.85, on white behind a transparent PNG (decision 5); a photo drawn
 * on a canvas carries no metadata. Fails when the browser cannot read the file.
 */
export async function shrinkPhoto(file: Blob): Promise<Blob> {
  const image = await createImageBitmap(file);
  try {
    const size = fitWithin(image.width, image.height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (context === null) {
      throw new Error('The browser gave no canvas to draw on.');
    }
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob === null) {
            reject(new Error('The browser could not make a JPEG.'));
          } else {
            resolve(blob);
          }
        },
        'image/jpeg',
        0.85,
      );
    });
  } finally {
    image.close();
  }
}
