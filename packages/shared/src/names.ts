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
 * The words a search must all find, folded by `spellingKey`; `null` when
 * nothing is typed. One split for the lists, Ctrl+K and the search routes of
 * the API (task 3.2d, moved from the web's list state), so the server and
 * the screen find the same records.
 */
export function searchWords(typed: string | undefined): string[] | null {
  const words = spellingKey(typed ?? '')
    .split(/\s+/)
    .filter((word) => word !== '');
  return words.length === 0 ? null : words;
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

/** Stand-ins for oʻ and gʻ while the other apostrophes are dropped. */
const O_OKINA = '\u0001';
const G_OKINA = '\u0002';

/** Cyrillic letters whose Uzbek Latin is a letter of its own in the order. */
const CYRILLIC_ORDER_LETTERS: Readonly<Record<string, string>> = { ў: O_OKINA, ғ: G_OKINA };

/** The letters of the Uzbek Latin alphabet after z, in order (edge/journal: "... z, oʻ, gʻ, sh, ch, ng"). */
const AFTER_Z = [O_OKINA, G_OKINA, 'sh', 'ch', 'ng'] as const;

/**
 * The ranks of a name's letters in the one fixed order of `edge/journal`
 * ("Uzbek names: Oʻktam, Gʻulomov, Shodiyev, and names typed in Cyrillic": "One
 * fixed order (... z, oʻ, gʻ, sh, ch, ng) is used everywhere: grid, exports,
 * prints, in all three languages"; task 6.2, decision 15): Cyrillic read as its
 * Uzbek Latin, any apostrophe after o or g making oʻ or gʻ, the letters a to z
 * in their Latin order, the five two-letter letters after z, anything else after
 * them by its code.
 */
function orderRanks(text: string): number[] {
  const lower = text.normalize('NFKC').toLocaleLowerCase('en');
  let latin = '';
  for (const letter of lower) {
    latin += CYRILLIC_ORDER_LETTERS[letter] ?? CYRILLIC_TO_LATIN[letter] ?? letter;
  }
  latin = latin
    .replace(/o['`ʻʼ’‘]/g, O_OKINA)
    .replace(/g['`ʻʼ’‘]/g, G_OKINA)
    .replace(APOSTROPHES, '');
  const ranks: number[] = [];
  for (let at = 0; at < latin.length; ) {
    const single = AFTER_Z.indexOf(latin.charAt(at) as (typeof AFTER_Z)[number]);
    const pair = AFTER_Z.indexOf(latin.slice(at, at + 2) as (typeof AFTER_Z)[number]);
    const special = single >= 0 ? single : pair;
    if (special >= 0) {
      ranks.push(27 + special);
      at += single >= 0 ? 1 : 2;
      continue;
    }
    const code = latin.charCodeAt(at);
    ranks.push(code >= 97 && code <= 122 ? code - 96 : code === 32 || code === 45 ? 0 : 100 + code);
    at += 1;
  }
  return ranks;
}

function compareRanks(left: string, right: string): number {
  const a = orderRanks(left);
  const b = orderRanks(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

/**
 * The order of students in the journal, its exports and prints (`07`, Layout:
 * "surname and name in alphabetical order"; `edge/journal`, "Two students in the
 * list have the same surname and name": "The paternal name is added; if they are
 * still equal, the UID tells them apart"): surname, first name, paternal name
 * (none first), then UID, each in the order of `orderRanks`.
 */
export function compareStudentNames(
  left: {
    readonly lastName: string;
    readonly firstName: string;
    readonly paternalName: string | null;
    readonly uid: string;
  },
  right: {
    readonly lastName: string;
    readonly firstName: string;
    readonly paternalName: string | null;
    readonly uid: string;
  },
): number {
  return (
    compareRanks(left.lastName, right.lastName) ||
    compareRanks(left.firstName, right.firstName) ||
    compareRanks(left.paternalName ?? '', right.paternalName ?? '') ||
    (left.uid < right.uid ? -1 : left.uid > right.uid ? 1 : 0)
  );
}
