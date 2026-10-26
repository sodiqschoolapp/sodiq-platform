import {
  planDropSchema,
  planMergeSchema,
  type Plan,
  type PlanDrop,
  type PlanMerge,
  type PlanOutcome,
  type PlanTrayItem,
} from '@sodiq/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { SelectField, TextAreaField } from '@/components/field';
import { useRecordForm } from '@/components/form/use-record-form';
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
import { schoolDateText } from '@/lib/dates';
import {
  carryNotCovered,
  dropNotCovered,
  invalidatePlans,
  mergeNotCovered,
  placeCarried,
} from './plans-api';

/**
 * The outcomes of "not covered" items and the "carried in" tray (task 9.2d, pull request #233;
 * `edge/lesson-plans`: "Each item gets one outcome: merged into a lesson, carried, or dropped with
 * a reason; only the approver can drop. Carried items wait in a 'carried in' tray on the next
 * quarter's plan."). The server decides who may do what; the page offers what the plan answers
 * (`canEdit`, `canDrop`, `carryClosed`, the rows open now).
 */

type Opened =
  | { readonly kind: 'merge' | 'place' | 'drop'; readonly item: PlanTrayItem }
  | { readonly kind: null };

/** The not-covered list, the tray and the outcomes of the quarter. */
export function NotCoveredSections({ plan }: { plan: Plan }) {
  const [opened, setOpened] = useState<Opened>({ kind: null });
  const close = () => {
    setOpened({ kind: null });
  };
  return (
    <>
      {plan.carriedIn.length > 0 && (
        <ItemsSection
          plan={plan}
          id="plan-carried-in"
          titleKey="plans.outcomes.carriedIn"
          items={plan.carriedIn}
          tray
          onOpen={setOpened}
        />
      )}
      {plan.notCovered.length > 0 && (
        <ItemsSection
          plan={plan}
          id="plan-not-covered"
          titleKey="plans.plan.notCovered"
          items={plan.notCovered}
          tray={false}
          onOpen={setOpened}
        />
      )}
      {plan.outcomes.length > 0 && <Outcomes outcomes={plan.outcomes} />}
      {(opened.kind === 'merge' || opened.kind === 'place') && (
        <RowDialog plan={plan} item={opened.item} kind={opened.kind} onClose={close} />
      )}
      {opened.kind === 'drop' && <DropDialog plan={plan} item={opened.item} onClose={close} />}
    </>
  );
}

function ItemsSection({
  plan,
  id,
  titleKey,
  items,
  tray,
  onOpen,
}: {
  plan: Plan;
  id: string;
  titleKey: 'plans.outcomes.carriedIn' | 'plans.plan.notCovered';
  items: readonly PlanTrayItem[];
  tray: boolean;
  onOpen: (opened: Opened) => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const carry = useMutation({
    mutationFn: (itemId: string) => carryNotCovered(plan.journalId, itemId, plan.quarterId),
    onSuccess: () => invalidatePlans(queryClient),
  });
  const writable = plan.canEdit && plan.rows.some((row) => row.open !== 'none');
  return (
    <section className={`${PANEL} grid gap-2 p-4`} aria-labelledby={id}>
      <h2 id={id} className={SECTION_TITLE}>
        {t(titleKey)}
      </h2>
      <ul className="grid gap-2">
        {items.map((item) => (
          <li key={item.id} data-item={item.id} className="flex flex-wrap items-center gap-2">
            <span>{item.topic}</span>
            {item.notDeliveredFrom !== null && (
              <span className="text-xs text-muted-foreground">
                {t('plans.marks.copyOf', {
                  date: schoolDateText(item.notDeliveredFrom, i18n.language, false),
                })}
              </span>
            )}
            <span className="ml-auto flex flex-wrap gap-2">
              {writable && tray && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onOpen({ kind: 'place', item });
                  }}
                >
                  {t('plans.outcomes.place')}
                </Button>
              )}
              {writable && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onOpen({ kind: 'merge', item });
                  }}
                >
                  {t('plans.outcomes.merge')}
                </Button>
              )}
              {writable && !plan.carryClosed && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={carry.isPending}
                  onClick={() => {
                    void (async () => {
                      const sure = await confirm({
                        title: t('plans.outcomes.carryTitle', { topic: item.topic }),
                        text: t('plans.outcomes.carryText'),
                        action: t('plans.outcomes.carry'),
                      });
                      if (sure) carry.mutate(item.id);
                    })();
                  }}
                >
                  {t('plans.outcomes.carry')}
                </Button>
              )}
              {plan.canDrop && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onOpen({ kind: 'drop', item });
                  }}
                >
                  {t('plans.outcomes.drop')}
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <FailureAlert error={carry.error} />
    </section>
  );
}

