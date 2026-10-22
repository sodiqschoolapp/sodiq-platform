import { describe, expect, it } from 'vitest';
import {
  PLAN_FILE_EXTENSIONS,
  PLAN_FILE_MAX_BYTES,
  PLAN_FILE_TYPES,
  PLAN_FILES_MAX,
  PLAN_LINK_MAX_LENGTH,
  PLAN_LINKS_MAX,
  PLAN_OBJECTIVES_MAX_LENGTH,
  PLAN_TOPIC_MAX_LENGTH,
  PLAN_WORK_DESCRIPTION_MAX_LENGTH,
  PLAN_WORK_TITLE_MAX_LENGTH,
  PLAN_WORKS_MAX,
  planFileUploadQuerySchema,
  planItemCreateSchema,
  planItemSaveSchema,
  planItemValuesSchema,
} from './plans.js';

const QUARTER = '0190f3a0-0000-7000-8000-000000000001';
const WORK = '0190f3a0-0000-7000-8000-000000000002';

const values = (change: Record<string, unknown> = {}) => ({
  topic: 'Fractions',
  objectives: '',
  links: [],
  classworks: [],
  homeworks: [],
  ...change,
});

const work = (title = 'Exercise 1', description = '') => ({ title, description });

// Task 7.1a, pull request #212: 09, What a plan contains; edge/lesson-plans,
// "Limits: 20 MB per file, 10 files per item, a fixed list of file types. Each
// classwork and each homework has a short title of at most 60 characters".
describe('plan schemas (task 7.1a)', () => {
  it('keeps the bounds of the spec and of the plan (decisions 3 and 7)', () => {
    expect(PLAN_WORK_TITLE_MAX_LENGTH).toBe(60);
    expect(PLAN_WORKS_MAX).toBe(10);
    expect(PLAN_FILES_MAX).toBe(10);
    expect(PLAN_FILE_MAX_BYTES).toBe(20_000_000);
    expect(PLAN_TOPIC_MAX_LENGTH).toBe(300);
    expect(PLAN_OBJECTIVES_MAX_LENGTH).toBe(2000);
    expect(PLAN_WORK_DESCRIPTION_MAX_LENGTH).toBe(1000);
    expect(PLAN_LINKS_MAX).toBe(10);
    expect(PLAN_LINK_MAX_LENGTH).toBe(500);
    expect(Object.keys(PLAN_FILE_EXTENSIONS).sort()).toEqual([...PLAN_FILE_TYPES].sort());
  });

  it('requires a topic that is not blank, of at most 300 characters', () => {
    expect(planItemValuesSchema.safeParse(values()).success).toBe(true);
    for (const topic of ['', '   ', 'x'.repeat(PLAN_TOPIC_MAX_LENGTH + 1)]) {
      expect(planItemValuesSchema.safeParse(values({ topic })).success, topic).toBe(false);
    }
    expect(
      planItemValuesSchema.safeParse(values({ topic: 'x'.repeat(PLAN_TOPIC_MAX_LENGTH) })).success,
    ).toBe(true);
  });

  it('takes up to 10 classworks and 10 homeworks, each with a title of at most 60 characters', () => {
    const ten = Array.from({ length: PLAN_WORKS_MAX }, (_, index) => work(`Work ${index}`));
    expect(
      planItemValuesSchema.safeParse(values({ classworks: ten, homeworks: ten })).success,
    ).toBe(true);
    expect(planItemValuesSchema.safeParse(values({ classworks: [...ten, work()] })).success).toBe(
      false,
    );
    expect(planItemValuesSchema.safeParse(values({ homeworks: [...ten, work()] })).success).toBe(
      false,
    );
    expect(
      planItemValuesSchema.safeParse(
        values({ classworks: [work('x'.repeat(PLAN_WORK_TITLE_MAX_LENGTH))] }),
      ).success,
    ).toBe(true);
    for (const title of ['', ' ', 'x'.repeat(PLAN_WORK_TITLE_MAX_LENGTH + 1)]) {
      expect(planItemValuesSchema.safeParse(values({ classworks: [work(title)] })).success).toBe(
        false,
      );
    }
    expect(
      planItemValuesSchema.safeParse(
        values({ homeworks: [work('Read', 'x'.repeat(PLAN_WORK_DESCRIPTION_MAX_LENGTH + 1))] }),
      ).success,
    ).toBe(false);
  });

  it('takes up to 10 web addresses, never another kind of text', () => {
    const links = Array.from(
      { length: PLAN_LINKS_MAX },
      (_, index) => `https://example.org/${index}`,
    );
    expect(planItemValuesSchema.safeParse(values({ links })).success).toBe(true);
    expect(
      planItemValuesSchema.safeParse(values({ links: [...links, 'https://example.org/x'] }))
        .success,
    ).toBe(false);
    for (const link of [
      'example.org',
      'ftp://example.org',
      'https://example.org/a b',
      `https://${'x'.repeat(PLAN_LINK_MAX_LENGTH)}`,
    ]) {
      expect(planItemValuesSchema.safeParse(values({ links: [link] })).success, link).toBe(false);
    }
  });

  it('refuses an id on a work of a new item, and takes it on a save', () => {
    expect(
      planItemCreateSchema.safeParse({
        quarterId: QUARTER,
        position: 1,
        values: values({ classworks: [{ id: WORK, ...work() }] }),
      }).success,
    ).toBe(false);
    expect(
      planItemCreateSchema.safeParse({ quarterId: QUARTER, position: 0, values: values() }).success,
    ).toBe(false);
    const base = values({ classworks: [{ id: WORK, ...work() }] });
    expect(
      planItemSaveSchema.safeParse({
        base,
        values: values({ classworks: [{ id: WORK, ...work('Exercise 2') }] }),
      }).success,
    ).toBe(true);
  });

  it('names a file with up to 200 characters', () => {
    expect(planFileUploadQuerySchema.safeParse({ name: 'Worksheet.pdf' }).success).toBe(true);
    expect(planFileUploadQuerySchema.safeParse({ name: ' ' }).success).toBe(false);
    expect(planFileUploadQuerySchema.safeParse({ name: 'x'.repeat(201) }).success).toBe(false);
  });
});
