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
import { requiredOf, useRecordForm } from './use-record-form';
import { Field, SelectField } from '@/components/field';
import type { RequiredWhen } from '@sodiq/shared';

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

describe('a field checked on Save, taken away and drawn again', () => {
  // Review of the build of task 2.7b-2: the group waits for the next Save.
  it('waits for the next Save', async () => {
    render(
      <Wrap>
        <DaysForm onSave={() => Promise.resolve()} />
      </Wrap>,
    );
    set('more', 'on');
    await pressSave();
    expect(message('days')).toBe(en.form.chooseOne);
    set('more', '');
    set('more', 'on');
    expect(message('days')).toBe('');
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
      <button type="button" onClick={form.reset}>
        reset
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

  // Review of the build of task 2.7b-2: a value skipped while typing is taken
  // once the typing is dropped.
  it('takes the skipped value once what was typed is dropped', () => {
    render(
      <Wrap>
        <Following start="first" />
      </Wrap>,
    );
    set('note', 'typing');
    fireEvent.click(screen.getByRole('button', { name: 'elsewhere' }));
    fireEvent.click(screen.getByRole('button', { name: 'reset' }));
    expect(note()).toBe('changed elsewhere');
  });
});

// Task 11.18 (docs/spec/12-ux-standards.md, No lost work): "A field that must be
// filled is marked with a red asterisk ... A field without the mark may be left
// empty." The mark comes from the schema the form checks with.
describe('the required mark of a bound field', () => {
  interface Read {
    name: string;
    nickname: string | null;
    sex: string;
    kind: string | null;
    number: string | null;
  }
  /**
   * As zod 4 checks it: the rule of each field, then the refine "a kind and
   * its number, both or neither", skipped while any field is wrong.
   */
  const schema: FormSchema<Read> = {
    safeParse: (input) => {
      const values = input as Read;
      const issues = [
        ...(values.name === ''
          ? [{ code: 'too_small', origin: 'string', minimum: 1, path: ['name'] }]
          : []),
        ...(['male', 'female'].includes(values.sex)
          ? []
          : [{ code: 'invalid_value', path: ['sex'] }]),
      ];
      if (issues.length === 0 && (values.kind === null) !== (values.number === null)) {
        issues.push({ code: 'custom', path: ['number'] });
      }
      return issues.length === 0
        ? { success: true, data: values }
        : { success: false, error: { issues } };
    },
  };
  type Field = 'name' | 'nickname' | 'sex' | 'kind' | 'number';
  const read = (typed: Record<Field, string>) => ({
    name: typed.name,
    nickname: typed.nickname === '' ? null : typed.nickname,
    sex: typed.sex,
    kind: typed.kind === '' ? null : typed.kind,
    number: typed.number === '' ? null : typed.number,
  });
  const requiredWhen: RequiredWhen = {
    number: (values) => values.kind !== null,
    kind: (values) => values.number !== null,
  };
  const typed = (more: Partial<Record<Field, string>> = {}): Record<Field, string> => ({
    name: '',
    nickname: '',
    sex: '',
    kind: '',
    number: '',
    ...more,
  });

  it('marks a field the schema needs, and not one it may leave empty', () => {
    expect(requiredOf(schema, typed(), 'name', { read })).toBe(true);
    expect(requiredOf(schema, typed(), 'sex', { read })).toBe(true);
    // Its empty value is read as null, which the schema takes.
    expect(requiredOf(schema, typed(), 'nickname', { read })).toBe(false);
    expect(requiredOf(schema, typed(), 'number', { read, requiredWhen })).toBe(false);
  });

  it('follows a requirement of a refine, also while an unrelated select is still empty', () => {
    // zod skips the refine while `sex` is not chosen: the map still marks it.
    const chosen = typed({ kind: 'passport' });
    expect(requiredOf(schema, chosen, 'number', { read, requiredWhen })).toBe(true);
    expect(requiredOf(schema, typed({ number: 'AB1' }), 'kind', { read, requiredWhen })).toBe(true);
    expect(requiredOf(schema, typed(), 'kind', { read, requiredWhen })).toBe(false);
    // Without the map the probe alone does not see it: why the map exists.
    expect(requiredOf(schema, chosen, 'number', { read })).toBe(false);
  });

  it('gives the branch’s today to a requirement that depends on it', () => {
    const when: RequiredWhen = {
      classId: (values, known) =>
        known.today === undefined ||
        typeof values.startsOn !== 'string' ||
        values.startsOn <= known.today,
    };
    const loose: FormSchema<unknown> = {
      safeParse: (input) => ({ success: true, data: input }),
    };
    const values = { startsOn: '2026-12-01', classId: '' };
    const readClass = (one: Record<'startsOn' | 'classId', string>) => ({
      ...one,
      classId: one.classId === '' ? null : one.classId,
    });
    const at = (today?: string) =>
      requiredOf(loose, values, 'classId', {
        read: readClass,
        requiredWhen: when,
        known: { today },
      });
    expect(at('2026-11-24')).toBe(false);
    expect(at('2026-12-01')).toBe(true);
    expect(at('2026-12-02')).toBe(true);
    // Not known yet: marked, since the server may refuse it.
    expect(at(undefined)).toBe(true);
  });

  it('says nothing when the form cannot read what is typed', () => {
    const throwing = () => {
      throw new Error('unreadable');
    };
    expect(requiredOf(schema, typed(), 'name', { read: throwing })).toBe(false);
  });

  function Marked({ locked }: { locked: boolean }) {
    const form = useRecordForm<Field, Read>({
      schema,
      initial: typed(),
      read,
      requiredWhen,
      save: async () => undefined,
    });
    return (
      <RecordForm form={form} label="Person">
        <Field label="Name" {...form.bind('name')} disabled={locked} />
        <Field label="Nickname" {...form.bind('nickname')} />
        <SelectField
          label="Kind"
          options={[
            { value: '', label: '-' },
            { value: 'passport', label: 'Passport' },
          ]}
          {...form.bind('kind')}
        />
        <Field label="Number" {...form.bind('number')} />
      </RecordForm>
    );
  }

  const marked = () =>
    [...document.querySelectorAll('[aria-required="true"]')].map((element) =>
      element.getAttribute('name'),
    );

  it('draws the mark on the bound fields, follows what is typed, and leaves a locked field unmarked', () => {
    const view = render(
      <Wrap>
        <Marked locked={false} />
      </Wrap>,
    );
    expect(marked()).toEqual(['name']);
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'passport' } });
    // A kind chosen needs its number; the kind itself may still go back to none.
    expect(marked()).toEqual(['name', 'number']);
    // The browser's own `required` never: the form says what to fix.
    expect(document.querySelector('[required]')).toBeNull();
    view.unmount();
    render(
      <Wrap>
        <Marked locked />
      </Wrap>,
    );
    expect(marked()).toEqual([]);
  });
});
