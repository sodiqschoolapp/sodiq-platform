import { describe, expect, it } from 'vitest';
import { compareStudentNames, listName } from './names.js';

describe('listName (finding 27)', () => {
  it('puts the surname first', () => {
    expect(listName({ firstName: 'Malika', lastName: 'Karimova' })).toBe('Karimova Malika');
  });
});

describe('compareStudentNames (edge/journal, task 6.2 decision 15)', () => {
  const student = (lastName: string, firstName = 'Ali', paternalName: string | null = null, uid = 'S-1') => ({
    lastName,
    firstName,
    paternalName,
    uid,
  });
  const sorted = (names: string[]): string[] =>
    names.map((name) => student(name)).sort(compareStudentNames).map((one) => one.lastName);

  it('puts oʻ, gʻ, sh, ch and ng after z, in that order', () => {
    expect(sorted(['Ngoyev', 'Chorshanbiyev', 'Shodiyev', 'Gʻulomov', 'Oʻktamov', 'Zokirov', 'Abdullayev'])).toEqual([
      'Abdullayev',
      'Zokirov',
      'Oʻktamov',
      'Gʻulomov',
      'Shodiyev',
      'Chorshanbiyev',
      'Ngoyev',
    ]);
  });

  it('reads any apostrophe after o or g as the same letter', () => {
    expect(sorted(["O'ktamov", 'Zokirov'])).toEqual(['Zokirov', "O'ktamov"]);
    expect(sorted(['Gʼaniyev', 'Gulomov'])).toEqual(['Gulomov', 'Gʼaniyev']);
  });

  it('sorts names typed in Cyrillic with the Latin ones', () => {
    expect(sorted(['Шодиев', 'Rahimov', 'Ўктамов', 'Зокиров', 'Bakirov'])).toEqual([
      'Bakirov',
      'Rahimov',
      'Зокиров',
      'Ўктамов',
      'Шодиев',
    ]);
  });

  it('adds the first name, then the paternal name, then the UID', () => {
    const list = [
      student('Karimov', 'Ali', 'Valiyevich', 'S-3'),
      student('Karimov', 'Ali', null, 'S-9'),
      student('Karimov', 'Ali', 'Valiyevich', 'S-2'),
      student('Karimov', 'Aziz', null, 'S-1'),
    ].sort(compareStudentNames);
    expect(list.map((one) => one.uid)).toEqual(['S-9', 'S-2', 'S-3', 'S-1']);
  });
});
