import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { Button } from '@/components/ui/button';
import { AuthPage } from './auth-page';
import { SecondStepSetUp } from './second-step-set-up';
import { refreshSession, STEP_PATH, stepOf } from './session';
import { useSignOut } from './use-sign-out';

/**
 * docs/spec/02-roles-and-access.md, Rules: two-step verification is required
 * for the Super Admin and the Academic Vice Principal. The step of sign-in
 * that sets it up, in the frame of the pages before the app; the stages are
 * `SecondStepSetUp`, shared with the account page (task 0.8d).
 */
export function SetUpPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOut = useSignOut();

  // The session says where to go next: home, or another step it owes.
  const leave = useMutation({
    mutationFn: () => refreshSession(queryClient),
    onSuccess: (session) => {
      void navigate({ to: STEP_PATH[stepOf(session)] });
    },
  });

  return (
    <SecondStepSetUp
      intro={t('setUp.intro')}
      size="lg"
      stage={({ title, text, children }) => (
        <AuthPage title={title} text={text}>
          {children}
        </AuthPage>
      )}
      footer={
        <>
          <FailureAlert error={signOut.error ?? leave.error} />
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
        </>
      }
      onSaved={async () => {
        await leave.mutateAsync();
      }}
      onAlreadyOn={() => {
        leave.mutate();
      }}
    />
  );
}
