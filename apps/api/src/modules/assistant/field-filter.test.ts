import { describe, expect, it } from 'vitest';
import { filterRead, filterWords, isRemovedKey, REMOVED, REMOVED_KEYS } from './field-filter.js';

// Task 11.12. `02`, Assistant, What never goes to the model: "Passport and birth certificate
// numbers, medical data, the financial group, phone numbers and addresses, passwords and
// secrets." Widened by plan decision 2 (Look first) to the Contact, Identity and Financial groups
// and the diagnostic score. Review correction 1: the shapes apply to free texts only, and a
// date, a moment, a year name, a room, a UID or an id is never replaced.

/** A read with the field at the top, in a list and deep inside. */
function everywhere(key: string, value: unknown): unknown {
  return {
    [key]: value,
    students: [{ id: 'a', name: 'Kamola', [key]: value }],
    student: { profile: { inner: { [key]: value } } },
  };
}

const removedEverywhere = (key: string, value: unknown) => {
  const filtered = JSON.stringify(filterRead(everywhere(key, value)));
  expect(filtered, key).not.toContain(`"${key}"`);
  if (typeof value === 'string') {
    expect(filtered, key).not.toContain(value);
  }
  // The rest of the read stays.
  expect(filtered).toContain('Kamola');
};

describe('the fields that never go to the model', () => {
  describe('passport and birth certificate numbers', () => {
    it('removes the document number and its type by key', () => {
      removedEverywhere('documentNumber', 'AA1234567');
      removedEverywhere('documentType', 'passport');
    });
    it('removes a passport and a birth certificate number written in a free text', () => {
      const filtered = JSON.stringify(
        filterRead({ comment: 'Passport AB 1234567, certificate I-TN 7654321.' }),
      );
      expect(filtered).not.toContain('1234567');
      expect(filtered).not.toContain('7654321');
      expect(filtered).toContain(REMOVED);
    });
  });

  it('removes medical data by key', () => {
    removedEverywhere('medicalNote', 'asthma');
    removedEverywhere('healthGroup', 'II');
  });

  it('removes the financial group: contracts, scholarship, previous school, consent', () => {
    removedEverywhere('contracts', [{ id: 'c', number: 'CTR-1', signedOn: '2026-09-01' }]);
    removedEverywhere('scholarship', { type: 'full' });
    removedEverywhere('previousSchool', 'School 12');
    removedEverywhere('consentSignedOn', '2026-09-01');
    removedEverywhere('contractNumber', 'CTR-77');
    removedEverywhere('financial', { contracts: [] });
  });

  describe('phone numbers', () => {
    it('removes every phone field by key', () => {
      for (const key of [
        'phone',
        'phones',
        'extraPhones',
        'mainContactPhone',
        'phoneInvalidSince',
      ]) {
        removedEverywhere(key, '+998901234567');
      }
    });
    it('removes a phone written in a free text, in any spacing', () => {
      for (const written of ['+998 90 123 45 67', '+998901234567', '90 123 45 67', '901234567']) {
        const filtered = JSON.stringify(filterRead({ note: `Call ${written} after five.` }));
        expect(filtered, written).not.toContain(written);
      }
    });
    it('removes a phone from the person’s own words', () => {
      expect(filterWords('Call +998 90 123 45 67 now')).toBe(`Call ${REMOVED} now`);
      expect(filterWords('Call 90 123 45 67 now')).toBe(`Call ${REMOVED} now`);
    });
  });

  it('removes addresses and the region by key', () => {
    removedEverywhere('address', 'Sentinel street 7');
    removedEverywhere('region', 'tashkent_city');
  });

  it('removes the rest of Contact and Identity: email, birth date, JSHSHIR, workplace, the main contact and the other relatives', () => {
    removedEverywhere('email', 'someone@example.com');
    removedEverywhere('birthDate', '2012-04-01');
    removedEverywhere('jshshir', '31234567890123');
    removedEverywhere('workplace', 'Sentinel works');
    removedEverywhere('mainContactName', 'Sentinel Parentov');
    removedEverywhere('mainContactRelationship', 'father');
    removedEverywhere('otherRelatives', 'Sentinel Aunt');
    removedEverywhere('contact', { phone: '+998901234567' });
    removedEverywhere('identity', { address: 'x' });
    // A JSHSHIR in a free text and in the person's words.
    expect(JSON.stringify(filterRead({ reason: 'JSHSHIR 31234567890123' }))).not.toContain(
      '31234567890123',
    );
    expect(filterWords('find 31234567890123')).toBe(`find ${REMOVED}`);
  });

  it('removes the diagnostic score', () => {
    removedEverywhere('diagnosticScore', 87);
  });

  it('removes passwords and secrets by key', () => {
    for (const key of [
      'password',
      'newPassword',
      'firstPassword',
      'secret',
      'token',
      'totpSecret',
      'recoveryCodes',
    ]) {
      removedEverywhere(key, 'sentinel-secret-1');
    }
  });

  it('takes its keys from the shared schemas of the groups', () => {
    for (const key of [
      'phone',
      'email',
      'birthdate',
      'documentnumber',
      'jshshir',
      'address',
      'region',
      'contracts',
      'scholarship',
      'previousschool',
      'consentsignedon',
      'workplace',
    ]) {
      expect(REMOVED_KEYS.has(key), key).toBe(true);
    }
  });

  describe('ordinary data passes unchanged (review correction 1)', () => {
    it('keeps dates, moments, year names, rooms, UIDs, ids and names in a read', () => {
      const read = {
        date: '2026-11-21',
        startsAt: '2026-11-21T08:30:00+05:00',
        yearName: '2026-2027',
        room: 'A-204',
        uid: '260012345',
        longUid: 'UID-2026-000123',
        id: '0199a000-0000-7000-8000-000000000001',
        name: 'Oxford 7B',
        lessons: 12,
        title: 'Lesson of 2026-11-21 in A-204',
      };
      expect(filterRead(read)).toEqual(read);
    });
    it('keeps a date and a class in the person’s words', () => {
      expect(filterWords("Move 7B's mathematics on 2026-03-10 to room A-204.")).toBe(
        "Move 7B's mathematics on 2026-03-10 to room A-204.",
      );
    });
    it('keeps names of people and of classes, which the reads need', () => {
      expect(isRemovedKey('firstName')).toBe(false);
      expect(isRemovedKey('fullName')).toBe(false);
      expect(isRemovedKey('className')).toBe(false);
    });
  });
});
