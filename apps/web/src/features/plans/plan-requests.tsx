import {
  PLAN_REQUEST_DAYS_MAX,
  planRequestCreateSchema,
  planRequestDecisionSchema,
  planWindowExtendSchema,
  type Plan,
  type PlanRequest,
  type PlanRequestCreate,
  type PlanRequestDecision,
} from '@sodiq/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import {
  CHECKED,
  CheckboxField,
  DateField,
  NumberField,
  SelectField,
  TextAreaField,
} from '@/components/field';
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
import { useMayView } from '@/features/access/use-view';
import { momentDateText, schoolDateText } from '@/lib/dates';
import {
  askPlanRequest,
  decidePlanRequest,
  decidePreparedPlanRequest,
  extendPlanWindow,
  finishPlanRequest,
  invalidatePlans,
  sendPlanRequest,
  sendPreparedPlanRequest,
} from './plans-api';

/**
 * The plan window and edit requests on the plan page (task 7.2, pull request
 * #215; `09`, The plan window, Editing after the window; `edge/lesson-plans`,
 * The window and requests). The server decides what is open and who decides;
 * the page shows what it answers.
 */

/** Where the window stands for the plan's owner, and the plan's flag. */
export function WindowLine({ plan }: { plan: Plan }) {
  const { t, i18n } = useTranslation();
  const date = (value: string | null) =>
    value === null ? '' : schoolDateText(value, i18n.language, false);
  return (
    <div className="flex gap-1 text-sm" data-plan-window={plan.window.state}>
      <dt className="text-muted-foreground">{t('plans.window.label')}</dt>
      <dd>
        {t(`plans.window.state.${plan.window.state}`, {
          start: date(plan.window.startDate),
          end: date(plan.window.endDate),
        })}
        {plan.flag !== null && (
          <>
            {' · '}
            <span className="font-semibold">{t(`plans.flag.${plan.flag}`)}</span>
          </>
        )}
      </dd>
    </div>
  );
}

