import { useTranslation } from 'react-i18next';

/**
 * "Saved." after a save (docs/spec/12-ux-standards.md, No lost work: a visible
 * saved sign). Always in the page, so it is read out when the text arrives;
 * empty while `saved` is false. Shared by `RecordForm` and the actions that
 * save without one (availability, a vacancy closed or reopened; task 2.7b-2,
 * finding 18).
 */
export function SavedSign({ saved }: { saved: boolean }) {
  const { t } = useTranslation();
  return (
    <p role="status" className="text-sm font-medium">
      {saved && t('form.saved')}
    </p>
  );
}
