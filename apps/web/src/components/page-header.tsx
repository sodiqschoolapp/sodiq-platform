import { Link, type LinkProps } from '@tanstack/react-router';
import { ChevronRightIcon } from '@/components/icons';
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
  /**
   * The name of the page in the breadcrumbs when its title names a record (the journal: title
   * "5 Oxford · Ingliz tili", breadcrumb "Sinf jurnali", `07`, Opening a journal). The title by default.
   */
  current?: string;
  /** The buttons of the page, for example "Add". */
  actions?: ReactNode;
}

/**
 * The head of a page inside the layout (docs/spec/12-ux-standards.md,
 * Navigation: breadcrumbs on inner pages).
 */
export function PageHeader({ title, breadcrumbs = [], current, actions }: PageHeaderProps) {
  const { t } = useTranslation();
  return (
    <header className="mb-6 grid gap-1">
      {breadcrumbs.length > 0 && (
        <nav aria-label={t('layout.breadcrumbs')}>
          <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            {breadcrumbs.map((crumb) => (
              <li key={crumb.label} className="flex items-center gap-1">
                {/* Exact: a page above this one is never marked as the current page. */}
                <Link
                  to={crumb.to}
                  activeOptions={{ exact: true }}
                  className="font-semibold text-link underline-offset-4 hover:underline"
                >
                  {crumb.label}
                </Link>
                <ChevronRightIcon className="size-4" />
              </li>
            ))}
            <li aria-current="page">{current ?? title}</li>
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {/* Page title 28 / 34, 700, -0.01em (docs/design-system.md, Type). */}
        <h1 className="text-[1.75rem]/[2.125rem] font-bold tracking-[-0.01em]">{title}</h1>
        {actions !== undefined && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
