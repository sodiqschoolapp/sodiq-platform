import type { Database } from '../database/database.js';

/**
 * A standing exam over one class lesson, its lesson cancelled "exam" with the
 * link, as an exam save leaves it (task 5.6c-3a, permission review must-fix 1):
 * rows a publish or a withdraw over its date would change, for the 404 tests
 * that compare every row of both branches. Written by the migrator in one
 * transaction, so the commit checks of 0060 and 0094 see it whole. The room
 * must be free at the lesson's time; the invigilator may be the lesson's
 * teacher, whom the cancel frees.
 */
export async function standingExamOver(
  migrator: Database,
  input: { readonly lessonId: string; readonly roomId: string; readonly staffId: string },
): Promise<string> {
  return migrator.transaction().execute(async (transaction) => {
    const lesson = await transaction
      .selectFrom('lessons')
      .innerJoin('lesson_blocks', 'lesson_blocks.id', 'lessons.block_id')
      .select([
        'lessons.branch_id',
        'lessons.class_id',
        'lessons.lesson_date',
        'lessons.starts_at',
        'lessons.ends_at',
        'lessons.subject_id',
        'lesson_blocks.academic_year_id',
      ])
      .where('lessons.id', '=', input.lessonId)
      .executeTakeFirstOrThrow();
    if (lesson.class_id === null) throw new Error('A class lesson is needed.');
    const exam = await transaction
      .insertInto('exams')
      .values({
        branch_id: lesson.branch_id,
        academic_year_id: lesson.academic_year_id,
        exam_date: lesson.lesson_date,
        starts_at: lesson.starts_at,
        ends_at: lesson.ends_at,
        first_slot: 1,
        last_slot: 1,
        title: 'Quarter exam',
        subject_id: lesson.subject_id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    // The lesson cancelled and linked first: the class claim meets it at once.
    await transaction
      .updateTable('lessons')
      .set({ cancel_cause: 'exam', cancel_reason: null })
      .where('id', '=', input.lessonId)
      .execute();
    await transaction
      .insertInto('lesson_exam_cancels')
      .values({ branch_id: lesson.branch_id, lesson_id: input.lessonId, exam_id: exam.id })
      .execute();
    const room = await transaction
      .insertInto('exam_rooms')
      .values({ branch_id: lesson.branch_id, exam_id: exam.id, room_id: input.roomId })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('exam_room_classes')
      .values({
        branch_id: lesson.branch_id,
        exam_id: exam.id,
        exam_room_id: room.id,
        class_id: lesson.class_id,
      })
      .execute();
    await transaction
      .insertInto('exam_invigilators')
      .values({
        branch_id: lesson.branch_id,
        exam_id: exam.id,
        exam_room_id: room.id,
        staff_id: input.staffId,
      })
      .execute();
    return exam.id;
  });
}
