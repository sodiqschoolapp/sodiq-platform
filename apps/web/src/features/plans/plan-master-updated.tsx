import { planCopySchema, type Plan, type PlanCopy, type PlanMasterContent } from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
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
import {
  answerPlanMaster,
  copyPlan,
  invalidatePlans,
  planMasterCompareQuery,
  planMastersQuery,
} from './plans-api';

/**
 * A plan and its master (task 7.3, pull request #216; `09`, Master plans):
 * "A teacher creates a plan as a copy of the master. Its items fill the rows
 * of the class in order." "Teachers who copied it see 'master updated' with a
 * side-by-side comparison. Taking the changes is free inside the window and
 * needs an edit request after it." The server answers which masters fit the
 * plan and what can be taken.
 */

/** "Copy from a master" for the owner, with the masters that fit the plan. */
export function CopyMasterDialog({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { branchId } = useView();
  const done = useRef(false);
  const masters = useQuery(
    planMastersQuery(branchId, { journalId: plan.journalId, quarterId: plan.quarterId }),
  );
  const options = masters.data?.masters ?? [];
  const form = useRecordForm<'masterId', PlanCopy>({
    schema: planCopySchema,
    initial: { masterId: '' },
    read: (typed) => ({ quarterId: plan.quarterId, source: { masterId: typed.masterId } }),
    save: async (body) => {
      await copyPlan(plan.journalId, body);
      done.current = true;
      await invalidatePlans(queryClient);
    },
    message: () => t('plans.masterCopy.choose'),
  });
  const title = t('plans.masterCopy.title');
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
          {masters.isError ? (
            <ErrorState
              error={masters.error}
              onRetry={() => {
                void masters.refetch();
              }}
            />
          ) : masters.data === undefined ? (
            <LoadingOutline />
          ) : options.length === 0 ? (
            <EmptyState text={t('plans.masterCopy.none')} />
          ) : (
            <SelectField
              label={t('plans.masterCopy.master')}
              options={[
                { value: '', label: t('plans.share.chooseOption') },
                ...options.map((one) => ({
                  value: one.id,
                  label: `${one.name} · ${t(`plans.masters.scopes.${one.scope}`)} · ${t('plans.masterCopy.items', { count: one.items })}`,
                })),
              ]}
              {...form.bind('masterId')}
            />
          )}
          <FailureAlert error={form.failure} />
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>{t('plans.share.back')}</DialogClose>
            <Button type="submit" disabled={form.status === 'saving' || options.length === 0}>
              {t('plans.share.copySend')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The master a plan was copied from, and "master updated" with the comparison. */
export function MasterMark({ plan }: { plan: Plan }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const master = plan.master;
  if (master === null) return null;
  return (
    <section className={`${PANEL} grid gap-2 p-4`} aria-labelledby="plan-master">
      <h2 id="plan-master" className={SECTION_TITLE}>
        {t('plans.updated.copiedFrom', { name: master.name })}
      </h2>
      {master.updated && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold" data-master-updated>
            {t('plans.updated.mark')}
          </span>
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(true);
            }}
          >
            {t('plans.updated.compare')}
          </Button>
        </div>
      )}
      {open && (
        <CompareDialog
          plan={plan}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </section>
  );
}

function ContentCell({ content }: { content: PlanMasterContent | null }) {
  const { t } = useTranslation();
  if (content === null) return <span className="text-muted-foreground">—</span>;
  const works = [...content.classworks, ...content.homeworks].map((work) => work.title);
  return (
    <div className="grid gap-0.5">
      <span>{content.topic}</span>
      {works.length > 0 && (
        <span className="text-sm text-muted-foreground">
          {t('plans.updated.works', { works: works.join(', ') })}
        </span>
      )}
    </div>
  );
}

/** The side-by-side comparison, matched by identity; take or keep (decision 6). */
function CompareDialog({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const compare = useQuery(planMasterCompareQuery(branchId, plan.journalId, plan.quarterId));
  const answer = useMutation({
    mutationFn: async (take: boolean) => {
      const revision = compare.data?.master.revision;
      if (revision === undefined) return;
      await answerPlanMaster(plan.journalId, { quarterId: plan.quarterId, revision }, take);
      await invalidatePlans(queryClient);
      onClose();
    },
  });
  const title = t('plans.updated.title');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {compare.isError ? (
          <ErrorState
            error={compare.error}
            onRetry={() => {
              void compare.refetch();
            }}
          />
        ) : compare.data === undefined ? (
          <LoadingOutline />
        ) : compare.data.rows.length === 0 ? (
          <EmptyState text={t('plans.updated.nothing')} />
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="text-left">
                <th className="p-2">{t('plans.updated.change')}</th>
                <th className="p-2">{t('plans.updated.master')}</th>
                <th className="p-2">{t('plans.updated.plan')}</th>
              </tr>
            </thead>
            <tbody>
              {compare.data.rows.map((row) => (
                <tr key={row.masterItemId} data-change={row.change} className="align-top">
                  <td className="p-2">
                    {t(`plans.updated.changes.${row.change}`)}
                    {row.held && (
                      <span className="block text-muted-foreground">{t('plans.updated.held')}</span>
                    )}
                  </td>
                  <td className="p-2">
                    <ContentCell content={row.master} />
                  </td>
                  <td className="p-2">
                    <ContentCell content={row.plan} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <FailureAlert error={answer.error} />
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>{t('plans.share.back')}</DialogClose>
          {plan.canEdit && compare.data !== undefined && compare.data.rows.length > 0 && (
            <>
              <Button
                variant="secondary"
                disabled={answer.isPending}
                onClick={() => {
                  answer.mutate(false);
                }}
              >
                {t('plans.updated.keep')}
              </Button>
              <Button
                disabled={answer.isPending}
                onClick={() => {
                  answer.mutate(true);
                }}
              >
                {t('plans.updated.take')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
