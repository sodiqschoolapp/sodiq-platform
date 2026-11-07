import { digestSettingsChangeSchema, type DigestSettings } from '@sodiq/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Field } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { ErrorState, LoadingOutline } from '@/components/states';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { useMayView } from '@/features/access/use-view';
import { digestSettingsQuery, saveDigestSettings } from '@/features/portal/digest-api';

/**
 * Task 11.5 (`10`, The parents' digest): the digest's time of day and the quiet hours, set by the
 * Super Admin alone (`school_settings`, plan decision 2); no other role sees the section.
 */
export function DigestSettingsSection(): React.JSX.Element | null {
  const { t } = useTranslation();
  const mayEdit = useMayView('school_settings', 'edit');
  const settings = useQuery(digestSettingsQuery(mayEdit));
  if (!mayEdit) return null;
  let body;
  if (settings.isError) {
    body = (
      <ErrorState
        error={settings.error}
        onRetry={() => {
          void settings.refetch();
        }}
      />
    );
  } else if (settings.data === undefined) {
    body = <LoadingOutline />;
  } else {
    body = <DigestSettingsForm settings={settings.data} />;
  }
  return (
    <section className={PANEL} aria-labelledby="digest-settings">
      <h2 id="digest-settings" className={SECTION_TITLE}>
        {t('digest.settings.title')}
      </h2>
      {body}
    </section>
  );
}

function DigestSettingsForm({ settings }: { settings: DigestSettings }): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const query = digestSettingsQuery(true);
  const form = useRecordForm({
    schema: digestSettingsChangeSchema,
    initial: { ...settings },
    read: (typed) => typed,
    save: async (change) => {
      const saved = await saveDigestSettings(change);
      queryClient.setQueryData(query.queryKey, saved);
    },
  });
  return (
    <RecordForm form={form} label={t('digest.settings.title')}>
      <Field
        type="time"
        label={t('digest.settings.sendAt')}
        note={t('digest.settings.sendAtNote')}
        {...form.bind('sendAt')}
      />
      <Field type="time" label={t('digest.settings.quietFrom')} {...form.bind('quietFrom')} />
      <Field type="time" label={t('digest.settings.quietUntil')} {...form.bind('quietUntil')} />
    </RecordForm>
  );
}
