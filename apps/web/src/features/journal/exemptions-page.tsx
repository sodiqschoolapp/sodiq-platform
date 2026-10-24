import {
  EXEMPTION_CATEGORIES,
  EXEMPTION_DETAIL_MAX,
  EXEMPTION_FILE_TYPES,
  EXEMPTION_VOID_REASON_MAX,
  exemptionCreateSchema,
  type Exemption,
  type ExemptionAbsence,
  type ExemptionChoice,
  type ExemptionCreate,
  type ExemptionMoveOffer,
  type ExemptionPreview,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import {
  CheckboxGroupField,
  DateField,
  Field,
  SelectField,
  TextAreaField,
  listValues,
} from '@/components/field';
import { useRecordForm } from '@/components/form/use-record-form';
import { ListPage } from '@/components/list/list-page';
import { listSearch, type Column, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Segmented } from '@/components/ui/segmented';
import { useMayView, useView } from '@/features/access/use-view';
import { classMembersQuery, classesQuery } from '@/features/classes/classes-api';
import { nameOf } from '@/features/setup/setup-api';
import { subjectsQuery } from '@/features/setup/subjects-api';
import { momentText, schoolDateText } from '@/lib/dates';
import {
  confirmOffer,
  createExemptions,
  downloadDocument,
  dropOffer,
  endExemption,
  exemptionAbsencesQuery,
  exemptionOffersQuery,
  exemptionsQuery,
  invalidateExemptions,
  openOfferReason,
  openReason,
  previewConfirm,
  previewCreate,
  previewEnd,
  previewVoid,
  putDocument,
  removeDocument,
  voidBatch,
  voidExemption,
} from './exemptions-api';

const VIEWS = ['list', 'absences', 'offers'] as const;

type View = (typeof VIEWS)[number];

export type ExemptionsSearch = ListSearch & { view?: View };

export function exemptionsSearch(search: Record<string, unknown>): ExemptionsSearch {
  const result: ExemptionsSearch = listSearch(search);
  const view = search.view;
  if (typeof view === 'string' && (VIEWS as readonly string[]).includes(view)) {
    result.view = view as View;
  }
  return result;
}

const studentName = (student: Exemption['student']) =>
  [student.lastName, student.firstName].filter(Boolean).join(' ');

/** The dates of an exemption as read: one day with its slots, or from and to. */
function useDatesText() {
  const { t, i18n } = useTranslation();
  return (one: {
    startDate: string;
    endDate: string;
    slots: { start: string; end: string } | null;
  }) =>
    one.slots !== null
      ? t('journal.exemptions.slotsLine', {
          date: schoolDateText(one.startDate, i18n.language),
          start: one.slots.start,
          end: one.slots.end,
        })
      : one.startDate === one.endDate
        ? schoolDateText(one.startDate, i18n.language)
        : t('journal.exemptions.datesLine', {
            from: schoolDateText(one.startDate, i18n.language),
            to: schoolDateText(one.endDate, i18n.language),
          });
}

/**
 * The Exemptions page (task 8.5, pull request #223; `07`, Problem cases:
 * "An Exemptions page lists all of them with filters (class, kind, subject,
 * in force, ending this week), each with its reason, document and who granted
 * it"; `edge/exemptions`, rows 8 to 10 and 12). The Academic Vice Principal and
 * the Super Admin enter and change them, the Principal reads.
 */
export function ExemptionsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search: ExemptionsSearch = useSearch({ from: '/app/journal/exemptions' });
  const { branchId } = useView();
  const mayCreate = useMayView('exemptions', 'create');
  const view: View = search.view ?? 'list';
  const list = useQuery({
    ...exemptionsQuery(branchId),
    enabled: branchId !== null && view === 'list',
  });
  const [creating, setCreating] = useState<{ studentId?: string; date?: string } | null>(null);
  const language = i18n.language;
  const datesText = useDatesText();
  const go = (next: ExemptionsSearch, how: 'push' | 'replace' = 'push') => {
    void navigate({ to: '/journal/exemptions', search: next, replace: how === 'replace' });
  };
  const columns = useMemo(
    (): Column<Exemption>[] => [
      {
        key: 'student',
        header: t('journal.exemptions.student'),
        cell: (row) => studentName(row.student),
        sortValue: (row) => studentName(row.student),
        searchText: (row) => `${studentName(row.student)} ${row.student.uid}`,
        opens: true,
        fixed: true,
      },
      {
        key: 'class',
        header: t('journal.exemptions.class'),
        cell: (row) => row.student.className ?? '—',
        sortValue: (row) => row.student.className,
        searchText: (row) => row.student.className ?? '',
      },
      {
        key: 'kind',
        header: t('journal.exemptions.kind'),
        cell: (row) => t(`journal.exemptions.kinds.${row.kind}`),
        sortValue: (row) => row.kind,
      },
      {
        key: 'dates',
        header: t('journal.exemptions.dates'),
        cell: (row) => datesText(row),
        sortValue: (row) => row.startDate,
      },
      {
        key: 'scope',
        header: t('journal.exemptions.scope'),
        cell: (row) =>
          row.subjects === null
            ? t('journal.exemptions.allSubjects')
            : row.subjects.map((one) => nameOf(one.name, language)).join(', '),
      },
      {
        key: 'category',
        header: t('journal.exemptions.category'),
        cell: (row) => t(`journal.exemptions.categories.${row.category}`),
        sortValue: (row) => row.category,
        narrow: true,
      },
      {
        key: 'state',
        header: t('journal.exemptions.state'),
        cell: (row) => t(`journal.exemptions.states.${row.state}`),
        sortValue: (row) => row.state,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `datesText` follows `t` and `language`.
    [t, language],
  );
  const filters = useMemo(
    () => [
      {
        key: 'state',
        label: t('journal.exemptions.state'),
        options: (['in_force', 'coming', 'ended', 'voided'] as const).map((value) => ({
          value,
          label: t(`journal.exemptions.states.${value}`),
        })),
        matches: (row: Exemption, value: string) => row.state === value,
      },
      {
        key: 'kind',
        label: t('journal.exemptions.kind'),
        options: (['temporary', 'full'] as const).map((value) => ({
          value,
          label: t(`journal.exemptions.kinds.${value}`),
        })),
        matches: (row: Exemption, value: string) => row.kind === value,
      },
    ],
    [t],
  );
  return (
    <>
      <PageHeader
        title={t('journal.exemptions.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('journal.page.title'), to: '/journal' },
        ]}
        actions={
          mayCreate ? (
            <Button
              onClick={() => {
                setCreating({});
              }}
            >
              {t('journal.exemptions.new')}
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-4">
        <Segmented
          label={t('journal.exemptions.views')}
          options={VIEWS.map((one) => ({ value: one, label: t(`journal.exemptions.view.${one}`) }))}
          value={view}
          onChange={(value) => {
            go({ view: value });
          }}
        />
        {view === 'list' &&
          (list.isError ? (
            <ErrorState
              error={list.error}
              onRetry={() => {
                void list.refetch();
              }}
            />
          ) : (
            <ListPage
              listId="journal-exemptions"
              caption={t('journal.exemptions.caption')}
              rows={list.data?.items}
              rowId={(row) => row.id}
              rowName={(row) => `${studentName(row.student)} · ${datesText(row)}`}
              columns={columns}
              filters={filters}
              search={search}
              onSearchChange={(next: ListSearch, how) => {
                go({ ...next, view }, how);
              }}
              panel={(row) => <ExemptionPanel key={row.id} exemption={row} />}
              empty={{
                title: t('journal.exemptions.emptyTitle'),
                text: t('journal.exemptions.empty'),
              }}
            />
          ))}
        {view === 'absences' && (
          <AbsencesView
            search={search}
            onSearchChange={(next, how) => {
              go({ ...next, view }, how);
            }}
            onCreate={
              mayCreate
                ? (absence) => {
                    setCreating({ studentId: absence.student.id, date: absence.date });
                  }
                : null
            }
          />
        )}
        {view === 'offers' && (
          <OffersView
            search={search}
            onSearchChange={(next, how) => {
              go({ ...next, view }, how);
            }}
          />
        )}
      </div>
      {creating !== null && (
        <ExemptionFormDialog
          initialStudent={creating.studentId ?? null}
          initialDate={creating.date ?? null}
          onClose={() => {
            setCreating(null);
          }}
        />
      )}
    </>
  );
}

/** The detail of an exemption, its reason opened on a click, its document and its changes. */
function ExemptionPanel({ exemption }: { exemption: Exemption }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const mayEdit = useMayView('exemptions', 'edit');
  const datesText = useDatesText();
  const language = i18n.language;
  const [reason, setReason] = useState<string | null>(null);
  const [changing, setChanging] = useState<'end' | 'void' | 'batch' | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const opened = useMutation({
    mutationFn: () => openReason(exemption.id),
    onSuccess: (answer) => {
      setReason(answer.detail);
    },
  });
  const download = useMutation({
    mutationFn: () => downloadDocument(exemption.id, exemption.document?.name ?? 'document'),
  });
  const upload = useMutation({
    mutationFn: (chosen: File) => putDocument(exemption.id, chosen),
    onSuccess: () => invalidateExemptions(queryClient),
  });
  const remove = useMutation({
    mutationFn: async () => {
      const went = await confirm({
        title: t('journal.exemptions.removeDocument'),
        names: [exemption.document?.name ?? ''],
        action: t('journal.exemptions.removeDocument'),
        destructive: true,
      });
      if (!went) return null;
      return removeDocument(exemption.id);
    },
    onSuccess: () => invalidateExemptions(queryClient),
  });
  const live = exemption.state !== 'voided';
  return (
    <div className="grid gap-3 text-sm">
      <p>
        <span className="font-semibold">{t(`journal.exemptions.kinds.${exemption.kind}`)}</span>
        {' · '}
        {datesText(exemption)}
        {' · '}
        {t(`journal.exemptions.states.${exemption.state}`)}
      </p>
      <p>
        {exemption.subjects === null
          ? t('journal.exemptions.allSubjects')
          : exemption.subjects.map((one) => nameOf(one.name, language)).join(', ')}
      </p>
      <p>
        {t('journal.exemptions.categoryLine', {
          category: t(`journal.exemptions.categories.${exemption.category}`),
        })}
      </p>
      <p>
        {t('journal.exemptions.granted', {
          name: exemption.grantedBy.name ?? exemption.grantedBy.login ?? '—',
          at: momentText(language, exemption.grantedAt),
        })}
      </p>
      {exemption.endCause !== null && (
        <p>{t(`journal.exemptions.endCauses.${exemption.endCause}`)}</p>
      )}
      {exemption.voided !== null && (
        <p>
          {t('journal.exemptions.voidedLine', {
            name: exemption.voided.by.name ?? exemption.voided.by.login ?? '—',
            at: momentText(language, exemption.voided.at),
          })}
          {exemption.voided.reason !== null && (
            <span className="ml-1">{exemption.voided.reason}</span>
          )}
        </p>
      )}
      <div>
        {reason === null ? (
          <Button
            variant="ghost"
            disabled={opened.isPending}
            onClick={() => {
              opened.mutate();
            }}
          >
            {t('journal.exemptions.showReason')}
          </Button>
        ) : (
          <p className="whitespace-pre-wrap">{reason}</p>
        )}
        <FailureAlert error={opened.error} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {exemption.document !== null && (
          <Button
            variant="ghost"
            disabled={download.isPending}
            onClick={() => {
              download.mutate();
            }}
          >
            {t('journal.exemptions.openDocument', { name: exemption.document.name })}
          </Button>
        )}
        {mayEdit && live && (
          <>
            <input
              ref={file}
              type="file"
              className="hidden"
              accept={EXEMPTION_FILE_TYPES.join(',')}
              aria-label={t('journal.exemptions.attachDocument')}
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (chosen !== undefined) upload.mutate(chosen);
                event.target.value = '';
              }}
            />
            <Button
              variant="secondary"
              disabled={upload.isPending}
              onClick={() => {
                file.current?.click();
              }}
            >
              {t('journal.exemptions.attachDocument')}
            </Button>
            {exemption.document !== null && (
              <Button
                variant="ghost"
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate();
                }}
              >
                {t('journal.exemptions.removeDocument')}
              </Button>
            )}
          </>
        )}
      </div>
      <FailureAlert error={download.error ?? upload.error ?? remove.error} />
      {mayEdit && live && (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setChanging('end');
            }}
          >
            {t('journal.exemptions.end')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setChanging('void');
            }}
          >
            {t('journal.exemptions.void')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setChanging('batch');
            }}
          >
            {t('journal.exemptions.voidBatch')}
          </Button>
        </div>
      )}
      {changing !== null && (
        <ChangeDialog
          exemption={exemption}
          change={changing}
          onClose={() => {
            setChanging(null);
          }}
        />
      )}
    </div>
  );
}

