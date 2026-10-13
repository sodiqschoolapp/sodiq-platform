import { describe, expect, it } from 'vitest';
import { en } from './locales/en';
import { ru } from './locales/ru';
import { uz } from './locales/uz';

// The owner's answers to the hand test of 13 October 2026 (issue #39,
// findings 34–36): the wording of these keys is decided, not the builder's.
describe('the decided wording', () => {
  it('uses one Uzbek word for "inactive", for staff and students', () => {
    expect(uz.people.students.statuses.inactive).toBe('Faol emas');
    expect(uz.people.staff.statuses.inactive).toBe('Faol emas');
    expect(uz.people.students.inactiveFrom).toBe('{{date}} dan faol emas');
  });

  it('names "Also export"', () => {
    expect(uz.list.exportAlso).toBe('Qoʻshimcha maydonlar');
    expect(ru.list.exportAlso).toBe('Дополнительные поля');
    expect(en.list.exportAlso).toBe('Also export');
  });

  it('names the slot types', () => {
    expect(uz.setup.slotTypesLink).toBe('Dars va tanaffus turlari');
    expect(uz.setup.slotTypes.title).toBe('Dars va tanaffus turlari');
    expect(uz.setup.checklist.items.slotTypes).toBe('Dars va tanaffus turlari');
    expect(ru.setup.slotTypesLink).toBe('Типы уроков и перемен');
    expect(ru.setup.slotTypes.title).toBe('Типы уроков и перемен');
    expect(ru.setup.checklist.items.slotTypes).toBe('Типы уроков и перемен');
  });

  it('keeps no "slot type" in Uzbek or Russian', () => {
    expect(JSON.stringify(uz)).not.toMatch(/slot tur/i);
    expect(JSON.stringify(ru)).not.toMatch(/тип(а|ы|ов)? слот/i);
  });

  it('names the subject switches column', () => {
    expect(uz.setup.subjects.switches).toBe('Xususiyatlar');
    expect(ru.setup.subjects.switches).toBe('Признаки');
  });

  it('names the People tabs after the People page', () => {
    expect(en.people.sections).toBe('People sections');
    expect(ru.people.sections).toBe('Разделы «Люди»');
    expect(uz.people.sections).toBe('Odamlar boʻlimlari');
  });

  // The owner's confirmation of 13 October 2026, 19:46, on issue #39 (task
  // 2.7b-2, findings 17, 21, 22 and 26).
  it('names the photo refusal, the leaving dialog, the choices and the checklist marks', () => {
    expect(en.errors.photo_invalid).toBe('Choose a JPEG or PNG photo, up to 5 MB.');
    expect(uz.errors.photo_invalid).toBe(
      'JPEG yoki PNG formatidagi, 5 MB gacha boʻlgan surat tanlang.',
    );
    expect(ru.errors.photo_invalid).toBe('Выберите фотографию в формате JPEG или PNG, до 5 МБ.');
    expect(en.people.students.keepLeaving).toBe('Keep the leaving');
    expect(en.people.students.cancelLeaving).toBe('Cancel the leaving');
    expect(en.form.chooseGrade).toBe('Choose at least one grade.');
    expect(en.form.chooseSubject).toBe('Choose at least one subject.');
    expect(en.setup.checklist.done).toBe('Done');
    expect(en.setup.checklist.missing).toBe('Missing');
  });
});
