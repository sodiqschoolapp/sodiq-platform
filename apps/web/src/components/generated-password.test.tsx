import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GeneratedPassword, passwordGroups } from './generated-password';

// Owner, 28 November 2026 ("easier parent and staff passwords"): a generated password is
// shown in two groups of five with a visible gap that is not a space in the text, so
// copying it gives the password as it is typed. All values are invented.
describe('a generated password as it is shown', () => {
  it('is cut into groups of five', () => {
    expect(passwordGroups('kp7wq2mzr9')).toEqual(['kp7wq', '2mzr9']);
    expect(passwordGroups('')).toEqual([]);
  });

  it('draws two groups with a margin between them and no space in its text', () => {
    const { container } = render(<GeneratedPassword password="kp7wq2mzr9" />);
    const shown = container.querySelector('[data-generated-password]');
    const groups = Array.from(shown?.children ?? []);
    expect(groups.map((group) => group.textContent)).toEqual(['kp7wq', '2mzr9']);
    // The gap is the second group's margin, never a character of the text.
    expect(groups.map((group) => group.className)).toEqual(['', 'ml-[0.6em]']);
    expect(shown?.textContent).toBe('kp7wq2mzr9');
    expect(container.textContent).not.toMatch(/\s/);
    // Inline spans: a flex or block item would put a line break into the copied text.
    expect(groups.map((group) => group.tagName)).toEqual(['SPAN', 'SPAN']);
  });
});
