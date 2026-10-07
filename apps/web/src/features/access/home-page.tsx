import { HOME_KIND } from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { useView } from './use-view';

/**
 * The first screen of the active role (`08`, Home pages by role). Empty for
 * now: each later task fills the page of its kind. The text says what the page
 * will show.
 */
export function HomePage() {
  const { t } = useTranslation();
  const { role } = useView();
  return (
    <section className="max-w-prose">
      <h1 className="text-xl font-semibold">{t('home.title')}</h1>
      <p className="mt-2 text-muted-foreground">
        {role === null ? t('home.empty') : t(`home.${HOME_KIND[role]}`)}
      </p>
    </section>
  );
}
