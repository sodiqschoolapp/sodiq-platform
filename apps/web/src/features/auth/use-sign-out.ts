import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useViewStore } from '@/features/access/use-view';
import { api } from '@/api/client';
import { answerOf } from '@/api/failure';
import { forgetSession, STEP_PATH } from './session';
import { rememberTrustAsked } from './trust-asked';

/**
 * What the tab does once its session is over by its own doing (sign-out, the
 * removal of this trusted device): nothing of the person stays in the tab,
 * and the sign-in page opens.
 */
export function useLeaveSignedOut(): () => void {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const view = useViewStore();
  return () => {
    rememberTrustAsked(false);
    forgetSession(queryClient);
    view.clear();
    void navigate({ to: STEP_PATH.sign_in });
  };
}

/** Sign-out of this browser. Afterwards nothing of the person stays in the tab. */
export function useSignOut() {
  const leave = useLeaveSignedOut();

  return useMutation({
    mutationFn: () => answerOf(api.POST('/api/auth/sign-out')),
    onSuccess: leave,
  });
}
