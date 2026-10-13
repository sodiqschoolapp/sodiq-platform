import {
  namesSchema,
  type Department,
  type DepartmentRecord,
  type Division,
  type DivisionRecord,
  type Names,
} from '@sodiq/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { ApiFailure, answerOf } from '@/api/failure';
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
import { PanelActions } from '@/components/list/panel-actions';
import { usePanelEditing } from '@/components/list/use-panel-editing';
import { invalidateDivisions, nameOf } from './setup-api';
import { SECTION_TITLE, SUBSECTION_TITLE } from '@/components/ui/control';

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
  /** Closes the form (opened in the side panel). */
  onCancel?: () => void;
}

/**
 * The record of a division or a department: a name in each of the three
 * languages (`03`, Divisions, Names). A taken name is shown beside its field
 * (`12`, Look and feel: "Error messages say what happened and what to do next").
 */
export function NamesForm({ names, label, takenText, onSave, onCancel }: NamesFormProps) {
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
    <RecordForm form={form} label={label} onCancel={onCancel}>
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
  // One form open at a time: the names, a department's names or a new department (task 2.7c-2b-1).
  const panel = usePanelEditing();
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
    onSuccess: refresh,
  });

  const renameDepartment = useMutation({
    mutationFn: ({ id, record }: { id: string; record: DepartmentRecord }) =>
      answerOf(api.PUT('/api/setup/departments/{id}', { params: { path: { id } }, body: record })),
    onSuccess: refresh,
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

  const archived = division.archivedAt !== null;
  const editable = canEdit && !division.builtIn && !archived;

  return (
    <div ref={panel.root} className="grid gap-6">
      {editable && panel.editing === 'record' ? (
        // The form takes the read view's place and its Save and Cancel are last.
        <NamesForm
          names={division.names}
          label={name(division.names)}
          takenText={t('setup.divisions.nameTaken')}
          onSave={async (record) => {
            await rename.mutateAsync(record);
            panel.stop({ saved: true });
          }}
          onCancel={() => {
            panel.stop();
          }}
        />
      ) : (
        <>
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

          <section className="grid gap-3">
            <h3 className={SECTION_TITLE}>{t('setup.divisions.departmentsTitle')}</h3>
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
                        {canEdit && panel.editing === `department:${department.id}` ? (
                          <NamesForm
                            names={department.names}
                            label={name(department.names)}
                            takenText={t('setup.divisions.departmentNameTaken')}
                            onSave={async (record) => {
                              await renameDepartment.mutateAsync({ id: department.id, record });
                              panel.stop({ saved: true });
                            }}
                            onCancel={() => {
                              panel.stop();
                            }}
                          />
                        ) : (
                          name(department.names)
                        )}
                      </TableCell>
                      <TableCell>{status(department.archivedAt)}</TableCell>
                      {canEdit && (
                        <TableCell className="space-x-2 whitespace-nowrap">
                          {panel.editing !== `department:${department.id}` &&
                            department.archivedAt === null &&
                            !archived && (
                              <Button
                                variant="secondary"
                                size="sm"
                                aria-label={t('setup.divisions.renameNamed', {
                                  name: name(department.names),
                                })}
                                {...panel.opener(`department:${department.id}`)}
                                onClick={() => {
                                  panel.start(`department:${department.id}`);
                                }}
                              >
                                {t('setup.divisions.rename')}
                              </Button>
                            )}
                          {!archived && (
                            <Button
                              variant={department.archivedAt === null ? 'destructive' : 'secondary'}
                              size="sm"
                              disabled={archiveDepartment.isPending}
                              aria-label={
                                department.archivedAt === null
                                  ? t('setup.divisions.archiveNamed', {
                                      name: name(department.names),
                                    })
                                  : t('setup.divisions.restoreNamed', {
                                      name: name(department.names),
                                    })
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
            {canEdit &&
              !archived &&
              (panel.editing === 'department-new' ? (
                <div className="grid gap-2 rounded-lg border p-3">
                  <h4 className={SUBSECTION_TITLE}>{t('setup.divisions.addDepartment')}</h4>
                  <NamesForm
                    names={null}
                    label={t('setup.divisions.newDepartment')}
                    takenText={t('setup.divisions.departmentNameTaken')}
                    onSave={async (record) => {
                      await addDepartment.mutateAsync(record);
                      panel.stop({ saved: true });
                    }}
                    onCancel={() => {
                      panel.stop();
                    }}
                  />
                </div>
              ) : (
                <div>
                  <Button
                    variant="secondary"
                    {...panel.opener('department-new')}
                    onClick={() => {
                      panel.start('department-new');
                    }}
                  >
                    {t('setup.divisions.addDepartment')}
                  </Button>
                </div>
              ))}
          </section>
        </>
      )}

      {canEdit && !division.builtIn && panel.editing === null && (
        <PanelActions
          primary={
            editable && (
              <Button
                {...panel.opener('record')}
                onClick={() => {
                  panel.start('record');
                }}
              >
                {t('form.edit')}
              </Button>
            )
          }
          secondary={
            archived && (
              <Button
                variant="secondary"
                disabled={archiveDivision.isPending}
                onClick={() => {
                  void askDivision();
                }}
              >
                {t('setup.divisions.restoreDivision')}
              </Button>
            )
          }
          danger={
            !archived && (
              <Button
                variant="destructive"
                disabled={archiveDivision.isPending}
                onClick={() => {
                  void askDivision();
                }}
              >
                {t('setup.divisions.archiveDivision')}
              </Button>
            )
          }
          error={archiveDivision.error}
          errorText={
            archiveDivision.error instanceof ApiFailure &&
            archiveDivision.error.code === 'archive_refused'
              ? t('setup.divisions.hasStaff')
              : undefined
          }
          saved={panel.saved}
        />
      )}
      {canEdit && division.builtIn && panel.editing === null && (
        <PanelActions saved={panel.saved} />
      )}
    </div>
  );
}
