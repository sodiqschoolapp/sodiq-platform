import { describe, expect, it } from 'vitest';
import { DecodedCache } from './decoded-cache.js';

// Task 10.1c: the decoded values of the largest prepared units, kept between reads.
describe('DecodedCache', () => {
  it('gives back a value under its key only', () => {
    const cache = new DecodedCache(100);
    cache.set('a', { figure: 1 }, 10);
    expect(cache.get('a')).toEqual({ figure: 1 });
    expect(cache.get('b')).toBeUndefined();
  });

  it('keeps the stored size under its bound, dropping the least recently read first', () => {
    const cache = new DecodedCache(30);
    cache.set('a', 'A', 10);
    cache.set('b', 'B', 10);
    cache.set('c', 'C', 10);
    // Read again, so "b" is now the least recent.
    cache.get('a');
    cache.set('d', 'D', 10);
    expect(cache.has('b')).toBe(false);
    expect([cache.has('a'), cache.has('c'), cache.has('d')]).toEqual([true, true, true]);
    expect(cache.storedBytes).toBe(30);
  });

  it('never keeps a value larger than its bound, and counts a replaced value once', () => {
    const cache = new DecodedCache(30);
    cache.set('big', 'X', 31);
    expect(cache.has('big')).toBe(false);
    cache.set('a', 'A', 10);
    cache.set('a', 'A2', 20);
    expect(cache.get('a')).toBe('A2');
    expect(cache.storedBytes).toBe(20);
    expect(cache.size).toBe(1);
  });
});
