import {
  namesSchema,
  type Department,
  type DepartmentRecord,
  type Division,
  type DivisionRecord,
  type Names,
} from '@sodiq/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { ApiFailure, answerOf } from '@/api/failure';
import { failureText } from '@/api/failure-text';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { Field } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLeave } from '@/components/unsent/unsent-changes';
import { invalidateDivisions, nameOf } from './setup-api';

type NameField = keyof Names;

const NAME_FIELDS: readonly NameField[] = ['uz', 'ru', 'en'];

/** The language whose name the server said is taken (`details` of `already_exists`), or none. */
export function takenNameOf(failure: unknown): NameField | null {
  if (!(failure instanceof ApiFailure) || failure.code !== 'already_exists') {
    return null;
  }
  const detail = failure.details?.find((one) => one.path.startsWith('names.'));
  const field = detail?.path.slice('names.'.length);
  return NAME_FIELDS.find((one) => one === field) ?? null;
}

interface NamesFormProps {
  /** The names as saved; `null` for a new record. */
  names: Names | null;
  label: string;
  /** What the field says when the server answers that this name is taken. */
  takenText: string;
  onSave: (record: DivisionRecord | DepartmentRecord) => Promise<void>;
}

/**
 * The record of a division or a department: a name in each of the three
 * languages (`03`, Divisions, Names). A taken name is shown beside its field
 * (`12`, Look and feel: "Error messages say what happened and what to do next").
 */
export function NamesForm({ names, label, takenText, onSave }: NamesFormProps) {
  const { t } = useTranslation();
  const form = useRecordForm<NameField, Names>({
    schema: namesSchema,
    initial: { uz: names?.uz ?? '', ru: names?.ru ?? '', en: names?.en ?? '' },
    save: (typed) => onSave({ names: typed }),
  });
  const taken = takenNameOf(form.failure);
  const labels: Record<NameField, string> = {
    uz: t('setup.divisions.nameUz'),
    ru: t('setup.divisions.nameRu'),
    en: t('setup.divisions.nameEn'),
  };
  return (
    <RecordForm form={form} label={label}>
      {NAME_FIELDS.map((field) => {
        const bound = form.bind(field);
        return (
          <Field
            key={field}
            label={labels[field]}
            autoComplete="off"
            {...bound}
            error={bound.error ?? (taken === field ? takenText : undefined)}
          />
        );
      })}
    </RecordForm>
  );
}

interface DivisionPanelProps {
  division: Division;
  /** The Super Admin edits, archives and restores; the other roles read. */
  canEdit: boolean;
}

/**
 * A division in the side panel of the list: its names, and its departments,
 * which are added, renamed, archived and restored here. Academic is built in
 * (`03`): its names are shown, not edited, and it has no archive. A
 * department is not changed in an archived division (decided by the owner,
 * pull request #40, answer 4); the refusal is shown as its text.
 */
