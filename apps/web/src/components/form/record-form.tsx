import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { Button } from '@/components/ui/button';
import { useUnsentEntry } from '@/components/unsent/unsent-changes';
import type { RecordFormState } from './use-record-form';

interface RecordFormProps<Field extends string> {
  /** The state of the form (`useRecordForm`). */
  form: RecordFormState<Field>;
  /**
   * What a person calls the record, for example the name of the student. Read
   * out as the name of the form, and named by the warning before leaving.
   */
  label: string;
  /** The fields: `Field`, `NumberField`, `SelectField`. */
  children: ReactNode;
}

/**
 * The one way every record form works (docs/spec/12-ux-standards.md, No lost
 * work): the fields, why a save was refused, the Save button and the sign
 * "Saved". Decided by the owner (task 0.8b): a record form has a Save button,
 * and leaving with typed changes asks first; while something is typed and not
 * saved, or a save failed, the form is named in the top bar (`UnsentBanner`).
 *
 * Save stays on while a field is wrong: pressing it says what to fix in every
 * field and puts the focus into the first wrong one.
 */
export function RecordForm<Field extends string>({
  form,
  label,
  children,
}: RecordFormProps<Field>) {
  const { t } = useTranslation();
  const element = useRef<HTMLFormElement>(null);
  // Counts the presses of Save that a wrong field refused.
  const [refused, setRefused] = useState(0);

  useEffect(() => {
    if (refused > 0) {
      element.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [refused]);

  useUnsentEntry(
    form.dirty || form.status === 'failed'
      ? {
          label,
          state: form.status === 'failed' ? 'failed' : 'typed',
          discard: form.reset,
          settled: form.settled,
          focus: () => {
            const fields =
              element.current?.querySelectorAll<HTMLElement>('input, select, textarea');
            const wrong = element.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
            (wrong ?? fields?.[0])?.focus();
          },
        }
      : null,
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    void form.submit().then((sent) => {
      if (!sent) {
        setRefused((before) => before + 1);
      }
    });
  }

  return (
    <form
      ref={element}
      aria-label={label}
      data-slot="record-form"
      className="grid gap-4"
      onSubmit={submit}
      noValidate
    >
      {children}
      <FailureAlert error={form.failure} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={form.status === 'saving'}>
          {t('form.save')}
        </Button>
        {/* Always there, so it is read out when the text arrives. */}
        <p role="status" className="text-sm font-medium">
          {form.status === 'saved' && t('form.saved')}
        </p>
      </div>
    </form>
  );
}
