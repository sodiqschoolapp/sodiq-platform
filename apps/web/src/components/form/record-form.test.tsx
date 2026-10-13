import type { SampleRecord } from '@sodiq/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { ApiFailure } from '@/api/failure';
import { SaveCancelled } from '@/components/form/save-cancelled';
import { ConfirmProvider } from '@/components/confirm-dialog';
import { UnsentProvider, useLeave, useUnsent } from '@/components/unsent/unsent-changes';
import { SampleForm } from '@/features/sample/sample-form';
import type { SampleRow } from '@/features/sample/sample-rows';
import { createI18n } from '@/i18n/i18n';
import type { Language } from '@/i18n/languages';
import { en } from '@/i18n/locales/en';
import { uz } from '@/i18n/locales/uz';

const ROW: SampleRow = {
  id: 'sample-0002',
  name: 'Bekzod Abdullayev',
  grade: 6,
  className: 'Cambridge',
  language: 'uz',
  status: 'active',
  score: 77,
};

const LEAVE = 'leave';

/** Something beside the form that would take it away, and what it was answered. */
function Leaver() {
  const { leave } = useLeave();
  const unsent = useUnsent();
  const [answers, setAnswers] = useState<readonly boolean[]>([]);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void leave().then((leaves) => {
            setAnswers((before) => [...before, leaves]);
          });
        }}
      >
        {LEAVE}
      </button>
      <output data-testid="answers">{answers.join(',')}</output>
      <output data-testid="unsent">{unsent.map((entry) => entry.state).join(',')}</output>
    </>
  );
}

type Save = (record: SampleRecord) => Promise<void>;

function renderForm(save: Save, language: Language = 'en') {
  render(
    <I18nextProvider i18n={createI18n(language)}>
      <ConfirmProvider>
        <UnsentProvider>
          <SampleForm row={ROW} onSave={save} />
          <Leaver />
        </UnsentProvider>
      </ConfirmProvider>
    </I18nextProvider>,
  );
}

/** A save whose answer the test gives when it wants. */
function heldSave() {
  const answers: { saved: () => void; refused: () => void }[] = [];
  const save = vi.fn<Save>(
    () =>
      new Promise<void>((resolve, reject) => {
        answers.push({
          saved: resolve,
          refused: () => {
            reject(new ApiFailure('no_answer'));
          },
        });
      }),
  );
  const answer = async (index: number, how: 'saved' | 'refused'): Promise<void> => {
    await act(async () => {
      answers[index]?.[how]();
      await Promise.resolve();
    });
  };
  return { save, answer };
}

const score = () => screen.getByLabelText<HTMLInputElement>(en.sample.score);

const type = (value: string): void => {
  fireEvent.change(score(), { target: { value } });
};

const pressSave = (): void => {
  fireEvent.submit(screen.getByRole('form'));
};

const savedSign = () => within(screen.getByRole('form')).getByRole('status').textContent;

const unsent = () => screen.getByTestId('unsent').textContent;

const answers = () => screen.getByTestId('answers').textContent;

const tryToLeave = (): void => {
  fireEvent.click(screen.getByRole('button', { name: LEAVE }));
};

// docs/spec/12-ux-standards.md, No lost work: a visible saved sign. The sign
// must be true while a save is on its way.
describe('a record form while its save is on the way', () => {
  it('does not say "Saved" of what was typed after Save was pressed', async () => {
    const { save, answer } = heldSave();
    renderForm(save);
    type('90');
    pressSave();

    type('91');
    await answer(0, 'saved');

    expect(savedSign()).toBe('');
    expect(unsent()).toBe('typed');

    // The next Save sends what is in the fields now.
    pressSave();
    await answer(1, 'saved');
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0].score).toBe(91);
    expect(savedSign()).toBe(en.form.saved);
    expect(unsent()).toBe('');
  });

  it('sends once when Save is pressed twice', async () => {
    const { save, answer } = heldSave();
    renderForm(save);
    type('90');

    pressSave();
    pressSave();
    await answer(0, 'saved');

    expect(save).toHaveBeenCalledTimes(1);
    expect(savedSign()).toBe(en.form.saved);
  });

  // The warning before leaving must say what is true: it waits for the answer.
  it('lets the person leave without a question when the save arrives', async () => {
    const { save, answer } = heldSave();
    renderForm(save);
    type('90');
    pressSave();

    tryToLeave();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(answers()).toBe('');
    await answer(0, 'saved');

    await waitFor(() => {
      expect(answers()).toBe('true');
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    // Nothing was dropped: the field holds what was saved.
    expect(score().value).toBe('90');
  });

  it('asks when the save is refused, and keeps what was typed when the person stays', async () => {
    const { save, answer } = heldSave();
    renderForm(save);
    type('90');
    pressSave();

    tryToLeave();
    await answer(0, 'refused');

    const dialog = await screen.findByRole('alertdialog', { name: en.unsent.leaveTitle });
    expect(within(dialog).getByText(ROW.name)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: en.unsent.stay }));

    await waitFor(() => {
      expect(answers()).toBe('false');
    });
    expect(score().value).toBe('90');
    expect(unsent()).toBe('failed');
  });
});

