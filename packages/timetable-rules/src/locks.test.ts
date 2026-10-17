import { describe, expect, it } from 'vitest';
import { patternModel } from './facts-data.js';
import { lockedBy, type PatternLock } from './locks.js';
import { newBlockOf, type PatternBlock } from './pattern-place.js';
import { patternData } from './testing/pattern-fixture.js';

// Task 5.4c-1: "A lesson, a class, a teacher or a day can be locked" (06, Auto-generation).

const model = patternModel(patternData());

const block = (id: string, rowIds: readonly string[], weekday: number): PatternBlock => ({
  id,
  weekday,
  slotPosition: 1,
  start: 480,
  end: 525,
  lessons: rowIds.map((loadRowId) => ({ id: `${id}:${loadRowId}`, loadRowId, roomId: null })),
});

const math7a = block('a', ['math-7a'], 1);
const english = block('e', ['eng-e1', 'eng-e2'], 2);

describe('lockedBy', () => {
  it('names nothing without locks', () => {
    expect(lockedBy(model, [], math7a)).toEqual([]);
  });

  it('holds a block by its own lock only', () => {
    const lock: PatternLock = { id: 'l', kind: 'block', blockId: 'a' };
    expect(lockedBy(model, [lock], math7a)).toEqual([lock]);
    expect(lockedBy(model, [lock], english)).toEqual([]);
  });

  it('holds a block of a class lock, a group block by every class it draws from', () => {
    const lock: PatternLock = { id: 'l', kind: 'class', classId: '7a' };
    expect(lockedBy(model, [lock], math7a)).toEqual([lock]);
    expect(lockedBy(model, [lock], english)).toEqual([lock]);
    expect(lockedBy(model, [lock], block('b', ['math-7b'], 1))).toEqual([]);
  });

  it('holds a block of a teacher lock on any teacher of its rows', () => {
    const lock: PatternLock = { id: 'l', kind: 'teacher', teacherId: 't4' };
    expect(lockedBy(model, [lock], english)).toEqual([lock]);
    expect(lockedBy(model, [lock], math7a)).toEqual([]);
  });

  it('holds a block on a locked day, and keeps a block out of a locked day it would move to', () => {
    const lock: PatternLock = { id: 'l', kind: 'day', weekday: 2 };
    expect(lockedBy(model, [lock], english)).toEqual([lock]);
    expect(lockedBy(model, [lock], math7a)).toEqual([]);
    expect(lockedBy(model, [lock], math7a, { weekday: 2 })).toEqual([lock]);
    expect(lockedBy(model, [lock], math7a, { weekday: 3 })).toEqual([]);
  });

  it('holds a new block of a locked class', () => {
    const fresh = newBlockOf(model, 'math-7b');
    expect(lockedBy(model, [{ id: 'l', kind: 'class', classId: '7b' }], fresh)).toHaveLength(1);
    expect(lockedBy(model, [{ id: 'l', kind: 'class', classId: '7a' }], fresh)).toEqual([]);
  });
});
