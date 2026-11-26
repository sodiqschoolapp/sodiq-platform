import {
  PERMISSIONS,
  pastMarkWithdrawBodySchema,
  permits,
  type PastMarkUpload,
  type PastMarkWithdrawBody,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { TextAreaField } from '@/components/field';
import { useRecordForm } from '@/components/form/use-record-form';
import { ListPage } from '@/components/list/list-page';
import type { Column, ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/states';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useView } from '@/features/access/use-view';
import { formatMoment } from '@/lib/dates';
import { pastMarkUploadsKey, pastMarkUploadsQuery, withdrawPastMarks } from './past-marks-api';

/**
 * The uploads of past marks from before go-live of the branch (task 11.26; `10`, The upload: "The
 * import page lists the uploads: file name, who, when, the number of rows, and whether it stands
 * or was withdrawn"), and the withdrawal of a whole upload with a reason (`10`, Withdrawal). The
 * marks themselves are for parents only and are never shown here.
 */
export function PastMarksPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search: ListSearch = useSearch({ from: '/app/setup/past-marks' });
  const { role, branchId } = useView();
  const mayView = role !== null && permits(PERMISSIONS, role, 'past_marks', 'view');
  const mayImport = role !== null && permits(PERMISSIONS, role, 'past_marks', 'create');
  const mayWithdraw = role !== null && permits(PERMISSIONS, role, 'past_marks', 'archive');
  const uploads = useQuery({
    ...pastMarkUploadsQuery(branchId),
    enabled: mayView && branchId !== null,
  });
  const [withdrawing, setWithdrawing] = useState<PastMarkUpload | null>(null);

  const who = (named: PastMarkUpload['confirmedBy']) => named.name ?? named.login ?? '—';
  const state = (upload: PastMarkUpload) =>
    upload.withdrawn === null ? t('setup.pastMarks.standing') : t('setup.pastMarks.withdrawn');

  const columns = useMemo(
    (): Column<PastMarkUpload>[] => [
      {
        key: 'file',
        header: t('setup.pastMarks.fileName'),
        cell: (row) => row.fileName,
        sortValue: (row) => row.fileName,
        searchText: (row) => row.fileName,
      },
      {
        key: 'by',
        header: t('setup.pastMarks.by'),
        cell: (row) => who(row.confirmedBy),
        sortValue: (row) => who(row.confirmedBy),
      },
      {
        key: 'at',
        header: t('setup.pastMarks.at'),
        cell: (row) => formatMoment(i18n.language, row.confirmedAt),
        sortValue: (row) => row.confirmedAt,
      },
      {
        key: 'rows',
        header: t('setup.pastMarks.rows'),
        cell: (row) => row.rowCount,
        sortValue: (row) => row.rowCount,
        numeric: true,
      },
      {
        key: 'state',
        header: t('setup.pastMarks.state'),
        cell: state,
        sortValue: state,
      },
    ],
    // `who` and `state` read only `t`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, i18n.language],
  );

  if (!mayView) {
    return (
      <>
        <PageHeader title={t('setup.pastMarks.title')} />
        <EmptyState title={t('setup.pastMarks.title')} text={t('problems.noAccessPart')} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('setup.pastMarks.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('setup.title'), to: '/setup' },
        ]}
        actions={
          mayImport ? (
            <Link to="/setup/past-marks/import" className={buttonVariants()}>
              {t('setup.pastMarks.import')}
            </Link>
          ) : undefined
        }
      />
      <ListPage
        listId="past-mark-uploads"
        caption={t('setup.pastMarks.title')}
        rows={uploads.data?.uploads}
        error={uploads.isError ? uploads.error : undefined}
        onRetry={() => {
          void uploads.refetch();
        }}
        rowId={(row) => row.id}
        rowName={(row) => row.fileName}
        columns={columns}
        search={search}
        onSearchChange={(next: ListSearch, how) => {
          void navigate({ to: '/setup/past-marks', search: next, replace: how === 'replace' });
        }}
        empty={{ title: t('setup.pastMarks.emptyTitle'), text: t('setup.pastMarks.empty') }}
        panel={(row) => (
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">{t('setup.pastMarks.fileName')}</dt>
              <dd>{row.fileName}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('setup.pastMarks.by')}</dt>
              <dd>
                {who(row.confirmedBy)}, {formatMoment(i18n.language, row.confirmedAt)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('setup.pastMarks.rows')}</dt>
              <dd>{row.rowCount}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('setup.pastMarks.state')}</dt>
              <dd>{state(row)}</dd>
            </div>
            {row.withdrawn !== null && (
              <div>
                <dt className="text-muted-foreground">{t('setup.pastMarks.reason')}</dt>
                <dd>
                  {row.withdrawn.reason} ({who(row.withdrawn.by)},{' '}
                  {formatMoment(i18n.language, row.withdrawn.at)})
                </dd>
              </div>
            )}
            {row.withdrawn === null && mayWithdraw && (
              <div>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setWithdrawing(row);
                  }}
                >
                  {t('setup.pastMarks.withdraw')}
                </Button>
              </div>
            )}
          </dl>
        )}
      />
      {withdrawing !== null && branchId !== null && (
        <WithdrawDialog
          upload={withdrawing}
          branchId={branchId}
          onClose={() => {
            setWithdrawing(null);
          }}
        />
      )}
    </>
  );
}

/** The withdrawal of an upload with its reason: a dialog that sends once (`.claude/rules/web.md`). */
function WithdrawDialog({
  upload,
  branchId,
  onClose,
}: {
  upload: PastMarkUpload;
  branchId: string;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const withdraw = useMutation({
    mutationFn: (body: PastMarkWithdrawBody) => withdrawPastMarks(upload.id, body),
    onSuccess: (answer) => {
      queryClient.setQueryData(pastMarkUploadsKey(branchId), answer);
    },
  });
  const done = useRef(false);
  const form = useRecordForm<'reason', PastMarkWithdrawBody>({
    schema: pastMarkWithdrawBodySchema,
    initial: { reason: '' },
    save: async (body) => {
      await withdraw.mutateAsync(body);
      done.current = true;
    },
    message: (field) => (field === 'reason' ? t('setup.pastMarks.reasonNeeded') : undefined),
  });
  const element = useRef<HTMLFormElement>(null);
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const checked = await form.submit();
    if (!checked) {
      element.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    if (done.current) onClose();
  };
  const title = t('setup.pastMarks.withdrawTitle', { name: upload.fileName });
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
          ref={element}
          aria-label={title}
          className="grid gap-4"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <p className="text-sm">{t('setup.pastMarks.withdrawText', { count: upload.rowCount })}</p>
          <TextAreaField label={t('setup.pastMarks.reason')} rows={3} {...form.bind('reason')} />
          <FailureAlert error={form.failure} />
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>
              {t('setup.pastMarks.keep')}
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={form.status === 'saving'}>
              {t('setup.pastMarks.withdraw')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