/** The request the system prepared, "Ask to edit" and the requests of the plan. */
export function RequestsSection({ plan }: { plan: Plan }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const deciders = useMayView('plan_requests', 'edit');
  const [open, setOpen] = useState<'ask' | 'decide' | null>(null);
  const dateText = (date: string) => schoolDateText(date, i18n.language, false);
  const request = plan.request;
  const send = useMutation({
    mutationFn: () =>
      request?.id === null || request === null
        ? sendPreparedPlanRequest(plan.journalId, plan.quarterId)
        : sendPlanRequest(request.id),
    onSuccess: () => invalidatePlans(queryClient),
  });
  const confirm = useConfirm();
  const finish = useMutation({
    mutationFn: (id: string) => finishPlanRequest(id),
    onSuccess: () => invalidatePlans(queryClient),
  });
  // The owner asks only while the window is not open for them (review decision 13).
  const mayAsk = plan.canEdit && plan.window.state !== 'open';
  if (request === null && plan.requests.length === 0 && !mayAsk) return null;
  return (
    <section className={`${PANEL} grid gap-3 p-4`} aria-labelledby="plan-requests">
      <h2 id="plan-requests" className={SECTION_TITLE}>
        {t('plans.requests.title')}
      </h2>
      {request !== null && (
        <div className="grid gap-1 text-sm" data-prepared-request={request.id ?? 'window-end'}>
          <p className="font-semibold">{t('plans.plan.request.title')}</p>
          {request.fromDate !== null && (
            <p>{t('plans.plan.request.text', { date: dateText(request.fromDate) })}</p>
          )}
          {request.lessons.length > 0 && (
            <p>
              {t('plans.requests.textLessons', {
                dates: request.lessons.map((one) => dateText(one.date)).join(', '),
              })}
            </p>
          )}
          <ul className="grid gap-1">
            {request.causes.map((cause, index) => (
              <li key={`${cause.kind}|${cause.onDate}|${String(index)}`}>
                {t(`plans.plan.request.${cause.kind}`, {
                  count: cause.items,
                  date: dateText(cause.onDate),
                })}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            {plan.canEdit && (
              <Button
                variant="secondary"
                disabled={send.isPending}
                onClick={() => {
                  send.mutate();
                }}
              >
                {t('plans.requests.send')}
              </Button>
            )}
            {deciders && !plan.canEdit && (
              <Button
                variant="secondary"
                onClick={() => {
                  setOpen('decide');
                }}
              >
                {t('plans.requests.decide')}
              </Button>
            )}
          </div>
          <FailureAlert error={send.error} />
        </div>
      )}
      {mayAsk && (
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              setOpen('ask');
            }}
          >
            {t('plans.requests.ask')}
          </Button>
        </div>
      )}
      {plan.requests.length > 0 && (
        <ul className="grid gap-2 text-sm">
          {plan.requests.map((one) => (
            <li key={one.id} data-plan-request={one.id} className="grid gap-0.5">
              <span>
                <span className="font-semibold">{t(`plans.requests.kind.${one.kind}`)}</span>
                {' · '}
                {t(`plans.requests.status.${one.status}`)}
                {one.open && one.openUntil !== null && (
                  <>
                    {' · '}
                    {t('plans.requests.openUntil', {
                      date: momentDateText(i18n.language, one.openUntil),
                    })}
                  </>
                )}
              </span>
              <RequestLines request={one} />
              {plan.canEdit && one.open && (
                <span>
                  <Button
                    variant="ghost"
                    disabled={finish.isPending}
                    onClick={() => {
                      // `edge`: "press 'finished' to lock early": it cannot be undone.
                      void (async () => {
                        const sure = await confirm({
                          title: t('plans.requests.finishTitle', { unit: plan.unit.name }),
                          text: t('plans.requests.finishText'),
                          action: t('plans.requests.finish'),
                        });
                        if (sure) finish.mutate(one.id);
                      })();
                    }}
                  >
                    {t('plans.requests.finish')}
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <FailureAlert error={finish.error} />
      {open === 'ask' && (
        <AskDialog
          plan={plan}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
      {open === 'decide' && request !== null && (
        <DecideDialog
          lessons={request.lessons}
          replan={request.fromDate !== null}
          decide={(decision) =>
            request.id === null
              ? decidePreparedPlanRequest(plan.journalId, plan.quarterId, decision)
              : decidePlanRequest(request.id, decision)
          }
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </section>
  );
}

/** The lessons, first lesson and reasons of a request. */
export function RequestLines({ request }: { request: PlanRequest }) {
  const { t, i18n } = useTranslation();
  const dateText = (date: string) => schoolDateText(date, i18n.language, false);
  return (
    <>
      {request.fromDate !== null && (
        <span>{t('plans.requests.from', { date: dateText(request.fromDate) })}</span>
      )}
      {request.lessons.length > 0 && (
        <span>
          {t('plans.requests.textLessons', {
            dates: request.lessons
              .map((one) =>
                one.approved
                  ? dateText(one.date)
                  : t('plans.requests.unticked', { date: dateText(one.date) }),
              )
              .join(', '),
          })}
        </span>
      )}
      {request.reason !== '' && (
        <span className="text-muted-foreground">
          {t('plans.requests.reason', { reason: request.reason })}
        </span>
      )}
      {request.decisionReason !== '' && (
        <span className="text-muted-foreground">
          {t('plans.requests.decisionReason', { reason: request.decisionReason })}
        </span>
      )}
    </>
  );
}

/** The lesson chosen when it is among `rows`, else the first of them. */
const offered = (rows: Plan['rows'], lessonId: string): string =>
  rows.some((row) => row.lessonId === lessonId) ? lessonId : (rows[0]?.lessonId ?? lessonId);

type AskField = 'kind' | 'from' | 'to' | 'reason';

/**
 * "Ask to edit" (`09`: "The teacher sends an edit request: which lessons, and
 * the reason"; `edge`: "There are two kinds of request. 'Text' ... 'Re-plan'
 * ... Lessons already held take only Text"). Text names the lessons from one
 * row to another; Re-plan its first lesson not yet held.
 */
function AskDialog({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const done = useRef(false);
  const first = plan.rows[0]?.lessonId ?? '';
  const ahead = plan.rows.filter((row) => !row.started);
  const form = useRecordForm<AskField, PlanRequestCreate>({
    schema: planRequestCreateSchema,
    initial: { kind: 'text', from: first, to: first, reason: '' },
    read: (typed) => {
      if (typed.kind === 'replan') {
        return {
          kind: 'replan',
          quarterId: plan.quarterId,
          fromLessonId: offered(ahead, typed.from),
          reason: typed.reason,
        };
      }
      const from = plan.rows.findIndex((row) => row.lessonId === typed.from);
      const to = plan.rows.findIndex((row) => row.lessonId === typed.to);
      const [low, high] = from <= to ? [from, to] : [to, from];
      return {
        kind: 'text',
        quarterId: plan.quarterId,
        lessonIds: plan.rows.slice(Math.max(low, 0), high + 1).map((row) => row.lessonId),
        reason: typed.reason,
      };
    },
    save: async (body) => {
      await askPlanRequest(plan.journalId, body);
      done.current = true;
      await invalidatePlans(queryClient);
    },
    message: (field) => (field === 'reason' ? t('plans.requests.reasonNeeded') : undefined),
  });
  const kind = form.bind('kind').value;
  // `.claude/rules/web.md`: a choice follows its options. Re-plan offers the
  // lessons not yet held only, so a held first lesson kept from Text falls back.
  const fromOptions = kind === 'replan' ? ahead : plan.rows;
  const fromBinding = form.bind('from');
  const rowLabel = (row: Plan['rows'][number]) =>
    t('plans.requests.rowOption', {
      number: row.number,
      date: schoolDateText(row.date, i18n.language, false),
    });
  const title = t('plans.requests.askTitle');
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
            label={t('plans.requests.kindLabel')}
            options={[
              { value: 'text', label: t('plans.requests.kind.text') },
              ...(ahead.length > 0
                ? [{ value: 'replan', label: t('plans.requests.kind.replan') }]
                : []),
            ]}
            {...form.bind('kind')}
          />
          <SelectField
            label={t(kind === 'replan' ? 'plans.requests.fromLabel' : 'plans.requests.firstLabel')}
            options={fromOptions.map((row) => ({
              value: row.lessonId,
              label: rowLabel(row),
            }))}
            {...fromBinding}
            value={offered(fromOptions, fromBinding.value)}
          />
          {kind !== 'replan' && (
            <SelectField
              label={t('plans.requests.lastLabel')}
              options={plan.rows.map((row) => ({ value: row.lessonId, label: rowLabel(row) }))}
              {...form.bind('to')}
            />
          )}
          <TextAreaField label={t('plans.requests.reasonLabel')} {...form.bind('reason')} />
          <FailureAlert error={form.failure} />
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>{t('plans.share.back')}</DialogClose>
            <Button type="submit" disabled={form.status === 'saving'}>
              {t('plans.requests.send')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Approve or refuse (`edge`: "The days are school days, from 1 to 10. The
 * approver can untick lessons, giving a reason. A refusal changes nothing").
 */
export function DecideDialog({
  lessons,
  replan,
  decide,
  onClose,
}: {
  lessons: readonly { lessonId: string; date: string }[];
  replan: boolean;
  decide: (decision: PlanRequestDecision) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const done = useRef(false);
  const keepKeys = lessons.map((_, index) => `keep${String(index)}`);
  const form = useRecordForm<string, PlanRequestDecision>({
    schema: planRequestDecisionSchema,
    initial: {
      decision: 'approve',
      days: '1',
      reason: '',
      ...Object.fromEntries(keepKeys.map((key) => [key, CHECKED])),
    },
    read: (typed) => {
      if (typed.decision === 'refuse') return { decision: 'refuse', reason: typed.reason ?? '' };
      const untick = lessons.flatMap((one, index) =>
        typed[`keep${String(index)}`] === CHECKED
          ? []
          : [{ lessonId: one.lessonId, reason: typed.reason ?? '' }],
      );
      return {
        decision: 'approve',
        days: Number(typed.days),
        ...(untick.length > 0 ? { untick } : {}),
      };
    },
    save: async (decision) => {
      await decide(decision);
      done.current = true;
      await invalidatePlans(queryClient);
    },
    message: (field) =>
      field === 'days'
        ? t('plans.requests.daysRange', { max: PLAN_REQUEST_DAYS_MAX })
        : t('plans.requests.reasonNeeded'),
  });
  const decision = form.bind('decision').value;
  const title = t('plans.requests.decideTitle');
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
            label={t('plans.requests.decisionLabel')}
            options={[
              { value: 'approve', label: t('plans.requests.approve') },
              { value: 'refuse', label: t('plans.requests.refuse') },
            ]}
            {...form.bind('decision')}
          />
          {decision === 'approve' && (
            <NumberField label={t('plans.requests.daysLabel')} {...form.bind('days')} />
          )}
          {decision === 'approve' &&
            lessons.map((one, index) => (
              <CheckboxField
                key={one.lessonId}
                label={t('plans.requests.keepLesson', {
                  date: schoolDateText(one.date, i18n.language, false),
                })}
                {...form.bind(keepKeys[index] ?? '')}
              />
            ))}
          {decision === 'approve' && replan && (
            <p className="text-sm text-muted-foreground">{t('plans.requests.replanNote')}</p>
          )}
          <TextAreaField
            label={t(
              decision === 'refuse' ? 'plans.requests.refuseReason' : 'plans.requests.untickReason',
            )}
            {...form.bind('reason')}
          />
          <FailureAlert error={form.failure} />
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>{t('plans.share.back')}</DialogClose>
            <Button type="submit" disabled={form.status === 'saving'}>
              {t(decision === 'refuse' ? 'plans.requests.refuse' : 'plans.requests.approve')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "The Academic Vice Principal can extend the window for one teacher"
 * (`09`): a later end for the plan's owner; after the window ended the server
 * records it as an approved request (`edge`).
 */
export function ExtendWindow({ plan }: { plan: Plan }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const editors = useMayView('plan_windows', 'edit');
  const [open, setOpen] = useState(false);
  const done = useRef(false);
  const form = useRecordForm<'endDate', { staffId: string; endDate: string }>({
    schema: planWindowExtendSchema,
    initial: { endDate: plan.window.endDate ?? '' },
    read: (typed) => ({ staffId: plan.ownerStaffId ?? '', endDate: typed.endDate }),
    save: async (body) => {
      await extendPlanWindow(plan.quarterId, body);
      done.current = true;
      await invalidatePlans(queryClient);
    },
  });
  if (!editors || plan.ownerStaffId === null || plan.window.state === 'not_opened') return null;
  const title = t('plans.windows.extendTitle', { name: plan.owner ?? '' });
  const send = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await form.submit();
    if (done.current) setOpen(false);
  };
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          done.current = false;
          setOpen(true);
        }}
      >
        {t('plans.windows.extend')}
      </Button>
      {open && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) setOpen(false);
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
              <DateField label={t('plans.windows.end')} {...form.bind('endDate')} />
              <FailureAlert error={form.failure} />
              <DialogFooter>
                <DialogClose render={<Button variant="ghost" />}>
                  {t('plans.share.back')}
                </DialogClose>
                <Button type="submit" disabled={form.status === 'saving'}>
                  {t('plans.windows.extend')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
