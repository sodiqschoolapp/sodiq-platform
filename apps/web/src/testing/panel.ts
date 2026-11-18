import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect } from 'vitest';
import { en } from '@/i18n/locales/en';

/**
 * The side panel's actions (`PanelActions`): in the panel's header under its title since
 * 18 November 2026 (owner, 17 November), or `null` while a form of the panel is open.
 */
export const panelActions = (panel: HTMLElement): HTMLElement | null =>
  panel.querySelector<HTMLElement>('[data-slot="panel-actions"]');

/** The words of the buttons in the header, in their order; the "More" menu is not among them. */
export const panelActionNames = (panel: HTMLElement): string[] =>
  [...(panelActions(panel)?.querySelectorAll('[data-slot="button"]') ?? [])]
    .map((button) => button.textContent ?? '')
    .filter((text) => text !== '');

/** The "More" button of the panel's actions, or `null` when every action is in the header. */
export const moreButton = (panel: HTMLElement): HTMLElement | null => {
  const row = panelActions(panel);
  return row === null ? null : within(row).queryByRole('button', { name: en.list.moreActions });
};

/** The words of the items of the "More" menu, in their order; the menu is closed again after. */
export async function moreActionNames(panel: HTMLElement): Promise<string[]> {
  const more = moreButton(panel);
  if (more === null) {
    return [];
  }
  fireEvent.click(more);
  const menu = await screen.findByRole('menu');
  const names = within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent ?? '');
  fireEvent.keyDown(menu, { key: 'Escape' });
  await waitFor(() => {
    expect(screen.queryByRole('menu')).toBeNull();
  });
  return names;
}

/**
 * An action of the record by its words: a button of the header, or an item of the "More"
 * menu, which is opened for it. Press it with `fireEvent.click`.
 */
export async function panelAction(panel: HTMLElement, name: string): Promise<HTMLElement> {
  const row = panelActions(panel);
  const inRow = row === null ? null : within(row).queryByRole('button', { name });
  if (inRow !== null) {
    return inRow;
  }
  const more = moreButton(panel);
  if (more === null) {
    throw new Error(`The panel has no action "${name}".`);
  }
  if (more.getAttribute('aria-expanded') !== 'true') {
    fireEvent.click(more);
  }
  return within(await screen.findByRole('menu')).findByRole('menuitem', { name });
}

/**
 * Whether the actions are in the panel's header: right after the title row, before everything
 * else the panel shows (docs/design-system.md, Layout shell, Lists; owner, 17 November 2026).
 */
export const actionsInHeader = (panel: HTMLElement): boolean => {
  const row = panelActions(panel);
  const header = panel.querySelector('[data-slot="panel-header-actions"]');
  return (
    row !== null &&
    header !== null &&
    row.parentElement === header &&
    header.previousElementSibling?.querySelector('h2') != null
  );
};

/**
 * Edit, or the button `editText` of a part, pressed: its form, named
 * `name`. The actions are searched first, since a part may have a button
 * of the same words in a language ("Изменить", task 2.7c-2b-2b).
 */
export async function edit(
  panel: HTMLElement,
  name: string,
  editText: string = en.form.edit,
): Promise<HTMLElement> {
  const row = panelActions(panel);
  const inRow = row === null ? null : within(row).queryByRole('button', { name: editText });
  fireEvent.click(inRow ?? within(panel).getByRole('button', { name: editText }));
  return within(panel).findByRole('form', { name });
}

/** After a save the form has closed and the actions say "Saved.". */
export async function savedInPanel(panel: HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(panelActions(panel)?.textContent).toContain(en.form.saved);
  });
}
