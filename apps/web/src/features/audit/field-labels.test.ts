import { describe, expect, it } from 'vitest';
import { fieldLabel, fieldsTypeOf } from './field-labels';

// Task 3.4c: the start date a department move writes into `staff.edit` and
// `subject.edit` is named in the History with the label of its form field
// (`.claude/rules/web.md`: a field of a record is named with the label its form has).
describe('the labels of the audit fields', () => {
  it('names the start date of a department move of a person and of a subject', () => {
    expect(fieldLabel(fieldsTypeOf('staff.edit', 'staff'), 'departmentStartsOn')).toBe(
      'people.staff.departmentStartsOn',
    );
    expect(fieldLabel(fieldsTypeOf('subject.edit', 'subject'), 'departmentStartsOn')).toBe(
      'setup.subjects.departmentStartsOn',
    );
  });
});
