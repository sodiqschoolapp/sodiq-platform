/**
 * Names as typed on a document and their folding (answer 18), shared by
 * student and relative records (moved here from students.ts in task 2.5a).
 */

const OKINA = 'ʻ';
const MODIFIER_APOSTROPHE = 'ʼ';
/** The apostrophes a keyboard types: ', `, ʻ, ʼ, ’ and ‘. */
const APOSTROPHES = /['`ʻʼ’‘]/g;

/**
 * A student's name in its stored form: outer spaces dropped, inner runs made
 * one, and in Latin each apostrophe stored as ʻ after o or g and as ʼ
 * elsewhere (as `storedName` of the staff record).
 */
export function storedStudentName(typed: string): string {
  const spaced = typed.trim().replace(/\s+/g, ' ');
  return spaced.replace(APOSTROPHES, (_mark, offset: number) => {
    const before = spaced.charAt(offset - 1).toLowerCase();
    return before === 'o' || before === 'g' ? OKINA : MODIFIER_APOSTROPHE;
  });
}

/** Latin with ʻ and ʼ, or Cyrillic with ў қ ғ ҳ; one script per name; the check of the database. */
const LATIN_NAME = /^[A-Za-zʻʼ]+([ -][A-Za-zʻʼ]+)*$/;
const CYRILLIC_NAME = /^[А-Яа-яЁёЎўҚқҒғҲҳ]+([ -][А-Яа-яЁёЎўҚқҒғҲҳ]+)*$/;

export const validName = (name: string): boolean =>
  LATIN_NAME.test(name) || CYRILLIC_NAME.test(name);

/** Cyrillic letters to the Latin of the Uzbek state alphabet (the Russian ones too). */
const CYRILLIC_TO_LATIN: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'j',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'x',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sh',
  ъ: '',
  ы: 'i',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  ў: 'o',
  қ: 'q',
  ғ: 'g',
  ҳ: 'h',
};

/**
 * A text with its spelling differences removed (answer 18: "Search and the
 * duplicate check treat look-alike spellings as the same (Oʻtkir, O'tkir,
 * Ўткир)"): lower case, Cyrillic written in Latin, every apostrophe and the
 * hard and soft signs dropped (so oʻ is o and gʻ is g), "kh" and every h not
 * after s or c written x (Russian writes Uzbek x and h both as х: Рахимов is
 * Rahimov), runs of spaces made one. The Russian у of an Uzbek ў (Уткир for
 * Ўткир) is not folded: u and o stay apart (decided in the build of 2.4a). The one folding of the platform: the list search and the
 * stored `name_key` of the duplicate check use it; a change to it comes with a
 * migration that rewrites `students.name_key`.
 */
export function spellingKey(text: string): string {
  const lower = text.normalize('NFKC').toLocaleLowerCase('en');
  let latin = '';
  for (const letter of lower) {
    latin += CYRILLIC_TO_LATIN[letter] ?? letter;
  }
  return latin
    .replace(APOSTROPHES, '')
    .replace(/kh/g, 'x')
    .replace(/(?<![sc])h/g, 'x')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A person's name in a list, an export or a picker: surname first, as on
 * school registers (owner's answer to finding 27 of the hand test of
 * 13 October 2026). Titles of panels and pages, the own name and sentences
 * keep "First name Surname" (task 2.7b-1, decision 3).
 */
export const listName = (person: {
  readonly firstName: string;
  readonly lastName: string;
}): string => `${person.lastName} ${person.firstName}`;
