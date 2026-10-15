import { useTranslation } from 'react-i18next';
import { failureText } from '@/api/failure-text';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * The refusal or failure of a call, in the language of the person. Nothing
 * while there is none. `text`, when given, says the refusal more exactly than
 * its code can (a duplicate name that names the record holding it).
 */
export function FailureAlert({ error, text }: { error: unknown; text?: string | undefined }) {
  const { t } = useTranslation();
  if (error === null || error === undefined) {
    return null;
  }
  return (
    <Alert variant="destructive">
      <AlertDescription>{text ?? failureText(t, error)}</AlertDescription>
    </Alert>
  );
}
