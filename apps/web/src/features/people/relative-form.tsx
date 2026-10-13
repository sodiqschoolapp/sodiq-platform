import {
  DEFAULT_PHONE_PREFIX,
  relativeRecordSchema,
  receivesNotices,
  relativePhoneSchema,
  smsCapable,
  type RelativeDetail,
  type RelativeRecord,
} from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { CHECKED, CheckboxField, Field } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm, type FieldBinding } from '@/components/form/use-record-form';
import { asFormSchema } from './form-schema';

type RelativeField = 'fullName' | 'phone' | 'noPhone' | 'workplace' | 'email';

const SCHEMA = asFormSchema<RelativeRecord>(relativeRecordSchema, (path) => [...path]);

/**
 * The "cannot receive SMS" warning of a typed phone (answer 24), a warning
 * only; nothing for a phone that is not complete yet.
 */
export function smsWarning(typed: string): boolean {
  const parsed = relativePhoneSchema.safeParse(typed);
  return parsed.success && !smsCapable(parsed.data);
}

/**
 * The holder named by a refused phone (`relative_phone_taken` or
 * `relative_phone_exists`, task 2.5a decision 3): the name and the number of
 * linked students, and the id when the reader may open or link that person.
 */
export function phoneHolderOf(
  failure: unknown,
): { fullName: string; students: number; id: string | null } | null {
  if (
    !(failure instanceof ApiFailure) ||
    (failure.code !== 'relative_phone_taken' && failure.code !== 'relative_phone_exists')
  ) {
    return null;
  }
  const detail = failure.details?.[0];
  return detail?.holder === undefined ? null : { ...detail.holder, id: detail.recordId ?? null };
}

/**
 * The record of a relative (`04`, Close relatives: full name, main phone,
 * workplace, email). "No phone of their own" empties the phone (decision 8).
 * A phone held by another relative is refused with that relative named.
 */
export function RelativeForm({
  relative,
  label,
  onSave,
}: {
  relative: RelativeDetail;
  label: string;
  onSave: (record: RelativeRecord) => Promise<void>;
}) {
  const { t } = useTranslation();
  const form = useRecordForm<RelativeField, RelativeRecord>({
    schema: SCHEMA,
    initial: {
      fullName: relative.fullName,
      phone: relative.phone ?? `${DEFAULT_PHONE_PREFIX} `,
      noPhone: relative.phone === null ? CHECKED : '',
      workplace: relative.identity?.workplace ?? '',
      email: relative.identity?.email ?? '',
    },
    read: (typed) => ({
      fullName: typed.fullName,
      phone: typed.noPhone === CHECKED ? null : typed.phone,
      workplace: typed.workplace,
      email: typed.email,
    }),
    save: onSave,
  });
  const noPhone = form.bind('noPhone').value === CHECKED;
  const phone = form.bind('phone');
  const holder = phoneHolderOf(form.failure);
  return (
    <RecordForm form={form} label={label}>
      <Field label={t('people.relatives.fullName')} autoComplete="off" {...form.bind('fullName')} />
      <CheckboxField label={t('people.relatives.noPhone')} {...form.bind('noPhone')} />
      {!noPhone && (
        <Field
          label={t('people.relatives.phone')}
          type="tel"
          autoComplete="off"
          {...phone}
          note={smsWarning(phone.value) ? t('people.relatives.noSms') : undefined}
          error={
            phone.error ??
            (holder === null
              ? undefined
              : t('people.relatives.takenBy', { name: holder.fullName, count: holder.students }))
          }
        />
      )}
      {relative.identity !== null && (
        <>
          <Field
            label={t('people.relatives.workplace')}
            autoComplete="off"
            {...form.bind('workplace')}
          />
          <Field
            label={t('people.relatives.email')}
            type="email"
            autoComplete="off"
            {...form.bind('email')}
          />
        </>
      )}
    </RecordForm>
  );
}

/**
 * The "receives notices" switch of a link: off and locked for a relative with
 * no phone of their own, whatever is stored (decision 8, `receivesNotices`
 * of packages/shared); the stored switch is sent as it was.
 */
export function NoticesField({
  label,
  note,
  hasPhone,
  ...bound
}: FieldBinding & { label: string; note?: string | undefined; hasPhone: boolean }) {
  const shown = receivesNotices({ receivesNotices: bound.value === CHECKED }, hasPhone ? '' : null);
  return (
    <CheckboxField
      label={label}
      note={note}
      {...bound}
      value={shown ? CHECKED : ''}
      disabled={!hasPhone}
    />
  );
}
