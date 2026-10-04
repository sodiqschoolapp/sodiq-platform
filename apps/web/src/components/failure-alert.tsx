import { useTranslation } from 'react-i18next';
import { failureText } from '@/api/failure-text';
import { Alert, AlertDescription } from '@/components/ui/alert';

/** The refusal or failure of a call, in the language of the person. Nothing while there is none. */
export function FailureAlert({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (error === null || error === undefined) {
    return null;
  }
  return (
    <Alert variant="destructive">
      <AlertDescription>{failureText(t, error)}</AlertDescription>
    </Alert>
  );
}
