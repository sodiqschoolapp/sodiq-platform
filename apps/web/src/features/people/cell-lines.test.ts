import type { TFunction } from 'i18next';
import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { workLineText } from './cell-lines';

// Task 10.6: a line of a work's history names a rename and the takeover of a typed title.
describe('a line of a work', () => {
  let t: TFunction;

  beforeAll(async () => {
    const instance = i18next.createInstance();
    await instance.init({ lng: 'en', resources: { en: { translation: en } } });
    t = instance.t;
  });

  const line = {
    workKind: 'classwork' as const,
    totalBefore: 10,
    totalAfter: 10,
    notHeldBefore: false,
    notHeldAfter: false,
    titleBefore: 'Dictation',
    titleAfter: 'Spelling',
  };

  it('names a rename with the title before and after', () => {
    expect(workLineText(t, line)).toBe('Title of Classwork: Dictation → Spelling');
  });

  it('names the takeover of a typed title, the plan title shown in its place', () => {
    expect(workLineText(t, { ...line, titleAfter: null })).toBe(
      'Title of Classwork: Dictation → —',
    );
  });

  it('names a change of the total first', () => {
    expect(workLineText(t, { ...line, totalAfter: 20, titleAfter: 'Spelling' })).toBe(
      'Total of Classwork: 10 → 20',
    );
  });
});
