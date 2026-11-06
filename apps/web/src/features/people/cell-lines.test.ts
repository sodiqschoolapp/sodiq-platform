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
    changedHow: 'entry' as const,
  };

  it('names a rename with the title before and after', () => {
    expect(workLineText(t, line)).toBe('Title of Classwork: Dictation → Spelling');
  });

  it('names the takeover of a typed title, which leaves the work no title of its own', () => {
    expect(workLineText(t, { ...line, titleAfter: null, changedHow: 'takeover' })).toBe(
      'Title of Classwork: Dictation → —',
    );
  });

  it('reads the delete and the restore of a titled work as such, never as a rename', () => {
    expect(workLineText(t, { ...line, titleAfter: null, changedHow: 'deleted' })).not.toContain(
      'Title of',
    );
    expect(workLineText(t, { ...line, titleBefore: null, changedHow: 'restored' })).not.toContain(
      'Title of',
    );
  });

  it('names a change of the total first', () => {
    expect(workLineText(t, { ...line, totalAfter: 20 })).toBe('Total of Classwork: 10 → 20');
  });
});
