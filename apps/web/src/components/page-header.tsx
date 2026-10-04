import { Link, type LinkProps } from '@tanstack/react-router';
import { ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface Breadcrumb {
  label: string;
  to: LinkProps['to'];
}

interface PageHeaderProps {
  title: string;
  /** The pages above this one, from the top; the page itself is not among them. */
  breadcrumbs?: Breadcrumb[];
  /** The buttons of the page, for example "Add". */
  actions?: ReactNode;
}

/**
 * The head of a page inside the layout (docs/spec/12-ux-standards.md,
 * Navigation: breadcrumbs on inner pages).
 */
export function PageHeader({ title, breadcrumbs = [], actions }: PageHeaderProps) {
  const { t } = useTranslation();
  return (
    <header className="mb-4 grid gap-1">
      {breadcrumbs.length > 0 && (
        <nav aria-label={t('layout.breadcrumbs')}>
          <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            {breadcrumbs.map((crumb) => (
              <li key={crumb.label} className="flex items-center gap-1">
                <Link to={crumb.to} className="underline-offset-4 hover:underline">
                  {crumb.label}
                </Link>
                <ChevronRightIcon aria-hidden className="size-3.5" />
              </li>
            ))}
            <li aria-current="page">{title}</li>
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        {actions !== undefined && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
