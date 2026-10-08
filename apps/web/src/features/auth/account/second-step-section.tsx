import { secondStepOverviewSchema } from '@sodiq/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { ApiFailure, answerOf } from '@/api/failure';
import { Field } from '@/components/field';
import { FailureAlert } from '@/components/failure-alert';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { AccountSection } from './account-section';
import { useWaiting } from '../form-helpers';
import { SecondStepSetUp, type SetUpStage } from '../second-step-set-up';

export const secondStepQuery = queryOptions({
  queryKey: ['account', 'second-step'],
  queryFn: async () =>
    secondStepOverviewSchema.parse(await answerOf(api.GET('/api/auth/second-step'))),
});

/** A stage of the set-up as the account page draws it: a framed part of the section. */
function Stage({ title, text, children }: SetUpStage) {
  return (
    <div className="grid max-w-sm gap-4 rounded-lg border p-4">
      <div className="grid gap-1">
        <h3 className="font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
      {children}
    </div>
  );
}

/**
 * `02`, Rules: two-step verification is required for the Super Admin and the
 * Academic Vice Principal and optional for others. Turning it on runs the
 * set-up stages here; turning it off takes the code of the app and nothing
 * more (decided by the owner, task 0.8d). Where it is required there is no
 * button: display only, the server refuses "off" for those roles.
 */
export function SecondStepSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const overview = useQuery(secondStepQuery);
  const [mode, setMode] = useState<'view' | 'turning_on' | 'turning_off'>('view');
  const [changed, setChanged] = useState<'on' | 'off' | null>(null);
  const [code, setCode] = useState('');
  const [checked, setChecked] = useState(false);

  const refetchOverview = () =>
    queryClient.invalidateQueries({ queryKey: secondStepQuery.queryKey });

  const turnOff = useMutation({
    mutationFn: (typed: string) =>
      answerOf(api.POST('/api/auth/second-step/turn-off', { body: { code: typed } })),
    onSuccess: async () => {
      setMode('view');
      setCode('');
      setChecked(false);
      setChanged('off');
      await refetchOverview();
    },
    onError: async (error) => {
      // Nothing to turn off any more, or it cannot be turned off: the overview decides.
      if (
        error instanceof ApiFailure &&
        (error.code === 'second_step_not_on' || error.code === 'second_step_cannot_turn_off')
      ) {
        await refetchOverview();
      }
    },
  });
  const waiting = useWaiting(turnOff.error);
  const typed = code.trim();

  function submitTurnOff(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
    if (typed !== '') {
      turnOff.mutate(typed);
    }
  }

  let body;
  if (overview.data === undefined) {
    body = overview.isError ? (
      <ErrorState
        error={overview.error}
        onRetry={() => {
          void overview.refetch();
        }}
      />
    ) : (
      <LoadingOutline lines={2} />
    );
  } else if (mode === 'turning_on') {
    body = (
      <SecondStepSetUp
        intro={t('account.setUpIntro')}
        stage={(stage) => <Stage {...stage} />}
        footer={
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setMode('view');
            }}
          >
            {t('confirm.cancel')}
          </Button>
        }
        onSaved={async () => {
          await refetchOverview();
          setMode('view');
          setChanged('on');
        }}
        onAlreadyOn={() => {
          void refetchOverview().then(() => {
            setMode('view');
          });
        }}
      />
    );
  } else {
    const { on, required, recoveryCodesLeft } = overview.data;
    body = (
      <div className="grid gap-3">
        <p>{on ? t('account.secondStepOn') : t('account.secondStepOff')}</p>
        {on && (
          <p className="text-sm text-muted-foreground">
            {t('account.recoveryCodesLeft', { count: recoveryCodesLeft })}
          </p>
        )}
        {on && required && <p className="text-sm">{t('account.secondStepRequired')}</p>}
        {changed === 'on' && (
          <p role="status" className="text-sm font-medium">
            {t('account.turnedOn')}
          </p>
        )}
        {changed === 'off' && (
          <p role="status" className="text-sm font-medium">
            {t('account.turnedOff')}
          </p>
        )}
        {!on && (
          <div>
            <Button
              variant="outline"
              onClick={() => {
                setChanged(null);
                setMode('turning_on');
              }}
            >
              {t('account.turnOn')}
            </Button>
          </div>
        )}
        {on && !required && mode === 'view' && (
          <div>
            <Button
              variant="outline"
              onClick={() => {
                setChanged(null);
                setMode('turning_off');
              }}
            >
              {t('account.turnOff')}
            </Button>
          </div>
        )}
        {on && !required && mode === 'turning_off' && (
          <form
            className="grid max-w-sm gap-4 rounded-lg border p-4"
            onSubmit={submitTurnOff}
            noValidate
          >
            <p className="text-sm text-muted-foreground">{t('account.turnOffText')}</p>
            <Field
              label={t('setUp.code')}
              name="turn-off-code"
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
            <FailureAlert error={turnOff.error} />
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" disabled={turnOff.isPending || waiting}>
                {t('account.turnOff')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setMode('view');
                  setCode('');
                  setChecked(false);
                  turnOff.reset();
                }}
              >
                {t('confirm.cancel')}
              </Button>
            </div>
          </form>
        )}
      </div>
    );
  }

  return (
    <AccountSection title={t('account.secondStepTitle')} text={t('account.secondStepText')}>
      {body}
    </AccountSection>
  );
}
