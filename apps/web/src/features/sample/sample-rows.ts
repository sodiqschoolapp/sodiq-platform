/** A row of the sample list. Every name is invented. */
export interface SampleRow {
  id: string;
  name: string;
  grade: number;
  className: string;
  language: 'uz' | 'ru';
  status: 'active' | 'archived';
  /** Nothing for a row without a score. */
  score: number | null;
}

const FIRST_NAMES = [
  'Aziza',
  'Bekzod',
  'Dilshod',
  'Farida',
  'Gulnora',
  'Islom',
  'Jasur',
  'Kamola',
  'Laylo',
  'Madina',
  'Nodir',
  'Oʻgʻiloy',
  'Parviz',
  'Rustam',
  'Sevara',
  'Temur',
  'Umida',
  'Vali',
  'Yulduz',
  'Zafar',
];

const LAST_NAMES = [
  'Abdullayev',
  'Boboyev',
  'Choriyev',
  'Davronov',
  'Ergashev',
  'Fayzullayev',
  'Gʻaniyev',
  'Hamidov',
  'Ismoilov',
  'Joʻrayev',
  'Komilov',
  'Mirzayev',
];

const CLASS_NAMES = ['Oxford', 'Cambridge'];

/** The same rows on every call: the tests count on them. */
export function sampleRows(count = 240): SampleRow[] {
  return Array.from({ length: count }, (_, index) => {
    const first = FIRST_NAMES[index % FIRST_NAMES.length] ?? '';
    const last = LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length] ?? '';
    // After every pair of names was used once, a number keeps the names apart.
    const round = Math.floor(index / (FIRST_NAMES.length * LAST_NAMES.length));
    return {
      id: `sample-${String(index + 1).padStart(4, '0')}`,
      name: round === 0 ? `${first} ${last}` : `${first} ${last} ${String(round + 1)}`,
      grade: 5 + (index % 5),
      className: CLASS_NAMES[index % CLASS_NAMES.length] ?? '',
      language: index % 3 === 0 ? 'ru' : 'uz',
      status: index % 11 === 0 ? 'archived' : 'active',
      score: index % 7 === 0 ? null : 40 + ((index * 37) % 61),
    };
  });
}
