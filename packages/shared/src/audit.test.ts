import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTIONS,
  auditCursorOf,
  auditCursorSchema,
  auditQuerySchema,
  hideIdentity,
  SIGN_IN_HISTORY_ACTIONS,
  type HideableEntry,
} from './audit.js';

const ID = '0199a000-0000-7000-8000-000000000001';

const entryOf = (values: Partial<HideableEntry>): HideableEntry => ({
  action: 'student.edit',
  recordType: 'student',
  personId: null,
  oldValue: null,
  newValue: null,
  details: null,
  ...values,
});

// Task 2.6a, pull request #75: decision 6 (fail closed), decision 5 (search),
// decision 10 (the own history). All values are invented.
describe('the audit log in packages/shared', () => {
  describe('hideIdentity', () => {
    it('hides the Identity of a student entry and keeps the other groups', () => {
      const hidden = hideIdentity(
        entryOf({
          oldValue: { firstName: 'Madina', address: 'Yunusobod 7', birthDate: '2013-07-19' },
          newValue: {
            firstName: 'Madina',
            address: 'Chilonzor 3',
            phone: '+998901112233',
            scholarship: { type: 'gift', coverage: 'full', amount: null },
            documentNumber: 'AA1234567',
            jshshir: '31907130000011',
            region: 'tashkent_city',
          },
        }),
      );
      expect(hidden.oldValue).toEqual({ firstName: 'Madina', address: null, birthDate: null });
      expect(hidden.newValue).toEqual({
        firstName: 'Madina',
        address: null,
        phone: '+998901112233',
        scholarship: { type: 'gift', coverage: 'full', amount: null },
        documentNumber: null,
        jshshir: null,
        region: null,
      });
      expect(hidden.hidden.sort()).toEqual(
        [
          'oldValue.address',
          'oldValue.birthDate',
          'newValue.address',
          'newValue.documentNumber',
          'newValue.jshshir',
          'newValue.region',
        ].sort(),
      );
    });

    it('hides the nested snake_case row of a deleted student', () => {
      const hidden = hideIdentity(
        entryOf({
          action: 'student.delete',
          oldValue: {
            student: {
              first_name: 'Madina',
              birth_date: '2013-07-19',
              document_number: 'AA1',
              uid: '2607001',
            },
            relatives: [{ relativeId: ID, relationship: 'mother', mainContact: true }],
            uids: ['2607001'],
          },
        }),
      );
      expect(hidden.oldValue).toEqual({
        student: { first_name: 'Madina', birth_date: null, document_number: null, uid: '2607001' },
        relatives: [{ relativeId: ID, relationship: 'mother', mainContact: true }],
        uids: ['2607001'],
      });
      expect(hidden.hidden.sort()).toEqual([
        'oldValue.student.birth_date',
        'oldValue.student.document_number',
      ]);
    });

    it('hides a key it does not know, and does not name an empty value', () => {
      const hidden = hideIdentity(
        entryOf({ newValue: { passportSeries: 'AB', firstName: 'Madina', address: null } }),
      );
      expect(hidden.newValue).toEqual({ passportSeries: null, firstName: 'Madina', address: null });
      expect(hidden.hidden).toEqual(['newValue.passportSeries']);
    });

    it("hides a relative's email and workplace, and keeps a student's email", () => {
      expect(
        hideIdentity(
          entryOf({
            action: 'relative.edit',
            recordType: 'relative',
            newValue: { email: 'r@example.uz', workplace: 'Chorsu', fullName: 'Zarina Aliyeva' },
          }),
        ).newValue,
      ).toEqual({ email: null, workplace: null, fullName: 'Zarina Aliyeva' });
      expect(hideIdentity(entryOf({ newValue: { email: 's@example.uz' } })).newValue).toEqual({
        email: 's@example.uz',
      });
    });

    it('treats an entry about a person as people data whatever its action', () => {
      const hidden = hideIdentity(
        entryOf({
          action: 'room.edit',
          recordType: 'room',
          personId: ID,
          newValue: { birthDate: '1990-01-01' },
        }),
      );
      expect(hidden.newValue).toEqual({ birthDate: null });
    });

    it('leaves an entry of setup as it is', () => {
      const values = { name: 'Block A', address: 'Main street 1' };
      expect(
        hideIdentity(entryOf({ action: 'building.edit', recordType: 'building', newValue: values }))
          .newValue,
      ).toEqual(values);
    });

    it('hides only the typed search of an export', () => {
      const hidden = hideIdentity(
        entryOf({
          action: 'student.export',
          recordType: null,
          details: { list: 'students', search: 'AA7654321', filters: { grade: '7' }, rows: 3 },
        }),
      );
      expect(hidden.details).toEqual({
        list: 'students',
        search: null,
        filters: { grade: '7' },
        rows: 3,
      });
      expect(hidden.hidden).toEqual(['details.search']);
      expect(
        hideIdentity(entryOf({ action: 'student.export', details: { search: '' } })).hidden,
      ).toEqual([]);
    });
  });

  describe('the query of the page', () => {
    it('reads a person, a record, dates, a group and a cursor', () => {
      const cursor = auditCursorOf({ occurredAt: '2026-10-10T18:55:00.000Z', id: ID });
      expect(
        auditQuerySchema.parse({
          person: `student:${ID.toUpperCase()}`,
          recordType: 'student',
          recordId: ID,
          from: '2026-10-01',
          to: '2026-10-10',
          group: 'people',
          before: cursor,
        }),
      ).toEqual({
        person: { kind: 'student', id: ID },
        recordType: 'student',
        recordId: ID,
        from: '2026-10-01',
        to: '2026-10-10',
        group: 'people',
        scope: 'branch',
        before: { at: '2026-10-10T18:55:00.000Z', id: ID },
      });
      expect(auditCursorSchema.parse(cursor)).toEqual({ at: '2026-10-10T18:55:00.000Z', id: ID });
    });

    it.each([
      ['an unknown person kind', { person: `teacher:${ID}` }],
      ['a record without its id', { recordType: 'student' }],
      ['a range that ends before it begins', { from: '2026-10-10', to: '2026-10-01' }],
      ['a range of more than 366 days', { from: '2025-10-01', to: '2026-10-02' }],
      ['an unknown scope', { scope: 'everything' }],
      ['an unknown field', { branch: ID }],
      ['a broken cursor', { before: 'yesterday' }],
    ])('refuses %s', (_name, query) => {
      expect(auditQuerySchema.safeParse(query).success).toBe(false);
    });

    it('accepts a range of exactly 366 days', () => {
      expect(auditQuerySchema.safeParse({ from: '2025-10-01', to: '2026-10-01' }).success).toBe(
        true,
      );
    });
  });

  it('names every event of the own history among the actions', () => {
    for (const action of SIGN_IN_HISTORY_ACTIONS) {
      expect(AUDIT_ACTIONS).toContain(action);
    }
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });
});
