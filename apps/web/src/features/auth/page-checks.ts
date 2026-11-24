import { filledOnPage } from '@/components/form/page-checks';

/** The login of a reset request: the page refuses it empty (`forgot.loginMissing`). */
export const FORGOT_PAGE = filledOnPage(['login']);

/** The new password typed again: the page refuses it unlike the new one, and so empty. */
export const REPEAT_PAGE = filledOnPage(['repeat']);
