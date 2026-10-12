import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Segmented } from './segmented';

const OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
] as const;

type Value = (typeof OPTIONS)[number]['value'];

function Sample() {
  const [value, setValue] = useState<Value>('week');
  return <Segmented label="Period" options={OPTIONS} value={value} onChange={setValue} />;
}

const radio = (name: string) => screen.getByRole<HTMLInputElement>('radio', { name });

// docs/design-system.md, Fields and switches: a choice of two to four values
// as a segmented control (task 2.2d-1, pull request #60).
describe('the segmented control', () => {
  it('is a radio group with its name, the chosen item checked and marked', () => {
    render(<Sample />);
    const group = screen.getByRole('radiogroup', { name: 'Period' });
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
    expect(radio('Week').checked).toBe(true);
    expect(radio('Day').checked).toBe(false);
    // Not by colour alone: the chosen item carries a check mark.
    expect(radio('Week').closest('label')?.querySelector('svg')).not.toBeNull();
    expect(radio('Day').closest('label')?.querySelector('svg')).toBeNull();
  });

  it('changes the choice on a click, and only one item is chosen', () => {
    render(<Sample />);
    fireEvent.click(radio('Month'));
    expect(radio('Month').checked).toBe(true);
    expect(radio('Week').checked).toBe(false);
  });

  it('moves the choice with the keys of a radio group: its items share one name', () => {
    render(<Sample />);
    const names = new Set(screen.getAllByRole<HTMLInputElement>('radio').map((r) => r.name));
    expect(names.size).toBe(1);
    expect([...names][0]).not.toBe('');
  });
});
