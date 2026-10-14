import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { ConfirmProvider } from '@/components/confirm-dialog';
import { UnsentProvider } from '@/components/unsent/unsent-changes';
import { SampleForm } from '@/features/sample/sample-form';
import type { SampleRow } from '@/features/sample/sample-rows';
import { createI18n } from '@/i18n/i18n';
import { en } from '@/i18n/locales/en';
import { usePanelEditing } from './use-panel-editing';

const ROW: SampleRow = {
  id: 'sample-0002',
  name: 'Bekzod Abdullayev',
  grade: 6,
  className: 'Cambridge',
  language: 'uz',
  status: 'active',
  score: 77,
};

/** Saves held until the test answers them, by form. */
const held: Record<string, (() => void) | undefined> = {};

/** Two forms of one side panel, each behind its own button. */
function TwoForms() {
  const panel = usePanelEditing();
  const form = (key: string) => (
    <SampleForm
      row={{ ...ROW, name: `Form ${key}` }}
      onSave={async () => {
        await new Promise<void>((resolve) => {
          held[key] = resolve;
        });
        panel.stop({ saved: true, key });
      }}
      onCancel={() => {
        panel.stop();
      }}
    />
  );
  return (
    <aside data-slot="side-panel" aria-label="panel">
      {panel.editing === 'a' ? (
        form('a')
      ) : (
        <button type="button" {...panel.opener('a')} onClick={() => panel.start('a')}>
          open a
        </button>
      )}
      {panel.editing === 'b' ? (
        form('b')
      ) : (
        <button type="button" {...panel.opener('b')} onClick={() => panel.start('b')}>
          open b
        </button>
      )}
      <button type="button" onClick={() => panel.stop({ saved: true, key: 'b' })}>
        late save of b
      </button>
      <output data-testid="saved">{String(panel.saved)}</output>
    </aside>
  );
}

function draw() {
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <ConfirmProvider>
        <UnsentProvider>
          <TwoForms />
        </UnsentProvider>
      </ConfirmProvider>
    </I18nextProvider>,
  );
}

const score = (form: string) =>
  within(screen.getByRole('form', { name: form })).getByLabelText<HTMLInputElement>(
    en.sample.score,
  );

// Task 2.7c-2b-1: one form open at a time in a side panel (one primary per area).
describe('the open form of a side panel', () => {
  it('puts the focus in the first field when a form opens, and on its button when it closes', async () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'open a' }));
    const form = await screen.findByRole('form', { name: 'Form a' });
    await waitFor(() => {
      expect(document.activeElement).toBe(within(form).getByLabelText(en.sample.name));
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.cancel }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'open a' }));
    });
    expect(screen.getByTestId('saved').textContent).toBe('false');
  });

  it('asks before another form takes the place of one with typed text, and opens nothing when the person stays', async () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'open a' }));
    await screen.findByRole('form', { name: 'Form a' });
    fireEvent.change(score('Form a'), { target: { value: '90' } });

    fireEvent.click(screen.getByRole('button', { name: 'open b' }));
    const dialog = await screen.findByRole('alertdialog', { name: en.unsent.leaveTitle });
    fireEvent.click(within(dialog).getByRole('button', { name: en.unsent.stay }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(screen.queryByRole('form', { name: 'Form b' })).toBeNull();
    expect(score('Form a').value).toBe('90');

    fireEvent.click(screen.getByRole('button', { name: 'open b' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: en.unsent.leave,
      }),
    );
    expect(await screen.findByRole('form', { name: 'Form b' })).toBeDefined();
    expect(screen.queryByRole('form', { name: 'Form a' })).toBeNull();
  });

  it('says "Saved." after a save and gives the focus back to the button of the form', async () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'open a' }));
    const form = await screen.findByRole('form', { name: 'Form a' });
    fireEvent.change(score('Form a'), { target: { value: '90' } });
    fireEvent.submit(form);
    await waitFor(() => {
      expect(held.a).toBeDefined();
    });
    await act(async () => {
      held.a?.();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByRole('form', { name: 'Form a' })).toBeNull();
    });
    expect(screen.getByTestId('saved').textContent).toBe('true');
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'open a' }));
    });
  });

  it('closes nothing when the save of another form arrives late', async () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'open a' }));
    await screen.findByRole('form', { name: 'Form a' });
    fireEvent.click(screen.getByRole('button', { name: 'late save of b' }));
    expect(screen.getByRole('form', { name: 'Form a' })).toBeDefined();
    expect(screen.getByTestId('saved').textContent).toBe('false');
  });
});

/** A form whose save takes its own button away, as a role that is ended. */
function GoneOpener() {
  const panel = usePanelEditing();
  return (
    <aside data-slot="side-panel" aria-label="panel">
      <h3 tabIndex={-1} {...panel.opener('heading')}>
        heading
      </h3>
      {panel.editing === 'c' ? (
        <SampleForm
          row={{ ...ROW, name: 'Form c' }}
          onSave={() => {
            panel.stop({ saved: true, key: 'c', focus: 'heading' });
            return Promise.resolve();
          }}
          onCancel={() => {
            panel.stop();
          }}
        />
      ) : (
        panel.saved || (
          <button type="button" {...panel.opener('c')} onClick={() => panel.start('c')}>
            open c
          </button>
        )
      )}
    </aside>
  );
}

// Task 2.7c-2b-2a: a save that takes its opener away hands the focus to a part that stays.
describe('the focus after a save whose button is gone', () => {
  it('goes to the element the save names', async () => {
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <ConfirmProvider>
          <UnsentProvider>
            <GoneOpener />
          </UnsentProvider>
        </ConfirmProvider>
      </I18nextProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'open c' }));
    const form = await screen.findByRole('form', { name: 'Form c' });
    fireEvent.change(score('Form c'), { target: { value: '90' } });
    fireEvent.submit(form);
    await waitFor(() => {
      expect(screen.queryByRole('form', { name: 'Form c' })).toBeNull();
    });
    expect(screen.queryByRole('button', { name: 'open c' })).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'heading' }));
    });
  });
});