/** The lessons a change touches, with a choice where the server asks one. */
function PreviewLines({
  preview,
  names,
  choices,
  onChoose,
}: {
  preview: ExemptionPreview;
  names: ReadonlyMap<string, string>;
  choices: ReadonlyMap<string, ExemptionChoice['choice']>;
  onChoose: (studentId: string, lessonId: string, choice: ExemptionChoice['choice']) => void;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const lessonText = (lesson: ExemptionPreview['students'][number]['auto'][number]) =>
    t('journal.exemptions.lessonLine', {
      date: schoolDateText(lesson.date, language, false),
      start: lesson.start,
      subject: nameOf(lesson.subject, language),
    });
  const lines = preview.students.filter(
    (one) => one.auto.length + one.choose.length + one.reopen.length > 0 || one.overlap !== null,
  );
  if (lines.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('journal.exemptions.noLessons')}</p>;
  }
  return (
    <ul className="grid gap-3 text-sm">
      {lines.map((one) => (
        <li key={one.studentId} className="grid gap-1">
          <span className="font-semibold">{names.get(one.studentId) ?? '—'}</span>
          {one.overlap !== null && (
            <span role="alert">
              {one.overlap.exemption === null
                ? t('journal.exemptions.overlapElsewhere')
                : t('journal.exemptions.overlap', {
                    dates: t('journal.exemptions.datesLine', {
                      from: schoolDateText(one.overlap.exemption.startDate, language),
                      to: schoolDateText(one.overlap.exemption.endDate, language),
                    }),
                  })}
            </span>
          )}
          {one.auto.length > 0 && (
            <span>{t('journal.exemptions.auto', { count: one.auto.length })}</span>
          )}
          {one.choose.map((lesson) => {
            const key = `${one.studentId}|${lesson.lessonId}`;
            return (
              <fieldset key={lesson.lessonId} className="flex flex-wrap items-center gap-3">
                <legend className="sr-only">{lessonText(lesson)}</legend>
                <span>
                  {lessonText(lesson)}
                  {' · '}
                  {lesson.mark === 2
                    ? t('journal.exemptions.markLate')
                    : lesson.mark === 1
                      ? t('journal.exemptions.markPresent')
                      : t('journal.exemptions.numbers', { count: lesson.numbers })}
                </span>
                {(['keep', 'exempt'] as const).map((choice) => (
                  <label key={choice} className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name={key}
                      checked={choices.get(key) === choice}
                      onChange={() => {
                        onChoose(one.studentId, lesson.lessonId, choice);
                      }}
                    />
                    {t(`journal.exemptions.choice.${choice}`)}
                  </label>
                ))}
              </fieldset>
            );
          })}
          {one.reopen.length > 0 && (
            <span>
              {t('journal.exemptions.reopen', { count: one.reopen.length })}
              {one.reopen.some((lesson) => lesson.givesBack) && (
                <span className="ml-1">{t('journal.exemptions.givesBack')}</span>
              )}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The choices kept by student and lesson, sent as the server takes them. */
function useChoices() {
  const [choices, setChoices] = useState<Map<string, ExemptionChoice['choice']>>(new Map());
  const choose = useCallback(
    (studentId: string, lessonId: string, choice: ExemptionChoice['choice']) => {
      setChoices((before) => new Map(before).set(`${studentId}|${lessonId}`, choice));
    },
    [],
  );
  const list = (preview: ExemptionPreview | null): ExemptionChoice[] =>
    (preview?.students ?? []).flatMap((one) =>
      one.choose.flatMap((lesson) => {
        const choice = choices.get(`${one.studentId}|${lesson.lessonId}`);
        return choice === undefined
          ? []
          : [{ studentId: one.studentId, lessonId: lesson.lessonId, choice }];
      }),
    );
  const missing = (preview: ExemptionPreview | null) =>
    (preview?.students ?? []).some((one) =>
      one.choose.some((lesson) => !choices.has(`${one.studentId}|${lesson.lessonId}`)),
    );
  return { choices, choose, list, missing };
}

type FormField =
  | 'classId'
  | 'studentIds'
  | 'kind'
  | 'scope'
  | 'subjectIds'
  | 'days'
  | 'startDate'
  | 'endDate'
  | 'slotStart'
  | 'slotEnd'
  | 'category'
  | 'detail';

/**
 * The form of new exemptions (`edge/exemptions`, row 8: "One form creates one
 * exemption per chosen student"): checked as typed with `exemptionCreateSchema`,
 * then "Check" asks the late-entry preview of the server and "Save" sends the
 * choices it asked for (`07`, Problem cases, the late certificate).
 */
function ExemptionFormDialog({
  initialStudent,
  initialDate,
  onClose,
}: {
  initialStudent: string | null;
  initialDate: string | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { branchId } = useView();
  const language = i18n.language;
  const classes = useQuery(classesQuery(branchId));
  const subjects = useQuery(subjectsQuery(branchId));
  const [preview, setPreview] = useState<ExemptionPreview | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  const { choices, choose, list, missing } = useChoices();
  const [done, setDone] = useState(false);
  const read = useCallback(
    (typed: Record<FormField, string>): unknown => {
      const slots = typed.days === 'slots';
      return {
        studentIds: initialStudent !== null ? [initialStudent] : listValues(typed.studentIds),
        kind: typed.kind,
        subjectIds: typed.scope === 'all' ? null : listValues(typed.subjectIds),
        startDate: typed.startDate,
        endDate: typed.kind === 'full' ? null : slots ? typed.startDate : typed.endDate,
        slots: slots ? { start: typed.slotStart, end: typed.slotEnd } : null,
        category: typed.category,
        detail: typed.detail,
        choices: [],
      } satisfies Record<string, unknown>;
    },
    [initialStudent],
  );
  const lastSent = useRef<ExemptionCreate | null>(null);
  const form = useRecordForm<FormField, ExemptionCreate>({
    schema: exemptionCreateSchema,
    initial: {
      classId: '',
      studentIds: '',
      kind: 'temporary',
      scope: 'all',
      subjectIds: '',
      days: 'whole',
      startDate: initialDate ?? '',
      endDate: initialDate ?? '',
      slotStart: '',
      slotEnd: '',
      category: 'illness',
      detail: '',
    },
    read,
    checkedOnSave: ['studentIds', 'subjectIds'],
    message: (field, issue) =>
      field === 'studentIds' || field === 'subjectIds'
        ? t('form.chooseOne')
        : field === 'endDate' && issue.code === 'custom'
          ? t('journal.exemptions.endBeforeStart')
          : undefined,
    save: async (body) => {
      lastSent.current = body;
      if (preview === null) {
        setPreview(await previewCreate(body));
        return;
      }
      await createExemptions({ ...body, choices: list(preview) }, key);
      await invalidateExemptions(queryClient);
      setDone(true);
    },
  });
  const classId = form.bind('classId');
  const members = useQuery({
    ...classMembersQuery(branchId, classId.value),
    enabled: branchId !== null && classId.value !== '' && initialStudent === null,
  });
  const kind = form.bind('kind');
  const scope = form.bind('scope');
  const days = form.bind('days');
  const names = new Map(
    (members.data?.members ?? []).map((one) => [
      one.studentId,
      [one.lastName, one.firstName].filter(Boolean).join(' '),
    ]),
  );
  const title = t('journal.exemptions.new');
  const element = useRef<HTMLFormElement>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {done ? (
          <>
            <p role="status">{t('journal.exemptions.created')}</p>
            <DialogFooter>
              <DialogClose render={<Button />}>{t('journal.exemptions.close')}</DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form
            ref={element}
            aria-label={title}
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void form.submit().then((checked) => {
                if (!checked) {
                  element.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
                }
              });
            }}
            onChange={(event) => {
              // A change of the form asks the preview again; a choice of the preview does not.
              const target: unknown = event.target;
              if (target instanceof HTMLInputElement && target.type === 'radio') return;
              if (preview !== null) setPreview(null);
            }}
          >
            {initialStudent === null &&
              (classes.isError ? (
                <ErrorState
                  error={classes.error}
                  onRetry={() => {
                    void classes.refetch();
                  }}
                />
              ) : classes.data === undefined ? (
                <LoadingOutline />
              ) : (
                <>
                  <SelectField
                    label={t('journal.exemptions.class')}
                    options={[
                      { value: '', label: t('journal.exemptions.chooseClass') },
                      ...classes.data.classes.map((one) => ({
                        value: one.id,
                        label: `${String(one.grade)} ${one.name}`,
                      })),
                    ]}
                    {...classId}
                  />
                  {classId.value !== '' &&
                    (members.isError ? (
                      <ErrorState
                        error={members.error}
                        onRetry={() => {
                          void members.refetch();
                        }}
                      />
                    ) : members.data === undefined ? (
                      <LoadingOutline />
                    ) : (
                      <CheckboxGroupField
                        label={t('journal.exemptions.students')}
                        options={members.data.members.map((one) => ({
                          value: one.studentId,
                          label: [one.lastName, one.firstName].filter(Boolean).join(' '),
                        }))}
                        {...form.bind('studentIds')}
                      />
                    ))}
                </>
              ))}
            <SelectField
              label={t('journal.exemptions.kind')}
              options={(['temporary', 'full'] as const).map((value) => ({
                value,
                label: t(`journal.exemptions.kinds.${value}`),
              }))}
              {...kind}
            />
            <SelectField
              label={t('journal.exemptions.scope')}
              options={[
                { value: 'all', label: t('journal.exemptions.allSubjects') },
                { value: 'chosen', label: t('journal.exemptions.chosenSubjects') },
              ]}
              {...scope}
            />
            {scope.value === 'chosen' &&
              (subjects.isError ? (
                <ErrorState
                  error={subjects.error}
                  onRetry={() => {
                    void subjects.refetch();
                  }}
                />
              ) : subjects.data === undefined ? (
                <LoadingOutline />
              ) : (
                <CheckboxGroupField
                  label={t('journal.exemptions.subjects')}
                  options={subjects.data.subjects.map((one) => ({
                    value: one.id,
                    label: nameOf(one.names, language),
                  }))}
                  {...form.bind('subjectIds')}
                />
              ))}
            {kind.value === 'temporary' && scope.value === 'all' && (
              <SelectField
                label={t('journal.exemptions.days')}
                options={[
                  { value: 'whole', label: t('journal.exemptions.wholeDays') },
                  { value: 'slots', label: t('journal.exemptions.slots') },
                ]}
                {...days}
              />
            )}
            <DateField label={t('journal.exemptions.startDate')} {...form.bind('startDate')} />
            {kind.value === 'temporary' && days.value !== 'slots' && (
              <DateField label={t('journal.exemptions.endDate')} {...form.bind('endDate')} />
            )}
            {kind.value === 'temporary' && days.value === 'slots' && scope.value === 'all' && (
              <div className="flex flex-wrap gap-4">
                <Field
                  type="time"
                  label={t('journal.exemptions.slotStart')}
                  {...form.bind('slotStart')}
                />
                <Field
                  type="time"
                  label={t('journal.exemptions.slotEnd')}
                  {...form.bind('slotEnd')}
                />
              </div>
            )}
            <SelectField
              label={t('journal.exemptions.category')}
              options={EXEMPTION_CATEGORIES.map((value) => ({
                value,
                label: t(`journal.exemptions.categories.${value}`),
              }))}
              {...form.bind('category')}
            />
            <TextAreaField
              label={t('journal.exemptions.detail')}
              maxLength={EXEMPTION_DETAIL_MAX}
              {...form.bind('detail')}
            />
            {preview !== null && (
              <PreviewLines
                preview={preview}
                names={
                  initialStudent === null
                    ? names
                    : new Map([[initialStudent, t('journal.exemptions.thisStudent')]])
                }
                choices={choices}
                onChoose={choose}
              />
            )}
            <FailureAlert error={form.failure} />
            <DialogFooter>
              <DialogClose render={<Button variant="ghost" />}>
                {t('journal.exemptions.back')}
              </DialogClose>
              <Button
                type="submit"
                disabled={
                  form.status === 'saving' ||
                  (preview !== null &&
                    (missing(preview) || preview.students.some((one) => one.overlap !== null)))
                }
              >
                {preview === null ? t('journal.exemptions.check') : t('journal.exemptions.save')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** "End" from a date, "Void, entered in error" and the void of the batch, each with its preview. */
function ChangeDialog({
  exemption,
  change,
  onClose,
}: {
  exemption: Exemption;
  change: 'end' | 'void' | 'batch';
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(change === 'end' ? exemption.endDate : '');
  const [preview, setPreview] = useState<ExemptionPreview | null>(null);
  const { choices, choose, list, missing } = useChoices();
  const ask = useMutation({
    mutationFn: () =>
      change === 'end'
        ? previewEnd(exemption.id, value, exemption.version)
        : change === 'void'
          ? previewVoid(exemption.id, exemption.version)
          : Promise.resolve(null),
    onSuccess: (answer) => {
      setPreview(answer ?? { students: [], yearEnd: exemption.endDate });
    },
  });
  const send = useMutation({
    mutationFn: async () => {
      if (change === 'end') {
        await endExemption(exemption.id, value, exemption.version, list(preview));
      } else if (change === 'void') {
        await voidExemption(exemption.id, value, exemption.version);
      } else {
        await voidBatch(exemption.batchId, value);
      }
    },
    onSuccess: async () => {
      await invalidateExemptions(queryClient);
      onClose();
    },
  });
  const title = t(
    `journal.exemptions.${change === 'end' ? 'end' : change === 'void' ? 'void' : 'voidBatch'}`,
  );
  const ready = change === 'end' ? value !== '' : value.trim() !== '';
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          aria-label={title}
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;
            if (preview === null) ask.mutate();
            else send.mutate();
          }}
        >
          {change === 'end' ? (
            <DateField
              label={t('journal.exemptions.endDate')}
              name="endDate"
              value={value}
              error={undefined}
              onChange={(event) => {
                setValue(event.target.value);
                setPreview(null);
              }}
            />
          ) : (
            <TextAreaField
              label={t('journal.exemptions.voidReason')}
              name="reason"
              maxLength={EXEMPTION_VOID_REASON_MAX}
              value={value}
              error={undefined}
              onChange={(event) => {
                setValue(event.target.value);
              }}
            />
          )}
          {preview !== null && (
            <PreviewLines
              preview={preview}
              names={new Map([[exemption.student.id, studentName(exemption.student)]])}
              choices={choices}
              onChoose={choose}
            />
          )}
          <FailureAlert error={ask.error ?? send.error} />
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>
              {t('journal.exemptions.back')}
            </DialogClose>
            <Button
              type="submit"
              disabled={
                !ready || ask.isPending || send.isPending || (preview !== null && missing(preview))
              }
            >
              {preview === null ? t('journal.exemptions.check') : title}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** `edge/exemptions`, row 9: absences with a Tutor's reason and no exemption, one click to create one. */
function AbsencesView({
  search,
  onSearchChange,
  onCreate,
}: {
  search: ListSearch;
  onSearchChange: (next: ListSearch, how: 'push' | 'replace') => void;
  onCreate: ((absence: ExemptionAbsence) => void) | null;
}) {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const absences = useQuery(exemptionAbsencesQuery(branchId));
  const language = i18n.language;
  const columns = useMemo(
    (): Column<ExemptionAbsence>[] => [
      {
        key: 'student',
        header: t('journal.exemptions.student'),
        cell: (row) => studentName(row.student),
        sortValue: (row) => studentName(row.student),
        searchText: (row) => studentName(row.student),
        opens: true,
        fixed: true,
      },
      {
        key: 'class',
        header: t('journal.exemptions.class'),
        cell: (row) => row.student.className ?? '—',
      },
      {
        key: 'date',
        header: t('journal.exemptions.date'),
        cell: (row) => schoolDateText(row.date, language),
        sortValue: (row) => row.date,
      },
      {
        key: 'reason',
        header: t('journal.exemptions.absenceReason'),
        cell: (row) => t(`journal.absences.categories.${row.category}`),
      },
    ],
    [t, language],
  );
  if (absences.isError) {
    return (
      <ErrorState
        error={absences.error}
        onRetry={() => {
          void absences.refetch();
        }}
      />
    );
  }
  return (
    <ListPage
      listId="journal-exemption-absences"
      caption={t('journal.exemptions.view.absences')}
      rows={absences.data?.items}
      rowId={(row) => `${row.student.id}|${row.date}`}
      rowName={(row) => `${studentName(row.student)} · ${schoolDateText(row.date, language)}`}
      columns={columns}
      search={search}
      onSearchChange={onSearchChange}
      panel={(row) => (
        <div className="grid gap-3 text-sm">
          {row.note !== '' && <p>{row.note}</p>}
          {onCreate !== null && (
            <div>
              <Button
                onClick={() => {
                  onCreate(row);
                }}
              >
                {t('journal.exemptions.createFrom')}
              </Button>
            </div>
          )}
        </div>
      )}
      empty={{
        title: t('journal.exemptions.absencesEmptyTitle'),
        text: t('journal.exemptions.absencesEmpty'),
      }}
    />
  );
}

/** Decision 3: the exemptions a branch move offers, to confirm from the move date or drop. */
function OffersView({
  search,
  onSearchChange,
}: {
  search: ListSearch;
  onSearchChange: (next: ListSearch, how: 'push' | 'replace') => void;
}) {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const offers = useQuery(exemptionOffersQuery(branchId));
  const datesText = useDatesText();
  const language = i18n.language;
  const columns = useMemo(
    (): Column<ExemptionMoveOffer>[] => [
      {
        key: 'student',
        header: t('journal.exemptions.student'),
        cell: (row) => studentName(row.student),
        sortValue: (row) => studentName(row.student),
        searchText: (row) => studentName(row.student),
        opens: true,
        fixed: true,
      },
      {
        key: 'from',
        header: t('journal.exemptions.fromBranch'),
        cell: (row) => row.fromBranch,
      },
      {
        key: 'dates',
        header: t('journal.exemptions.dates'),
        cell: (row) => datesText(row),
        sortValue: (row) => row.startDate,
      },
      {
        key: 'decision',
        header: t('journal.exemptions.decision'),
        cell: (row) =>
          row.decision === null
            ? t('journal.exemptions.undecided')
            : t(`journal.exemptions.decisions.${row.decision}`),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `datesText` follows `t` and `language`.
    [t, language],
  );
  if (offers.isError) {
    return (
      <ErrorState
        error={offers.error}
        onRetry={() => {
          void offers.refetch();
        }}
      />
    );
  }
  return (
    <ListPage
      listId="journal-exemption-offers"
      caption={t('journal.exemptions.view.offers')}
      rows={offers.data?.items}
      rowId={(row) => row.id}
      rowName={(row) => studentName(row.student)}
      columns={columns}
      search={search}
      onSearchChange={onSearchChange}
      panel={(row) => <OfferPanel key={row.id} offer={row} />}
      empty={{
        title: t('journal.exemptions.offersEmptyTitle'),
        text: t('journal.exemptions.offersEmpty'),
      }}
    />
  );
}

function OfferPanel({ offer }: { offer: ExemptionMoveOffer }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const mayEdit = useMayView('exemptions', 'edit');
  const datesText = useDatesText();
  const [preview, setPreview] = useState<ExemptionPreview | null>(null);
  const { choices, choose, list, missing } = useChoices();
  const ask = useMutation({
    mutationFn: () => previewConfirm(offer.id),
    onSuccess: (answer) => {
      setPreview(answer);
    },
  });
  const confirmed = useMutation({
    mutationFn: () => confirmOffer(offer.id, list(preview)),
    onSuccess: () => invalidateExemptions(queryClient),
  });
  const dropped = useMutation({
    mutationFn: () => dropOffer(offer.id),
    onSuccess: () => invalidateExemptions(queryClient),
  });
  const [reason, setReason] = useState<string | null>(null);
  const opened = useMutation({
    mutationFn: () => openOfferReason(offer.id),
    onSuccess: (answer) => {
      setReason(answer.detail);
    },
  });
  return (
    <div className="grid gap-3 text-sm">
      <p>
        <span className="font-semibold">{t(`journal.exemptions.kinds.${offer.kind}`)}</span>
        {' · '}
        {datesText(offer)}
      </p>
      <p>
        {offer.subjects === null
          ? t('journal.exemptions.allSubjects')
          : offer.subjects.map((one) => nameOf(one.name, i18n.language)).join(', ')}
      </p>
      <p>
        {t('journal.exemptions.categoryLine', {
          category: t(`journal.exemptions.categories.${offer.category}`),
        })}
      </p>
      {offer.decision === null && (
        <div>
          {reason === null ? (
            <Button
              variant="ghost"
              disabled={opened.isPending}
              onClick={() => {
                opened.mutate();
              }}
            >
              {t('journal.exemptions.showReason')}
            </Button>
          ) : (
            <p className="whitespace-pre-wrap">{reason}</p>
          )}
          <FailureAlert error={opened.error} />
        </div>
      )}
      {preview !== null && (
        <PreviewLines
          preview={preview}
          names={new Map([[offer.student.id, studentName(offer.student)]])}
          choices={choices}
          onChoose={choose}
        />
      )}
      {mayEdit && offer.decision === null && (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              ask.isPending || confirmed.isPending || (preview !== null && missing(preview))
            }
            onClick={() => {
              if (preview === null) ask.mutate();
              else confirmed.mutate();
            }}
          >
            {preview === null ? t('journal.exemptions.check') : t('journal.exemptions.confirm')}
          </Button>
          <Button
            variant="secondary"
            disabled={dropped.isPending}
            onClick={() => {
              dropped.mutate();
            }}
          >
            {t('journal.exemptions.drop')}
          </Button>
        </div>
      )}
      <FailureAlert error={ask.error ?? confirmed.error ?? dropped.error} />
    </div>
  );
}
