import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CodedName } from './coded-name';

// Task 11.27 (`09`, Codes): "Where a code is filled it is shown first, with the full name beside
// it … Where space is short … the code is shown alone, with the full name on hover or on a tap.
// Where the code is empty, the name is shown alone." All names are invented.
describe('a name with its code (task 11.27)', () => {
  it('shows the code first, then the name', () => {
    const { container } = render(<CodedName code="F1" name="Fractions" />);
    expect(container.textContent).toBe('F1 Fractions');
    expect(container.querySelector('[data-code]')?.textContent).toBe('F1');
  });

  it('shows the name alone without a code', () => {
    for (const code of [null, undefined, '']) {
      const { container, unmount } = render(<CodedName code={code} name="Fractions" />);
      expect(container.textContent).toBe('Fractions');
      expect(container.querySelector('[data-code]')).toBeNull();
      unmount();
    }
  });

  it('shows the code alone where space is short, the full name on hover and on a tap', () => {
    const { container } = render(<CodedName short code="Q1" name="Quiz on fractions" />);
    const button = screen.getByRole('button', { name: 'Q1 · Quiz on fractions' });
    expect(container.textContent).toBe('Q1');
    expect(button.getAttribute('title')).toBe('Quiz on fractions');
    fireEvent.click(button);
    expect(screen.getByRole('tooltip').textContent).toBe('Quiz on fractions');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    // A second tap closes it.
    fireEvent.click(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
