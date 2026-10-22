import type { PlanFileType } from '@sodiq/shared';

/**
 * Whether the bytes of a plan file are of the type the request names (task
 * 7.1a, decision 3: "The first bytes are checked against the type"). The
 * office files are zip archives holding a folder of their own kind.
 */
export function fileMatchesType(bytes: Buffer, type: PlanFileType): boolean {
  const starts = (...expected: number[]) =>
    bytes.length >= expected.length && expected.every((byte, index) => bytes[index] === byte);
  const zipHolding = (folder: string) =>
    starts(0x50, 0x4b, 0x03, 0x04) && bytes.includes(Buffer.from(folder, 'latin1'));
  switch (type) {
    case 'application/pdf':
      return starts(0x25, 0x50, 0x44, 0x46, 0x2d);
    case 'image/jpeg':
      return starts(0xff, 0xd8, 0xff);
    case 'image/png':
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return zipHolding('word/');
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return zipHolding('xl/');
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return zipHolding('ppt/');
    case 'audio/mpeg':
      // An ID3 tag, or an MPEG audio frame.
      return (
        starts(0x49, 0x44, 0x33) ||
        (bytes.length >= 2 && bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)
      );
    case 'video/mp4':
      return bytes.length >= 8 && bytes.toString('latin1', 4, 8) === 'ftyp';
  }
}