describe('the question about leaving', () => {
  it('is asked once when two things ask at the same moment, and answers both', async () => {
    renderForm(() => Promise.resolve());
    type('90');

    tryToLeave();
    tryToLeave();

    const dialog = await screen.findByRole('alertdialog', { name: en.unsent.leaveTitle });
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('button', { name: en.unsent.leave }));

    await waitFor(() => {
      expect(answers()).toBe('true,true');
    });
    // Leaving by choice drops what was typed.
    expect(score().value).toBe('77');
    expect(unsent()).toBe('');
  });
});

describe('a record form whose save was refused', () => {
  it('is no longer unsaved once the fields hold what is saved again', async () => {
    renderForm(() => Promise.reject(new ApiFailure('no_answer')));
    type('90');
    pressSave();
    expect((await screen.findByRole('alert')).textContent).toBe(en.problems.noAnswer);
    // The entry reaches the top bar in an effect, which can land a render after the alert.
    await waitFor(() => {
      expect(unsent()).toBe('failed');
    });

    type('77');

    expect(unsent()).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
    tryToLeave();
    await waitFor(() => {
      expect(answers()).toBe('true');
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

// docs/spec/12-ux-standards.md, Language: every message in the three languages.
describe('the messages of a field', () => {
  it('are said in Uzbek', () => {
    renderForm(() => Promise.resolve(), 'uz');
    const name = screen.getByLabelText<HTMLInputElement>(uz.sample.name);

    fireEvent.change(name, { target: { value: 'B' } });

    expect(screen.getByText(uz.form.tooShort_other.replace('{{n}}', '2'))).toBeDefined();
    fireEvent.change(screen.getByLabelText(uz.sample.grade), { target: { value: '6,5' } });
    expect(screen.getByText(uz.form.wholeNumber)).toBeDefined();
  });

  // A message that arrives while typing is read out.
  it('arrive in a region a screen reader follows', () => {
    renderForm(() => Promise.resolve());

    type('101');

    const message = screen.getByText(en.form.tooBig.replace('{{max}}', '100'));
    expect(message.parentElement?.getAttribute('aria-live')).toBe('polite');
  });
});

// Issue #39, hand test of 13 October 2026, finding 10: "Save failed" in the
// top bar lasts only while it is true of what the form holds.
describe('the sign of a failed save', () => {
  const refusedOnce = () => {
    let calls = 0;
    return vi.fn<Save>(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new ApiFailure('no_answer')) : Promise.resolve();
    });
  };

  it('becomes "not saved" once the fields change after the refusal', async () => {
    renderForm(refusedOnce());
    type('90');
    pressSave();
    await waitFor(() => {
      expect(unsent()).toBe('failed');
    });

    type('91');

    expect(unsent()).toBe('typed');
  });

  it('is gone after the next save of the form succeeds', async () => {
    renderForm(refusedOnce());
    type('90');
    pressSave();
    await waitFor(() => {
      expect(unsent()).toBe('failed');
    });

    pressSave();

    await waitFor(() => {
      expect(unsent()).toBe('');
    });
  });

  it('is gone when the person leaves and what was typed is dropped', async () => {
    renderForm(refusedOnce());
    type('90');
    pressSave();
    await waitFor(() => {
      expect(unsent()).toBe('failed');
    });

    tryToLeave();
    const dialog = await screen.findByRole('alertdialog', { name: en.unsent.leaveTitle });
    fireEvent.click(within(dialog).getByRole('button', { name: en.unsent.leave }));

    await waitFor(() => {
      expect(unsent()).toBe('');
    });
    expect(score().value).toBe('77');
  });

  it('is never shown for a save the person stopped before it was sent', async () => {
    renderForm(() => Promise.reject(new SaveCancelled()));
    type('90');
    pressSave();
    await waitFor(() => {
      expect(unsent()).toBe('typed');
    });
    expect(score().value).toBe('90');
  });
});

// Review of the build of pull request #77, finding 4: the hand test's case of
// two forms on one page, and a form taken away after its refusal.
describe('the sign of a failed save with two forms on the page', () => {
  const OTHER: SampleRow = { ...ROW, id: 'sample-0003', name: 'Malika Yusupova', score: 64 };

  function renderTwo(saveFirst: Save, saveSecond: Save) {
    function Page() {
      const [first, setFirst] = useState(true);
      return (
        <>
          {first && <SampleForm row={ROW} onSave={saveFirst} />}
          <SampleForm row={OTHER} onSave={saveSecond} />
          <button
            type="button"
            onClick={() => {
              setFirst(false);
            }}
          >
            close
          </button>
          <Leaver />
        </>
      );
    }
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <ConfirmProvider>
          <UnsentProvider>
            <Page />
          </UnsentProvider>
        </ConfirmProvider>
      </I18nextProvider>,
    );
  }

  const formOf = (name: string) => screen.getByRole('form', { name });
  const scoreOf = (name: string) =>
    within(formOf(name)).getByLabelText<HTMLInputElement>(en.sample.score);

  it('does not say "Save failed" after another form saves, once the refused one was changed', async () => {
    renderTwo(
      () => Promise.reject(new ApiFailure('no_answer')),
      () => Promise.resolve(),
    );
    fireEvent.change(scoreOf(ROW.name), { target: { value: '90' } });
    fireEvent.submit(formOf(ROW.name));
    await waitFor(() => {
      expect(unsent()).toBe('failed');
    });
    fireEvent.change(scoreOf(ROW.name), { target: { value: '91' } });

    fireEvent.change(scoreOf(OTHER.name), { target: { value: '70' } });
    fireEvent.submit(formOf(OTHER.name));
    await within(formOf(OTHER.name)).findByText(en.form.saved);

    expect(unsent()).toBe('typed');
  });

  it('is gone when the refused form is closed', async () => {
    renderTwo(
      () => Promise.reject(new ApiFailure('no_answer')),
      () => Promise.resolve(),
    );
    fireEvent.change(scoreOf(ROW.name), { target: { value: '90' } });
    fireEvent.submit(formOf(ROW.name));
    await waitFor(() => {
      expect(unsent()).toBe('failed');
    });

    fireEvent.click(screen.getByRole('button', { name: 'close' }));

    await waitFor(() => {
      expect(unsent()).toBe('');
    });
  });
});

// Task 2.7c-2b-1: a form opened by Edit in a side panel has a quiet Cancel
// after Save; typed text is asked about first (`12`, No lost work).
describe('the Cancel of a record form', () => {
  function renderCancellable(save: Save) {
    const cancelled = vi.fn();
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <ConfirmProvider>
          <UnsentProvider>
            <SampleForm row={ROW} onSave={save} onCancel={cancelled} />
            <Leaver />
          </UnsentProvider>
        </ConfirmProvider>
      </I18nextProvider>,
    );
    return cancelled;
  }
  const cancel = () => screen.getByRole<HTMLButtonElement>('button', { name: en.form.cancel });

  it('is not drawn without onCancel', () => {
    renderForm(vi.fn<Save>(() => Promise.resolve()));
    expect(screen.queryByRole('button', { name: en.form.cancel })).toBeNull();
  });

  it('is a quiet button after Save, and closes at once when nothing is typed', () => {
    const cancelled = renderCancellable(vi.fn<Save>(() => Promise.resolve()));
    const buttons = within(screen.getByRole('form')).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([en.form.save, en.form.cancel]);
    expect(cancel().dataset.variant).toBe('ghost');

    fireEvent.click(cancel());

    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks about typed text, stays when the person stays, and drops it when they leave', async () => {
    const cancelled = renderCancellable(vi.fn<Save>(() => Promise.resolve()));
    type('90');

    fireEvent.click(cancel());
    const dialog = await screen.findByRole('alertdialog', { name: en.unsent.leaveTitle });
    expect(within(dialog).getByText(ROW.name)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: en.unsent.stay }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(cancelled).not.toHaveBeenCalled();
    expect(score().value).toBe('90');

    fireEvent.click(cancel());
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: en.unsent.leave,
      }),
    );
    await waitFor(() => {
      expect(cancelled).toHaveBeenCalledTimes(1);
    });
    expect(unsent()).toBe('');
  });

  it('is off while the save is on its way', () => {
    const { save } = heldSave();
    renderCancellable(save);
    type('90');
    pressSave();

    expect(cancel().disabled).toBe(true);
  });
});
