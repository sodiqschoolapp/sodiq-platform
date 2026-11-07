import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { answerOf } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { SECTION_TITLE } from '@/components/ui/control';
import { momentText } from '@/lib/dates';
import { Button, buttonVariants } from '@/components/ui/button';
import { DIGEST_FREQUENCIES, digestFrequencySchema } from '@sodiq/shared';
import { SelectField } from '@/components/field';
import { ErrorState, LoadingOutline } from '@/components/states';
import { chooseDigestFrequency, digestFrequencyQuery } from '@/features/portal/digest-api';
import { LanguageSection } from './account/language-section';
import { AuthPage } from './auth-page';
import { refreshSession, sessionQuery } from './session';
import { useLeaveSignedOut, useSignOut } from './use-sign-out';

/**
 * The frame of a parent session (task 11.1, decision 13): no staff menu and no branch, only
 * what the owner approved for the parent ("signs in and changes its own password and
 * language"): the language, the password change and sign-out. The parent pages come with
 * task 11.2.
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
    <section className="grid gap-2" aria-labelledby="parent-telegram">
      <h2 id="parent-telegram" className={SECTION_TITLE}>
        {t('parent.telegram')}
      </h2>
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
    </section>
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
      <div className="max-w-xs">
        <SelectField
          label={t('digest.parent.frequency')}
          name="digest-frequency"
          value={frequency.data.frequency}
          disabled={choose.isPending}
          options={DIGEST_FREQUENCIES.map((value) => ({
            value,
            label: t(`digest.parent.frequencies.${value}`),
          }))}
          onChange={(event) => {
            const chosen = digestFrequencySchema.safeParse(event.target.value);
            if (chosen.success) choose.mutate(chosen.data);
          }}
        />
      </div>
    );
  }
  return (
    <section className="grid gap-2" aria-labelledby="parent-digest">
      <h2 id="parent-digest" className={SECTION_TITLE}>
        {t('digest.parent.title')}
      </h2>
      {body}
      <FailureAlert error={choose.error} />
    </section>
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
    <AuthPage title={t('parent.title')} text={name}>
      <div className="grid gap-6">
        <LanguageSection />
        {children}
        <div className="flex flex-wrap gap-2">
          <Link to="/portal" className={buttonVariants({ variant: 'default' })}>
            {t('parent.portal')}
          </Link>
          <Link to="/parent/password" className={buttonVariants({ variant: 'secondary' })}>
            {t('parent.password')}
          </Link>
          <Button
            variant="secondary"
            disabled={signOut.isPending}
            onClick={() => {
              signOut.mutate();
            }}
          >
            {t('parent.signOut')}
          </Button>
        </div>
        <FailureAlert error={signOut.error} />
      </div>
    </AuthPage>
  );
}
