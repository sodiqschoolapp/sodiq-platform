import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { ApiFailure } from '@/api/failure';
import { Button } from '@/components/ui/button';
import { createI18n } from '@/i18n/i18n';
import { en } from '@/i18n/locales/en';
import { PanelActions } from './panel-actions';

const draw = (part: React.ReactElement) =>
  render(<I18nextProvider i18n={createI18n('en')}>{part}</I18nextProvider>);

const row = () => document.querySelector<HTMLElement>('[data-slot="panel-actions"]');

// docs/design-system.md, Layout shell, Lists: the side panel's actions at the
// bottom, "primary "Edit", secondary actions, danger quiet "Archive"" (task 2.7c-2b-1).
describe('the actions at the bottom of a side panel', () => {
  it('are drawn primary, secondary, danger, whatever order they are given in', () => {
    draw(
      <PanelActions
        danger={<Button variant="destructive">Archive</Button>}
        secondary={<Button variant="secondary">Start</Button>}
        primary={<Button>Edit</Button>}
      />,
    );
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Edit',
      'Start',
      'Archive',
    ]);
  });

  it('say inside the part why an action is off, what failed and that a form was saved', () => {
    draw(
      <PanelActions
        secondary={<Button variant="secondary">Start</Button>}
        note="Another year is current."
        error={new ApiFailure('no_answer')}
        saved
      />,
    );
    const part = row();
    expect(part?.textContent).toContain('Another year is current.');
    expect(part?.textContent).toContain(en.problems.noAnswer);
    expect(part?.textContent).toContain(en.form.saved);
  });

  it('name a failure in the panel’s own words when it gives them', () => {
    draw(
      <PanelActions
        danger={<Button variant="destructive">Archive</Button>}
        error={new ApiFailure('archive_refused')}
        errorText="Staff members are in this division."
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('Staff members are in this division.');
  });

  it('draw nothing when there is nothing to show', () => {
    draw(<PanelActions primary={false} secondary={null} saved={false} />);
    expect(row()).toBeNull();
  });
});
