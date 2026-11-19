import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { answerOf } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { momentText } from '@/lib/dates';
import { LockIcon, LogoutIcon } from '@/components/icons';
import { Button, buttonVariants } from '@/components/ui/button';
import { DIGEST_FREQUENCIES, digestFrequencySchema } from '@sodiq/shared';
import { CHECKBOX, QUICK } from '@/components/ui/control';
import { cn } from '@/lib/utils';
import { ErrorState, LoadingOutline } from '@/components/states';
import { chooseDigestFrequency, digestFrequencyQuery } from '@/features/portal/digest-api';
import { PortalShell, PortalTitle } from '@/features/portal/portal-shell';
import { AccountSection } from './account/account-section';
import { LanguageSection } from './account/language-section';
import { refreshSession, sessionQuery } from './session';
import { useLeaveSignedOut, useSignOut } from './use-sign-out';

/**
 * The parent's own account page (task 11.1, decision 13; inside the portal's frame since 19
 * November 2026): no staff menu and no branch, only what the owner approved for the parent
 * (`10`: "a parent changes only their own password, language and digest frequency"): the
 * language, the digest, the Telegram link, the password change and sign-out.
 */
export function ParentHomePage(): React.JSX.Element {
  const { data: session } = useQuery(sessionQuery);
  const signOut = useSignOut();
  return (
    <ParentFrame signOut={signOut} name={session?.fullName ?? session?.login ?? ''}>
      <TelegramSection linkedAt={session?.telegramLinkedAt ?? null} />
      <DigestSection />
    </ParentFrame>
  );
}

/**
 * Task 11.4: the parent's own Telegram link ("the `parent` role links and unlinks its own
 * chat"): since when, and "Unlink Telegram". Unlinking from inside the mini app ends this session
 * too, which then leaves signed out.
 */
function TelegramSection({ linkedAt }: { linkedAt: string | null }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const leave = useLeaveSignedOut();
  const unlink = useMutation({
    mutationFn: () => answerOf(api.DELETE('/api/auth/telegram-link')),
    onSuccess: async () => {
      const after = await refreshSession(queryClient).catch(() => null);
      if (after === null) {
        leave();
      }
    },
  });
  return (
    <AccountSection title={t('parent.telegram')}>
      <p className="text-sm">
        {linkedAt === null
          ? t('parent.telegramNone')
          : t('parent.telegramLinked', {
              date: momentText(i18n.language, linkedAt, {
                month: 'long',
                timeZone: 'Asia/Tashkent',
              }),
            })}
      </p>
      {linkedAt === null ? null : (
        <div>
          <Button
            variant="secondary"
            disabled={unlink.isPending}
            onClick={() => {
              void (async () => {
                const yes = await confirm({
                  title: t('parent.unlinkTitle'),
                  text: t('parent.unlinkText'),
                  action: t('parent.unlink'),
                  destructive: true,
                });
                if (yes) {
                  unlink.mutate();
                }
              })();
            }}
          >
            {t('parent.unlink')}
          </Button>
        </div>
      )}
      <FailureAlert error={unlink.error} />
    </AccountSection>
  );
}

/**
 * Task 11.5 (`10`: "In the portal a parent changes only their own password, language and digest
 * frequency"): how often the school's bot sends the digest, twice a week until chosen.
 */
function DigestSection(): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const frequency = useQuery(digestFrequencyQuery);
  const choose = useMutation({
    mutationFn: chooseDigestFrequency,
    onSuccess: (answer) => {
      queryClient.setQueryData(digestFrequencyQuery.queryKey, answer);
    },
  });
  let body;
  if (frequency.isError) {
    body = (
      <ErrorState
        error={frequency.error}
        onRetry={() => {
          void frequency.refetch();
        }}
      />
    );
  } else if (frequency.data === undefined) {
    body = <LoadingOutline />;
  } else {
    body = (
      // One row per choice, so the whole of each one is read at phone width (the select cut
      // "Twice a week, Wednesday and Saturday at 19:00" short).
      <fieldset className="grid gap-1" disabled={choose.isPending}>
        <legend className="mb-1 text-sm font-semibold">{t('digest.parent.frequency')}</legend>
        {DIGEST_FREQUENCIES.map((value) => (
          <label
            key={value}
            className={cn(
              'flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent has-[:checked]:bg-muted',
              QUICK,
            )}
          >
            <input
              type="radio"
              name="digest-frequency"
              value={value}
              className={CHECKBOX}
              checked={frequency.data.frequency === value}
              onChange={(event) => {
                const chosen = digestFrequencySchema.safeParse(event.target.value);
                if (chosen.success) choose.mutate(chosen.data);
              }}
            />
            <span>{t(`digest.parent.frequencies.${value}`)}</span>
          </label>
        ))}
      </fieldset>
    );
  }
  return (
    <AccountSection title={t('digest.parent.title')}>
      {body}
      <FailureAlert error={choose.error} />
    </AccountSection>
  );
}

function ParentFrame({
  signOut,
  name,
  children,
}: {
  signOut: ReturnType<typeof useSignOut>;
  name: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <PortalShell studentId={undefined} ownPage>
      <PortalTitle {...(name === '' ? {} : { fact: name })}>{t('parent.title')}</PortalTitle>
      <LanguageSection />
      {children}
      <AccountSection title={t('parent.access')}>
        <div className="flex flex-wrap gap-2">
          <Link to="/parent/password" className={buttonVariants({ variant: 'secondary' })}>
            <LockIcon />
            {t('parent.password')}
          </Link>
          <Button
            variant="secondary"
            disabled={signOut.isPending}
            onClick={() => {
              signOut.mutate();
            }}
          >
            <LogoutIcon />
            {t('parent.signOut')}
          </Button>
        </div>
        <FailureAlert error={signOut.error} />
      </AccountSection>
    </PortalShell>
  );
}