export function DivisionPanel({ division, canEdit }: DivisionPanelProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const leave = useLeave();
  const [renaming, setRenaming] = useState<string | null>(null);
  // A new key after every department added: the form starts empty again.
  const [added, setAdded] = useState(0);
  const name = (names: Names) => nameOf(names, i18n.language);
  const refresh = () => invalidateDivisions(queryClient);

  const rename = useMutation({
    mutationFn: (record: DivisionRecord) =>
      answerOf(
        api.PUT('/api/setup/divisions/{id}', {
          params: { path: { id: division.id } },
          body: record,
        }),
      ),
    onSuccess: refresh,
  });

  const archiveDivision = useMutation({
    mutationFn: (restore: boolean) =>
      answerOf(
        api.POST(
          restore ? '/api/setup/divisions/{id}/restore' : '/api/setup/divisions/{id}/archive',
          { params: { path: { id: division.id } } },
        ),
      ),
    onSuccess: refresh,
  });

  const addDepartment = useMutation({
    mutationFn: (record: DepartmentRecord) =>
      answerOf(
        api.POST('/api/setup/divisions/{id}/departments', {
          params: { path: { id: division.id } },
          body: record,
        }),
      ),
    onSuccess: async () => {
      setAdded((before) => before + 1);
      await refresh();
    },
  });

  const renameDepartment = useMutation({
    mutationFn: ({ id, record }: { id: string; record: DepartmentRecord }) =>
      answerOf(api.PUT('/api/setup/departments/{id}', { params: { path: { id } }, body: record })),
    onSuccess: async () => {
      setRenaming(null);
      await refresh();
    },
  });

  const archiveDepartment = useMutation({
    mutationFn: ({ id, restore }: { id: string; restore: boolean }) =>
      answerOf(
        api.POST(
          restore ? '/api/setup/departments/{id}/restore' : '/api/setup/departments/{id}/archive',
          { params: { path: { id } } },
        ),
      ),
    onSuccess: refresh,
  });

  const askDivision = async () => {
    const archived = division.archivedAt !== null;
    if (
      await confirm({
        title: archived
          ? t('setup.divisions.restoreTitle', { count: 1, n: '1' })
          : t('setup.divisions.archiveTitle', { count: 1, n: '1' }),
        text: archived ? t('setup.divisions.restoreText') : t('setup.divisions.archiveText'),
        names: [name(division.names)],
        action: archived ? t('setup.divisions.restore') : t('setup.divisions.archive'),
        destructive: !archived,
      })
    ) {
      archiveDivision.mutate(archived);
    }
  };

  const askDepartment = async (department: Department) => {
    const archived = department.archivedAt !== null;
    const departmentName = name(department.names);
    if (
      await confirm({
        title: archived
          ? t('setup.divisions.restoreDepartmentTitle', { name: departmentName })
          : t('setup.divisions.archiveDepartmentTitle', { name: departmentName }),
        text: archived
          ? t('setup.divisions.restoreDepartmentText')
          : t('setup.divisions.archiveDepartmentText'),
        action: archived ? t('setup.divisions.restore') : t('setup.divisions.archive'),
        destructive: !archived,
      })
    ) {
      archiveDepartment.mutate({ id: department.id, restore: archived });
    }
  };

  const status = (archivedAt: string | null) =>
    archivedAt === null ? t('setup.divisions.active') : t('setup.divisions.archived');

  const editable = canEdit && !division.builtIn && division.archivedAt === null;

  return (
    <div className="grid gap-6">
      {editable ? (
        <NamesForm
          key={division.id}
          names={division.names}
          label={name(division.names)}
          takenText={t('setup.divisions.nameTaken')}
          onSave={async (record) => {
            await rename.mutateAsync(record);
          }}
        />
      ) : (
        <div className="grid gap-2 text-sm">
          <dl className="grid gap-2">
            {NAME_FIELDS.map((field) => (
              <div key={field} className="grid gap-0.5">
                <dt className="text-muted-foreground">
                  {t(
                    field === 'uz'
                      ? 'setup.divisions.nameUz'
                      : field === 'ru'
                        ? 'setup.divisions.nameRu'
                        : 'setup.divisions.nameEn',
                  )}
                </dt>
                <dd>{division.names[field]}</dd>
              </div>
            ))}
          </dl>
          {division.builtIn ? (
            <p className="text-muted-foreground">{t('setup.divisions.builtIn')}</p>
          ) : (
            <p className="text-muted-foreground">
              {t('setup.divisions.status')}: {status(division.archivedAt)}
            </p>
          )}
        </div>
      )}
      {canEdit && !division.builtIn && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={archiveDivision.isPending}
            onClick={() => {
              void askDivision();
            }}
          >
            {division.archivedAt === null
              ? t('setup.divisions.archiveDivision')
              : t('setup.divisions.restoreDivision')}
          </Button>
          <span className="text-sm text-muted-foreground">{status(division.archivedAt)}</span>
          {archiveDivision.error !== null && (
            <span role="alert" className="text-sm text-destructive">
              {archiveDivision.error instanceof ApiFailure &&
              archiveDivision.error.code === 'archive_refused'
                ? t('setup.divisions.hasStaff')
                : failureText(t, archiveDivision.error)}
            </span>
          )}
        </div>
      )}

      <section className="grid gap-3">
        <h3 className="text-base font-semibold">{t('setup.divisions.departmentsTitle')}</h3>
        {division.departments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('setup.divisions.noDepartments')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('setup.divisions.department')}</TableHead>
                <TableHead>{t('setup.divisions.status')}</TableHead>
                {canEdit && (
                  <TableHead>
                    <span className="sr-only">{t('setup.divisions.departmentActions')}</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {division.departments.map((department) => (
                <TableRow key={department.id}>
                  <TableCell>
                    {canEdit && renaming === department.id ? (
                      <div className="grid gap-2">
                        <NamesForm
                          names={department.names}
                          label={name(department.names)}
                          takenText={t('setup.divisions.departmentNameTaken')}
                          onSave={async (record) => {
                            await renameDepartment.mutateAsync({ id: department.id, record });
                          }}
                        />
                        <div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              void leave.leave().then((leaves) => {
                                if (leaves) {
                                  setRenaming(null);
                                }
                              });
                            }}
                          >
                            {t('setup.divisions.cancel')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      name(department.names)
                    )}
                  </TableCell>
                  <TableCell>{status(department.archivedAt)}</TableCell>
                  {canEdit && (
                    <TableCell className="space-x-2 whitespace-nowrap">
                      {renaming !== department.id &&
                        department.archivedAt === null &&
                        division.archivedAt === null && (
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={t('setup.divisions.renameNamed', {
                              name: name(department.names),
                            })}
                            onClick={() => {
                              setRenaming(department.id);
                            }}
                          >
                            {t('setup.divisions.rename')}
                          </Button>
                        )}
                      {division.archivedAt === null && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={archiveDepartment.isPending}
                          aria-label={
                            department.archivedAt === null
                              ? t('setup.divisions.archiveNamed', { name: name(department.names) })
                              : t('setup.divisions.restoreNamed', { name: name(department.names) })
                          }
                          onClick={() => {
                            void askDepartment(department);
                          }}
                        >
                          {department.archivedAt === null
                            ? t('setup.divisions.archive')
                            : t('setup.divisions.restore')}
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <FailureAlert error={archiveDepartment.error} />
        {canEdit && division.archivedAt === null && (
          <div className="grid gap-2 rounded-lg border p-3">
            <h4 className="text-sm font-semibold">{t('setup.divisions.addDepartment')}</h4>
            <NamesForm
              key={added}
              names={null}
              label={t('setup.divisions.newDepartment')}
              takenText={t('setup.divisions.departmentNameTaken')}
              onSave={async (record) => {
                await addDepartment.mutateAsync(record);
              }}
            />
          </div>
        )}
      </section>
    </div>
  );
}
