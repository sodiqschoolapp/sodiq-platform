import type { FirstPasswordSlip as Slip } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Letterhead } from '@/components/print/letterhead';
import { failureText } from '@/api/failure-text';
import { LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useView } from '@/features/access/use-view';
import { branchQuery } from '@/features/setup/setup-api';
import { momentText, schoolDateText } from '@/lib/dates';

/** The body attribute that prints the slip alone (index.css). */
const PRINTING = 'slip';

/**
 * The slip itself (docs/design-system.md, This app, Printouts): the
 * letterhead, the person, the three steps to sign in at the site's address,
 * and a box with the login, the password and the date of issue; a cut line
 * below. One slip per person (answer 15). Both dates have the long month
 * (issue #39, hand test of 13 October 2026, finding 23); "Valid until" is a
 * moment in the branch's time zone, as on the personal data report (task
 * 2.6b); until the branch is read it is not drawn, and a failure to read it
 * says so with a retry (never the device's time zone in its place).
 */
export function FirstPasswordSlipCard({ slip, issued }: { slip: Slip; issued: string }) {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const branch = useQuery(branchQuery(branchId));
  const address = window.location.origin;
  return (
    <article data-slip="" className="grid gap-4 border-b-2 border-dashed border-foreground/40 pb-6">
      <Letterhead />
      <h2 className="text-xl font-semibold">
        {slip.firstName} {slip.lastName}
      </h2>
      <ol className="grid list-decimal gap-1 pl-5 text-sm">
        <li>{t('people.account.slipStepOpen', { address })}</li>
        <li>{t('people.account.slipStepSignIn')}</li>
        <li>{t('people.account.slipStepChange')}</li>
      </ol>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border-2 border-current p-4 text-sm">
        <dt>{t('people.account.login')}</dt>
        <dd className="font-mono text-base font-semibold">{slip.login}</dd>
        <dt>{t('people.account.password')}</dt>
        <dd className="font-mono text-base font-semibold">{slip.password}</dd>
        <dt>{t('people.account.issued')}</dt>
        <dd>{schoolDateText(issued, i18n.language)}</dd>
        <dt>{t('people.account.validUntil')}</dt>
        <dd>
          {branch.data !== undefined ? (
            momentText(i18n.language, slip.validUntil, {
              month: 'long',
              timeZone: branch.data.timeZone,
            })
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
 * The first password, shown once (answer 15; Accounts and sign-in: "printed
 * once on per-person slips and not stored"). The password lives only in the
 * state of the page that opened this dialog: closing it drops it, and nothing
 * keeps it in a query cache or the offline queue (correction 4 of the review
 * of pull request #62). "Print" prints the slip alone. A password reset by an
 * administrator shows the same slip under its own title (task 2.3c-1,
 * decision 9): its three steps hold for a one-time password too.
 */
export function FirstPasswordSlipDialog({
  slip,
  issued,
  onClose,
  kind = 'first',
}: {
  slip: Slip;
  issued: string;
  onClose: () => void;
  kind?: 'first' | 'reset';
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
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {kind === 'reset' ? t('people.access.slipTitle') : t('people.account.slipTitle')}
            </DialogTitle>
            <DialogDescription>{t('people.account.slipOnce')}</DialogDescription>
          </DialogHeader>
          <FirstPasswordSlipCard slip={slip} issued={issued} />
          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                setPrinting(true);
              }}
            >
              {t('people.account.print')}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('people.account.closeSlip')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {createPortal(
        <div data-slip-sheet="" className="hidden">
          <FirstPasswordSlipCard slip={slip} issued={issued} />
        </div>,
        document.body,
      )}
    </>
  );
}
