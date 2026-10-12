import { LOGIN_FORMAT, LOGIN_MAX_LENGTH } from '@sodiq/shared';

/**
 * Edge cases, "Accounts and sign-in": logins are generated (for example
 * a.karimov). The rule, decided by the owner on 4 October 2026: the first
 * letter of the first name, a dot, the last name; lower case, a to z only.
 * The owner's answer 14 (task 2.3a) adds two longer forms, tried in order
 * (`loginForms`).
 */

/**
 * Every character that is typed as an apostrophe, among them the modifier
 * letters of Uzbek Latin (oʻ, gʻ and the tutuq belgisi).
 */
const APOSTROPHE_CODES = [
  0x0027, // apostrophe of the keyboard
  0x0060, // backtick
  0x00b4, // acute accent
  0x2018, // left single quotation mark
  0x2019, // right single quotation mark
  0x201b, // single high-reversed-9 quotation mark
  0x2032, // prime
  0x02b9, // modifier letter prime
  0x02bb, // modifier letter turned comma: the mark of o' and g' in Uzbek Latin
  0x02bc, // modifier letter apostrophe: the tutuq belgisi
  0x02bd, // modifier letter reversed comma
  0x02be, // modifier letter right half ring
  0x02bf, // modifier letter left half ring
  0x02c8, // modifier letter vertical line
  0x02ca, // modifier letter acute accent
  0x02cb, // modifier letter grave accent
];

/** Hyphens and dashes: hyphen-minus and U+2010 to U+2014. */
const HYPHEN_CODES = [0x002d, 0x2010, 0x2011, 0x2012, 0x2013, 0x2014];

// Written by number: several of these characters look the same in an editor.
const APOSTROPHES = new RegExp(`[${String.fromCodePoint(...APOSTROPHE_CODES)}]`, 'g');

/** Hyphens and spaces inside a name. */
const SEPARATORS = new RegExp(
  `[\\s${HYPHEN_CODES.map((code) => `\\u{${code.toString(16)}}`).join('')}]`,
  'gu',
);

/** What is left of a diacritic once its letter is split off. */
const MARKS = /\p{M}/gu;

/** Whether a text can be a login at all: the form and length of every login (db/migrations/0027). */
export const isLogin = (text: string): boolean =>
  text.length <= LOGIN_MAX_LENGTH && LOGIN_FORMAT.test(text);

/** The name cannot give a login: after the rule it is empty or has a letter outside a to z. */
export class LoginNameError extends Error {
  constructor() {
    // The name is not repeated: it is personal data.
    super('A login needs a first and a last name in Latin letters.');
  }
}

function latinLetters(name: string): string {
  const letters = name
    .normalize('NFD')
    .replace(MARKS, '')
    .toLowerCase()
    .replace(APOSTROPHES, '')
    .replace(SEPARATORS, '');
  if (!/^[a-z]+$/.test(letters)) {
    throw new LoginNameError();
  }
  return letters;
}

/**
 * The login of the first holder of a name: "Oʻtkir Gʻaniyev" gives `o.ganiyev`.
 * A name with other letters (Cyrillic) is refused; the caller types the Latin
 * spelling. Later holders get a number: `o.ganiyev2` (see `Accounts`).
 */
export function loginBase(firstName: string, lastName: string): string {
  return `${latinLetters(firstName).charAt(0)}.${latinLetters(lastName)}`;
}

/**
 * The forms of the owner's answer 14, in the order they are tried: the first
 * letter of the first name and the surname (`a.karimov`), the whole first
 * name and the surname (`akmal.karimov`), the whole first name, the first
 * letter of the father's name and the surname (`akmal.b.karimov`), without
 * the last one when there is no father's name. Spaces, hyphens and
 * apostrophes are dropped, as for `loginBase`. A form appears once. Throws
 * `LoginNameError` for a name that cannot give a login.
 */
export function loginForms(
  firstName: string,
  lastName: string,
  fatherName: string | null,
): string[] {
  const first = latinLetters(firstName);
  const last = latinLetters(lastName);
  const forms = [`${first.charAt(0)}.${last}`, `${first}.${last}`];
  const father = fatherName === null ? '' : fatherName.trim();
  if (father !== '') {
    forms.push(`${first}.${latinLetters(father).charAt(0)}.${last}`);
  }
  return [...new Set(forms)];
}
