import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { ApiFailure } from '@/api/failure';
import { Button } from '@/components/ui/button';
import { createI18n } from '@/i18n/i18n';
import { en } from '@/i18n/locales/en';
import { PanelActions } from './panel-actions';
import { SidePanel } from '@/components/side-panel';
import {
  actionsInHeader,
  moreActionNames,
  moreButton,
  panelAction,
  panelActionNames,
} from '@/testing/panel';

const draw = (part: React.ReactElement) =>
  render(<I18nextProvider i18n={createI18n('en')}>{part}</I18nextProvider>);

const row = () => document.querySelector<HTMLElement>('[data-slot="panel-actions"]');

// docs/design-system.md, Layout shell, Lists: "primary "Edit", secondary actions, danger
// quiet "Archive"" (task 2.7c-2b-1), outside a side panel or as a part the menu cannot hold.
describe('the actions of a record', () => {
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

// docs/design-system.md, Layout shell, Lists (owner, 17 November 2026): in a side panel the
// actions are in its header, under the title; at most two secondary actions beside the primary
// one, and the rest and every danger action in the "More" menu, the danger ones last.
describe('the actions of a record in its side panel', () => {
  const inPanel = (actions: React.ReactElement, below = 'The record') =>
    draw(
      <SidePanel title="Bekzod Abdullayev" recordKey="one" onClose={() => undefined}>
        <p>{below}</p>
        {actions}
      </SidePanel>,
    );
  const press = (name: string) => () => {
    pressed.push(name);
  };
  let pressed: string[] = [];

  it('stand in the header, before the rest of the panel, though the panel draws them last', () => {
    inPanel(<PanelActions primary={<Button onClick={press('Edit')}>Edit</Button>} />);
    const panel = screen.getByRole('complementary');
    expect(actionsInHeader(panel)).toBe(true);
    const actions = row();
    const text = screen.getByText('The record');
    expect(
      actions !== null &&
        (actions.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    ).toBe(true);
  });

  it('keep two secondary actions in the header and put the rest and the danger ones in More', async () => {
    pressed = [];
    inPanel(
      <PanelActions
        primary={<Button onClick={press('Edit')}>Edit</Button>}
        secondary={
          <>
            <Button variant="secondary" onClick={press('Fix UID')}>
              Fix UID
            </Button>
            <Button variant="secondary" onClick={press('Move')}>
              Move
            </Button>
            <Button variant="secondary" onClick={press('Transfer')} data-opens="transfer">
              Transfer
            </Button>
          </>
        }
        danger={
          <Button variant="destructive" onClick={press('Leave')} data-opens="leave">
            Leave
          </Button>
        }
      />,
    );
    const panel = screen.getByRole('complementary');
    expect(panelActionNames(panel)).toEqual(['Edit', 'Fix UID', 'Move']);
    expect(await moreActionNames(panel)).toEqual(['Transfer', 'Leave']);
    // The focus comes back to "More" after a form opened from it closes.
    expect(moreButton(panel)?.dataset.holds).toBe('transfer leave');

    const leave = await panelAction(panel, 'Leave');
    expect(leave.dataset.variant).toBe('destructive');
    fireEvent.click(leave);
    expect(pressed).toEqual(['Leave']);
  });

  it('keep in the header a part the menu cannot hold, so no action is lost', () => {
    inPanel(
      <PanelActions
        primary={<Button onClick={press('Edit')}>Edit</Button>}
        danger={<a href="/history">History</a>}
      />,
    );
    const panel = screen.getByRole('complementary');
    expect(moreButton(panel)).toBeNull();
    expect(row()?.querySelector('a')?.textContent).toBe('History');
  });

  it('stay where the page draws them outside a side panel', () => {
    draw(
      <div>
        <p>The page</p>
        <PanelActions primary={<Button>Edit</Button>} />
      </div>,
    );
    expect(document.querySelector('[data-slot="panel-header-actions"]')).toBeNull();
    expect(row()?.previousElementSibling?.textContent).toBe('The page');
  });
});
