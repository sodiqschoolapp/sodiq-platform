import { forcedDeleteBodySchema, type ForcedDeleteBody } from '@sodiq/shared';
import { useRef, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { TextAreaField } from '@/components/field';
import { useRecordForm } from '@/components/form/use-record-form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * The Super Admin's forced delete of one record with a typed reason (`06`,
 * Protection: "Forced delete is for Super Admin only, with a typed reason";
 * tasks 5.8b and 5.8c): a dialog that sends once (`.claude/rules/web.md`),
 * its field checked with the shared schema, its key made when it opens. The
 * record's own part gives the title, the line on what is kept, and the call.
 */
export function ForcedDeleteDialog({
  title,
  text,
  send,
  onClose,
  onDeleted,
}: {
  title: string;
  /** What is kept and for how long. */
  text: string;
  send: (body: ForcedDeleteBody, key: string) => Promise<unknown>;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const done = useRef(false);
  const key = useRef(crypto.randomUUID());
  const form = useRecordForm<'reason', ForcedDeleteBody>({
    schema: forcedDeleteBodySchema,
    initial: { reason: '' },
    save: async (body) => {
      await send(body, key.current);
      done.current = true;
    },
    message: (field) => (field === 'reason' ? t('forcedDeletes.reasonNeeded') : undefined),
  });
  const element = useRef<HTMLFormElement>(null);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const checked = await form.submit();
    if (!checked) {
      element.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    if (done.current) {
      await onDeleted();
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
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
          <p className="text-sm">{text}</p>
          <TextAreaField label={t('forcedDeletes.reason')} rows={3} {...form.bind('reason')} />
          <FailureAlert error={form.failure} />
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>{t('forcedDeletes.keep')}</DialogClose>
            <Button type="submit" variant="destructive" disabled={form.status === 'saving'}>
              {t('forcedDeletes.send')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
