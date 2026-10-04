import type { en } from './en';

/** The plural forms a language can have (Unicode CLDR). */
export type PluralForm = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/**
 * The shape of `T` for a language with the plural forms `Forms`: the same keys
 * with a text each, and for every text that depends on a number (`key_one`,
 * `key_other` in English) one key per form of that language.
 */
type Shape<T, Forms extends PluralForm> = {
  [K in keyof T as K extends `${string}_${PluralForm}` ? never : K]: T[K] extends string
    ? string
    : Shape<T[K], Forms>;
} & {
  [K in keyof T as K extends `${infer Base}_${PluralForm}` ? `${Base}_${Forms}` : never]: string;
};

/** What a language file must contain, given its plural forms. */
export type Texts<Forms extends PluralForm> = Shape<typeof en, Forms>;
