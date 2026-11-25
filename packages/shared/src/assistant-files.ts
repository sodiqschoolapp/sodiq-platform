import { z } from 'zod';
import { assistantRoleSchema } from './assistant.js';
import { STUDENT_IMPORT_MAX_BYTES } from './student-import.js';

/**
 * Task 11.22 (`02`, Assistant, Files, photos and voice): what a person may attach to a question,
 * or record on a phone, and the files the assistant keeps with a conversation (an export it made).
 * The bytes live in the photo store (R2) under `assistant/<file id>` (plan decision 8); the
 * database keeps the row (`assistant_files`, 0185).
 */

/** An Excel workbook, as the imports take it. */
export const ASSISTANT_EXCEL_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The types a person may attach, by kind (plan, Size and type limits). */
export const ASSISTANT_ATTACHMENT_TYPES = [
  ASSISTANT_EXCEL_TYPE,
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/** The types of a recorded question (`MediaRecorder` of the browsers the school uses). */
export const ASSISTANT_VOICE_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4'] as const;

/** Every type the upload route takes, and every type a stored file may have (0185). */
export const ASSISTANT_UPLOAD_TYPES: readonly string[] = [
  ...ASSISTANT_ATTACHMENT_TYPES,
  ...ASSISTANT_VOICE_TYPES,
];

export type AssistantAttachmentType = (typeof ASSISTANT_ATTACHMENT_TYPES)[number];
export type AssistantVoiceType = (typeof ASSISTANT_VOICE_TYPES)[number];

/** The kinds of a stored file: attached, recorded, or an export the assistant made. */
export const ASSISTANT_FILE_KINDS = ['attachment', 'voice', 'export'] as const;

export type AssistantFileKind = (typeof ASSISTANT_FILE_KINDS)[number];

/** The kinds a person uploads (an export is made by the assistant, never uploaded). */
export const ASSISTANT_UPLOAD_KINDS = ['attachment', 'voice'] as const;

export type AssistantUploadKind = (typeof ASSISTANT_UPLOAD_KINDS)[number];

/** The largest body the upload route reads (10 MB); one more is refused 413 before the guard. */
export const ASSISTANT_UPLOAD_MAX_BYTES = 10_000_000;

/** An Excel workbook: as the imports (5 MB). */
export const ASSISTANT_EXCEL_MAX_BYTES = STUDENT_IMPORT_MAX_BYTES;

/** A recording: 5 MB (2 minutes on the recorder). */
export const ASSISTANT_VOICE_MAX_BYTES = 5_000_000;

/** The longest recording the microphone button takes, in seconds. */
export const ASSISTANT_VOICE_MAX_SECONDS = 120;

/** The most files one question carries. */
export const ASSISTANT_FILES_PER_QUESTION = 5;

/**
 * The most bytes of files one question carries (14 MB): sent inline, base64 makes them about
 * 19 MB, under the request limit of Gemini on Vertex.
 */
export const ASSISTANT_QUESTION_FILES_MAX_BYTES = 14_000_000;

/** An upload not sent with a question within this time cannot be sent (plan decision 9). */
export const ASSISTANT_UPLOAD_HOURS = 24;

/** The longest file name kept. */
export const ASSISTANT_FILE_NAME_MAX = 200;

/** The largest file of a type: the per-type limits of the plan. */
export function assistantFileMaxBytes(type: string): number {
  if (type === ASSISTANT_EXCEL_TYPE) return ASSISTANT_EXCEL_MAX_BYTES;
  if ((ASSISTANT_VOICE_TYPES as readonly string[]).includes(type)) return ASSISTANT_VOICE_MAX_BYTES;
  return ASSISTANT_UPLOAD_MAX_BYTES;
}

/** Whether a type may be uploaded as this kind. */
export function assistantTypeFits(kind: AssistantUploadKind, type: string): boolean {
  return kind === 'voice'
    ? (ASSISTANT_VOICE_TYPES as readonly string[]).includes(type)
    : (ASSISTANT_ATTACHMENT_TYPES as readonly string[]).includes(type);
}

/** The query of `PUT /api/assistant/files`; the file is the raw body. */
export const assistantFileUploadQuerySchema = z.strictObject({
  role: assistantRoleSchema,
  kind: z.enum(ASSISTANT_UPLOAD_KINDS),
  name: z.string().trim().min(1).max(ASSISTANT_FILE_NAME_MAX),
});

export type AssistantFileUploadQuery = z.infer<typeof assistantFileUploadQuerySchema>;

/** A stored file as the person reads it. */
export const assistantFileSchema = z.object({
  id: z.uuid(),
  kind: z.enum(ASSISTANT_FILE_KINDS),
  name: z.string(),
  mediaType: z.string(),
  size: z.int().positive(),
});

export type AssistantFile = z.infer<typeof assistantFileSchema>;

export const assistantFileParamsSchema = z.strictObject({ id: z.uuid() });

export type AssistantFileParams = z.infer<typeof assistantFileParamsSchema>;

/** Task 11.22: the Super Admin's download of a file of any conversation (review correction 3). */
export const assistantAnyFileParamsSchema = z.strictObject({ id: z.uuid(), fileId: z.uuid() });

export type AssistantAnyFileParams = z.infer<typeof assistantAnyFileParamsSchema>;

/** Every type a file of the assistant may have (0185): an upload's, or an export's. */
export type AssistantFileType = AssistantAttachmentType | AssistantVoiceType;

/** The key of a file of the assistant in the photo store (plan decision 8): never reused. */
export function assistantFileKey(fileId: string): string {
  return `assistant/${fileId}`;
}
