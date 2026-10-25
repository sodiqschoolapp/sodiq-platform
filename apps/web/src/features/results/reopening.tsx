import {
  CLOSING_BLOCKING,
  closingRecalculationApplyInputSchema,
  closingReopenInputSchema,
  type ClosingChange,
  type ClosingChecklist,
  type ClosingJournalCloseInput,
  type ClosingOutcome,
  type ClosingReopenedJournal,
  type ClosingReopening,
  type ClosingReopenInput,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { CHECKBOX, CHECKBOX_TARGET, FIELD } from '@/components/ui/control';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { momentText } from '@/lib/dates';
import { warningsSeen } from './close-quarter-dialog';
import {
  applyRecalculation,
  closeJournalAgain,
  invalidateClosing,
  recalculationQuery,
  reopenQuarter,
} from './closing-api';

/**
 * Reopening a closed quarter and closing it again, and "recalculate and compare" (task 9.2c,
 * pull request #231; `edge/journal`, Closing and reopening: "Reopening is for one journal or the
 * whole branch, for a set number of days ... Closing again lists every result that changed";
 * `edge/calculation`, "A bug is found after results were closed and exported"). Every list here
 * is the server's; the browser calculates nothing.
 */

const SEPARATOR = ' · ';

const studentName = (student: { firstName: string; lastName: string; uid: string }) =>
  [`${student.lastName} ${student.firstName}`, student.uid].join(SEPARATOR);

/** A result as it is shown: the number and grade, or its state. */
function OutcomeText({ outcome }: { outcome: ClosingOutcome | null }) {
  const { t } = useTranslation();
  if (outcome === null) return <>{t('results.reopening.noRecord')}</>;
  if (outcome.kind === 'number') {
    return (
      <>{t('results.reopening.number', { shown: outcome.shown ?? 0, grade: outcome.grade ?? 0 })}</>
    );
  }
  return <>{t(`results.reopening.outcomes.${outcome.kind}`)}</>;
}

/** "Closing again lists every result that changed." */
export function ChangesList({ changes }: { changes: readonly ClosingChange[] }) {
  const { t, i18n } = useTranslation();
  if (changes.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('results.reopening.noChanges')}</p>;
  }
  return (
    <table className="w-full text-sm" data-changes="true">
      <caption className="sr-only">{t('results.reopening.changes')}</caption>
      <thead>
        <tr className="text-left">
          <th className="py-1 pr-3">{t('results.reopening.student')}</th>
          <th className="py-1 pr-3">{t('results.reopening.subject')}</th>
          <th className="py-1 pr-3">{t('results.reopening.before')}</th>
          <th className="py-1">{t('results.reopening.after')}</th>
        </tr>
      </thead>
      <tbody>
        {changes.map((change) => (
          <tr
            key={`${change.subject.id}:${change.student.id}`}
            data-student={change.student.id}
            className="border-t"
          >
            <td className="py-1 pr-3">{studentName(change.student)}</td>
            <td className="py-1 pr-3">{nameOf(change.subject.names, i18n.language)}</td>
            <td className="py-1 pr-3">
              <OutcomeText outcome={change.before} />
            </td>
            <td className="py-1">
              <OutcomeText outcome={change.after} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One reopening as a line: whole branch or journal, by whom, until when, why. */
export function ReopeningLine({ reopening }: { reopening: ClosingReopening }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const what =
    reopening.journal === null
      ? t('results.reopening.wholeBranch')
      : `${reopening.journal.unit.name}${SEPARATOR}${nameOf(reopening.journal.subject.names, language)}`;
  const state =
    reopening.closedAgainVersion !== null
      ? t('results.reopening.closedAgain', { version: reopening.closedAgainVersion })
      : reopening.ended
        ? t('results.reopening.ended', { date: momentText(language, reopening.openUntil) })
        : t('results.reopening.openUntil', { date: momentText(language, reopening.openUntil) });
  return (
    <li data-reopening={reopening.id}>
      <span className="font-semibold">{what}</span>
      {SEPARATOR}
      {t('results.reopening.by', {
        date: momentText(language, reopening.reopenedAt),
        name: reopening.reopenedBy,
      })}
      {SEPARATOR}
      {state}
      <span className="block text-muted-foreground">{reopening.reason}</span>
    </li>
  );
}

/** The reopening dialog: the whole branch or one journal, a reason and the days. */
export function ReopenDialog({
  checklist,
  onDone,
  onCancel,
}: {
  checklist: ClosingChecklist;
  onDone: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [key] = useState(() => crypto.randomUUID());
  const [journalId, setJournalId] = useState<string>('');
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('3');
  const [tried, setTried] = useState(false);
  const input: ClosingReopenInput = {
    journalId: journalId === '' ? null : journalId,
    reason,
    days: /^\d+$/.test(days) ? Number(days) : 0,
  };
  const checked = closingReopenInputSchema.safeParse(input);
  const reopen = useMutation({
    mutationFn: async (body: ClosingReopenInput) => {
      if (checklist.quarterId === null) return;
      await reopenQuarter(checklist.quarterId, body, key);
      await invalidateClosing(queryClient);
    },
    onSuccess: onDone,
  });
  const reopened = new Set(
    checklist.reopenedJournals.map((one) => one.reopening.journal?.id ?? ''),
  );
  const title = t('results.reopening.title');
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          aria-label={title}
          className="grid gap-4 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            setTried(true);
            if (checked.success) reopen.mutate(checked.data);
          }}
        >
          <p>{t('results.reopening.text')}</p>
          <label className="grid gap-1">
            <span>{t('results.reopening.what')}</span>
            <select
              className={FIELD}
              value={journalId}
              onChange={(event) => setJournalId(event.target.value)}
            >
              <option value="">{t('results.reopening.wholeBranch')}</option>
              {checklist.closedJournals
                .filter((journal) => !reopened.has(journal.id))
                .map((journal) => (
                  <option key={journal.id} value={journal.id}>
                    {t('results.reopening.journalOption', {
                      unit: journal.unitName,
                      subject: nameOf(journal.subjectNames, i18n.language),
                    })}
                  </option>
                ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span>{t('results.reopening.days')}</span>
            <input
              className={FIELD}
              inputMode="numeric"
              value={days}
              aria-invalid={
                tried &&
                !checked.success &&
                checked.error.issues.some((one) => one.path[0] === 'days')
              }
              onChange={(event) => setDays(event.target.value)}
            />
          </label>
          <label className="grid gap-1">
            <span>{t('results.reopening.reason')}</span>
            <Textarea
              value={reason}
              maxLength={500}
              aria-invalid={
                tried &&
                !checked.success &&
                checked.error.issues.some((one) => one.path[0] === 'reason')
              }
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {tried && !checked.success && (
            <span role="alert" className="text-destructive">
              {t('results.reopening.missing')}
            </span>
          )}
          <FailureAlert error={reopen.error} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onCancel}>
              {t('results.closing.close.back')}
            </Button>
            <Button type="submit" disabled={reopen.isPending}>
              {t('results.reopening.action')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A reopened journal of a closed quarter: its own items, the results that changed, "close again". */
export function ReopenedJournalPanel({
  quarterId,
  journal,
  canEdit,
}: {
  quarterId: string;
  journal: ClosingReopenedJournal;
  canEdit: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [closing, setClosing] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const close = useMutation({
    mutationFn: async (body: ClosingJournalCloseInput) => {
      const journalId = journal.reopening.journal?.id;
      if (journalId === undefined || closing === null) return null;
      const answer = await closeJournalAgain(quarterId, journalId, body, closing);
      await invalidateClosing(queryClient);
      return answer;
    },
    onSuccess: (answer) => {
      if (answer !== null) setClosing(null);
    },
  });
  const name =
    journal.reopening.journal === null
      ? ''
      : `${journal.reopening.journal.unit.name}${SEPARATOR}${nameOf(journal.reopening.journal.subject.names, i18n.language)}`;
  return (
    <section
      className="grid gap-3 rounded-md border p-4 text-sm"
      aria-label={name}
      data-reopened-journal={journal.reopening.journal?.id}
    >
      <h2 className="font-semibold">{name}</h2>
      <ul>
        <ReopeningLine reopening={journal.reopening} />
      </ul>
      {journal.items.length === 0 ? (
        <p>{t('results.closing.nothingLeft')}</p>
      ) : (
        <ul className="grid gap-1">
          {journal.items.map((item, index) => (
            <li key={`${item.kind}:${String(index)}`} data-item={item.kind}>
              <span
                className={
                  CLOSING_BLOCKING.includes(item.kind) ? 'font-semibold text-destructive' : ''
                }
              >
                {t(`results.closing.kinds.${item.kind}`)}
              </span>
              {SEPARATOR}
              {CLOSING_BLOCKING.includes(item.kind)
                ? t('results.closing.blocking')
                : t('results.closing.warning')}
            </li>
          ))}
        </ul>
      )}
      <h3 className="font-semibold">{t('results.reopening.changes')}</h3>
      <ChangesList changes={journal.changes} />
      {close.data !== undefined && close.data !== null && (
        <p role="status">
          {t('results.reopening.closedAgainNow', { version: close.data.version })}
        </p>
      )}
      {canEdit && (
        <div>
          <Button
            disabled={!journal.closable || close.isPending}
            onClick={() => {
              close.reset();
              setClosing(crypto.randomUUID());
            }}
          >
            {t('results.reopening.closeAgain')}
          </Button>
        </div>
      )}
      {closing !== null && (
        <CloseJournalDialog
          key={`${closing}:${JSON.stringify(journal.items.map((item) => item.kind))}`}
          journal={journal}
          name={name}
          pending={close.isPending}
          error={close.error}
          onClose={(input) => close.mutate(input)}
          onCancel={() => setClosing(null)}
        />
      )}
    </section>
  );
}

/** The close of one reopened journal again: its warnings acknowledged, "lock now" when needed. */
function CloseJournalDialog({
  journal,
  name,
  pending,
  error,
  onClose,
  onCancel,
}: {
  journal: ClosingReopenedJournal;
  name: string;
  pending: boolean;
  error: unknown;
  onClose: (input: ClosingJournalCloseInput) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const warnings = warningsSeen(journal);
  const [acknowledged, setAcknowledged] = useState(false);
  const [lockNow, setLockNow] = useState(false);
  const [tried, setTried] = useState(false);
  const missing = (warnings.length > 0 && !acknowledged) || (journal.lockNowNeeded && !lockNow);
  const title = t('results.reopening.closeAgainTitle', { journal: name });
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          aria-label={title}
          className="grid gap-4 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            setTried(true);
            if (missing) return;
            onClose({ warnings, lockNow: journal.lockNowNeeded && lockNow });
          }}
        >
          <p>{t('results.reopening.closeAgainText', { count: journal.changes.length })}</p>
          {warnings.length > 0 && (
            <label className={CHECKBOX_TARGET}>
              <input
                type="checkbox"
                className={CHECKBOX}
                checked={acknowledged}
                aria-invalid={tried && !acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>{t('results.closing.close.acknowledge', { count: journal.warnings })}</span>
            </label>
          )}
          {journal.lockNowNeeded && (
            <label className={CHECKBOX_TARGET}>
              <input
                type="checkbox"
                className={CHECKBOX}
                checked={lockNow}
                aria-invalid={tried && !lockNow}
                onChange={(event) => setLockNow(event.target.checked)}
              />
              <span>{t('results.closing.close.lockNow')}</span>
            </label>
          )}
          {tried && missing && (
            <span role="alert" className="text-destructive">
              {t('results.closing.close.missing')}
            </span>
          )}
          <FailureAlert error={error} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onCancel}>
              {t('results.closing.close.back')}
            </Button>
            <Button type="submit" disabled={pending}>
              {t('results.reopening.closeAgain')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Recalculate and compare" of a closed quarter: read on request; "apply with a reason" for the
 * Super Admin (`results_recalculation`, decision 10).
 */
export function RecalculationSection({
  quarterId,
  canApply,
}: {
  quarterId: string;
  canApply: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const [asked, setAsked] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const query = useQuery(recalculationQuery(branchId, quarterId, asked));
  const rows = query.data?.rows ?? [];
  const applicable = rows.filter((row) => row.refused === null);
  return (
    <section className="grid gap-3 text-sm" aria-label={t('results.recalculation.title')}>
      <h2 className="font-semibold">{t('results.recalculation.title')}</h2>
      {!asked ? (
        <div>
          <Button variant="secondary" onClick={() => setAsked(true)}>
            {t('results.recalculation.compare')}
          </Button>
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data === undefined ? (
        <LoadingOutline />
      ) : rows.length === 0 ? (
        <p data-recalculation="same">
          {t('results.recalculation.same', { version: query.data.currentVersion })}
        </p>
      ) : (
        <>
          <table className="w-full" data-recalculation="differences">
            <caption className="sr-only">{t('results.recalculation.title')}</caption>
            <thead>
              <tr className="text-left">
                <th className="py-1 pr-3">{t('results.reopening.student')}</th>
                <th className="py-1 pr-3">{t('results.reopening.subject')}</th>
                <th className="py-1 pr-3">{t('results.recalculation.stored')}</th>
                <th className="py-1">{t('results.recalculation.now')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.subject.id}:${row.student.id}`}
                  data-student={row.student.id}
                  className="border-t"
                >
                  <td className="py-1 pr-3">{studentName(row.student)}</td>
                  <td className="py-1 pr-3">{nameOf(row.subject.names, i18n.language)}</td>
                  <td className="py-1 pr-3">
                    <OutcomeText outcome={row.before} />
                    {SEPARATOR}
                    {t('results.recalculation.version', { version: row.storedVersion })}
                  </td>
                  <td className="py-1">
                    {row.after === null ? (
                      t('results.recalculation.refused')
                    ) : (
                      <OutcomeText outcome={row.after} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {canApply && applicable.length > 0 && (
            <div>
              <Button onClick={() => setApplying(crypto.randomUUID())}>
                {t('results.recalculation.apply')}
              </Button>
            </div>
          )}
        </>
      )}
      {applying !== null && query.data !== undefined && (
        <ApplyDialog
          key={applying}
          requestKey={applying}
          quarterId={quarterId}
          students={applicable.map((row) => ({
            subjectId: row.subject.id,
            studentId: row.student.id,
          }))}
          onDone={() => {
            setApplying(null);
            void query.refetch();
          }}
          onCancel={() => setApplying(null)}
        />
      )}
    </section>
  );
}

function ApplyDialog({
  requestKey,
  quarterId,
  students,
  onDone,
  onCancel,
}: {
  requestKey: string;
  quarterId: string;
  students: { subjectId: string; studentId: string }[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const checked = closingRecalculationApplyInputSchema.safeParse({ reason, students });
  const apply = useMutation({
    mutationFn: async (body: { reason: string; students: typeof students }) => {
      await applyRecalculation(quarterId, body, requestKey);
      await invalidateClosing(queryClient);
    },
    onSuccess: onDone,
  });
  const title = t('results.recalculation.applyTitle', { count: students.length });
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          aria-label={title}
          className="grid gap-4 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            setTried(true);
            if (checked.success) apply.mutate(checked.data);
          }}
        >
          <p>{t('results.recalculation.applyText')}</p>
          <label className="grid gap-1">
            <span>{t('results.reopening.reason')}</span>
            <Textarea
              value={reason}
              maxLength={500}
              aria-invalid={tried && !checked.success}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {tried && !checked.success && (
            <span role="alert" className="text-destructive">
              {t('results.reopening.missing')}
            </span>
          )}
          <FailureAlert error={apply.error} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onCancel}>
              {t('results.closing.close.back')}
            </Button>
            <Button type="submit" disabled={apply.isPending}>
              {t('results.recalculation.apply')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
