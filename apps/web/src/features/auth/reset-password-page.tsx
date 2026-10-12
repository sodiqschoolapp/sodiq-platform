import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, type PasswordResetConfirm } from '@sodiq/shared';
import { useMutation } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { ApiFailure, answerOf } from '@/api/failure';
import { FailureAlert } from '@/components/failure-alert';
import { Field } from '@/components/field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AuthPage } from './auth-page';

/** The token of the link, from the fragment of the address (`token=...`). */
function tokenOf(hash: string): string {
  return /(?:^#?|&)token=([^&]*)/.exec(hash)?.[1] ?? '';
}

const LINK_REFUSALS = new Set(['reset_link_invalid', 'reset_link_expired']);

/**
 * The new password chosen with the link of the mail (task 2.3c-2). The token
 * and the password stay in this part's state only: the mutation keeps
 * nothing (`gcTime: 0`), nothing goes into the query cache or the offline
 * queue (`.claude/rules/web.md`, the rule on secrets). On success the sign-in
 * page says the password was changed.
 */
export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  // Read once, from the fragment (`#token=...`), which no server log and no
  // Referer sees (decision 15 of pull request #66); then taken out of the
  // address bar, so the history keeps no token.
  const [token] = useState(() => tokenOf(location.hash));
  const hasHash = location.hash !== '';
  useEffect(() => {
    if (hasHash) {
      void navigate({ to: '/reset-password', replace: true });
    }
  }, [hasHash, navigate]);
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [checked, setChecked] = useState(false);

  const confirm = useMutation({
    mutationFn: (input: PasswordResetConfirm) =>
      answerOf(api.POST('/api/auth/password-reset/confirm', { body: input })),
    gcTime: 0,
    onSuccess: () => {
      void navigate({ to: '/sign-in', search: { reason: 'password_changed' } });
    },
  });

  let nextError: string | undefined;
  if (next !== '' || checked) {
    if (next.length < PASSWORD_MIN_LENGTH) {
      nextError = t('password.tooShort', { min: PASSWORD_MIN_LENGTH });
    } else if (next.length > PASSWORD_MAX_LENGTH) {
      nextError = t('password.tooLong', { max: PASSWORD_MAX_LENGTH });
    }
  }
  const repeatError =
    (repeat !== '' || checked) && repeat !== next ? t('password.mismatch') : undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
    if (
      next.length >= PASSWORD_MIN_LENGTH &&
      next.length <= PASSWORD_MAX_LENGTH &&
      repeat === next
    ) {
      confirm.mutate({ token, newPassword: next });
    }
  }

  const linkRefused =
    token === '' || (confirm.error instanceof ApiFailure && LINK_REFUSALS.has(confirm.error.code));

  return (
    <AuthPage title={t('reset.title')}>
      {token === '' ? (
        <Alert variant="destructive">
          <AlertDescription>{t('reset.noToken')}</AlertDescription>
        </Alert>
      ) : (
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <Field
            large
            label={t('password.new')}
            name="new-password"
            type="password"
            autoComplete="new-password"
            autoFocus
            value={next}
            error={nextError}
            onChange={(event) => {
              setNext(event.target.value);
            }}
          />
          <Field
            large
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
          <FailureAlert error={confirm.error} />
          <Button type="submit" size="lg" disabled={confirm.isPending || linkRefused}>
            {t('reset.submit')}
          </Button>
        </form>
      )}
      {linkRefused ? (
        <Link to="/forgot-password" className="text-link justify-self-start">
          {t('reset.askAgain')}
        </Link>
      ) : (
        <Link to="/sign-in" className="text-link justify-self-start">
          {t('forgot.back')}
        </Link>
      )}
    </AuthPage>
  );
}
