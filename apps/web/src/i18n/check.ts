import { ERROR_CODES } from '@sodiq/shared';

/** The texts of one language: nested objects whose leaves are texts. */
export interface TextTree {
  [key: string]: string | TextTree;
}

const PLURAL_KEY = /^(.+)_(zero|one|two|few|many|other)$/;

function flatten(tree: TextTree, prefix = ''): Map<string, string> {
  const flat = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') {
      flat.set(path, value);
    } else {
      for (const [inner, text] of flatten(value, path)) {
        flat.set(inner, text);
      }
    }
  }
  return flat;
}

/** The `{{names}}` of a text, in order of the alphabet. */
function placeholders(text: string): string {
  return [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
    .map((match) => match[1])
    .sort()
    .join(', ');
}

/** `wait_one` is the form `one` of `wait`; a key without a form stands for itself. */
function baseAndForm(key: string): { base: string; form: string | undefined } {
  const match = PLURAL_KEY.exec(key);
  return match?.[1] === undefined
    ? { base: key, form: undefined }
    : { base: match[1], form: match[2] };
}

interface Entry {
  /** The plural forms the language has for this text; empty for a text without a number. */
  forms: Set<string>;
  texts: string[];
}

function entriesOf(tree: TextTree): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  for (const [key, text] of flatten(tree)) {
    const { base, form } = baseAndForm(key);
    const entry = entries.get(base) ?? { forms: new Set<string>(), texts: [] };
    if (form !== undefined) {
      entry.forms.add(form);
    }
    entry.texts.push(text);
    entries.set(base, entry);
  }
  return entries;
}

/**
 * docs/spec/12-ux-standards.md, Language: "A missing translation fails the
 * build." What is wrong with the texts of the languages, compared with the
 * first one; nothing when they are complete:
 *
 * - every language has the same keys, and no text is empty;
 * - a text with a number has exactly the plural forms of its language;
 * - the same `{{names}}` are filled in every language;
 * - every error code of the API has a text.
 */
export function translationProblems(resources: Record<string, TextTree>): string[] {
  const problems: string[] = [];
  const [reference, ...others] = Object.keys(resources);
  if (reference === undefined) {
    return ['There is no language.'];
  }
  const all = new Map(
    Object.entries(resources).map(([language, tree]) => [language, entriesOf(tree)]),
  );
  // Filled above for every key of `resources`.
  const expected = all.get(reference) ?? new Map<string, Entry>();

  for (const [language, entries] of all) {
    const forms = new Set<string>(
      new Intl.PluralRules(language).resolvedOptions().pluralCategories,
    );
    for (const [key, entry] of entries) {
      if (entry.texts.some((text) => text.trim() === '')) {
        problems.push(`${language}: "${key}" is empty.`);
      }
      if (entry.forms.size > 0) {
        const missing = [...forms].filter((form) => !entry.forms.has(form));
        const unknown = [...entry.forms].filter((form) => !forms.has(form));
        if (missing.length > 0) {
          problems.push(`${language}: "${key}" has no form ${missing.join(', ')}.`);
        }
        if (unknown.length > 0) {
          problems.push(
            `${language}: "${key}" has the form ${unknown.join(', ')}, which the language does not use.`,
          );
        }
      }
      const names = new Set(entry.texts.map(placeholders));
      const wanted = expected.get(key)?.texts[0];
      if (names.size > 1 || (wanted !== undefined && !names.has(placeholders(wanted)))) {
        problems.push(`${language}: "${key}" does not fill the same {{names}} as ${reference}.`);
      }
    }
    for (const code of ERROR_CODES) {
      if (!entries.has(`errors.${code}`)) {
        problems.push(`${language}: the error code "${code}" has no text.`);
      }
    }
  }

  for (const language of others) {
    const entries = all.get(language) ?? new Map<string, Entry>();
    for (const [key, entry] of expected) {
      const found = entries.get(key);
      if (found === undefined) {
        problems.push(`${language}: "${key}" is missing.`);
      } else if (found.forms.size > 0 !== entry.forms.size > 0) {
        problems.push(`${language}: "${key}" is a text with a number in one language only.`);
      }
    }
    for (const key of entries.keys()) {
      if (!expected.has(key)) {
        problems.push(`${language}: "${key}" does not exist in ${reference}.`);
      }
    }
  }
  return problems;
}
