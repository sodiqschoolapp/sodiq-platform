import { describe, expect, it } from 'vitest';
import { examBodySchema, examCheckBodySchema, examCreateBodySchema } from './exams.js';

// Task 5.6c-3b (decision 5): the rating-exam tick of an exam, only with a subject.
describe('the rating exam of an exam body', () => {
  const body = {
    date: '2026-10-19',
    firstLesson: 1,
    lastLesson: 1,
    title: 'Quarter exam',
    subjectId: '0192a000-0000-7000-8000-000000000001',
    rooms: [
      {
        roomId: '0192a000-0000-7000-8000-000000000002',
        classIds: ['0192a000-0000-7000-8000-000000000003'],
        groupIds: [],
        invigilatorIds: ['0192a000-0000-7000-8000-000000000004'],
      },
    ],
  };

  it('is off unless ticked', () => {
    expect(examCreateBodySchema.parse(body).ratingExam).toBe(false);
    expect(examCreateBodySchema.parse({ ...body, ratingExam: true }).ratingExam).toBe(true);
  });

  it('is refused with no subject, on a create, a change and a check', () => {
    const noSubject = { ...body, subjectId: null, ratingExam: true };
    for (const schema of [examCreateBodySchema, examBodySchema, examCheckBodySchema]) {
      const parsed = schema.safeParse(noSubject);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.path)).toEqual([['ratingExam']]);
      expect(schema.safeParse({ ...noSubject, ratingExam: false }).success).toBe(true);
    }
  });
});
