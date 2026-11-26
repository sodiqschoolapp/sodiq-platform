import { describe, expect, it } from 'vitest';
import {
  PLAN_CODE_MAX_LENGTH,
  codedName,
  planCodeSchema,
  planItemValuesSchema,
  planWorkInputSchema,
} from './plans.js';
import { lessonTopicSchema, planWorkRenameSchema, workAddSchema } from './journal-works.js';
import { subjectCodesSchema } from './subjects.js';

/** Task 11.27: codes for topics and works (`09`, Codes). */
describe('the code of a topic or a work (task 11.27)', () => {
  it('takes at most 20 characters, counted as the database counts them', () => {
    expect(PLAN_CODE_MAX_LENGTH).toBe(20);
    expect(planCodeSchema.parse('A'.repeat(20))).toBe('A'.repeat(20));
    expect(planCodeSchema.safeParse('A'.repeat(21)).success).toBe(false);
    // Cyrillic letters are one code point each; an emoji of two UTF-16 units is one character.
    expect(planCodeSchema.parse('Ж'.repeat(20))).toBe('Ж'.repeat(20));
    expect(planCodeSchema.parse('😀'.repeat(20))).toBe('😀'.repeat(20));
    expect(planCodeSchema.safeParse('😀'.repeat(21)).success).toBe(false);
  });

  it('drops spaces at either end, and an empty code is no code', () => {
    // `09`, Codes: "spaces at either end are dropped"; decision 4: no code is null.
    expect(planCodeSchema.parse('  T1.2  ')).toBe('T1.2');
    expect(planCodeSchema.parse(`  ${'B'.repeat(20)}\t`)).toBe('B'.repeat(20));
    expect(planCodeSchema.parse('   ')).toBeNull();
    expect(planCodeSchema.parse('')).toBeNull();
    expect(planCodeSchema.parse(null)).toBeNull();
  });

  it('is optional in every write that sets a topic or a title', () => {
    const values = { topic: 'Fractions', objectives: '', links: [], classworks: [], homeworks: [] };
    expect(planItemValuesSchema.parse(values).topicCode).toBeUndefined();
    expect(planItemValuesSchema.parse({ ...values, topicCode: ' F1 ' }).topicCode).toBe('F1');
    expect(planItemValuesSchema.safeParse({ ...values, topicCode: 'F'.repeat(21) }).success).toBe(
      false,
    );
    expect(planWorkInputSchema.parse({ title: 'Quiz', description: '', code: 'Q1' }).code).toBe(
      'Q1',
    );
    expect(workAddSchema.parse({ kind: 'classwork', title: 'Quiz', code: 'Q1' }).code).toBe('Q1');
    expect(
      planWorkRenameSchema.parse({ title: 'Quiz', baseTitle: 'Q', code: 'Q2', baseCode: 'Q1' })
        .code,
    ).toBe('Q2');
    expect(
      lessonTopicSchema.parse({ topic: 'T', baseTopic: '', topicCode: 'T1', baseTopicCode: null })
        .topicCode,
    ).toBe('T1');
  });

  it('is shown first with the name beside it, and the name alone without one', () => {
    expect(codedName('F1', 'Fractions')).toBe('F1 · Fractions');
    expect(codedName(null, 'Fractions')).toBe('Fractions');
    expect(codedName(undefined, 'Fractions')).toBe('Fractions');
  });

  it('the switch takes its value and nothing else', () => {
    expect(subjectCodesSchema.parse({ codesOn: true })).toEqual({ codesOn: true });
    expect(subjectCodesSchema.safeParse({ codesOn: true, name: 'x' }).success).toBe(false);
    expect(subjectCodesSchema.safeParse({}).success).toBe(false);
  });
});
