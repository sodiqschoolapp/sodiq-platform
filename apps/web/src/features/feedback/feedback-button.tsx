import { useLocation } from '@tanstack/react-router';
import { FEEDBACK_REPORTS_PER_DAY, feedbackReportSchema, type FeedbackReport } from '@sodiq/shared';
import { cn } from 'cn';
import { MessageSquareTextIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { ApiFailure, answerOf } from '@/api/failure';
import { FailureAlert } from '@/components/failure-alert';
import { TextAreaField } from '@/components/field';
import { useRecordForm } from '@/components/form/use-record-form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

/**
 * docs/spec/14-quality-plan.md, Whole system, Monitoring: "A feedback button
 * on every page sends a report with the page and role attached." In the top
 * bar of the layout only (decided by the owner, task 0.8b-3); the server adds
 * the roles of the session. A text typed and not sent is kept while the dialog
 * is closed and opened again in this tab; it is lost at a reload or sign-out,
 * as a form is when the session ends (0.8b-2). After a send the form is new
 * and a sign says that the report went out.
 */
export function FeedbackButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  /** The text of a report not sent yet. */
  const [draft, setDraft] = useState('');
  /** How many reports this tab sent: each gets a new form. */
  const [sent, setSent] = useState(0);
  const [justSent, setJustSent] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setJustSent(false);
        }
      }}
    >
      <DialogTrigger render={<Button variant="ghost" />}>
        <MessageSquareTextIcon aria-hidden />
        <span className="sr-only sm:not-sr-only">{t('feedback.button')}</span>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('feedback.title')}</DialogTitle>
          <DialogDescription>{t('feedback.text')}</DialogDescription>
        </DialogHeader>
        {/* Always there, so the sign is read out when it arrives. */}
        <p role="status" className={cn('text-sm', !justSent && 'sr-only')}>
          {justSent ? t('feedback.sent') : ''}
        </p>
        <FeedbackForm
          key={sent}
          initialText={draft}
          focusOnMount={justSent}
          onTyped={(text) => {
            setDraft(text);
            setJustSent(false);
          }}
          onSent={() => {
            setDraft('');
            setSent((count) => count + 1);
            setJustSent(true);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

interface FeedbackFormProps {
  initialText: string;
  /** After a send: the new, empty form takes the focus. */
  focusOnMount: boolean;
  onTyped: (text: string) => void;
  onSent: () => void;
}

type Field = 'text';

/**
 * The field and the Send button. Not a record form (`RecordForm`): a report is
 * sent once and not saved, so the button says Send, the sign is "sent", and
 * the dialog does not enter the store of unsent changes. The field is checked
 * as it is typed through `useRecordForm` with the schema the server checks
 * (docs/spec/12-ux-standards.md, No lost work).
 */
function FeedbackForm({ initialText, focusOnMount, onTyped, onSent }: FeedbackFormProps) {
  const { t, i18n } = useTranslation();
  // The path of the page, without the query (decided by the owner).
  const page = useLocation({ select: (location) => location.pathname });
  const read = useCallback(
    (typed: Record<Field, string>): FeedbackReport => ({ page, text: typed.text }),
    [page],
  );
  const succeeded = useRef(false);
  const form = useRecordForm<Field, FeedbackReport>({
    schema: feedbackReportSchema,
    initial: { text: initialText },
    read,
    save: async (report) => {
      await answerOf(api.POST('/api/feedback', { body: report }));
      succeeded.current = true;
    },
  });
  const element = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (focusOnMount) {
      element.current?.querySelector<HTMLElement>('textarea')?.focus();
    }
  }, [focusOnMount]);

  const send = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const checked = await form.submit();
    if (!checked) {
      // The field says what to fix; the focus goes to it.
      element.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    if (succeeded.current) {
      onSent();
    }
  };

  const binding = form.bind('text');
  const tooMany = form.failure instanceof ApiFailure && form.failure.code === 'too_many_attempts';

  return (
    <form
      ref={element}
      aria-label={t('feedback.title')}
      className="grid gap-4"
      onSubmit={(event) => {
        void send(event);
      }}
    >
      <TextAreaField
        label={t('feedback.message')}
        rows={5}
        {...binding}
        onChange={(event) => {
          binding.onChange(event);
          onTyped(event.target.value);
        }}
      />
      {tooMany ? (
        // The shared text of the code speaks of failed attempts; this is about reports.
        <p role="alert" className="text-sm text-destructive">
          {t('feedback.tooMany', {
            n: new Intl.NumberFormat(i18n.language).format(FEEDBACK_REPORTS_PER_DAY),
          })}
        </p>
      ) : (
        <FailureAlert error={form.failure} />
      )}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>{t('confirm.cancel')}</DialogClose>
        <Button type="submit" disabled={form.status === 'saving'}>
          {t('feedback.send')}
        </Button>
      </DialogFooter>
    </form>
  );
}
