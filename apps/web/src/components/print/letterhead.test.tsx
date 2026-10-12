import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { createI18n } from '@/i18n/i18n';
import { en } from '@/i18n/locales/en';
import { Letterhead } from './letterhead';

// docs/design-system.md, Brand moments, Printouts: "a navy tab with the
// on-dark one-line logo and a rounded top-right corner, followed by an orange
// band".
describe('the letterhead', () => {
  it('is the navy tab with the on-dark logo, then the orange band, printed in colour', () => {
    const { container } = render(
      <I18nextProvider i18n={createI18n('en')}>
        <Letterhead />
      </I18nextProvider>,
    );
    const logo = screen.getByRole('img', { name: en.app.name });
    expect(logo.getAttribute('src')).toBe('/brand/sodiq-logo-horizontal-on-dark.svg');
    const tab = logo.parentElement;
    expect(tab?.className).toContain('bg-sidebar');
    expect(tab?.className).toContain('rounded-tr-xl');
    expect(container.querySelector('[data-band]')?.className).toContain('bg-primary');
    expect(container.querySelector('[data-letterhead]')?.getAttribute('data-print')).toBe(
      'colours',
    );
  });
});
