import 'i18next';
import type { en } from './locales/en';

// The keys of the English file are the keys `t` accepts: a key that does not
// exist fails the type-check.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}
