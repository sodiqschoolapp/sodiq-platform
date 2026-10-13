import {
  DEFAULT_PHONE_PREFIX,
  phoneText,
  RELATIVE_EXTRA_PHONES_MAX,
  relativeRecordSchema,
  receivesNotices,
  relativePhoneSchema,
  smsCapable,
  type RelativeDetail,
  type RelativeHolder,
  type RelativeRecord,
} from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { CHECKED, CheckboxField, Field, SelectField } from '@/components/field';
import { CloseIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm, type FieldBinding } from '@/components/form/use-record-form';
import { asFormSchema } from './form-schema';

type RelativeField =
  | 'fullName'
  | 'phone'
  | 'noPhone'
  | 'workplace'
  | 'email'
  | 'extraCount'
  | 'extra1'
  | 'extra2'
  | 'extra3';

/**
 * The fields of the extra phones of a form (task 2.5b-2): how many are shown,
 * and one per phone. Three, as `RELATIVE_EXTRA_PHONES_MAX`: the type-check
 * fails here when that number changes.
 */
export interface ExtraPhoneFields<Name extends string> {
  count: Name;
  phones: readonly [Name, Name, Name];
}

const EXTRA_SLOTS: typeof RELATIVE_EXTRA_PHONES_MAX = 3;

/** An extra phone not typed yet: the country code, as on the main phone. */
const EMPTY_PHONE = `${DEFAULT_PHONE_PREFIX} `;

/** What the fields of the extra phones hold when the form opens. */
export function extraPhonesInitial<Name extends string>(
  fields: ExtraPhoneFields<Name>,
  phones: readonly string[],
): Record<Name, string> {
  const initial = { [fields.count]: String(Math.min(phones.length, EXTRA_SLOTS)) } as Record<
    Name,
    string
  >;
  fields.phones.forEach((field, index) => {
    initial[field] = phones[index] ?? EMPTY_PHONE;
  });
  return initial;
}

const shownOf = (typed: string): number => {
  const count = Number(typed);
  return Number.isInteger(count) ? Math.max(0, Math.min(count, EXTRA_SLOTS)) : 0;
};

/** The extra phones as typed, those shown only: the whole list the record sends. */
export function extraPhonesTyped<Name extends string>(
  fields: ExtraPhoneFields<Name>,
  typed: Record<Name, string>,
): string[] {
  return fields.phones.slice(0, shownOf(typed[fields.count])).map((field) => typed[field]);
}

/**
 * The field an issue of `extraPhones` names: the phone at its index, or the
 * count for the list as a whole (a phone given twice, which the field of that
 * phone says itself); `undefined` for an issue of another field.
 */
export function extraPhoneIssueField<Name extends string>(
  path: readonly PropertyKey[],
  fields: ExtraPhoneFields<Name>,
): Name | undefined {
  const at = path.indexOf('extraPhones');
  if (at === -1) {
    return undefined;
  }
  const index = path[at + 1];
  return (typeof index === 'number' ? fields.phones[index] : undefined) ?? fields.count;
}

const EXTRA_FIELDS: ExtraPhoneFields<'extraCount' | 'extra1' | 'extra2' | 'extra3'> = {
  count: 'extraCount',
  phones: ['extra1', 'extra2', 'extra3'],
};

const SCHEMA = asFormSchema<RelativeRecord>(relativeRecordSchema, (path) => [
  extraPhoneIssueField(path, EXTRA_FIELDS) ?? path[0] ?? 'fullName',
]);

/**
 * The "cannot receive SMS" warning of a typed phone (answer 24), a warning
 * only; nothing for a phone that is not complete yet.
 */
export function smsWarning(typed: string): boolean {
  const parsed = relativePhoneSchema.safeParse(typed);
  return parsed.success && !smsCapable(parsed.data);
}

/** A typed phone in its stored form, or `null` while it is not a phone. */
const storedOf = (typed: string): string | null => {
  const parsed = relativePhoneSchema.safeParse(typed);
  return parsed.success ? parsed.data : null;
};

/**
 * The extra phones of a relative (`edge/close-relatives`, row 5: "Extra
 * phones can be added; they are not unique and not used for sign-in"; task
 * 2.5b-2): added and removed one by one, at most three, each offered with the
 * country code and warned of as the main phone is (answer 24). A phone typed
 * twice is named on its second field; the schema refuses the save.
 */
export function ExtraPhonesField({
  count,
  phones,
}: {
  count: FieldBinding;
  phones: readonly FieldBinding[];
}) {
  const { t } = useTranslation();
  const shown = Math.min(shownOf(count.value), phones.length);
  const set = (binding: FieldBinding, value: string) => {
    binding.onChange({ target: { value } });
  };
  const stored = phones.slice(0, shown).map((phone) => storedOf(phone.value));
  const twice = (index: number): boolean => {
    const phone = stored[index];
    return phone !== null && phone !== undefined && stored.slice(0, index).includes(phone);
  };
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-1.5 text-sm font-medium">{t('people.relatives.extraPhones')}</legend>
      {phones.slice(0, shown).map((phone, index) => (
        <div key={phone.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
          <Field
            label={t('people.relatives.extraPhone', { n: index + 1 })}
            type="tel"
            autoComplete="off"
            {...phone}
            note={smsWarning(phone.value) ? t('people.relatives.noSms') : undefined}
            error={
              phone.error ?? (twice(index) ? t('people.relatives.extraPhoneTwice') : undefined)
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mt-6"
            aria-label={t('people.relatives.removeExtraPhone', { n: index + 1 })}
            onClick={() => {
              // The phones after it move up; the last field is offered empty again.
              for (let at = index; at < shown - 1; at += 1) {
                const next = phones[at + 1];
                const here = phones[at];
                if (next !== undefined && here !== undefined) {
                  set(here, next.value);
                }
              }
              const last = phones[shown - 1];
              if (last !== undefined) {
                set(last, EMPTY_PHONE);
              }
              set(count, String(shown - 1));
            }}
          >
            <CloseIcon />
          </Button>
        </div>
      ))}
      {shown < phones.length && (
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              set(count, String(shown + 1));
            }}
          >
            {t('people.relatives.addExtraPhone')}
          </Button>
        </div>
      )}
    </fieldset>
  );
}

