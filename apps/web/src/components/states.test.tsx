// Rendered without the app's i18n: a text is its key here.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiFailure } from '@/api/failure';
import { EmptyState, ErrorState } from './states';

// docs/design-system.md, Brand moments, Empty page; `12`, Look and feel:
// "Empty pages say what the page is for and offer the first action". Pull
// request #61, decision 1: with a title the brand moment, without one a quiet
// line in a part of a page.
describe('an empty state', () => {
  it('with a title is the brand moment: a Bitter heading, the line, the actions and the drawing', () => {
    const { container } = render(
      <EmptyState
        title="No rooms yet"
        text="The rooms of the branch are listed here."
        action={<button type="button">Add a room</button>}
        secondAction={<button type="button">Import</button>}
      />,
    );
    const heading = screen.getByRole('heading', { level: 2, name: 'No rooms yet' });
    expect(heading.className).toContain('font-brand');
    expect(screen.getByText('The rooms of the branch are listed here.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Add a room' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDefined();
    const drawing = container.querySelector('svg');
    expect(drawing?.getAttribute('aria-hidden')).toBe('true');
    // Hidden at phone width.
    expect(drawing?.getAttribute('class')).toContain('max-sm:hidden');
    // In the page's white panel.
    expect(container.firstElementChild?.className).toContain('bg-card');
  });

  it('without a title is one quiet line, with no heading and no drawing', () => {
    const { container } = render(<EmptyState text="No notifications." />);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText('No notifications.').className).toContain('text-muted-foreground');
  });
});

// Issue #39, hand test of 13 October 2026, finding 4.
describe('an error state', () => {
  it('says the role may not see it, with no "Try again"', () => {
    render(<ErrorState error={new ApiFailure('permission_denied')} onRetry={() => undefined} />);
    expect(screen.getByRole('alert').textContent).toBe('problems.noAccessText');
    expect(screen.queryByRole('button', { name: 'problems.retry' })).toBeNull();
  });

  it('keeps "Try again" for any other failure', () => {
    const retry = vi.fn();
    render(<ErrorState error={new ApiFailure('internal_error')} onRetry={retry} />);
    expect(screen.getByRole('alert').textContent).toBe('errors.internal_error');
    fireEvent.click(screen.getByRole('button', { name: 'problems.retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
