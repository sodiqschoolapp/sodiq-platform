import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';

// docs/design-system.md, Buttons (owner, 17 November 2026): the pending state and the filled
// danger button.
describe('a button', () => {
  it('waits: keeps its kind, says the action in progress, turns its icon and takes no click', () => {
    const click = vi.fn();
    render(
      <Button variant="secondary" pending pendingText="Saving…" onClick={click}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button.dataset.variant).toBe('secondary');
    expect(button.dataset.pending).toBe('true');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('svg')?.getAttribute('class')).toContain(
      'motion-safe:animate-spin',
    );
    button.click();
    expect(click).not.toHaveBeenCalled();
  });

  it('keeps its own word while it waits when no other is given', () => {
    render(<Button pending>Send</Button>);
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('aria-busy')).toBe('true');
  });

  it('is an ordinary button when it does not wait', () => {
    const click = vi.fn();
    render(<Button onClick={click}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.getAttribute('aria-busy')).toBeNull();
    expect(button.querySelector('svg')).toBeNull();
    button.click();
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('is filled red as the danger button of a confirmation', () => {
    render(<Button variant="destructive-fill">Delete the work</Button>);
    const button = screen.getByRole('button', { name: 'Delete the work' });
    expect(button.className).toContain('bg-destructive');
    expect(button.className).toContain('text-destructive-foreground');
    expect(button.className).toContain('hover:bg-destructive-hover');
  });
});
