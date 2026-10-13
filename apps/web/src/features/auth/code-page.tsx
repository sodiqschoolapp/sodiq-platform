import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { answerOf } from '@/api/failure';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';
import { AuthPage } from './auth-page';
import { FailureAlert } from '@/components/failure-alert';
import { useWaiting } from './form-helpers';
import { keepSession, STEP_PATH, stepOf } from './session';
import { useSignOut } from './use-sign-out';

/**
 * Edge cases, "Accounts and sign-in": the second step is a code from an
 * authenticator app; a recovery code goes into the same field.
 */
export function CodePage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOut = useSignOut();

  const [code, setCode] = useState('');
  const [checked, setChecked] = useState(false);

  const pass = useMutation({
    mutationFn: (typed: string) =>
      answerOf(api.POST('/api/auth/second-step', { body: { code: typed } })),
    onSuccess: (answer) => {
      const session = keepSession(queryClient, answer);
      void navigate({ to: STEP_PATH[stepOf(session)] });
    },
  });
  const waiting = useWaiting(pass.error);

  const typed = code.trim();

  function submit(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
    if (typed !== '') {
      pass.mutate(typed);
    }
  }

  return (
    <AuthPage title={t('code.title')} text={t('code.text')}>
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <Field
          label={t('code.label')}
          large
          name="code"
          autoComplete="one-time-code"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          maxLength={40}
          value={code}
          error={checked && typed === '' ? t('code.missing') : undefined}
          onChange={(event) => {
            setCode(event.target.value);
          }}
        />
        <FailureAlert error={pass.error ?? signOut.error} />
        <Button type="submit" size="lg" disabled={pass.isPending || waiting}>
          {t('code.submit')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          disabled={signOut.isPending}
          onClick={() => {
            signOut.mutate();
          }}
        >
          {t('layout.signOut')}
        </Button>
      </form>
    </AuthPage>
  );
}
