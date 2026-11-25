import {
  ASSISTANT_ATTACHMENT_TYPES,
  ASSISTANT_FILES_PER_QUESTION,
  ASSISTANT_QUESTION_FILES_MAX_BYTES,
  ASSISTANT_VOICE_MAX_SECONDS,
  assistantFileMaxBytes,
  assistantTypeFits,
  type AssistantFile,
  type AssistantMessage,
  type AssistantRole,
} from '@sodiq/shared';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { failureText } from '@/api/failure-text';
import { AttachFileIcon, CloseIcon, DownloadIcon, MicIcon, StopIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { downloadAssistantFile, uploadAssistantFile } from './assistant-api';

/**
 * Task 11.22 (`02`, Assistant, Files, photos and voice): the files attached to the question not
 * sent yet. Kept outside the panel and the page, like the typed words are kept outside the chat,
 * so closing the panel, leaving the page or opening the Assistant page loses none (`12`, No lost
 * work). Lost on a reload, as an upload not sent is (plan decision 9).
 */
let draft: readonly AssistantFile[] = [];
const listeners = new Set<() => void>();

function setDraft(next: readonly AssistantFile[]): void {
  draft = next;
  for (const listener of listeners) listener();
}

/** Empties the files attached and not sent (a sign-out, a test). */
export function resetDraftFiles(): void {
  setDraft([]);
}

export function useDraftFiles(): readonly [
  readonly AssistantFile[],
  (next: readonly AssistantFile[]) => void,
] {
  const files = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => draft,
  );
  return [files, setDraft] as const;
}

/** What the person is told when a file is not taken: a refusal of the API, or one of the browser. */
export type FileFailure = ApiFailure | 'tooMany' | 'noRecorder' | 'microphoneRefused';

/** The text of a failure of a file. */
export function useFileFailureText(): (failure: FileFailure) => string {
  const { t } = useTranslation();
  return (failure) =>
    failure instanceof ApiFailure ? failureText(t, failure) : t(`assistant.files.${failure}`);
}

/** Why a file is not taken before it is sent; `null`: taken. */
export function fileRefusal(
  file: { type: string; size: number },
  attached: readonly AssistantFile[],
): FileFailure | null {
  const type = file.type.split(';')[0] ?? '';
  if (!assistantTypeFits('attachment', type)) return new ApiFailure('unsupported_media_type');
  if (file.size > assistantFileMaxBytes(type)) return new ApiFailure('assistant_file_too_large');
  if (attached.length >= ASSISTANT_FILES_PER_QUESTION) return 'tooMany';
  const total = attached.reduce((sum, one) => sum + one.size, 0) + file.size;
  if (total > ASSISTANT_QUESTION_FILES_MAX_BYTES)
    return new ApiFailure('assistant_files_too_large');
  return null;
}

