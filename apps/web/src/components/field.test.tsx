import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { createI18n } from '@/i18n/i18n';
import { en } from '@/i18n/locales/en';
import { CHECKBOX_TARGET } from '@/components/ui/control';
import {
  CheckboxField,
  CheckboxGroupField,
  DateField,
  Field,
  listValues,
  NumberField,
  OrderedListField,
  PhoneField,
  SelectField,
  TextAreaField,
} from './field';

const LABEL = 'Slots in order';

/** The field with the options of the moment and the value it holds. */
function Slots({ options }: { options: readonly { value: string; label: string }[] }) {
  const [value, setValue] = useState('');
  return (
    <>
      <OrderedListField
        label={LABEL}
        name="slots"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
        options={options}
      />
      <output>{listValues(value).join(' ')}</output>
    </>
  );
}

const LESSON = { value: 'lesson', label: 'Lesson 45' };
const LUNCH = { value: 'lunch', label: 'Lunch' };

const choice = () =>
  screen.getByRole<HTMLSelectElement>('combobox', {
    name: en.form.addChoice.replace('{{label}}', LABEL),
  });
const add = () => {
  fireEvent.click(screen.getByRole('button', { name: en.form.add }));
};
const held = () => screen.getByRole('status').textContent;

// The options of an ordered list can change after it is drawn: they arrive
// after it, or one is archived and the list is read again.
describe('an ordered list field', () => {
  it('offers the options that arrive after it is drawn, and adds what the select shows', () => {
    const i18n = createI18n('en');
    const view = render(
      <I18nextProvider i18n={i18n}>
        <Slots options={[]} />
      </I18nextProvider>,
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.form.add }).disabled).toBe(
      true,
    );

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <Slots options={[LESSON, LUNCH]} />
      </I18nextProvider>,
    );
    expect(choice().value).toBe('lesson');
    add();
    expect(held()).toBe('lesson');
  });

  it('follows the options when the chosen one is no longer offered', () => {
    const i18n = createI18n('en');
    const view = render(
      <I18nextProvider i18n={i18n}>
        <Slots options={[LESSON, LUNCH]} />
      </I18nextProvider>,
    );
    fireEvent.change(choice(), { target: { value: 'lunch' } });

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <Slots options={[LESSON]} />
      </I18nextProvider>,
    );
    expect(choice().value).toBe('lesson');
    add();
    expect(held()).toBe('lesson');
  });
});

// docs/design-system.md, Accessibility: "touch targets of 44 px at phone
// width" (task 2.7c-2a, pull request #81, decision 8). jsdom draws no sizes:
// the label is the target, so a press on its words ticks the box.
describe('the checkboxes of a form', () => {
  function Ticks() {
    const [one, setOne] = useState('');
    const [days, setDays] = useState('');
    return (
      <>
        <CheckboxField
          label="Shared"
          name="shared"
          value={one}
          onChange={(event) => {
            setOne(event.target.value);
          }}
        />
        <CheckboxGroupField
          label="Weekdays"
          name="days"
          value={days}
          onChange={(event) => {
            setDays(event.target.value);
          }}
          options={[
            { value: '1', label: 'Monday' },
            { value: '2', label: 'Tuesday' },
          ]}
        />
      </>
    );
  }

  it('sit in a label that is 44 px at phone width, and a press on the words ticks them', () => {
    render(<Ticks />);
    for (const name of ['Shared', 'Monday', 'Tuesday']) {
      const box = screen.getByRole<HTMLInputElement>('checkbox', { name });
      const target = box.closest('label');
      expect(target?.className.split(' ')).toEqual(
        expect.arrayContaining(CHECKBOX_TARGET.split(' ')),
      );
      expect(box.checked).toBe(false);
      fireEvent.click(screen.getByText(name));
      expect(box.checked).toBe(true);
    }
  });
});