/**
 * The holder named by a refused phone (`relative_phone_taken` or
 * `relative_phone_exists`, task 2.5a decision 3): the name and the number of
 * linked students, and the id when the reader may open or link that person.
 */
export function phoneHolderOf(
  failure: unknown,
): { fullName: string; students: number; id: string | null; mergeable: boolean } | null {
  if (
    !(failure instanceof ApiFailure) ||
    (failure.code !== 'relative_phone_taken' && failure.code !== 'relative_phone_exists')
  ) {
    return null;
  }
  const detail = failure.details?.[0];
  return detail?.holder === undefined
    ? null
    : { ...detail.holder, id: detail.recordId ?? null, mergeable: detail.mergeable === true };
}

/** A phone change refused as taken: who holds it, and what was typed. */
export interface TakenPhone {
  holder: NonNullable<ReturnType<typeof phoneHolderOf>>;
  record: RelativeRecord & { phone: string };
}

/** The two choices on a phone match (`edge/close-relatives`, row 2; task 2.5b-1). */
export const SAME_PERSON = 'same';
export const NEW_OWNER = 'new_owner';

/**
 * On a phone match the person entering chooses "same person" (link) or
 * "different person, the number has a new owner"; the second asks for the
 * earlier relative's new phone, or "unknown" for "no valid phone"
 * (`edge/close-relatives`, row 2; task 2.5b-1).
 */
export function OwnerChoice({
  found,
  owner,
  previousPhone,
  previousUnknown,
}: {
  found: RelativeHolder;
  owner: FieldBinding;
  previousPhone: FieldBinding;
  previousUnknown: FieldBinding;
}) {
  const { t } = useTranslation();
  return (
    <>
      <SelectField
        label={t('people.relatives.ownerChoice', { name: found.fullName })}
        options={[
          { value: SAME_PERSON, label: t('people.relatives.samePerson') },
          { value: NEW_OWNER, label: t('people.relatives.newOwner') },
        ]}
        {...owner}
      />
      {owner.value === NEW_OWNER ? (
        <>
          <CheckboxField
            label={t('people.relatives.previousUnknown', { name: found.fullName })}
            {...previousUnknown}
          />
          {previousUnknown.value !== CHECKED && (
            <Field
              label={t('people.relatives.previousPhone', { name: found.fullName })}
              type="tel"
              autoComplete="off"
              {...previousPhone}
            />
          )}
        </>
      ) : (
        <p role="status" className="text-sm">
          {t('people.relatives.found', { name: found.fullName, count: found.students })}
        </p>
      )}
    </>
  );
}

/**
 * The record of a relative (`04`, Close relatives: full name, main phone,
 * workplace, email; the extra phones of task 2.5b-2). "No phone of their own" empties the phone (decision 8).
 * A phone held by another relative is refused with that relative named.
 */
export function RelativeForm({
  relative,
  label,
  onSave,
  onTaken,
}: {
  relative: RelativeDetail;
  label: string;
  onSave: (record: RelativeRecord) => Promise<void>;
  /** A phone refused as taken, with its holder and the record typed (task 2.5b-1). */
  onTaken?: (taken: TakenPhone) => void;
}) {
  const { t } = useTranslation();
  const form = useRecordForm<RelativeField, RelativeRecord>({
    schema: SCHEMA,
    initial: {
      fullName: relative.fullName,
      phone: relative.phone === null ? `${DEFAULT_PHONE_PREFIX} ` : phoneText(relative.phone),
      noPhone: relative.phone === null ? CHECKED : '',
      workplace: relative.identity?.workplace ?? '',
      email: relative.identity?.email ?? '',
      ...extraPhonesInitial(EXTRA_FIELDS, relative.extraPhones.map(phoneText)),
    },
    read: (typed) => ({
      fullName: typed.fullName,
      phone: typed.noPhone === CHECKED ? null : typed.phone,
      workplace: typed.workplace,
      email: typed.email,
      // The whole list, always: the edit refuses a record without it (task 2.5b-2).
      extraPhones: extraPhonesTyped(EXTRA_FIELDS, typed),
    }),
    save: async (record) => {
      try {
        await onSave(record);
      } catch (error) {
        const holder = phoneHolderOf(error);
        if (holder !== null && record.phone !== null) {
          onTaken?.({ holder, record: { ...record, phone: record.phone } });
        }
        throw error;
      }
    },
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
      <ExtraPhonesField
        count={form.bind(EXTRA_FIELDS.count)}
        phones={EXTRA_FIELDS.phones.map((field) => form.bind(field))}
      />
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
