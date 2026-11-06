import type { PrintedParentSlip, PrintedParentSlips } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { failureText } from '@/api/failure-text';
import { Letterhead } from '@/components/print/letterhead';
import { LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { branchQuery } from '@/features/setup/setup-api';
import { momentText } from '@/lib/dates';

/** The body attribute that prints the slips alone (index.css). */
const PRINTING = 'slip';

/**
 * One parent's slip (task 11.1; `10`, Signing in; reading 2 of the Release 2 plan): the
 * letterhead, the parent and the children, how to open the platform (the site, and the
 * school's bot by its name when it is set), the login, the password and the dates. Every text
 * is in the language chosen when printing, not the screen's.
 */
export function ParentSlipCard({
  slip,
  answer,
}: {
  slip: PrintedParentSlip;
  answer: PrintedParentSlips;
}) {
  const { t, i18n } = useTranslation();
  const fixed = i18n.getFixedT(answer.language);
  const { branchId } = useView();
  const branch = useQuery(branchQuery(branchId));
  const address = window.location.origin;
  const when = (iso: string) =>
    branch.data === undefined
      ? null
      : momentText(answer.language, iso, { month: 'long', timeZone: branch.data.timeZone });
  return (
    <article
      data-slip=""
      className="grid gap-2 border-b-2 border-dashed border-foreground/40 pb-3 text-xs"
    >
      <Letterhead />
      <h2 className="text-base font-semibold">
        {fixed('people.parentSlip.title')}: {slip.fullName}
      </h2>
      <p>
        {fixed('people.parentSlip.children', {
          names: slip.children.map((child) => `${child.firstName} ${child.lastName}`).join(', '),
        })}
      </p>
      <ol className="grid list-decimal gap-1 pl-5 text-xs">
        <li>{fixed('people.parentSlip.stepSite', { address })}</li>
        {answer.botUsername === null ? null : (
          <li>{fixed('people.parentSlip.stepBot', { bot: answer.botUsername })}</li>
        )}
        <li>{fixed('people.parentSlip.stepSignIn')}</li>
        <li>{fixed('people.parentSlip.stepChange')}</li>
      </ol>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border-2 border-current p-2 text-xs">
        <dt>{fixed('people.parentSlip.login')}</dt>
        <dd className="font-mono text-base font-semibold">{slip.login}</dd>
        <dt>{fixed('people.parentSlip.password')}</dt>
        <dd className="font-mono text-base font-semibold">{slip.password}</dd>
        <dt>{fixed('people.parentSlip.printedOn')}</dt>
        <dd>{when(slip.printedAt)}</dd>
        <dt>{fixed('people.parentSlip.validUntil')}</dt>
        <dd>
          {branch.data !== undefined ? (
            when(slip.validUntil)
          ) : branch.isError ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <span role="alert">{failureText(t, branch.error)}</span>
              <Button
                variant="secondary"
                onClick={() => {
                  void branch.refetch();
                }}
              >
                {t('problems.retry')}
              </Button>
            </span>
          ) : (
            <LoadingOutline lines={1} />
          )}
        </dd>
      </dl>
    </article>
  );
}

/**
 * The printed slips, four to an A4 page (`10`: "four slips to an A4 page"). The passwords live
 * only in the state of the page that holds the answer; leaving it drops them.
 */
export function ParentSlipsSheet({
  answer,
  onDone,
}: {
  answer: PrintedParentSlips;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!printing) {
      return undefined;
    }
    document.body.dataset.printing = PRINTING;
    const done = () => {
      setPrinting(false);
    };
    window.addEventListener('afterprint', done);
    window.print();
    return () => {
      window.removeEventListener('afterprint', done);
      delete document.body.dataset.printing;
    };
  }, [printing]);

  return (
    <section className={`${PANEL} grid gap-4`} aria-labelledby="parent-slips-sheet">
      <h2 id="parent-slips-sheet" className={SECTION_TITLE}>
        {t('people.parentSlips.sheetTitle', { count: answer.slips.length })}
      </h2>
      <p className="text-sm">{t('people.parentSlips.once')}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            setPrinting(true);
          }}
        >
          {t('people.parentSlips.print')}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {t('people.parentSlips.back')}
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {answer.slips.map((slip) => (
          <ParentSlipCard key={slip.relativeId} slip={slip} answer={answer} />
        ))}
      </div>
      {createPortal(
        <div data-slip-sheet="" data-four="" className="hidden">
          {answer.slips.map((slip) => (
            <ParentSlipCard key={slip.relativeId} slip={slip} answer={answer} />
          ))}
        </div>,
        document.body,
      )}
    </section>
  );
}
