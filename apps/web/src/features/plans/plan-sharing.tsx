import {
  planCopySchema,
  planShareSchema,
  type Plan,
  type PlanCopy,
  type PlanShare,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { SelectField } from '@/components/field';
import { useRecordForm } from '@/components/form/use-record-form';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useView } from '@/features/access/use-view';
import { schoolDateText } from '@/lib/dates';
import { copyPlan, invalidatePlans, plansQuery, separatePlan, sharePlan } from './plans-api';

/**
 * Shared plans and copies (task 7.1c, pull request #214; `09`, What a plan
 * contains: "can share one plan between them, if the classes have the same
 * language of instruction ... A shared plan can be separated later." "A plan
 * can be copied from another class, from another teacher of the same subject
 * and grade, or from last year."). The server decides who may join and what
 * may be copied; the page offers what it answers.
 */

/** The actions of the owner on the plan: share, copy. */
export function SharingActions({ plan }: { plan: Plan }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<'share' | 'copy' | null>(null);
  if (!plan.canEdit) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {plan.shareCandidates.length > 0 && (
        <Button
          variant="secondary"
          onClick={() => {
            setOpen('share');
          }}
        >
          {t('plans.share.share')}
        </Button>
      )}
      <Button
        variant="secondary"
        onClick={() => {
          setOpen('copy');
        }}
      >
        {t('plans.share.copy')}
      </Button>
      {open === 'share' && (
        <ShareDialog
          plan={plan}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
      {open === 'copy' && (
        <CopyDialog
          plan={plan}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * The other classes or groups of a shared plan and where each stands (`09`:
 * "The plan screen shows where each class is"), with "Separate" for the owner.
 */
export function SharedWith({ plan }: { plan: Plan }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const separate = useMutation({
    mutationFn: () => separatePlan(plan.journalId, plan.quarterId),
    onSuccess: () => invalidatePlans(queryClient),
  });
  if (plan.sharedWith.length === 0) return null;
  return (
    <section className={`${PANEL} grid gap-2 p-4`} aria-labelledby="plan-shared">
      <h2 id="plan-shared" className={SECTION_TITLE}>
        {t('plans.share.sharedTitle')}
      </h2>
      <ul className="grid gap-1 text-sm">
        {plan.sharedWith.map((one) => (
          <li key={one.journalId} data-shared-journal={one.journalId}>
            <span className="font-semibold">{one.unit.name}</span>
            {' · '}
            {one.next === null
              ? t('plans.share.finished')
              : t(one.next.topic === null ? 'plans.share.atEmpty' : 'plans.share.at', {
                  number: one.next.number,
                  date: schoolDateText(one.next.date, i18n.language, false),
                  topic: one.next.topic ?? '',
                })}
            {one.notCovered > 0 && (
              <>
                {' · '}
                {t('plans.share.notCovered', { count: one.notCovered })}
              </>
            )}
          </li>
        ))}
      </ul>
      {plan.canEdit && (
        <div>
          <Button
            variant="secondary"
            disabled={separate.isPending}
            onClick={() => {
              void (async () => {
                const sure = await confirm({
                  title: t('plans.share.separateTitle', { unit: plan.unit.name }),
                  text: t('plans.share.separateText'),
                  action: t('plans.share.separate'),
                });
                if (sure) separate.mutate();
              })();
            }}
          >
            {t('plans.share.separate')}
          </Button>
        </div>
      )}
      <FailureAlert error={separate.error} />
    </section>
  );
}

/** A dialog that sends one share (`.claude/rules/web.md`: a dialog that sends something once). */
function ShareDialog({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const done = useRef(false);
  const form = useRecordForm<'journalId', PlanShare>({
    schema: planShareSchema,
    initial: { journalId: '' },
    read: (typed) => ({ quarterId: plan.quarterId, journalId: typed.journalId }),
    save: async (body) => {
      await sharePlan(plan.journalId, body);
      done.current = true;
      await invalidatePlans(queryClient);
    },
    message: () => t('plans.share.choose'),
  });
  const title = t('plans.share.shareTitle');
  const send = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await form.submit();
    if (done.current) onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          aria-label={title}
          className="grid gap-4"
          onSubmit={(event) => {
            void send(event);
          }}
        >
          <SelectField
            label={t('plans.share.shareWith')}
            options={[
              { value: '', label: t('plans.share.chooseOption') },
              ...plan.shareCandidates.map((one) => ({
                value: one.journalId,
                label: one.unit.name,
              })),
            ]}
            {...form.bind('journalId')}
          />
          <FailureAlert error={form.failure} />
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>{t('plans.share.back')}</DialogClose>
            <Button type="submit" disabled={form.status === 'saving'}>
              {t('plans.share.shareSend')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The copy of another plan's items (`edge/lesson-plans`: "Copying last year's
 * plan of 38 lessons into a quarter of 35. Only the content is copied, in
 * order."): a year, a plan of the same subject read from the list of that
 * year, its quarter, and all items or only the remaining ones.
 */
function CopyDialog({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { branchId } = useView();
  const done = useRef(false);
  const current = useQuery(plansQuery(branchId, null));
  const [year, setYear] = useState<string | null>(null);
  const yearId = year ?? current.data?.yearId ?? null;
  const list = useQuery({
    ...plansQuery(branchId, yearId),
    enabled: branchId !== null && yearId !== null,
  });
  const [quarter, setQuarter] = useState<string | null>(null);
  const quarters = list.data?.quarters ?? [];
  const ownNumber = plan.quarters.find((one) => one.id === plan.quarterId)?.number;
  // The choice follows the options (`.claude/rules/web.md`): the same number, else the first.
  const quarterId =
    quarters.find((one) => one.id === quarter)?.id ??
    quarters.find((one) => one.number === ownNumber)?.id ??
    quarters[0]?.id ??
    '';
  const sources = (list.data?.plans ?? []).filter((one) => one.subject.id === plan.subject.id);
  const form = useRecordForm<'source' | 'part', PlanCopy>({
    schema: planCopySchema,
    initial: { source: '', part: 'all' },
    read: (typed) => ({
      quarterId: plan.quarterId,
      source: { journalId: typed.source, quarterId },
      part: typed.part,
    }),
    save: async (body) => {
      await copyPlan(plan.journalId, body);
      done.current = true;
      await invalidatePlans(queryClient);
    },
    message: (field) => (field === 'source' ? t('plans.share.copyChoose') : undefined),
  });
  const title = t('plans.share.copyTitle');
  const send = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await form.submit();
    if (done.current) onClose();
  };
  const failed = current.isError ? current : list.isError ? list : null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          aria-label={title}
          className="grid gap-4"
          onSubmit={(event) => {
            void send(event);
          }}
        >
          {failed !== null ? (
            <ErrorState
              error={failed.error}
              onRetry={() => {
                void failed.refetch();
              }}
            />
          ) : current.data === undefined || list.data === undefined ? (
            <LoadingOutline />
          ) : (
            <>
              <SelectField
                label={t('plans.share.copyYear')}
                options={current.data.years.map((one) => ({
                  value: one.id,
                  label: `${one.startDate.slice(0, 4)}–${one.endDate.slice(0, 4)}`,
                }))}
                name="year"
                value={yearId ?? ''}
                onChange={(event) => {
                  setYear(event.target.value);
                  setQuarter(null);
                  form.bind('source').onChange({ target: { value: '' } });
                }}
              />
              {sources.length === 0 ? (
                <EmptyState text={t('plans.share.copyNone')} />
              ) : (
                <>
                  <SelectField
                    label={t('plans.share.copySource')}
                    options={[
                      { value: '', label: t('plans.share.chooseOption') },
                      ...sources.map((one) => ({ value: one.journalId, label: one.unit.name })),
                    ]}
                    {...form.bind('source')}
                  />
                  <SelectField
                    label={t('plans.share.copyQuarter')}
                    options={quarters.map((one) => ({
                      value: one.id,
                      label: t('plans.page.quarter', { number: one.number }),
                    }))}
                    name="quarter"
                    value={quarterId}
                    onChange={(event) => {
                      setQuarter(event.target.value);
                    }}
                  />
                  <SelectField
                    label={t('plans.share.copyPart')}
                    options={[
                      { value: 'all', label: t('plans.share.copyAll') },
                      { value: 'remaining', label: t('plans.share.copyRemaining') },
                    ]}
                    {...form.bind('part')}
                  />
                </>
              )}
            </>
          )}
          <FailureAlert error={form.failure} />
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>{t('plans.share.back')}</DialogClose>
            <Button type="submit" disabled={form.status === 'saving' || sources.length === 0}>
              {t('plans.share.copySend')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Decision 16: the plan an item was copied from, whose history holds its earlier changes. */
export function CopiedFrom({ from }: { from: { journalId: string; quarterId: string } }) {
  const { t } = useTranslation();
  return (
    <p className="text-sm text-muted-foreground">
      {t('plans.share.copiedFrom')}{' '}
      <Link
        className="text-link font-semibold hover:underline"
        to="/plans/$journalId"
        params={{ journalId: from.journalId }}
        search={{ quarter: from.quarterId }}
      >
        {t('plans.share.openSource')}
      </Link>
    </p>
  );
}
