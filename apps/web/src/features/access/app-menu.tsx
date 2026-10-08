import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import { ChevronRightIcon, MenuIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useMenuPages } from './use-menu';

/**
 * The entries of the menu: the pages of the active role, then the entries every
 * role has. `onNavigate` closes the phone menu.
 */
function MenuLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const pages = useMenuPages();
  // The own account page (task 0.8d) is the entry every role has, after the pages of the role.
  const entries = [...pages, { titleKey: 'account.title', to: '/account' } as const];

  return (
    <ul className="grid gap-1">
      {entries.map((entry) => (
        <li key={entry.titleKey}>
          <Link
            to={entry.to}
            {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
            className="group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm hover:bg-muted data-[status=active]:bg-muted data-[status=active]:font-medium"
            activeOptions={{ exact: true }}
            activeProps={{ 'aria-current': 'page' }}
          >
            {({ isActive }) => (
              <>
                {t(entry.titleKey)}
                {/* The current page is marked by a sign and by words, not by colour alone. */}
                <ChevronRightIcon
                  aria-hidden
                  className={cn('ml-auto size-4', isActive ? 'opacity-100' : 'opacity-0')}
                />
                {isActive ? <span className="sr-only">{t('menu.current')}</span> : null}
              </>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The left menu from tablet width up (`12`, Navigation). */
export function SideMenu() {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('layout.menu')} className="hidden w-56 shrink-0 border-r p-2 md:block">
      <MenuLinks />
    </nav>
  );
}

/** On a phone the menu opens from a button in the top bar, in the shared dialog. */
export function PhoneMenu() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon" className="md:hidden" aria-label={t('menu.open')} />
        }
      >
        <MenuIcon aria-hidden />
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{t('menu.title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('layout.menu')}</DialogDescription>
        <nav aria-label={t('layout.menu')}>
          <MenuLinks
            onNavigate={() => {
              setOpen(false);
            }}
          />
        </nav>
        <DialogClose render={<Button variant="outline" />}>{t('menu.close')}</DialogClose>
      </DialogContent>
    </Dialog>
  );
}
