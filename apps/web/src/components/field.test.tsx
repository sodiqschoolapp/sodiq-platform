import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { createI18n } from '@/i18n/i18n';
import { en } from '@/i18n/locales/en';
import { CHECKBOX_TARGET } from '@/components/ui/control';
import { CheckboxField, CheckboxGroupField, listValues, OrderedListField } from './field';

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
