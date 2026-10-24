import {
  JOURNAL_VOID_REASON_MAX_LENGTH,
  journalVoidReasonSchema,
  nextDay,
  type JournalEntriesChoice,
  type JournalEntryDetail,
} from '@sodiq/shared';
import type { TFunction } from 'i18next';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { TextAreaField } from '@/components/field';
import { useRecordForm } from '@/components/form/use-record-form';
import { SaveCancelled } from '@/components/form/save-cancelled';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { schoolDateText } from '@/lib/dates';
import { asFormSchema } from './form-schema';

/**
 * The journal entries a move, a return, a leaving or a merge meets (task 8.6,
 * pull request #224; `edge/students-classes-groups`: "Entries in the old
 * journals on or after the date are listed; he either moves the date past
 * them or voids them with a reason"; "A 'present' mark or a real score after
 * the date blocks the save until someone checks it"). The server answers
 * `journal_entries` (or `student_merge_journal_cut`) with each entry; the
 * dialog lists them, says the first date past them, and sends the change
 * again with the entries seen and the reason. A list the server cannot void
 * (a move dated today) is not offered: its refusal shows beside the form.
 */

/** One entry the change met, as the refusal names it. */
export interface MetEntry {
  readonly id: string;
  readonly detail: JournalEntryDetail;
}

const VOID_CODES = new Set(['journal_entries', 'student_merge_journal_cut']);

/** The entries of a refusal that the change can void, or none. */
export function voidableEntries(error: unknown): MetEntry[] {
  if (!(error instanceof ApiFailure) || !VOID_CODES.has(error.code)) return [];
  const entries = (error.details ?? []).flatMap((detail) =>
    detail.journalEntry === undefined || detail.recordId === undefined
      ? []
      : [{ id: detail.recordId, detail: detail.journalEntry }],
  );
  return entries.length > 0 && entries.every((entry) => entry.detail.voidable) ? entries : [];
}

/** What an entry holds, in words. */
export function entryText(t: TFunction, entry: JournalEntryDetail): string {
  if (entry.kind === 'comment') return t('people.students.journalEntries.comment');
  if (entry.kind === 'rating') {
    return entry.didNotSit
      ? t('people.students.journalEntries.didNotSit')
      : t('people.students.journalEntries.rating', { score: entry.score ?? 0 });
  }
  switch (entry.mark) {
    case 0:
      return t('people.students.journalEntries.mark0');
    case 1:
      return t('people.students.journalEntries.mark1');
    case 2:
      return t('people.students.journalEntries.mark2');
    case 3:
      return t('people.students.journalEntries.mark3');
    default:
      return t('people.students.journalEntries.number', { score: entry.score ?? 0 });
  }
}

/**
 * Wraps a send that may meet journal entries: the first send goes without a
 * choice; on a voidable list the dialog asks, and the send goes again with
 * the entries seen and the reason. Cancelling the dialog cancels the save.
 */
export function useJournalEntries(): {
  withEntries: <T>(send: (choice: JournalEntriesChoice | undefined) => Promise<T>) => Promise<T>;
  dialog: ReactNode;
} {
  const [asked, setAsked] = useState<{
    entries: MetEntry[];
    answer: (reason: string | null) => void;
  } | null>(null);
  const ask = (entries: MetEntry[]) =>
    new Promise<string | null>((resolve) => {
      setAsked({ entries, answer: resolve });
    });
  const withEntries = async <T,>(
    send: (choice: JournalEntriesChoice | undefined) => Promise<T>,
  ): Promise<T> => {
    let choice: JournalEntriesChoice | undefined;
    for (;;) {
      try {
        return await send(choice);
      } catch (error) {
        const entries = voidableEntries(error);
        if (entries.length === 0) throw error;
        const reason = await ask(entries);
        setAsked(null);
        if (reason === null) throw new SaveCancelled();
        choice = {
          reason,
          seen: entries.map((entry) => ({ id: entry.id, version: entry.detail.version })),
        };
      }
    }
  };
  const dialog =
    asked === null ? null : (
      <JournalEntriesDialog
        entries={asked.entries}
        onVoid={(reason) => {
          asked.answer(reason);
        }}
        onClose={() => {
          asked.answer(null);
          setAsked(null);
        }}
      />
    );
  return { withEntries, dialog };
}

const REASON_SCHEMA = asFormSchema<{ reason: string }>(journalVoidReasonSchema, (path) => [
  ...path,
]);

/** The list of entries, the first date past them, and the reason of their void. */
function JournalEntriesDialog({
  entries,
  onVoid,
  onClose,
}: {
  entries: readonly MetEntry[];
  onVoid: (reason: string) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const chosen = useRef<string | null>(null);
  const form = useRecordForm<'reason', { reason: string }>({
    schema: REASON_SCHEMA,
    initial: { reason: '' },
    message: (_field, issue) =>
      issue.code === 'too_small' ? t('people.students.journalEntries.reasonNeeded') : undefined,
    save: (values) => {
      chosen.current = values.reason;
      return Promise.resolve();
    },
  });
  const element = useRef<HTMLFormElement>(null);
  const last = entries.reduce(
    (latest, entry) => (entry.detail.date > latest ? entry.detail.date : latest),
    '',
  );
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const checked = await form.submit();
    if (!checked || chosen.current === null) {
      element.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    onVoid(chosen.current);
  };
  const title = t('people.students.journalEntries.title', { count: entries.length });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          ref={element}
          aria-label={title}
          className="grid gap-4"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <ul className="grid max-h-64 gap-1 overflow-y-auto text-sm" aria-label={title}>
            {entries.map((entry) => (
              <li key={entry.id} data-entry={entry.id}>
                {t('people.students.journalEntries.line', {
                  date: schoolDateText(entry.detail.date, i18n.language),
                  unit: entry.detail.unitName,
                  subject: entry.detail.subject[i18n.language as 'uz' | 'ru' | 'en'],
                  what: entryText(t, entry.detail),
                })}
              </li>
            ))}
          </ul>
          {last !== '' && (
            <p className="text-sm">
              {t('people.students.journalEntries.moveDate', {
                date: schoolDateText(nextDay(last), i18n.language),
              })}
            </p>
          )}
          <TextAreaField
            label={t('people.students.journalEntries.reason')}
            maxLength={JOURNAL_VOID_REASON_MAX_LENGTH}
            {...form.bind('reason')}
          />
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>
              {t('people.students.journalEntries.back')}
            </DialogClose>
            <Button type="submit" variant="destructive">
              {t('people.students.journalEntries.void', { count: entries.length })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