/** The outcomes of the quarter, oldest first. */
function Outcomes({ outcomes }: { outcomes: readonly PlanOutcome[] }) {
  const { t, i18n } = useTranslation();
  const what = (outcome: PlanOutcome): string => {
    switch (outcome.kind) {
      case 'merged':
        return t('plans.outcomes.kind.merged', {
          date:
            outcome.targetDate === null
              ? ''
              : schoolDateText(outcome.targetDate, i18n.language, false),
        });
      case 'dropped':
        return t('plans.outcomes.kind.dropped', { reason: outcome.reason });
      case 'carried':
        return outcome.automatic
          ? t('plans.outcomes.kind.carriedAutomatic')
          : t('plans.outcomes.kind.carried');
    }
  };
  return (
    <section className={`${PANEL} grid gap-2 p-4`} aria-labelledby="plan-outcomes">
      <h2 id="plan-outcomes" className={SECTION_TITLE}>
        {t('plans.outcomes.title')}
      </h2>
      <ul className="grid gap-1 text-sm">
        {outcomes.map((outcome) => (
          <li key={outcome.id} data-outcome={outcome.kind}>
            <span className="font-semibold">{outcome.topic}</span>
            {' · '}
            {what(outcome)}
            {outcome.decidedBy !== null && (
              <span className="text-muted-foreground">
                {' · '}
                {outcome.decidedBy}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Merge into a lesson, or place a carried-in item at one: the row is chosen. */
function RowDialog({
  plan,
  item,
  kind,
  onClose,
}: {
  plan: Plan;
  item: PlanTrayItem;
  kind: 'merge' | 'place';
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const done = useRef(false);
  const rows = plan.rows.filter((row) => row.open !== 'none');
  const first = rows[0]?.lessonId ?? '';
  const form = useRecordForm<'lessonId', PlanMerge>({
    schema: planMergeSchema,
    initial: { lessonId: first },
    read: (typed) => {
      // `.claude/rules/web.md`: a choice follows its options.
      const row = rows.find((one) => one.lessonId === typed.lessonId) ?? rows[0];
      return {
        quarterId: plan.quarterId,
        position: row?.number ?? 1,
        lessonId: row?.lessonId ?? typed.lessonId,
        base:
          row?.item == null
            ? null
            : { topic: row.item.topic, objectives: row.item.objectives, links: row.item.links },
      };
    },
    save: async (body) => {
      await (kind === 'merge'
        ? mergeNotCovered(plan.journalId, item.id, body)
        : placeCarried(plan.journalId, item.id, {
            quarterId: body.quarterId,
            position: body.position,
            lessonId: body.lessonId,
          }));
      done.current = true;
      await invalidatePlans(queryClient);
    },
    message: () => t('plans.outcomes.chooseRow'),
  });
  const binding = form.bind('lessonId');
  const title = t(kind === 'merge' ? 'plans.outcomes.mergeTitle' : 'plans.outcomes.placeTitle', {
    topic: item.topic,
  });
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
            label={t('plans.outcomes.row')}
            options={rows.map((row) => ({
              value: row.lessonId,
              label: t(row.item === null ? 'plans.outcomes.rowEmpty' : 'plans.outcomes.rowWith', {
                number: row.number,
                date: schoolDateText(row.date, i18n.language, false),
                topic: row.item?.topic ?? '',
              }),
            }))}
            {...binding}
            value={rows.some((row) => row.lessonId === binding.value) ? binding.value : first}
          />
          <FailureAlert error={form.failure} />
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>{t('plans.share.back')}</DialogClose>
            <Button type="submit" disabled={form.status === 'saving'}>
              {t(kind === 'merge' ? 'plans.outcomes.merge' : 'plans.outcomes.place')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Dropped with a reason; only the approver can drop." */
function DropDialog({
  plan,
  item,
  onClose,
}: {
  plan: Plan;
  item: PlanTrayItem;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const done = useRef(false);
  const form = useRecordForm<'reason', PlanDrop>({
    schema: planDropSchema,
    initial: { reason: '' },
    read: (typed) => ({ quarterId: plan.quarterId, reason: typed.reason }),
    save: async (body) => {
      await dropNotCovered(plan.journalId, item.id, body);
      done.current = true;
      await invalidatePlans(queryClient);
    },
    message: () => t('plans.outcomes.reasonNeeded'),
  });
  const title = t('plans.outcomes.dropTitle', { topic: item.topic });
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
          <TextAreaField label={t('plans.outcomes.reason')} {...form.bind('reason')} />
          <FailureAlert error={form.failure} />
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>{t('plans.share.back')}</DialogClose>
            <Button type="submit" disabled={form.status === 'saving'}>
              {t('plans.outcomes.drop')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
