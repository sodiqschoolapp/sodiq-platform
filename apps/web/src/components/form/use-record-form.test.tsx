import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { ConfirmProvider } from '@/components/confirm-dialog';
import { UnsentProvider } from '@/components/unsent/unsent-changes';
import { createI18n } from '@/i18n/i18n';
import { en } from '@/i18n/locales/en';
import type { FormSchema } from './form-messages';
import { RecordForm } from './record-form';
import { useRecordForm } from './use-record-form';

// What the forms of task 2.7b-2 need of the hook: a checkbox group that says
// what is missing on Save only (issue #39, hand test of 13 October 2026,
// finding 21; decision 2), and a form that follows what it shows instead of
// being drawn again by its own save (finding 18; decision 7).

type Fields = 'more' | 'days' | 'note';
interface Values {
  more: boolean;
  days: string[];
  note: string;
}

/** `days` must hold one choice while `more` is ticked. */
const SCHEMA: FormSchema<Values> = {
  safeParse: (input) => {
    const values = input as Record<Fields, string>;
    const more = values.more === 'on';
    const days = values.days === '' ? [] : values.days.split(',');
    if (more && days.length === 0) {
      return {
        success: false,
        error: { issues: [{ code: 'too_small', origin: 'array', minimum: 1, path: ['days'] }] },
      };
    }
    return { success: true, data: { more, days, note: values.note } };
  },
};

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <I18nextProvider i18n={createI18n('en')}>
      <ConfirmProvider>
        <UnsentProvider>{children}</UnsentProvider>
      </ConfirmProvider>
    </I18nextProvider>
  );
}

function DaysForm({ onSave }: { onSave: (values: Values) => Promise<void> }) {
  const form = useRecordForm<Fields, Values>({
    schema: SCHEMA,
    initial: { more: '', days: '', note: '' },
    save: onSave,
    checkedOnSave: ['days'],
  });
  const more = form.bind('more');
  return (
    <RecordForm form={form} label="Days">
      <input aria-label="more" {...more} />
      {more.value === 'on' && <Input label="days" binding={form.bind('days')} />}
    </RecordForm>
  );
}

function Input({
  label,
  binding,
}: {
  label: string;
  binding: ReturnType<ReturnType<typeof useRecordForm<Fields, Values>>['bind']>;
}) {
  return (
    <div>
      <input
        aria-label={label}
        name={binding.name}
        value={binding.value}
        onChange={binding.onChange}
      />
      <p data-testid={`${label}-message`}>{binding.error}</p>
    </div>
  );
}

const set = (label: string, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};
const message = (label: string) => screen.queryByTestId(`${label}-message`)?.textContent ?? null;
const pressSave = async (): Promise<void> => {
  await act(async () => {
    fireEvent.submit(screen.getByRole('form'));
    await Promise.resolve();
  });
};

describe('a field checked on Save', () => {
  it('says nothing as it is ticked and unticked', () => {
    render(
      <Wrap>
        <DaysForm onSave={() => Promise.resolve()} />
      </Wrap>,
    );
    set('more', 'on');
    set('days', 'mon');
    set('days', '');
    expect(message('days')).toBe('');
  });

  it('says what is missing after a Save pressed while it was drawn', async () => {
    render(
      <Wrap>
        <DaysForm onSave={() => Promise.resolve()} />
      </Wrap>,
    );
    set('more', 'on');
    await pressSave();
    expect(message('days')).toBe(en.form.chooseOne);
  });

  it('waits for the next Save when it was drawn after Save was pressed', async () => {
    render(
      <Wrap>
        <DaysForm onSave={() => Promise.resolve()} />
      </Wrap>,
    );
    // Saved without the group; then the choice that draws it.
    await pressSave();
    set('more', 'on');
    expect(message('days')).toBe('');

    await pressSave();
    expect(message('days')).toBe(en.form.chooseOne);
  });
});

/** A record kept by its page; the form follows it and saves into it. */
function Following({ start }: { start: string }) {
  const [note, setNote] = useState(start);
  const form = useRecordForm<Fields, Values>({
    schema: SCHEMA,
    initial: { more: '', days: '', note },
    save: (values) => {
      setNote(values.note);
      return Promise.resolve();
    },
    followInitial: true,
  });
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setNote('changed elsewhere');
        }}
      >
        elsewhere
      </button>
      <RecordForm form={form} label="Note">
        <Input label="note" binding={form.bind('note')} />
      </RecordForm>
    </>
  );
}

const note = () => screen.getByLabelText<HTMLInputElement>('note').value;
const savedSign = () => screen.getByRole('form').querySelector('[role="status"]')?.textContent;

describe('a form that follows what it shows', () => {
  it('keeps "Saved." after its own save', async () => {
    render(
      <Wrap>
        <Following start="first" />
      </Wrap>,
    );
    set('note', 'second');
    await pressSave();
    expect(savedSign()).toBe(en.form.saved);
    expect(note()).toBe('second');
  });

  it('shows a change from elsewhere while nothing is typed', () => {
    render(
      <Wrap>
        <Following start="first" />
      </Wrap>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(note()).toBe('changed elsewhere');
  });

  // The review of task 2.7b-2, correction 3: a refetch never overwrites typing.
  it('takes no new value while something is typed', () => {
    render(
      <Wrap>
        <Following start="first" />
      </Wrap>,
    );
    set('note', 'typing');
    fireEvent.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(note()).toBe('typing');
  });
});
