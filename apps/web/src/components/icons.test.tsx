import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SearchIcon } from './icons';

// docs/design-system.md, Icons: "An icon alone is a button with an
// `aria-label`, or decoration with `aria-hidden`"; drawn from SVG, never from a
// font ligature, so the icon's name is never text on the screen.
describe('an icon', () => {
  it('is hidden decoration without a name, with no text in it', () => {
    const { container } = render(<SearchIcon />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('role')).toBeNull();
    expect(svg?.getAttribute('fill')).toBe('currentColor');
    expect(container.textContent).toBe('');
    expect(svg?.querySelector('path')).not.toBeNull();
  });

  it('is an image with its name when it has an aria-label', () => {
    const { getByRole } = render(<SearchIcon aria-label="Find" />);
    const svg = getByRole('img', { name: 'Find' });
    expect(svg.getAttribute('aria-hidden')).toBeNull();
  });
});
