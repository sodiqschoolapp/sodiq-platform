import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Language } from '@/i18n/languages';
import { saveAccountLanguage } from './account-language';

/**
 * The language chooser of a signed-in person (the top bar, the account page):
 * the tab changes at once and the choice is stored on the account (decided by
 * the owner, task 0.8d). The failure of the save is the caller's to show.
 */
export function useAccountLanguage() {
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (language: Language) => {
      await i18n.changeLanguage(language);
      await saveAccountLanguage(queryClient, language);
    },
  });
}
