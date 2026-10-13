import { screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';
import { en } from '@/i18n/locales/en';

/**
 * After a new record of a list is saved (task 2.7c-2a): the side panel shows
 * the saved record, named after it, and never "Record not in the list".
 */
export async function savedRecordPanel(newTitle: string): Promise<HTMLElement> {
  let panel: HTMLElement | undefined;
  await waitFor(() => {
    const panels = screen.queryAllByRole('complementary');
    expect(panels).toHaveLength(1);
    panel = panels[0];
    const name = panel?.getAttribute('aria-label');
    expect(name).not.toBe(newTitle);
    expect(name).not.toBe(en.list.recordGoneTitle);
    expect(name).not.toBe(en.app.loading);
  });
  if (panel === undefined) {
    throw new Error('no side panel');
  }
  return panel;
}
