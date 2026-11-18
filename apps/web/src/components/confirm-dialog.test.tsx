import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { ConfirmProvider, useConfirm, type Confirmation } from './confirm-dialog';
import { createI18n } from '@/i18n/i18n';

function Asker({ question }: { question: Confirmation }) {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      onClick={() => {
        void confirm(question);
      }}
    >
      ask
    </button>
  );
}

function ask(question: Confirmation) {
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <ConfirmProvider>
        <Asker question={question} />
      </ConfirmProvider>
    </I18nextProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'ask' }));
}

// docs/design-system.md, Buttons and Dialogs (owner, 17 November 2026): what cannot be undone is
// confirmed with the filled danger button, anything else with the primary one.
describe('a confirmation', () => {
  it('confirms what cannot be undone with the filled danger button', async () => {
    ask({ title: 'Delete the work?', action: 'Delete the work', destructive: true });
    const action = await screen.findByRole('button', { name: 'Delete the work' });
    expect(action.dataset.variant).toBe('destructive-fill');
  });

  it('confirms anything else with the primary button', async () => {
    ask({ title: 'Publish the version?', action: 'Publish' });
    const action = await screen.findByRole('button', { name: 'Publish' });
    expect(action.dataset.variant).toBe('default');
  });
});
