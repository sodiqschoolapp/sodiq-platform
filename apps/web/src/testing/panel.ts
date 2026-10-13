import { fireEvent, waitFor, within } from '@testing-library/react';
import { expect } from 'vitest';
import { en } from '@/i18n/locales/en';

/**
 * The side panel's actions at the bottom (task 2.7c-2b-1): the row of
 * `PanelActions`, or `null` while a form of the panel is open.
 */
export const panelActions = (panel: HTMLElement): HTMLElement | null =>
  panel.querySelector<HTMLElement>('[data-slot="panel-actions"]');

/** The words of the buttons in the bottom row, in their order. */
export const panelActionNames = (panel: HTMLElement): string[] =>
  [...(panelActions(panel)?.querySelectorAll('[data-slot="button"]') ?? [])].map(
    (button) => button.textContent ?? '',
  );

/** Whether nothing of the panel follows its bottom row. */
export const actionsAreLast = (panel: HTMLElement): boolean => {
  const row = panelActions(panel);
  if (row === null) {
    return false;
  }
  let node: Element | null = row;
  while (node !== null && node !== panel) {
    if (node.nextElementSibling !== null) {
      return false;
    }
    node = node.parentElement;
  }
  return node === panel;
};

/** Edit pressed in the panel's bottom row: its form, named `name`. */
export async function edit(panel: HTMLElement, name: string): Promise<HTMLElement> {
  fireEvent.click(within(panel).getByRole('button', { name: en.form.edit }));
  return within(panel).findByRole('form', { name });
}

/** After a save the form has closed and the bottom row says "Saved.". */
export async function savedInPanel(panel: HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(panelActions(panel)?.textContent).toContain(en.form.saved);
  });
}
