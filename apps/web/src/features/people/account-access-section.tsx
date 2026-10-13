import {
  lockSchema,
  type Actor,
  type FirstPasswordSlip,
  type Lock,
  type StaffDetail,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { TextAreaField } from '@/components/field';
import { useRecordForm } from '@/components/form/use-record-form';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SUPER_ADMINS_KEY } from '@/features/access/super-admin-banner';
import { invalidateBranchesWithoutVice } from '@/features/access/vice-principal-banner';
import { useView } from '@/features/access/use-view';
import { FirstPasswordSlipDialog } from './first-password-slip';
import {
  accountAccessKey,
  accountAccessQuery,
  invalidateHeadTeachers,
  neverUsedKey,
  staffAccountKey,
} from './people-api';
import { formatMoment } from '@/lib/dates';

/** Who locked or reset: the name when the server could read it, the login otherwise. */
const actorText = (actor: Actor | null): string =>
  actor === null
    ? ''
    : actor.name === null
      ? actor.login
      : `${actor.name.firstName} ${actor.name.lastName}`;

/**
 * "Sign-in access" in the side panel of the staff list (task 2.3c-1): the
 * lock and its reason, a password reset in force, whether the account was
 * ever used and whether a second step is on; the buttons only where the
 * server's `can` allows (decision 13). A one-time password lives only in the
 * state of this part while its slip is shown: the mutations keep nothing
 * (`gcTime: 0`, reset once handed over) and no query holds it.
 */
export function AccountAccessSection({ staff, label }: { staff: StaffDetail; label: string }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const state = useQuery(accountAccessQuery(branchId, staff.id));
  const [slip, setSlip] = useState<FirstPasswordSlip | null>(null);
  const [locking, setLocking] = useState(false);
  /** A reason typed and not sent, kept while the dialog is closed. */
  const [draft, setDraft] = useState('');

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: accountAccessKey(staff.id) }),
      queryClient.invalidateQueries({ queryKey: staffAccountKey(staff.id) }),
      queryClient.invalidateQueries({ queryKey: neverUsedKey() }),
      queryClient.invalidateQueries({ queryKey: SUPER_ADMINS_KEY }),
      invalidateBranchesWithoutVice(queryClient),
      invalidateHeadTeachers(queryClient),
    ]);
  };

  const path = { params: { header: branchHeader(), path: { id: staff.id } } };
  const unlock = useMutation({
    mutationFn: () => answerOf(api.POST('/api/people/staff/{id}/account/unlock', path)),
  });
  const resetPassword = useMutation({
    // The answer holds the one-time password: nothing keeps it.
    gcTime: 0,
    mutationFn: () => answerOf(api.POST('/api/people/staff/{id}/account/password-reset', path)),
  });
  const resetSecondStep = useMutation({
    gcTime: 0,
    mutationFn: () => answerOf(api.POST('/api/people/staff/{id}/account/second-step-reset', path)),
  });
  const failure = unlock.error ?? resetPassword.error ?? resetSecondStep.error;

  if (state.isError) {
    return (
      <Section id={staff.id} title={t('people.access.title')}>
        <ErrorState
          error={state.error}
          onRetry={() => {
            void state.refetch();
          }}
        />
      </Section>
    );
  }
  if (state.data === undefined) {
    return (
      <Section id={staff.id} title={t('people.access.title')}>
        <LoadingOutline />
      </Section>
    );
  }
  const { account, can } = state.data;

  const handOver = async (
    mutation: typeof resetPassword | typeof resetSecondStep,
  ): Promise<void> => {
    const answer = await mutation.mutateAsync();
    mutation.reset();
    setSlip(answer);
    await refresh();
  };

  return (
    <Section id={staff.id} title={t('people.access.title')}>
      {account === null ? (
        <p className="text-sm">{t('people.access.none')}</p>
      ) : (
        <div className="grid gap-3">
          <ul
            className="grid gap-1 text-sm"
            aria-label={t('people.access.stateOf', { name: label })}
          >
            <li>
              <span className="font-semibold">{account.login}</span>
            </li>
            {account.locked !== null && (
              <li data-state="locked">
                {t('people.access.lockedLine', {
                  date: formatMoment(language, account.locked.at),
                  name: actorText(account.locked.by),
                  reason: account.locked.reason,
                })}
              </li>
            )}
            {account.passwordReset !== null && (
              <li data-state="reset">
                {t('people.access.resetLine', {
                  name: actorText(account.passwordReset.by),
                  date: formatMoment(language, account.passwordReset.validUntil),
                })}
              </li>
            )}
            {account.neverUsed && <li data-state="never-used">{t('people.access.neverUsed')}</li>}
            {account.secondStepOn && (
              <li data-state="second-step">{t('people.access.secondStepOn')}</li>
            )}
          </ul>
          <div className="flex flex-wrap gap-2">
            {can.lock && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  setLocking(true);
                }}
              >
                {t('people.access.lock')}
              </Button>
            )}
            {can.unlock && (
              <Button
                type="button"
                variant="secondary"
                disabled={unlock.isPending}
                onClick={() => {
                  void (async () => {
                    const go = await confirm({
                      title: t('people.access.unlockTitle'),
                      names: [`${label}: ${account.login}`],
                      action: t('people.access.unlock'),
                    });
                    if (go) {
                      await unlock.mutateAsync();
                      await refresh();
                    }
                  })().catch(() => undefined);
                }}
              >
                {t('people.access.unlock')}
              </Button>
            )}
            {can.resetPassword && (
              <Button
                type="button"
                variant="secondary"
                disabled={resetPassword.isPending}
                onClick={() => {
                  void (async () => {
                    const go = await confirm({
                      title: t('people.access.resetTitle'),
                      text: t('people.access.resetText'),
                      names: [`${label}: ${account.login}`],
                      action: t('people.access.resetPassword'),
                    });
                    if (go) {
                      await handOver(resetPassword);
                    }
                  })().catch(() => undefined);
                }}
              >
                {t('people.access.resetPassword')}
              </Button>
            )}
            {can.resetSecondStep && (
              <Button
                type="button"
                variant="secondary"
                disabled={resetSecondStep.isPending}
                onClick={() => {
                  void (async () => {
                    const go = await confirm({
                      title: t('people.access.secondStepTitle'),
                      text: t('people.access.secondStepText'),
                      names: [`${label}: ${account.login}`],
                      action: t('people.access.resetSecondStep'),
                    });
                    if (go) {
                      await handOver(resetSecondStep);
                    }
                  })().catch(() => undefined);
                }}
              >
                {t('people.access.resetSecondStep')}
              </Button>
            )}
          </div>
          <FailureAlert error={failure} />
        </div>
      )}
      {locking && (
        <LockDialog
          staffId={staff.id}
          label={label}
          draft={draft}
          onTyped={setDraft}
          onClose={() => {
            setLocking(false);
          }}
          onLocked={async () => {
            setDraft('');
            setLocking(false);
            await refresh();
          }}
        />
      )}
      {slip !== null && (
        <FirstPasswordSlipDialog
          kind="reset"
          slip={slip}
          issued={staff.today}
          onClose={() => {
            setSlip(null);
          }}
        />
      )}
    </Section>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3" aria-labelledby={`access-${id}`}>
      <h3 id={`access-${id}`} className="text-base font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * "Lock now" with its reason (Staff over time: "is logged with a reason"). A
 * dialog that sends once (`.claude/rules/web.md`): its field is checked with
 * the shared schema, its button says what it does, and a reason typed and not
 * sent is kept in the tab.
 */
