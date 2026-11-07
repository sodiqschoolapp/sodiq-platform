import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { ApiFailure, answerOf } from '@/api/failure';
import { FailureAlert } from '@/components/failure-alert';
import { Field } from '@/components/field';
import { LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { AuthPage } from '@/features/auth/auth-page';
import { useWaiting } from '@/features/auth/form-helpers';
import { keepSession, STEP_PATH, stepOf, type Session } from '@/features/auth/session';
import { loadTelegramScript, telegramLaunchData } from './telegram';

/**
 * Task 11.4: the page the school's bot opens (`/portal/telegram`; `10`, Signing in: Telegram).
 * It sends Telegram's launch data: from a linked chat the portal opens without the password.
 * Otherwise the parent signs in once with the login and password, and the chat is linked (after
 * the change of a first password, which the password page sends with the launch data too).
 * Opened outside Telegram, it is the ordinary sign-in.
 */
export function TelegramStartPage(): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const launch = telegramLaunchData();
  const [asking, setAsking] = useState(false);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [checked, setChecked] = useState(false);
  const started = useRef(false);

  const go = (answer: unknown) => {
    const session: Session = keepSession(queryClient, answer);
    const step = stepOf(session);
    void navigate({ to: step === 'none' ? '/portal' : STEP_PATH[step] });
  };

  const opening = useMutation({
    mutationFn: (telegramInitData: string) =>
      answerOf(api.POST('/api/auth/sign-in', { body: { telegramInitData } })),
    onSuccess: go,
    onError: () => {
      setAsking(true);
    },
  });

  const signIn = useMutation({
    mutationFn: (body: { login: string; password: string; telegramInitData: string }) =>
      answerOf(api.POST('/api/auth/sign-in', { body })),
    onSuccess: go,
  });
  const waiting = useWaiting(signIn.error);

  useEffect(() => {
    if (launch === undefined || started.current) {
      return;
    }
    started.current = true;
    void loadTelegramScript();
    opening.mutate(launch);
  }, [launch, opening]);

  if (launch === undefined) {
    return <Navigate to="/sign-in" />;
  }

  const typedLogin = login.trim();
  const loginError = checked && typedLogin === '' ? t('signIn.loginMissing') : undefined;
  const passwordError = checked && password === '' ? t('signIn.passwordMissing') : undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
    if (typedLogin === '' || password === '' || launch === undefined) {
      return;
    }
    signIn.mutate({ login: typedLogin, password, telegramInitData: launch });
  }

  // "Not linked" is no failure: the form is the next step. Anything else is said.
  const openingFailure =
    opening.error instanceof ApiFailure && opening.error.code === 'telegram_sign_in_needed'
      ? null
      : opening.error;

  return (
    <AuthPage title={t('portal.telegram.title')}>
      {!asking ? (
        <div className="grid gap-4">
          <p className="text-sm">{t('portal.telegram.opening')}</p>
          <LoadingOutline lines={2} />
        </div>
      ) : (
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <FailureAlert error={openingFailure} />
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
          <FailureAlert error={signIn.error} />
          <Button type="submit" size="lg" disabled={signIn.isPending || waiting}>
            {t('signIn.submit')}
          </Button>
        </form>
      )}
    </AuthPage>
  );
}
