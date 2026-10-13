import { describe, expect, it } from 'vitest';
import { listName } from './names.js';

describe('listName (finding 27)', () => {
  it('puts the surname first', () => {
    expect(listName({ firstName: 'Malika', lastName: 'Karimova' })).toBe('Karimova Malika');
  });
});
