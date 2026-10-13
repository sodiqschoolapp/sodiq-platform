import { HOME_KIND } from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { NoClassTile } from './no-class-tile';
import { useView } from './use-view';
import { cn } from 'cn';
import { PageHeader } from '@/components/page-header';
import { PANEL } from '@/components/ui/control';

/**
 * The first screen of the active role (`08`, Home pages by role). Empty for
 * now: each later task fills the page of its kind. The text says what the page
 * will show. The Academic Vice Principal's home shows the "No class"
 * counter above it (task 2.4b-2).
 */
export function HomePage() {
  const { t } = useTranslation();
  const { role } = useView();
  return (
    <section>
      <PageHeader title={t('home.title')} />
      {role !== null && HOME_KIND[role] === 'academic_vice_principal' && <NoClassTile />}
      <p className={cn(PANEL, 'max-w-prose text-muted-foreground')}>
        {role === null ? t('home.empty') : t(`home.${HOME_KIND[role]}`)}
      </p>
    </section>
  );
}