// Task 3.5b, H25 of issue #105: one phone field for every phone of the app.
describe('a phone field', () => {
  function Phone({ error, uzbekOnly = false }: { error?: string; uzbekOnly?: boolean }) {
    const [value, setValue] = useState('+998 ');
    return (
      <I18nextProvider i18n={createI18n('en')}>
        <PhoneField
          label="Phone"
          name="phone"
          value={value}
          error={error}
          uzbekOnly={uzbekOnly}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
      </I18nextProvider>
    );
  }
  const field = () => screen.getByLabelText<HTMLInputElement>('Phone');

  it('groups a number pasted after the prefilled +998 when the field is left', () => {
    render(<Phone />);
    fireEvent.change(field(), { target: { value: '+998 +998901234501' } });
    fireEvent.blur(field());
    expect(field().value).toBe('+998 90 123 45 01');
  });

  it('groups nine digits, and leaves a number it cannot read as typed', () => {
    render(<Phone />);
    fireEvent.change(field(), { target: { value: '(90) 123-45-01' } });
    fireEvent.blur(field());
    expect(field().value).toBe('+998 90 123 45 01');
    fireEvent.change(field(), { target: { value: '+998 90 12' } });
    fireEvent.blur(field());
    expect(field().value).toBe('+998 90 12');
  });

  it('says the format for a wrong number, the Uzbek one for the branch phone, and "fill in" at the bare prefix', () => {
    const { unmount } = render(<Phone error="x" />);
    fireEvent.change(field(), { target: { value: '+998 90 12' } });
    expect(screen.getByText(en.form.phoneFormatAny)).toBeDefined();
    fireEvent.change(field(), { target: { value: '+998 ' } });
    expect(screen.getByText(en.form.required)).toBeDefined();
    unmount();
    const { unmount: again } = render(<Phone error="x" uzbekOnly />);
    fireEvent.change(field(), { target: { value: '+998 90 12' } });
    expect(screen.getByText(en.form.phoneFormat)).toBeDefined();
    again();
    // A well-formed number refused for another reason keeps that reason.
    render(<Phone error="Another phone, please." />);
    fireEvent.change(field(), { target: { value: '+998 90 123 45 01' } });
    expect(screen.getByText('Another phone, please.')).toBeDefined();
  });
});

// docs/spec/12-ux-standards.md, No lost work: "A field that must be filled is
// marked with a red asterisk (*) after its label ... and a screen reader
// announces it as required. A field without the mark may be left empty"
// (task 11.18).
describe('the mark of a required field', () => {
  const noop = () => undefined;
  const OPTIONS = [{ value: 'a', label: 'A' }];
  const KINDS = [
    ['Field', (required?: boolean) => <Field label="Name" required={required} />],
    ['DateField', (required?: boolean) => <DateField label="Name" required={required} />],
    ['NumberField', (required?: boolean) => <NumberField label="Name" required={required} />],
    [
      'PhoneField',
      (required?: boolean) => (
        <PhoneField label="Name" value="" onChange={noop} required={required} />
      ),
    ],
    [
      'SelectField',
      (required?: boolean) => <SelectField label="Name" options={OPTIONS} required={required} />,
    ],
    ['TextAreaField', (required?: boolean) => <TextAreaField label="Name" required={required} />],
    [
      'CheckboxField',
      (required?: boolean) => (
        <CheckboxField label="Name" name="n" value="" onChange={noop} required={required} />
      ),
    ],
  ] as const;

  const draw = (node: ReactNode) =>
    render(<I18nextProvider i18n={createI18n('en')}>{node}</I18nextProvider>);

  for (const [kind, make] of KINDS) {
    it(`${kind}: a red asterisk hidden from screen readers and aria-required, only with required`, () => {
      const marked = draw(make(true));
      const mark = marked.container.querySelector('[data-required-mark]');
      expect(mark?.textContent).toBe('*');
      expect(mark?.getAttribute('aria-hidden')).toBe('true');
      expect(mark?.className).toContain('text-destructive');
      // The name is the label's words alone: the mark stands outside the label.
      const control = screen.getByLabelText('Name');
      expect(control.getAttribute('aria-required')).toBe('true');
      // Never the browser's own bubble: the form says what to fix in plain words.
      expect(control.hasAttribute('required')).toBe(false);
      marked.unmount();

      const plain = draw(make(undefined));
      expect(plain.container.querySelector('[data-required-mark]')).toBeNull();
      expect(screen.getByLabelText('Name').hasAttribute('aria-required')).toBe(false);
      plain.unmount();
    });
  }

  it('a group: the mark beside its legend and the word in its description, its name unchanged', () => {
    const group = (required?: boolean) => (
      <>
        <CheckboxGroupField
          label="Days"
          name="days"
          value=""
          onChange={noop}
          options={OPTIONS}
          required={required}
        />
        <OrderedListField
          label="Slots"
          name="slots"
          value=""
          onChange={noop}
          options={OPTIONS}
          required={required}
        />
      </>
    );
    const marked = draw(group(true));
    expect(marked.container.querySelectorAll('[data-required-mark]')).toHaveLength(2);
    for (const name of ['Days', 'Slots']) {
      const element = screen.getByRole('group', { name });
      const describedBy = (element.getAttribute('aria-describedby') ?? '').split(' ');
      const words = describedBy.map((id) => document.getElementById(id)?.textContent);
      expect(words).toContain(en.form.requiredWord);
    }
    marked.unmount();
    const plain = draw(group(false));
    expect(plain.container.querySelector('[data-required-mark]')).toBeNull();
    expect(plain.container.textContent).not.toContain(en.form.requiredWord);
  });
});
