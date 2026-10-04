import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { api } from '@/api/client';
import { answerOf } from '@/api/failure';
import { forgetSession, STEP_PATH } from './session';
import { rememberTrustAsked } from './trust-asked';

/** Sign-out of this browser. Afterwards nothing of the person stays in the tab. */
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: () => answerOf(api.POST('/api/auth/sign-out')),
    onSuccess: () => {
      rememberTrustAsked(false);
      forgetSession(queryClient);
      void navigate({ to: STEP_PATH.sign_in });
    },
  });
}
