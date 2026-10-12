import type { SignIn } from '@sodiq/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { answerOf } from '@/api/failure';
import { Field } from '@/components/field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CHECKBOX } from '@/components/ui/control';
import { AuthPage } from './auth-page';
import { FailureAlert } from '@/components/failure-alert';
import { useWaiting } from './form-helpers';
import { keepSession, STEP_PATH, stepOf } from './session';
import { rememberTrustAsked } from './trust-asked';

/**
 * docs/spec/02-roles-and-access.md, Rules: staff sign in with login and
 * password. Edge cases, "Accounts and sign-in": the "Trust this device"
 * switch is off by default and carries its note.
 */
export function SignInPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { reason } = useSearch({ from: '/sign-in' });
  const trustId = useId();

  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [trust, setTrust] = useState(false);
  const [checked, setChecked] = useState(false);

  const signIn = useMutation({
    mutationFn: (input: SignIn) => answerOf(api.POST('/api/auth/sign-in', { body: input })),
    onSuccess: (answer) => {
      rememberTrustAsked(trust);
      const session = keepSession(queryClient, answer);
      void navigate({ to: STEP_PATH[stepOf(session)] });
    },
  });
  const waiting = useWaiting(signIn.error);

  // A login is compared exactly: only the spaces around it are dropped.
  const typedLogin = login.trim();
  const loginError = checked && typedLogin === '' ? t('signIn.loginMissing') : undefined;
  const passwordError = checked && password === '' ? t('signIn.passwordMissing') : undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
    if (typedLogin === '' || password === '') {
      return;
    }
    // The switch is sent only when it is on.
    signIn.mutate(
      trust ? { login: typedLogin, password, trustDevice: true } : { login: typedLogin, password },
    );
  }

  return (
    <AuthPage title={t('signIn.title')}>
      {reason === 'ended' && signIn.error === null && (
        <Alert>
          <AlertDescription>{t('signIn.sessionEnded')}</AlertDescription>
        </Alert>
      )}
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <Field
          large
          label={t('signIn.login')}
          name="login"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          maxLength={100}
          value={login}
          error={loginError}
          onChange={(event) => {
            setLogin(event.target.value);
          }}
        />
        <Field
          large
          label={t('signIn.password')}
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          error={passwordError}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
        <div className="grid gap-1">
          <label className="flex items-center gap-2 text-sm font-medium max-sm:min-h-11">
            <input
              type="checkbox"
              className={CHECKBOX}
              checked={trust}
              aria-describedby={trustId}
              onChange={(event) => {
                setTrust(event.target.checked);
              }}
            />
            {t('signIn.trust')}
          </label>
          <p id={trustId} className="text-xs text-muted-foreground">
            {t('signIn.trustNote')}
          </p>
        </div>
        <FailureAlert error={signIn.error} />
        <Button type="submit" size="lg" disabled={signIn.isPending || waiting}>
          {t('signIn.submit')}
        </Button>
      </form>
    </AuthPage>
  );
}
