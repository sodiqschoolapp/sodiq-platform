import type { Language, ParentSlipList, PrintedParentSlips } from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { ListPage } from '@/components/list/list-page';
import type { Column, ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useView } from '@/features/access/use-view';
import { LANGUAGE_NAMES, LANGUAGES, isLanguage } from '@/i18n/languages';
import { branchQuery } from '@/features/setup/setup-api';
import { momentText } from '@/lib/dates';
import { parentSlipsKey, parentSlipsQuery, printParentSlips } from './parent-accounts-api';
import { ParentSlipsSheet } from './parent-slip';

type Row = ParentSlipList['relatives'][number];

/**
 * The slips of a class (task 11.1; `edge/close-relatives`, first passwords): each relative
 * linked with portal access on to a student of the class, to print, with a valid slip (its
 * class and date, or "another branch"), or signed in. Print gives a slip to everyone to print;
 * "Print again" on ticked rows replaces the earlier password. The server decides; the page
 * shows its answer.
 */
export function ParentSlipsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { classId } = useParams({ from: '/app/people/classes/$classId/parent-slips' });
  const search = useSearch({ from: '/app/people/classes/$classId/parent-slips' });
  const { branchId } = useView();
  const list = useQuery(parentSlipsQuery(branchId, classId));
  const branch = useQuery(branchQuery(branchId));
  const [language, setLanguage] = useState<Language>(
    isLanguage(i18n.language) ? i18n.language : 'uz',
  );
  const [printed, setPrinted] = useState<PrintedParentSlips | null>(null);
  // The passwords are held by the page alone (`.claude/rules/web.md`: a secret answered once).
  const print = useMutation({
    gcTime: 0,
    mutationFn: (printAgain: string[]) => printParentSlips(classId, language, printAgain),
    onSuccess: (answer) => {
      setPrinted(answer);
      print.reset();
      void queryClient.invalidateQueries({ queryKey: parentSlipsKey(branchId, classId) });
    },
  });

  // A day shown from a stored moment is the branch's (`.claude/rules/database.md`, task 9.4g).
  const timeZone = branch.data?.timeZone;
  const dateOf = (iso: string) =>
    momentText(i18n.language, iso, {
      month: 'long',
      ...(timeZone === undefined ? {} : { timeZone }),
    });
  const stateText = (row: Row): string => {
    if (row.state !== 'valid_slip' || row.slip === null) {
      return t(`people.parentSlips.${row.state}`);
    }
    const date = dateOf(row.slip.printedAt);
    const where =
      row.slip.kind === 'reset'
        ? t('people.parentSlips.resetSlip', { date })
        : row.slip.otherBranch || row.slip.className === null
          ? t('people.parentSlips.otherBranch', { date })
          : t('people.parentSlips.printedIn', { class: row.slip.className, date });
    return `${t('people.parentSlips.valid_slip')}: ${where}`;
  };

  const columns = useMemo(
    (): Column<Row>[] => [
      {
        key: 'relative',
        header: t('people.parentSlips.relative'),
        cell: (row) => row.fullName,
        sortValue: (row) => row.fullName,
        searchText: (row) =>
          `${row.fullName} ${row.login ?? ''} ${row.children.map((child) => `${child.lastName} ${child.firstName}`).join(' ')}`,
        fixed: true,
      },
      {
        key: 'children',
        header: t('people.parentSlips.children'),
        cell: (row) =>
          row.children.map((child) => `${child.lastName} ${child.firstName}`).join(', '),
        sortValue: (row) => row.children[0]?.lastName ?? '',
      },
      {
        key: 'login',
        header: t('people.parentSlips.login'),
        cell: (row) => row.login ?? '',
        sortValue: (row) => row.login ?? '',
      },
      {
        key: 'state',
        header: t('people.parentSlips.state'),
        cell: stateText,
        sortValue: (row) => row.state,
      },
    ],
    // `stateText` reads only `t` and the language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, i18n.language, timeZone],
  );

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({
      to: '/people/classes/$classId/parent-slips',
      params: { classId },
      search: next,
      replace: how === 'replace',
    });
  };

  const title =
    list.data === undefined
      ? t('people.parentSlips.title')
      : t('people.parentSlips.pageTitle', { class: list.data.className });

  return (
    <>
      <PageHeader
        title={title}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('classes.title'), to: '/classes' },
        ]}
        actions={
          printed === null ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid gap-1 text-sm">
                <span>{t('people.parentSlips.language')}</span>
                <Select
                  value={language}
                  onChange={(event) => {
                    if (isLanguage(event.target.value)) {
                      setLanguage(event.target.value);
                    }
                  }}
                >
                  {LANGUAGES.map((one) => (
                    <option key={one} value={one}>
                      {LANGUAGE_NAMES[one]}
                    </option>
                  ))}
                </Select>
              </label>
              <Button
                disabled={print.isPending || list.data === undefined}
                onClick={() => {
                  print.mutate([]);
                }}
              >
                {t('people.parentSlips.printSlips')}
              </Button>
            </div>
          ) : undefined
        }
      />
      {print.isError ? <FailureAlert error={print.error} /> : null}
      {printed !== null ? (
        printed.slips.length === 0 ? (
          <div className="grid gap-2">
            <p role="status">{t('people.parentSlips.nothingToPrint')}</p>
            <div>
              <Button
                variant="secondary"
                onClick={() => {
                  setPrinted(null);
                }}
              >
                {t('people.parentSlips.back')}
              </Button>
            </div>
          </div>
        ) : (
          <ParentSlipsSheet
            answer={printed}
            onDone={() => {
              setPrinted(null);
            }}
          />
        )
      ) : (
        <ListPage
          listId="parent-slips"
          caption={t('people.parentSlips.caption')}
          rows={list.data?.relatives}
          error={list.error ?? undefined}
          onRetry={() => {
            void list.refetch();
          }}
          rowId={(row) => row.relativeId}
          rowName={(row) => row.fullName}
          columns={columns}
          search={search}
          onSearchChange={open}
          empty={{
            title: t('people.parentSlips.emptyTitle'),
            text: t('people.parentSlips.empty'),
          }}
          bulkActions={[
            {
              key: 'print-again',
              label: t('people.parentSlips.printAgain'),
              run: (rows) => {
                print.mutate(rows.map((row) => row.relativeId));
              },
              confirm: () => ({
                title: t('people.parentSlips.confirmTitle'),
                text: t('people.parentSlips.confirmText'),
                action: t('people.parentSlips.confirmAction'),
                destructive: true,
              }),
            },
          ]}
        />
      )}
    </>
  );
}