/** The paperclip: chooses files, checks each before the upload, and uploads it at once. */
export function AttachButton({
  role,
  disabled,
  onFailure,
}: {
  role: AssistantRole;
  disabled: boolean;
  onFailure: (failure: FileFailure | null) => void;
}) {
  const { t } = useTranslation();
  const [files, setFiles] = useDraftFiles();
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const choose = async (chosen: readonly File[]): Promise<void> => {
    onFailure(null);
    setUploading(true);
    let attached = files;
    try {
      for (const file of chosen) {
        const refusal = fileRefusal(file, attached);
        if (refusal !== null) {
          onFailure(refusal);
          break;
        }
        try {
          const stored = await uploadAssistantFile(role, 'attachment', file, file.name);
          attached = [...attached, stored];
          setFiles(attached);
        } catch (error) {
          onFailure(failureOf(error));
          break;
        }
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={ASSISTANT_ATTACHMENT_TYPES.join(',')}
        data-assistant-file-input=""
        onChange={(event) => {
          const chosen = [...(event.target.files ?? [])];
          event.target.value = '';
          void choose(chosen);
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="max-sm:size-11"
        aria-label={t('assistant.files.attach')}
        pending={uploading}
        disabled={disabled || files.length >= ASSISTANT_FILES_PER_QUESTION}
        onClick={() => input.current?.click()}
      >
        {!uploading && <AttachFileIcon aria-hidden />}
      </Button>
    </>
  );
}

/** The chips of the files attached, each with its remove button. */
export function DraftChips() {
  const { t } = useTranslation();
  const [files, setFiles] = useDraftFiles();
  if (files.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label={t('assistant.files.attached')}>
      {files.map((file) => (
        <li
          key={file.id}
          className="flex max-w-full items-center gap-1 rounded-full border bg-muted py-0.5 ps-3 pe-1 text-sm"
        >
          <span className="truncate">{file.name}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t('assistant.files.remove', { name: file.name })}
            onClick={() => {
              setFiles(files.filter((one) => one.id !== file.id));
            }}
          >
            <CloseIcon aria-hidden />
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** A failed upload or download as a failure of a file. */
export function failureOf(error: unknown): FileFailure {
  return error instanceof ApiFailure ? error : new ApiFailure('request_refused');
}

/** Whether the browser can record (`MediaRecorder` and a microphone). */
export function canRecord(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder === 'function' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

/** The type a recorder makes here: the first of the voice types the browser records. */
function recordingType(): string | undefined {
  return ['audio/webm', 'audio/ogg', 'audio/mp4'].find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
}

/**
 * The microphone of a phone (`02`: "On a phone the person can speak the question"): records up
 * to two minutes with the time running, and on Stop uploads the recording and sends it.
 */
export function MicButton({
  role,
  disabled,
  onRecorded,
  onFailure,
}: {
  role: AssistantRole;
  disabled: boolean;
  onRecorded: (voiceId: string) => void;
  onFailure: (failure: FileFailure | null) => void;
}) {
  const { t } = useTranslation();
  const [seconds, setSeconds] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    if (seconds === null) return;
    if (seconds >= ASSISTANT_VOICE_MAX_SECONDS) {
      recorder.current?.stop();
      return;
    }
    const timer = setTimeout(() => {
      setSeconds((now) => (now === null ? null : now + 1));
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [seconds]);

  // Leaving the chat stops the microphone.
  useEffect(
    () => () => {
      if (recorder.current?.state === 'recording') recorder.current.stop();
    },
    [],
  );

  const start = async (): Promise<void> => {
    onFailure(null);
    const type = recordingType();
    if (type === undefined) {
      onFailure('noRecorder');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onFailure('microphoneRefused');
      return;
    }
    const chunks: Blob[] = [];
    const made = new MediaRecorder(stream, { mimeType: type });
    made.ondataavailable = (event) => {
      chunks.push(event.data);
    };
    made.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      recorder.current = null;
      setSeconds(null);
      const blob = new Blob(chunks, { type });
      if (blob.size === 0) return;
      setUploading(true);
      uploadAssistantFile(role, 'voice', blob, `question.${type.slice('audio/'.length)}`)
        .then((stored) => {
          onRecorded(stored.id);
        })
        .catch((error: unknown) => {
          onFailure(failureOf(error));
        })
        .finally(() => {
          setUploading(false);
        });
    };
    recorder.current = made;
    made.start();
    setSeconds(0);
  };

  const recording = seconds !== null;
  const minutes = Math.floor((seconds ?? 0) / 60);
  const rest = String((seconds ?? 0) % 60).padStart(2, '0');
  return (
    <div className="flex items-center gap-2">
      {recording && (
        <span role="status" className="text-sm tabular-nums text-destructive">
          {t('assistant.files.recording', { time: `${String(minutes)}:${rest}` })}
        </span>
      )}
      <Button
        type="button"
        variant={recording ? 'destructive' : 'ghost'}
        size="icon"
        className="size-11"
        aria-label={recording ? t('assistant.files.stop') : t('assistant.files.record')}
        pending={uploading}
        disabled={disabled && !recording}
        onClick={() => {
          if (recording) recorder.current?.stop();
          else void start();
        }}
      >
        {!uploading && (recording ? <StopIcon aria-hidden /> : <MicIcon aria-hidden />)}
      </Button>
    </div>
  );
}

/**
 * The files of a message (task 11.22): a question's attachments and recording, an answer's
 * exports, each with its download. `conversationId` downloads through the Super Admin's route of
 * every conversation.
 */
export function MessageFiles({
  message,
  conversationId,
}: {
  message: Extract<AssistantMessage, { kind: 'question' | 'answer' }>;
  conversationId?: string;
}) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState<FileFailure | null>(null);
  const textOf = useFileFailureText();
  if (message.files.length === 0) return null;
  return (
    <div className="grid gap-1">
      <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label={t('assistant.files.files')}>
        {message.files.map((file) => (
          <li key={file.id}>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-link font-semibold hover:underline"
              onClick={() => {
                setFailed(null);
                downloadAssistantFile(file.id, file.name, conversationId).catch(
                  (error: unknown) => {
                    setFailed(failureOf(error));
                  },
                );
              }}
            >
              {file.kind === 'voice' ? (
                <MicIcon aria-hidden className="size-4" />
              ) : (
                <DownloadIcon aria-hidden className="size-4" />
              )}
              {file.kind === 'voice'
                ? t('assistant.files.recordingFile')
                : t('assistant.files.download', { name: file.name })}
            </button>
          </li>
        ))}
      </ul>
      {failed !== null && (
        <p role="alert" className="text-sm text-destructive">
          {textOf(failed)}
        </p>
      )}
    </div>
  );
}
