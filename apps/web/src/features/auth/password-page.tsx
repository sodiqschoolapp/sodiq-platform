import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, type ChangePassword } from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { answerOf } from '@/api/failure';
import { Field } from '@/components/field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { AuthPage } from './auth-page';
import { FailureAlert, useWaiting } from './form-helpers';
import { refreshSession, sessionQuery, STEP_PATH, stepOf } from './session';

/**
 * docs/spec/02-roles-and-access.md, Rules: staff must change the password at
 * first sign-in. Edge cases, "Accounts and sign-in": staff change their own
 * password with the current one; passwords have at least ten characters; after
 * a reset the person sees "your password was reset by X".
 *
 * One page for both: forced, while a first or reset password is in use, and
 * by choice from the account menu.
 */
export function PasswordPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: session } = useQuery(sessionQuery);
  const forced = session?.mustChangePassword === true;

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [checked, setChecked] = useState(false);
  const [changed, setChanged] = useState(false);

  const change = useMutation({
    mutationFn: (input: ChangePassword) =>
      answerOf(api.POST('/api/auth/password', { body: input })),
    onSuccess: async () => {
      const wasForced = forced;
      const after = await refreshSession(queryClient);
      if (wasForced) {
        await navigate({ to: STEP_PATH[stepOf(after)] });
        return;
      }
      setCurrent('');
      setNext('');
      setRepeat('');
      setChecked(false);
      setChanged(true);
    },
  });
  const waiting = useWaiting(change.error);

  // Each field says what to fix as soon as something is typed into it.
  const currentError = checked && current === '' ? t('password.currentMissing') : undefined;
  let nextError: string | undefined;
  if (next !== '' || checked) {
    if (next.length < PASSWORD_MIN_LENGTH) {
      nextError = t('password.tooShort', { min: PASSWORD_MIN_LENGTH });
    } else if (next.length > PASSWORD_MAX_LENGTH) {
      nextError = t('password.tooLong', { max: PASSWORD_MAX_LENGTH });
    } else if (next === current) {
      nextError = t('password.same');
    }
  }
  const repeatError =
    (repeat !== '' || checked) && repeat !== next ? t('password.mismatch') : undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
    setChanged(false);
    const valid =
      current !== '' &&
      next.length >= PASSWORD_MIN_LENGTH &&
      next.length <= PASSWORD_MAX_LENGTH &&
      next !== current &&
      repeat === next;
    if (valid) {
      change.mutate({ currentPassword: current, newPassword: next });
    }
  }

  return (
    <AuthPage
      title={forced ? t('password.titleForced') : t('password.titleOwn')}
      text={forced ? t('password.textForced') : t('password.othersEnd')}
    >
      {session?.passwordResetBy != null && (
        <Alert>
          <AlertDescription>
            {t('password.resetBy', { login: session.passwordResetBy })}
          </AlertDescription>
        </Alert>
      )}
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <Field
          label={forced ? t('password.currentOneTime') : t('password.current')}
          name="current-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={current}
          error={currentError}
          onChange={(event) => {
            setCurrent(event.target.value);
          }}
        />
        <Field
          label={t('password.new')}
          name="new-password"
          type="password"
          autoComplete="new-password"
          value={next}
          error={nextError}
          onChange={(event) => {
            setNext(event.target.value);
          }}
        />
        <Field
          label={t('password.repeat')}
          name="new-password-again"
          type="password"
          autoComplete="new-password"
          value={repeat}
          error={repeatError}
          onChange={(event) => {
            setRepeat(event.target.value);
          }}
        />
        <FailureAlert error={change.error} />
        {changed && (
          <p role="status" className="text-sm font-medium">
            {t('password.changed')}
          </p>
        )}
        <Button type="submit" size="lg" disabled={change.isPending || waiting}>
          {t('password.submit')}
        </Button>
        {!forced && (
          <Link to="/" className={buttonVariants({ variant: 'ghost' })}>
            {t('password.back')}
          </Link>
        )}
      </form>
    </AuthPage>
  );
}