function LockDialog({
  staffId,
  label,
  draft,
  onTyped,
  onClose,
  onLocked,
}: {
  staffId: string;
  label: string;
  draft: string;
  onTyped: (text: string) => void;
  onClose: () => void;
  onLocked: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const done = useRef(false);
  const form = useRecordForm<'reason', Lock>({
    schema: lockSchema,
    initial: { reason: draft },
    save: async (lock) => {
      await answerOf(
        api.POST('/api/people/staff/{id}/account/lock', {
          params: { header: branchHeader(), path: { id: staffId } },
          body: lock,
        }),
      );
      done.current = true;
    },
    message: (field) => (field === 'reason' ? t('people.access.reasonNeeded') : undefined),
  });
  const element = useRef<HTMLFormElement>(null);
  const binding = form.bind('reason');

  const send = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const checked = await form.submit();
    if (!checked) {
      element.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    if (done.current) {
      await onLocked();
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('people.access.lockTitle', { name: label })}</DialogTitle>
        </DialogHeader>
        <form
          ref={element}
          aria-label={t('people.access.lockTitle', { name: label })}
          className="grid gap-4"
          onSubmit={(event) => {
            void send(event);
          }}
        >
          <TextAreaField
            label={t('people.access.reason')}
            rows={3}
            {...binding}
            onChange={(event) => {
              binding.onChange(event);
              onTyped(event.target.value);
            }}
          />
          <FailureAlert error={form.failure} />
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>{t('confirm.cancel')}</DialogClose>
            <Button type="submit" variant="destructive" disabled={form.status === 'saving'}>
              {t('people.access.lock')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
