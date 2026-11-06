import { describe, expect, it } from 'vitest';
import { childExamRooms, isChildLesson } from './portal-timetable.service.js';

// Task 11.2, pull request #294: which lessons and exam rooms are a child's on a date (`06`,
// Views: "students and parents their own week"; `edge/timetable`, Exams).
const CLASS = 'class-7a';
const OTHER_CLASS = 'class-7b';
const GROUP = 'group-english-1';
const OTHER_GROUP = 'group-english-2';

describe('the lessons of a child', () => {
  const lesson = (kind: 'class' | 'group', id: string) => ({ id: 'lesson-1', unit: { kind, id } });

  it('takes the child’s class lesson and the lessons of its own groups only', () => {
    const groups = new Set([GROUP]);
    expect(isChildLesson(lesson('class', CLASS), CLASS, groups, new Set())).toBe(true);
    expect(isChildLesson(lesson('class', OTHER_CLASS), CLASS, groups, new Set())).toBe(false);
    expect(isChildLesson(lesson('group', GROUP), CLASS, groups, new Set())).toBe(true);
    // A group of the child's class that the child is not in.
    expect(isChildLesson(lesson('group', OTHER_GROUP), CLASS, groups, new Set())).toBe(false);
  });

  it('leaves out a lesson whose block a standing exam keeps the child’s class out of', () => {
    const groups = new Set([GROUP]);
    const keptOut = new Set([`lesson-1|${CLASS}`]);
    expect(isChildLesson(lesson('group', GROUP), CLASS, groups, keptOut)).toBe(false);
    // Kept out for another class only: still the child's.
    expect(
      isChildLesson(lesson('group', GROUP), CLASS, groups, new Set([`lesson-1|${OTHER_CLASS}`])),
    ).toBe(true);
  });
});

describe('the exam room of a child', () => {
  const room = (name: string, ownClassIds: string[], groupIds: string[]) => ({
    name,
    ownClassIds,
    groupIds,
  });

  it('takes the room of the child’s class', () => {
    const rooms = [room('101', [OTHER_CLASS], []), room('102', [CLASS], [])];
    expect(childExamRooms(rooms, CLASS, new Set()).map((one) => one.name)).toEqual(['102']);
  });

  it('takes the room of the child’s group, and never a group the child is not in', () => {
    const rooms = [room('201', [], [GROUP]), room('202', [], [OTHER_GROUP])];
    expect(childExamRooms(rooms, CLASS, new Set([GROUP])).map((one) => one.name)).toEqual(['201']);
    // A classmate in the other group: the group's exam of the class is not theirs.
    expect(childExamRooms([room('201', [], [GROUP])], CLASS, new Set([OTHER_GROUP]))).toEqual([]);
  });
});
