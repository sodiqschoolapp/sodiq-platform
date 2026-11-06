import {
  PERMISSIONS,
  permits,
  type Language,
  type ParentSlip,
  type PrintedParentSlips,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { useConfirm } from '@/components/confirm-dialog';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { SECTION_TITLE } from '@/components/ui/control';
import { Select } from '@/components/ui/select';
import { useView } from '@/features/access/use-view';
import { LANGUAGE_NAMES, LANGUAGES, isLanguage } from '@/i18n/languages';
import { branchQuery } from '@/features/setup/setup-api';
import { momentText } from '@/lib/dates';
import { parentAccountKey, parentAccountQuery, resetParentPassword } from './parent-accounts-api';
import { ParentSlipsSheet } from './parent-slip';

/**
 * The Parent account on the Parent page (task 11.1): the login, whether the parent has signed
 * in, the last sign-in and the last slip, and "Reset password" (`edge/close-relatives`,
 * forgotten password: a new slip valid for 7 days, every session ends). Shown to the readers of
 * `parent_accounts`; the server checks the relative against the branch again.
 */
export function ParentAccountPart({ relativeId, name }: { relativeId: string; name: string }) {
  const { t, i18n } = useTranslation();
  const { role, branchId } = useView();
  const mayView = role !== null && permits(PERMISSIONS, role, 'parent_accounts', 'view');
  const mayReset = role !== null && permits(PERMISSIONS, role, 'parent_accounts', 'create');
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const account = useQuery({ ...parentAccountQuery(branchId, relativeId), enabled: mayView });
  const branch = useQuery({ ...branchQuery(branchId), enabled: mayView });
  const [language, setLanguage] = useState<Language>(
    isLanguage(i18n.language) ? i18n.language : 'uz',
  );
  const [printed, setPrinted] = useState<PrintedParentSlips | null>(null);
  // The one-time password is held by this part alone (`.claude/rules/web.md`).
  const reset = useMutation({
    gcTime: 0,
    mutationFn: () => resetParentPassword(relativeId, language),
    onSuccess: (answer) => {
      setPrinted(answer);
      reset.reset();
      void queryClient.invalidateQueries({ queryKey: parentAccountKey(branchId, relativeId) });
    },
  });

  if (!mayView) {
    return null;
  }
  // A day shown from a stored moment is the branch's (`.claude/rules/database.md`, task 9.4g).
  const timeZone = branch.data?.timeZone;
  const when = (iso: string) =>
    momentText(i18n.language, iso, {
      month: 'long',
      ...(timeZone === undefined ? {} : { timeZone }),
    });
  const slipText = (slip: ParentSlip) =>
    slip.kind === 'reset'
      ? t('people.parentSlips.resetSlip', { date: when(slip.printedAt) })
      : slip.otherBranch || slip.className === null
        ? t('people.parentSlips.otherBranch', { date: when(slip.printedAt) })
        : t('people.parentSlips.printedIn', { class: slip.className, date: when(slip.printedAt) });

  return (
    <section className="grid gap-2" aria-labelledby={`parent-account-${relativeId}`}>
      <h3 id={`parent-account-${relativeId}`} className={SECTION_TITLE}>
        {t('people.parentAccount.title')}
      </h3>
      {account.isError ? (
        <ErrorState
          error={account.error}
          onRetry={() => {
            void account.refetch();
          }}
        />
      ) : account.data === undefined ? (
        <LoadingOutline lines={2} />
      ) : account.data.account === null ? (
        <p className="text-sm">{t('people.parentAccount.none')}</p>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t('people.parentAccount.login')}</dt>
            <dd className="font-mono">{account.data.account.login}</dd>
            <dt className="text-muted-foreground">{t('people.parentSlips.state')}</dt>
            <dd>
              {account.data.account.signedIn
                ? t('people.parentAccount.signedIn')
                : t('people.parentAccount.notSignedIn')}
            </dd>
            {account.data.account.lastSignInAt === null ? null : (
              <>
                <dt className="text-muted-foreground">{t('people.parentAccount.lastSignIn')}</dt>
                <dd>{when(account.data.account.lastSignInAt)}</dd>
              </>
            )}
            {account.data.account.slip === null ? null : (
              <>
                <dt className="text-muted-foreground">{t('people.parentAccount.slip')}</dt>
                <dd>{slipText(account.data.account.slip)}</dd>
              </>
            )}
          </dl>
          {mayReset && printed === null ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid gap-1 text-sm">
                <span>{t('people.parentAccount.resetLanguage')}</span>
                <Select
                  value={language}
                  onChange={(event) => {
                    if (isLanguage(event.target.value)) {
                      setLanguage(event.target.value);
                    }
                  }}
                >
                  {LANGUAGES.map((one) => (
                    <option key={one} value={one}>
                      {LANGUAGE_NAMES[one]}
                    </option>
                  ))}
                </Select>
              </label>
              <Button
                variant="secondary"
                disabled={reset.isPending}
                onClick={() => {
                  void (async () => {
                    const yes = await confirm({
                      title: t('people.parentAccount.resetTitle', { name }),
                      text: t('people.parentAccount.resetText'),
                      action: t('people.parentAccount.reset'),
                      destructive: true,
                    });
                    if (yes) {
                      reset.mutate();
                    }
                  })();
                }}
              >
                {t('people.parentAccount.reset')}
              </Button>
            </div>
          ) : null}
          {reset.isError ? <FailureAlert error={reset.error} /> : null}
          {printed === null ? null : (
            <ParentSlipsSheet
              answer={printed}
              onDone={() => {
                setPrinted(null);
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
