import type { PortalScore } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import { createI18n } from '@/i18n/i18n';
import { workTitle } from './portal-today-page';

const score = (kind: PortalScore['kind'], title: string | null): PortalScore => ({
  date: '2026-11-17',
  kind,
  title,
  code: null,
  position: 2,
  score: 9,
  total: 10,
  percent: 90,
  comment: null,
  savedAt: null,
  past: false,
});

// Owner, 19 November 2026: a title alone ("10-mashq") does not say whether a work was done in
// class or at home, so every score names its kind.
describe('the name of a work in the portal', () => {
  it('puts the kind before a title, in each language', () => {
    const uz = createI18n('uz').t;
    expect(workTitle(score('classwork', '10-mashq'), uz)).toBe('Sinf ishi · 10-mashq');
    expect(workTitle(score('homework', '10-mashq'), uz)).toBe('Uyga vazifa · 10-mashq');
    const ru = createI18n('ru').t;
    expect(workTitle(score('classwork', '10-mashq'), ru)).toBe('Классная работа · 10-mashq');
    expect(workTitle(score('homework', '10-mashq'), ru)).toBe('Домашнее задание · 10-mashq');
    const en = createI18n('en').t;
    expect(workTitle(score('homework', 'Read & answer <3>'), en)).toBe(
      'Homework · Read & answer <3>',
    );
  });

  it('puts a code before the title (task 11.27)', () => {
    const en = createI18n('en').t;
    expect(workTitle({ ...score('classwork', 'Fractions'), code: 'F1' }, en)).toBe(
      'Classwork · F1 · Fractions',
    );
  });

  it('names a work without a title by its kind and number only', () => {
    const uz = createI18n('uz').t;
    expect(workTitle(score('classwork', null), uz)).toBe('2-sinf ishi');
    expect(workTitle(score('homework', null), uz)).toBe('Uyga vazifa 2');
  });
});
