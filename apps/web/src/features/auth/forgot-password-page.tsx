import type { PasswordResetRequest } from '@sodiq/shared';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { answerOf } from '@/api/failure';
import { FailureAlert } from '@/components/failure-alert';
import { Field } from '@/components/field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AuthPage } from './auth-page';

/**
 * "Forgot your password?" (docs/spec/02-roles-and-access.md, Accounts and
 * sign-in: build order, "Password reset by email"; docs/design-system.md,
 * This app, Sign-in; task 2.3c-2). The answer is the same for every login
 * (decision 8 of pull request #66), so the page says the same after every
 * send. Part of the sign-in brand moment (decision 17).
 */
export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [login, setLogin] = useState('');
  const [checked, setChecked] = useState(false);

  const ask = useMutation({
    mutationFn: (input: PasswordResetRequest) =>
      answerOf(api.POST('/api/auth/password-reset', { body: input })),
  });

  const typedLogin = login.trim();
  const loginError = checked && typedLogin === '' ? t('forgot.loginMissing') : undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
    if (typedLogin === '') {
      return;
    }
    ask.mutate({ login: typedLogin });
  }

  return (
    <AuthPage title={t('forgot.title')}>
      {ask.isSuccess ? (
        <Alert role="status">
          <AlertDescription>{t('forgot.sent')}</AlertDescription>
        </Alert>
      ) : (
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <Field
            large
            label={t('forgot.login')}
            name="login"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            maxLength={64}
            value={login}
            error={loginError}
            onChange={(event) => {
              setLogin(event.target.value);
            }}
          />
          <FailureAlert error={ask.error} />
          <Button type="submit" size="lg" disabled={ask.isPending}>
            {t('forgot.submit')}
          </Button>
        </form>
      )}
      <Link to="/sign-in" className="text-link justify-self-start">
        {t('forgot.back')}
      </Link>
    </AuthPage>
  );
}
