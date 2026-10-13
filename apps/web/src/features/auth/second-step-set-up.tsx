import {
  secondStepRecoveryCodesSchema,
  secondStepSetUpSchema,
  type SecondStepSetUp as StartedSetUp,
} from '@sodiq/shared';
import { useMutation } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { QRCodeSVG } from 'qrcode.react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { ApiFailure, answerOf } from '@/api/failure';
import { Field } from '@/components/field';
import { FailureAlert } from '@/components/failure-alert';
import { Button, type buttonVariants } from '@/components/ui/button';
import type { VariantProps } from 'class-variance-authority';
import { CHECKBOX } from '@/components/ui/control';
import { useWaiting } from './form-helpers';

/** The key in groups of four, as it is typed into the app by hand. */
function grouped(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join(' ');
}

export interface SetUpStage {
  title: string;
  text: string;
  children: ReactNode;
}

/** The sizes a caller chooses from: large on the sign-in frame, default inside the layout. */
type StageSize = Extract<VariantProps<typeof buttonVariants>['size'], 'default' | 'lg'>;

interface SecondStepSetUpProps {
  /**
   * The size of the buttons, and of the field with it: large on the sign-in
   * frame, the default inside the layout (docs/design-system.md, Buttons;
   * pull request #80, decision 13).
   */
  size: StageSize;
  /** What the person is told before the start. */
  intro: string;
  /** Draws a stage: the step page draws its card, the account page a section. */
  stage: (stage: SetUpStage) => ReactNode;
  /** Under the first two stages, for example the sign-out button of the step page. */
  footer?: ReactNode;
  /** After "I have saved the codes": where the person goes on. A failure is shown here. */
  onSaved: () => Promise<void>;
  /** The second step is on already: it was set up in another tab, or the answer was lost. */
  onAlreadyOn: () => void;
}

/**
 * Edge cases, "Accounts and sign-in": the second step is a code from an
 * authenticator app, with ten single-use recovery codes shown at set-up.
 *
 * Three stages: the start, the key with its confirmation, and the recovery
 * codes. Used by the set-up step of sign-in (`SetUpPage`) and by the account
 * page, where an optional second step is turned on (task 0.8d). The codes are
 * shown once: the page is left only after the person says they are saved.
 */
export function SecondStepSetUp({
  size,
  intro,
  stage,
  footer,
  onSaved,
  onAlreadyOn,
}: SecondStepSetUpProps) {
  const { t } = useTranslation();

  const [setUp, setSetUp] = useState<StartedSetUp | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [checked, setChecked] = useState(false);
  const [saved, setSaved] = useState(false);

  // The codes are shown once. Until the person says they are saved, the page
  // is not left by the Back button or a link, and the browser asks before a
  // reload or before the tab is closed.
  const codesUnsaved = recoveryCodes !== null && !saved;
  useBlocker({
    shouldBlockFn: () => true,
    disabled: !codesUnsaved,
    enableBeforeUnload: codesUnsaved,
  });

  const leaveWhenAlreadyOn = (error: unknown): void => {
    if (error instanceof ApiFailure && error.code === 'second_step_already_on') {
      onAlreadyOn();
    }
  };

  // Started by a button, not on arrival: every start makes a new key.
  const start = useMutation({
    mutationFn: async () =>
      secondStepSetUpSchema.parse(await answerOf(api.POST('/api/auth/second-step/set-up'))),
    onSuccess: setSetUp,
    onError: leaveWhenAlreadyOn,
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
      leaveWhenAlreadyOn(error);
      // The started set-up is gone on the server: begin again.
      if (error instanceof ApiFailure && error.code === 'second_step_not_on') {
        setSetUp(null);
        setCode('');
        setChecked(false);
      }
    },
  });
  const waiting = useWaiting(confirm.error);

  const finish = useMutation({ mutationFn: onSaved });

  const typed = code.trim();

  function submitCode(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
    if (typed !== '') {
      confirm.mutate(typed);
    }
  }

  if (recoveryCodes !== null) {
    return stage({
      title: t('setUp.codesTitle'),
      text: t('setUp.codesText'),
      children: (
        <>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border p-3 font-mono text-sm">
            {recoveryCodes.map((recoveryCode) => (
              <li key={recoveryCode}>{recoveryCode}</li>
            ))}
          </ul>
          <label className="flex items-center gap-2 text-sm font-medium max-sm:min-h-11">
            <input
              type="checkbox"
              className={CHECKBOX}
              checked={saved}
              onChange={(event) => {
                setSaved(event.target.checked);
              }}
            />
            {t('setUp.saved')}
          </label>
          <FailureAlert error={finish.error} />
          <Button
            size={size}
            disabled={!saved || finish.isPending}
            onClick={() => {
              finish.mutate();
            }}
          >
            {t('setUp.continue')}
          </Button>
        </>
      ),
    });
  }

  if (setUp === null) {
    return stage({
      title: t('setUp.title'),
      text: intro,
      children: (
        <>
          <FailureAlert error={start.error ?? confirm.error} />
          <Button
            size={size}
            disabled={start.isPending}
            onClick={() => {
              confirm.reset();
              start.mutate();
            }}
          >
            {t('setUp.start')}
          </Button>
          {footer}
        </>
      ),
    });
  }

  return stage({
    title: t('setUp.title'),
    text: t('setUp.scan'),
    children: (
      <>
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
            large={size !== 'default'}
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
          <FailureAlert error={confirm.error} />
          <Button type="submit" size={size} disabled={confirm.isPending || waiting}>
            {t('setUp.confirm')}
          </Button>
          {footer}
        </form>
      </>
    ),
  });
}
