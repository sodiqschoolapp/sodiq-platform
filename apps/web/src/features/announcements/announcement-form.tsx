import {
  ANNOUNCEMENT_GRADES,
  classDisplayName,
  announcementFormSchema,
  type Announcement,
  type AnnouncementForm as FormValues,
} from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  CHECKED,
  CheckboxField,
  CheckboxGroupField,
  DateField,
  Field,
  listValue,
  listValues,
  SelectField,
  TextAreaField,
} from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { ErrorState } from '@/components/states';
import { useView } from '@/features/access/use-view';
import { classesQuery } from '@/features/classes/classes-api';

interface AnnouncementFormProps {
  /** The announcement edited; `null` for a new one. Its audience and readers stay (decision 5). */
  row: Announcement | null;
  /** Whether "Whole school" is offered (the Super Admin). */
  mayWriteSchool: boolean;
  onSave: (values: FormValues) => Promise<void>;
  onCancel?: () => void;
}

const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

/**
 * A new announcement or event, or the edit of one (task 11.7): the text and an event's dates,
 * times and place; for a new one also the kind, the audience and the readers, which are fixed
 * once saved (plan decision 5).
 */
export function AnnouncementForm({ row, mayWriteSchool, onSave, onCancel }: AnnouncementFormProps) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const fresh = row === null;
  const classes = useQuery({ ...classesQuery(branchId), enabled: branchId !== null && fresh });
  const form = useRecordForm({
    schema: announcementFormSchema,
    initial: {
      kind: row?.kind ?? 'news',
      title: row?.title ?? '',
      body: row?.body ?? '',
      audience: row?.audience.kind ?? 'branch',
      grades: row?.audience.kind === 'grades' ? listValue(row.audience.grades.map(String)) : '',
      classIds:
        row?.audience.kind === 'classes'
          ? listValue(row.audience.classes.map((one) => one.id))
          : '',
      forStaff: row === null || row.forStaff ? CHECKED : '',
      forParents: row === null || row.forParents ? CHECKED : '',
      firstDate: row?.event?.firstDate ?? '',
      lastDate: row?.event?.lastDate ?? '',
      startsAt: row?.event?.startsAt ?? '',
      endsAt: row?.event?.endsAt ?? '',
      place: row?.event?.place ?? '',
    },
    read: (typed) => ({
      kind: typed.kind,
      title: typed.title,
      body: typed.body,
      audience: typed.audience,
      grades: typed.audience === 'grades' ? listValues(typed.grades).map(Number) : [],
      classIds: typed.audience === 'classes' ? listValues(typed.classIds) : [],
      forStaff: typed.forStaff === CHECKED,
      forParents: typed.forParents === CHECKED,
      firstDate: typed.kind === 'event' ? orNull(typed.firstDate) : null,
      lastDate: typed.kind === 'event' ? orNull(typed.lastDate) : null,
      startsAt: typed.kind === 'event' ? orNull(typed.startsAt) : null,
      endsAt: typed.kind === 'event' ? orNull(typed.endsAt) : null,
      place: typed.kind === 'event' ? orNull(typed.place) : null,
    }),
    save: onSave,
    checkedOnSave: ['grades', 'classIds', 'forParents'],
  });
  const kind = form.bind('kind').value;
  const audience = form.bind('audience').value;
  return (
    <RecordForm
      form={form}
      label={row?.title ?? t('announcements.manage.newTitle')}
      onCancel={onCancel}
    >
      {fresh && (
        <SelectField
          label={t('announcements.form.kind')}
          options={[
            { value: 'news', label: t('announcements.kind.news') },
            { value: 'event', label: t('announcements.kind.event') },
          ]}
          {...form.bind('kind')}
        />
      )}
      <Field label={t('announcements.form.title')} autoComplete="off" {...form.bind('title')} />
      <TextAreaField label={t('announcements.form.body')} {...form.bind('body')} />
      {kind === 'event' && (
        <>
          <DateField label={t('announcements.form.firstDate')} {...form.bind('firstDate')} />
          <DateField label={t('announcements.form.lastDate')} {...form.bind('lastDate')} />
          <Field label={t('announcements.form.startsAt')} type="time" {...form.bind('startsAt')} />
          <Field label={t('announcements.form.endsAt')} type="time" {...form.bind('endsAt')} />
          <Field label={t('announcements.form.place')} autoComplete="off" {...form.bind('place')} />
        </>
      )}
      {fresh && (
        <>
          <SelectField
            label={t('announcements.form.audience')}
            options={[
              ...(mayWriteSchool
                ? [{ value: 'school', label: t('announcements.audience.school') }]
                : []),
              { value: 'branch', label: t('announcements.audience.branch') },
              { value: 'grades', label: t('announcements.audience.grades') },
              { value: 'classes', label: t('announcements.audience.classes') },
            ]}
            {...form.bind('audience')}
          />
          {audience === 'grades' && (
            <CheckboxGroupField
              label={t('announcements.form.grades')}
              options={ANNOUNCEMENT_GRADES.map((grade) => ({
                value: String(grade),
                label: t('announcements.grade', { grade }),
              }))}
              {...form.bind('grades')}
            />
          )}
          {audience === 'classes' &&
            (classes.isError ? (
              <ErrorState
                error={classes.error}
                onRetry={() => {
                  void classes.refetch();
                }}
              />
            ) : (
              <CheckboxGroupField
                label={t('announcements.form.classes')}
                options={(classes.data?.classes ?? [])
                  .filter((one) => !one.archived && one.yearStatus !== 'closed')
                  .map((one) => ({ value: one.id, label: classDisplayName(one.grade, one.name) }))}
                {...form.bind('classIds')}
              />
            ))}
          <CheckboxField label={t('announcements.form.forStaff')} {...form.bind('forStaff')} />
          <CheckboxField
            label={t('announcements.form.forParents')}
            note={t('announcements.form.forParentsNote')}
            {...form.bind('forParents')}
          />
        </>
      )}
    </RecordForm>
  );
}
