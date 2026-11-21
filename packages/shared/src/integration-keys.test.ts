import { describe, expect, it } from 'vitest';
import {
  INTEGRATION_KEY_NAME_MAX_LENGTH,
  INTEGRATION_KEY_PEOPLE_MAX,
  INTEGRATION_KEY_ROLES,
  INTEGRATION_KEY_SECRET_FORMAT,
  integrationKeyEndDateSchema,
  integrationKeyPeopleSchema,
  integrationKeyRecordSchema,
  latestIntegrationKeyEnd,
} from './integration-keys.js';

const id = (n: number): string => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('integration keys (task 10.9)', () => {
  it('counts the Teacher, Head Teacher and Senior Head Teacher roles only (`02`, Integration keys)', () => {
    expect(INTEGRATION_KEY_ROLES).toEqual(['teacher', 'head_teacher', 'senior_head_teacher']);
  });

  it('takes a name of 1 to 100 characters, trimmed', () => {
    const record = { staffRecordIds: [id(1)], endsOn: '2026-12-31' };
    expect(integrationKeyRecordSchema.parse({ ...record, name: '  English platform ' }).name).toBe(
      'English platform',
    );
    expect(
      integrationKeyRecordSchema.safeParse({
        ...record,
        name: 'x'.repeat(INTEGRATION_KEY_NAME_MAX_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      integrationKeyRecordSchema.safeParse({
        ...record,
        name: 'x'.repeat(INTEGRATION_KEY_NAME_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(integrationKeyRecordSchema.safeParse({ ...record, name: '   ' }).success).toBe(false);
  });

  it('takes 1 to 200 people, each once', () => {
    expect(integrationKeyPeopleSchema.safeParse({ staffRecordIds: [] }).success).toBe(false);
    const most = Array.from({ length: INTEGRATION_KEY_PEOPLE_MAX }, (_, n) => id(n));
    expect(integrationKeyPeopleSchema.safeParse({ staffRecordIds: most }).success).toBe(true);
    expect(
      integrationKeyPeopleSchema.safeParse({ staffRecordIds: [...most, id(999)] }).success,
    ).toBe(false);
    expect(
      integrationKeyPeopleSchema.safeParse({ staffRecordIds: [id(1), id(1).toUpperCase()] })
        .success,
    ).toBe(false);
  });

  it('refuses a field it does not know (strict objects)', () => {
    expect(
      integrationKeyRecordSchema.safeParse({
        name: 'English platform',
        staffRecordIds: [id(1)],
        endsOn: '2026-12-31',
        secret: 'mine',
      }).success,
    ).toBe(false);
    expect(
      integrationKeyEndDateSchema.safeParse({ endsOn: '2026-12-31', name: 'other' }).success,
    ).toBe(false);
    expect(integrationKeyEndDateSchema.safeParse({ endsOn: '31.12.2026' }).success).toBe(false);
  });

  it('allows an end date a year after today at the latest, 28 February after a 29 February (decision 5)', () => {
    expect(latestIntegrationKeyEnd('2026-11-21')).toBe('2027-11-21');
    expect(latestIntegrationKeyEnd('2028-02-29')).toBe('2029-02-28');
    expect(latestIntegrationKeyEnd('2027-02-28')).toBe('2028-02-28');
    expect(latestIntegrationKeyEnd('2026-12-31')).toBe('2027-12-31');
  });

  it('describes a secret as the prefix and 43 characters of base64url', () => {
    expect(INTEGRATION_KEY_SECRET_FORMAT.test(`sodiq_ik_${'A'.repeat(43)}`)).toBe(true);
    expect(INTEGRATION_KEY_SECRET_FORMAT.test(`sodiq_ik_${'A'.repeat(42)}`)).toBe(false);
    expect(INTEGRATION_KEY_SECRET_FORMAT.test(`other_${'A'.repeat(43)}`)).toBe(false);
  });
});
