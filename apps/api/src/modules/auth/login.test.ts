import { describe, expect, it } from 'vitest';
import { loginBase, LoginNameError } from './login.js';

// Edge cases, "Accounts and sign-in": logins are generated (for example
// a.karimov). All names here are invented.
describe('the generated login', () => {
  it('is the first letter of the first name, a dot and the last name, in lower case', () => {
    expect(loginBase('Aziz', 'Karimov')).toBe('a.karimov');
    expect(loginBase('DILNOZA', 'YUSUPOVA')).toBe('d.yusupova');
  });

  // The owner's examples: every way an apostrophe is typed gives one login.
  it.each([
    ['the Uzbek modifier letter', 'Oʻtkir', 'Gʻaniyev'],
    ['the typewriter apostrophe', "O'tkir", "G'aniyev"],
    ['the curly apostrophe', 'O’tkir', 'G’aniyev'],
    ['the opening quote', 'O‘tkir', 'G‘aniyev'],
    ['the modifier apostrophe', 'Oʼtkir', 'Gʼaniyev'],
    ['the backtick', 'O`tkir', 'G`aniyev'],
  ])('drops an apostrophe typed as %s', (_name, firstName, lastName) => {
    expect(loginBase(firstName, lastName)).toBe('o.ganiyev');
  });

  it('drops hyphens, spaces and marks on letters', () => {
    expect(loginBase('Anna-Mariya', 'Sodiqova-Rahimova')).toBe('a.sodiqovarahimova');
    expect(loginBase('  Jasur ', 'Mirzo Aliyev')).toBe('j.mirzoaliyev');
    expect(loginBase('Élodie', 'Müller')).toBe('e.muller');
  });

  it.each([
    ['a Cyrillic first name', 'Азиз', 'Karimov'],
    ['a Cyrillic last name', 'Aziz', 'Каримов'],
    ['an empty first name', '', 'Karimov'],
    ['a last name of apostrophes only', 'Aziz', "'ʻ’"],
    ['a digit', 'Aziz', 'Karimov2'],
    ['a dot', 'A.', 'Karimov'],
  ])('refuses %s', (_name, firstName, lastName) => {
    expect(() => loginBase(firstName, lastName)).toThrow(LoginNameError);
  });

  it('does not repeat the name in its refusal', () => {
    try {
      loginBase('Азиз', 'Каримов');
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toMatch(/Азиз|Каримов/);
    }
  });
});
