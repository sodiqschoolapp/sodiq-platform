import {
  secondStepRecoveryCodesSchema,
  secondStepSetUpSchema,
  type SecondStepSetUp,
} from '@sodiq/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { QRCodeSVG } from 'qrcode.react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { ApiFailure, answerOf } from '@/api/failure';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';
import { AuthPage } from './auth-page';
import { FailureAlert, useWaiting } from './form-helpers';
import { refreshSession, STEP_PATH, stepOf } from './session';
import { useSignOut } from './use-sign-out';

/** The key in groups of four, as it is typed into the app by hand. */
function grouped(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join(' ');
}

/**
 * docs/spec/02-roles-and-access.md, Rules: two-step verification is required
 * for the Super Admin and the Academic Vice Principal. Edge cases, "Accounts
 * and sign-in": a code from an authenticator app, with ten single-use recovery
 * codes shown at set-up.
 *
 * Three stages on one page: the start, the key with its confirmation, and the
 * recovery codes. The codes are shown once: the page is left only after the
 * person says they are saved.
 */
export function SetUpPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOut = useSignOut();

  const [setUp, setSetUp] = useState<SecondStepSetUp | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [checked, setChecked] = useState(false);
  const [saved, setSaved] = useState(false);

  // Started by a button, not on arrival: every start makes a new key.
  const start = useMutation({
    mutationFn: async () =>
      secondStepSetUpSchema.parse(await answerOf(api.POST('/api/auth/second-step/set-up'))),
    onSuccess: setSetUp,
  });

  const confirm = useMutation({
    mutationFn: async (typed: string) =>
      secondStepRecoveryCodesSchema.parse(
        await answerOf(api.POST('/api/auth/second-step/confirm', { body: { code: typed } })),
      ),
    onSuccess: (answer) => {
      setRecoveryCodes(answer.recoveryCodes);
    },
    onError: (error) => {
      // The started set-up is gone on the server: begin again.
      if (error instanceof ApiFailure && error.code === 'second_step_not_on') {
        setSetUp(null);
        setCode('');
        setChecked(false);
      }
    },
  });
  const waiting = useWaiting(confirm.error);

  const leave = useMutation({
    mutationFn: () => refreshSession(queryClient),
    onSuccess: (session) => {
      void navigate({ to: STEP_PATH[stepOf(session)] });
    },
  });

  const typed = code.trim();

  function submitCode(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
    if (typed !== '') {
      confirm.mutate(typed);
    }
  }

  if (recoveryCodes !== null) {
    return (
      <AuthPage title={t('setUp.codesTitle')} text={t('setUp.codesText')}>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border p-3 font-mono text-sm">
          {recoveryCodes.map((recoveryCode) => (
            <li key={recoveryCode}>{recoveryCode}</li>
          ))}
        </ul>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={saved}
            onChange={(event) => {
              setSaved(event.target.checked);
            }}
          />
          {t('setUp.saved')}
        </label>
        <FailureAlert error={leave.error} />
        <Button
          size="lg"
          disabled={!saved || leave.isPending}
          onClick={() => {
            leave.mutate();
          }}
        >
          {t('setUp.continue')}
        </Button>
      </AuthPage>
    );
  }

  const signOutButton = (
    <Button
      type="button"
      variant="ghost"
      disabled={signOut.isPending}
      onClick={() => {
        signOut.mutate();
      }}
    >
      {t('layout.signOut')}
    </Button>
  );

  if (setUp === null) {
    return (
      <AuthPage title={t('setUp.title')} text={t('setUp.intro')}>
        <FailureAlert error={start.error ?? confirm.error ?? signOut.error} />
        <Button
          size="lg"
          disabled={start.isPending}
          onClick={() => {
            confirm.reset();
            start.mutate();
          }}
        >
          {t('setUp.start')}
        </Button>
        {signOutButton}
      </AuthPage>
    );
  }

  return (
    <AuthPage title={t('setUp.title')} text={t('setUp.scan')}>
      {/* A QR picture is read on a white ground, also in the dark theme. */}
      <div className="justify-self-center rounded-lg bg-white p-3">
        <QRCodeSVG value={setUp.address} size={176} role="img" aria-label={t('setUp.qr')} />
      </div>
      <dl className="grid gap-1 text-sm">
        <dt className="font-medium">{t('setUp.key')}</dt>
        <dd className="font-mono break-all select-all">{grouped(setUp.secret)}</dd>
      </dl>
      <form className="grid gap-4" onSubmit={submitCode} noValidate>
        <Field
          label={t('setUp.code')}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={40}
          value={code}
          error={checked && typed === '' ? t('setUp.codeMissing') : undefined}
          onChange={(event) => {
            setCode(event.target.value);
          }}
        />
        <FailureAlert error={confirm.error ?? signOut.error} />
        <Button type="submit" size="lg" disabled={confirm.isPending || waiting}>
          {t('setUp.confirm')}
        </Button>
        {signOutButton}
      </form>
    </AuthPage>
  );
}
