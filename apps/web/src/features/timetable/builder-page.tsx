import {
  classDisplayName,
  PERMISSIONS,
  permits,
  type DraftReadiness,
  type LoadRow,
  type TimetableVersion,
  type TimetableVersionEdit,
  weekdaySchema,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { WarningIcon } from '@/components/icons';
import { SelectField } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { StatusMark } from '@/components/status-mark';
import { Button } from '@/components/ui/button';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useView } from '@/features/access/use-view';
import { nameOf, yearsQuery } from '@/features/setup/setup-api';
import { TemplateTableView } from '@/features/setup/template-table';
import { schoolDateText, weekdayName } from '@/lib/dates';
import {
  BUILDER_STEPS,
  READINESS_STEPS,
  type BuilderSearch,
  type BuilderStep,
} from './builder-search';
import { gridMarkText } from './grid-conflicts';
import { EditLockBanner, useEditLock } from './edit-lock';
import { GridStep } from './grid-step';
import { useGridHistory } from './use-grid-history';
import { PublishStep } from './publish-step';
import { RulesStep } from './rules-step';
import {
  confirmTemplates,
  editVersion,
  invalidateTimetable,
  readinessQuery,
  versionsQuery,
} from './timetable-api';
import { comingQuarterStarts, StartForm } from './version-form';

/** The eight steps of `06`, Building a timetable; 1 to 5, 7 and 8 are built (tasks 5.3a, 5.3b-1, 5.4a and 5.5a-1); step 7's mark comes with task 5.4b-2a. */
const STEPS = [
  'templates',
  'load',
  'teachers',
  'rooms',
  'rules',
  'generate',
  'grid',
  'publish',
] as const;

type StepKey = (typeof STEPS)[number];

const BUILT = BUILDER_STEPS;

type BuiltStep = BuilderStep;

const isBuilt = (step: StepKey): step is BuiltStep => (BUILT as readonly string[]).includes(step);

type ReadyStep = (typeof READINESS_STEPS)[number];

const hasReadiness = (step: StepKey): step is ReadyStep =>
  (READINESS_STEPS as readonly string[]).includes(step);

/** The class or group of a row as a person reads it. */
const unitText = (row: LoadRow): string =>
  row.unit.kind === 'class'
    ? classDisplayName(row.unit.grades[0] ?? 0, row.unit.name)
    : row.unit.name;

/**
 * The draft builder (`06`, Building a timetable: "one screen with a
 * checklist of steps on the left"; task 5.3a, pull request #127): the eight
 * steps, each ready, not ready or not yet available, and the panel of the
 * chosen step. Steps 1 to 4 show what is there and what is missing from the
 * readiness route; the load and the staff record stay where they are edited
 * (decision 13).
 */
export function BuilderPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/timetable/builder' });
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const [changingStart, setChangingStart] = useState(false);
  const can = (action: 'edit') => role !== null && permits(PERMISSIONS, role, 'timetable', action);
  const versions = useQuery(versionsQuery(branchId));
  const list = versions.data?.versions ?? [];
  const chosen: TimetableVersion | undefined =
    list.find((one) => one.id === search.version) ??
    list.find((one) => one.status === 'draft') ??
    list[0];
  const readiness = useQuery(readinessQuery(branchId, chosen?.id ?? null));
  const writable = chosen?.status === 'draft' && chosen.yearStatus !== 'closed';
  // Task 5.4c-1: one edits at a time; the others read.
  const editLock = useEditLock(writable ? chosen : undefined, writable && can('edit'));
  const canEdit = writable && can('edit') && !editLock.othersEditing;
  const years = useQuery({ ...yearsQuery(branchId), enabled: branchId !== null && canEdit });
  const step: BuiltStep = search.step ?? 'templates';
  // Task 5.4c-2: the undo and redo of the grid outlive a visit to another step.
  const [gridHistory, setGridHistory] = useGridHistory(chosen?.id ?? null);

  const refresh = () => invalidateTimetable(queryClient);
  const confirm = useMutation({
    mutationFn: () => confirmTemplates(chosen?.id ?? ''),
    onSuccess: refresh,
  });
  const start = useMutation({
    mutationFn: (edit: TimetableVersionEdit) => editVersion(chosen?.id ?? '', edit),
    onSuccess: async () => {
      await refresh();
      setChangingStart(false);
    },
  });

  const go = (next: BuilderSearch) => {
    void navigate({ to: '/timetable/builder', search: next });
  };

  const header = (
    <PageHeader
      title={t('timetable.builder.title')}
      breadcrumbs={[
        { label: t('home.title'), to: '/' },
        { label: t('timetable.title'), to: '/timetable' },
      ]}
    />
  );

  if (versions.isError) {
    return (
      <>
        {header}
        <ErrorState
          error={versions.error}
          onRetry={() => {
            void versions.refetch();
          }}
        />
      </>
    );
  }
  if (versions.data === undefined) {
    return (
      <>
        {header}
        <LoadingOutline lines={6} />
      </>
    );
  }
  if (chosen === undefined) {
    return (
      <>
        {header}
        <EmptyState
          title={t('timetable.load.noVersionTitle')}
          text={t('timetable.builder.noVersion')}
        />
      </>
    );
  }

  const versionLabel = (one: TimetableVersion) =>
    t('timetable.load.versionOption', {
      number: one.number,
      year: one.yearName,
      // Task 5.5a-1, decision 4: a draft that a publish marked says so.
      status: one.outOfDate
        ? t('timetable.load.statuses.outOfDate')
        : t(`timetable.load.statuses.${one.status}`),
    });

  // Task 5.4b-2a, decision 7: step 7 has a mark of its own, apart from the gate of generation.
  const stepReady = (key: StepKey, data: DraftReadiness | undefined): boolean | null =>
    key === 'publish'
      ? chosen.status === 'published'
        ? true
        : null
      : key === 'grid'
        ? (data?.grid?.ready ?? null)
        : !hasReadiness(key) || data === undefined
          ? null
          : data[key].ready;

  const markText = (key: StepKey, data: DraftReadiness | undefined): string =>
    key === 'publish'
      ? chosen.status === 'published'
        ? t('timetable.load.statuses.published')
        : t('timetable.builder.notPublished')
      : key === 'grid' && data?.grid !== undefined
        ? gridMarkText(t, data.grid)
        : !isBuilt(key)
          ? t('timetable.builder.later')
          : !hasReadiness(key)
            ? t('timetable.builder.byHand')
            : data === undefined
              ? ''
              : data[key].ready
                ? t('timetable.builder.ready')
                : t('timetable.builder.notReady');

  const data = readiness.data;
  const notReady =
    data === undefined ? 0 : READINESS_STEPS.filter((key) => !data[key].ready).length;

  let panel;
  if (readiness.isError) {
    panel = (
      <ErrorState
        error={readiness.error}
        onRetry={() => {
          void readiness.refetch();
        }}
      />
    );
  } else if (data === undefined) {
    panel = <LoadingOutline lines={6} />;
  } else if (step === 'templates') {
    const weekdays = weekdaySchema
      .array()
      .parse([...new Set(data.templates.cells.map((cell) => cell.weekday))].sort((a, b) => a - b));
    const grades = [...new Set(data.templates.cells.map((cell) => cell.grade))].sort(
      (a, b) => a - b,
    );
    panel = (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <p className="text-sm">
            {t('timetable.load.startsOnText', {
              date: schoolDateText(data.templates.startsOn, language),
            })}
          </p>
          {canEdit && !changingStart && (
            <Button
              variant="secondary"
              onClick={() => {
                setChangingStart(true);
              }}
            >
              {t('timetable.load.changeStart')}
            </Button>
          )}
        </div>
        {changingStart && (
          <div className="max-w-xl">
            <StartForm
              key={chosen.id}
              version={chosen}
              quarterStarts={comingQuarterStarts(
                years.data?.years.find((year) => year.id === chosen.academicYearId),
                versions.data.today,
              )}
              onSave={async (edit) => {
                await start.mutateAsync(edit);
              }}
              onCancel={() => {
                setChangingStart(false);
              }}
            />
          </div>
        )}
        {data.templates.startPast && (
          <p className="text-sm text-destructive" data-reason="startPast">
            {t('timetable.builder.startPast')}
          </p>
        )}
        {grades.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('timetable.builder.noClasses')}</p>
        ) : (
          <TemplateTableView
            table={{
              date: data.templates.startsOn,
              weekdays,
              cells: data.templates.cells,
            }}
            grades={grades}
            changed={data.templates.changed}
            caption={t('timetable.builder.templatesCaption')}
          />
        )}
        {data.templates.missing.length > 0 && (
          <p className="text-sm text-destructive" data-reason="missing">
            {t('timetable.builder.missing', { count: data.templates.missing.length })}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <StatusMark
            done={data.templates.confirmed}
            text={
              data.templates.confirmed
                ? t('timetable.builder.confirmed')
                : data.templates.changed.length > 0
                  ? t('timetable.builder.changedSince')
                  : t('timetable.builder.notConfirmed')
            }
          />
          {canEdit && !data.templates.confirmed && (
            <Button
              disabled={confirm.isPending}
              onClick={() => {
                confirm.mutate();
              }}
            >
              {t('timetable.builder.confirm')}
            </Button>
          )}
        </div>
        {confirm.isError && <FailureAlert error={confirm.error} />}
      </div>
    );
  } else if (step === 'load') {
    panel = (
      <div className="grid gap-4">
        <p className="text-sm">{t('timetable.builder.rows', { count: data.load.rows })}</p>
        {data.load.rows === 0 && (
          <p className="text-sm text-destructive" data-reason="empty">
            {t('timetable.builder.noRows')}
          </p>
        )}
        {data.load.leftRows > 0 && (
          <p className="text-sm text-destructive" data-reason="leftRows">
            {t('timetable.builder.leftRows', { count: data.load.leftRows })}
          </p>
        )}
        {data.load.problemRows.length > 0 && (
          <section aria-labelledby="problem-rows" className="grid gap-2">
            <h3 id="problem-rows" className={SECTION_TITLE}>
              {t('timetable.builder.problemRows')}
            </h3>
            <ul className="grid gap-1">
              {data.load.problemRows.map((row) => (
                <li key={row.id} data-problem-row={row.id}>
                  <span className="font-semibold">
                    {unitText(row)}, {nameOf(row.subject.names, language)}
                  </span>
                  {' · '}
                  <span className="text-destructive">
                    {row.problems
                      .filter((code) => code !== 'load_room_closed')
                      .map((code) => t(`timetable.load.problems.${code}`))
                      .join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {data.load.tutorPinClashes.length > 0 && (
          <section aria-labelledby="tutor-pin-clashes" className="grid gap-2">
            <h3 id="tutor-pin-clashes" className={SECTION_TITLE}>
              {t('timetable.builder.tutorPinClashes')}
            </h3>
            <ul className="grid gap-1">
              {data.load.tutorPinClashes.map((clash) => (
                <li key={clash.pinIds.join(',')} data-tutor-clash={clash.pinIds.join(',')}>
                  {clash.pinIds
                    .map((id) => data.rules.pins.find((pin) => pin.id === id))
                    .filter((pin) => pin !== undefined)
                    .map((pin) =>
                      t('timetable.builder.pins.pinText', {
                        unit:
                          pin.unit.kind === 'class'
                            ? classDisplayName(pin.unit.grades[0] ?? 0, pin.unit.name)
                            : pin.unit.name,
                        subject: nameOf(pin.subject.names, language),
                        weekday: weekdayName(language, pin.weekday),
                        position: pin.slotPosition,
                      }),
                    )
                    .concat(clash.elsewhere ? [t('timetable.builder.pins.elsewhere')] : [])
                    .join('; ')}
                </li>
              ))}
            </ul>
          </section>
        )}
        {data.load.classesOver.length > 0 && (
          <section aria-labelledby="classes-over" className="grid gap-2">
            <h3 id="classes-over" className={SECTION_TITLE}>
              {t('timetable.builder.classesOver')}
            </h3>
            <ul className="grid gap-1">
              {data.load.classesOver.map((one) => (
                <li key={one.id} data-class-over={one.id}>
                  {t('timetable.builder.classOver', {
                    name: classDisplayName(one.grade, one.name),
                    lessons: one.lessons,
                    slots: one.lessonSlots,
                  })}
                </li>
              ))}
            </ul>
          </section>
        )}
        <div>
          <Link
            to="/timetable/load"
            search={{ version: chosen.id }}
            className="font-semibold text-link underline-offset-4 hover:underline"
          >
            {t('timetable.builder.openLoad')}
          </Link>
        </div>
      </div>
    );
  } else if (step === 'teachers') {
    const number = (value: number) => new Intl.NumberFormat(language).format(value);
    panel =
      data.teachers.teachers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('timetable.builder.noTeachers')}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <caption className="sr-only">{t('timetable.builder.steps.teachers')}</caption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('timetable.builder.teacher')}</TableHead>
                <TableHead>{t('timetable.builder.lessons')}</TableHead>
                <TableHead>{t('timetable.builder.freeSlots')}</TableHead>
                <TableHead>{t('timetable.builder.dailyLessons')}</TableHead>
                <TableHead>{t('timetable.builder.contract')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.teachers.teachers.map((teacher) => {
                const name = teacher.name ?? t('timetable.load.gone');
                return (
                  <TableRow key={teacher.id} data-teacher={teacher.id}>
                    <TableCell>
                      <Link
                        to={teacher.kind === 'vacancy' ? '/people/vacancies' : '/people/staff'}
                        search={{ open: teacher.id }}
                        className="font-semibold text-link underline-offset-4 hover:underline"
                      >
                        {teacher.kind === 'vacancy'
                          ? t('timetable.load.vacancyOption', { name })
                          : name}
                      </Link>
                    </TableCell>
                    <TableCell className={teacher.over ? 'text-destructive' : undefined}>
                      {number(teacher.lessons)}
                      {teacher.over && (
                        <span className="sr-only"> {t('timetable.builder.over')}</span>
                      )}
                    </TableCell>
                    <TableCell className={teacher.noHours ? 'text-destructive' : undefined}>
                      {teacher.freeSlots === null
                        ? t('timetable.builder.noHours')
                        : number(teacher.freeSlots)}
                    </TableCell>
                    <TableCell>
                      {teacher.dailyLessons === null
                        ? t('timetable.builder.notSet')
                        : number(teacher.dailyLessons)}
                    </TableCell>
                    <TableCell>
                      {teacher.contract === null
                        ? t('timetable.builder.notSet')
                        : number(teacher.contract)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      );
  } else if (step === 'rooms') {
    panel = (
      <div className="grid gap-4">
        {data.rooms.rows.length === 0 ? (
          <p className="text-sm">{t('timetable.builder.roomsMet')}</p>
        ) : (
          <ul className="grid gap-1">
            {data.rooms.rows.map((row) => (
              <li key={row.id} data-room-row={row.id}>
                <span className="font-semibold">
                  {unitText(row)}, {nameOf(row.subject.names, language)}
                </span>
                {' · '}
                <span className="text-destructive">
                  {row.reason === 'room_type_none' && row.roomType !== null
                    ? t('timetable.builder.roomTypeNone', {
                        type: t(`setup.rooms.types.${row.roomType}`),
                      })
                    : t('timetable.load.problems.load_room_closed')}
                </span>
              </li>
            ))}
          </ul>
        )}
        {data.rooms.classesWithoutRoom.length > 0 && (
          <section aria-labelledby="classes-without-room" className="grid gap-2">
            <h3 id="classes-without-room" className={SECTION_TITLE}>
              {t('timetable.builder.classesWithoutRoom')}
            </h3>
            <p className="text-sm text-muted-foreground">
              {data.rooms.classesWithoutRoom
                .map((one) => classDisplayName(one.grade, one.name))
                .join(', ')}
            </p>
          </section>
        )}
      </div>
    );
  } else if (step === 'rules') {
    panel = (
      <RulesStep
        key={chosen.id}
        versionId={chosen.id}
        rules={data.rules}
        cells={data.templates.cells}
        canEdit={canEdit}
        onChanged={refresh}
      />
    );
  } else if (step === 'grid') {
    panel = (
      <GridStep
        key={chosen.id}
        versionId={chosen.id}
        canEdit={canEdit}
        history={gridHistory}
        onHistory={setGridHistory}
      />
    );
  } else if (step === 'publish') {
    panel = (
      <PublishStep
        key={chosen.id}
        version={chosen}
        canEdit={canEdit}
        onOpenGrid={() => {
          go({ version: chosen.id, step: 'grid' });
        }}
      />
    );
  } else {
    panel = <p className="text-sm text-muted-foreground">{t('timetable.builder.laterText')}</p>;
  }

  return (
    <>
      {header}
      {editLock.othersEditing && (
        <div className="mb-6">
          <EditLockBanner version={chosen} take={editLock.take} />
        </div>
      )}
      <section className={`${PANEL} mb-6 grid gap-4 p-6`}>
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-64">
            <SelectField
              label={t('timetable.load.version')}
              name="version"
              value={chosen.id}
              options={list.map((one) => ({ value: one.id, label: versionLabel(one) }))}
              onChange={(event) => {
                go({ version: event.target.value, step });
              }}
            />
          </div>
          {chosen.outOfDate && (
            <p className="flex items-center gap-2 text-sm" data-out-of-date="true">
              <WarningIcon aria-hidden="true" className="size-4 shrink-0" />
              {t('timetable.builder.outOfDate')}
            </p>
          )}
          {data !== undefined && (
            <p className="text-sm font-semibold" data-ready={data.ready ? 'true' : 'false'}>
              {data.ready
                ? t('timetable.builder.readyForGeneration')
                : t('timetable.builder.notReadyForGeneration', { count: notReady })}
            </p>
          )}
          {data !== undefined && !data.ready && (
            <p className="text-sm" data-reason="notReadySteps">
              {t('timetable.builder.rulesStep.notReadySteps', {
                steps: READINESS_STEPS.filter((key) => !data[key].ready)
                  .map((key) => t(`timetable.builder.steps.${key}`))
                  .join(', '),
              })}
            </p>
          )}
        </div>
      </section>
      <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
        <nav aria-label={t('timetable.builder.stepsLabel')} className={`${PANEL} p-4`}>
          <ol className="grid gap-1">
            {STEPS.map((key, index) => (
              <li key={key} data-step={key}>
                <button
                  type="button"
                  aria-current={key === step ? 'step' : undefined}
                  disabled={!isBuilt(key)}
                  onClick={() => {
                    if (isBuilt(key)) {
                      go({ version: chosen.id, step: key });
                    }
                  }}
                  className={`grid w-full gap-0.5 rounded-lg px-3 py-2 text-left disabled:cursor-default ${
                    key === step ? 'bg-muted font-semibold' : ''
                  }`}
                >
                  <span>
                    {t('timetable.builder.stepNumber', { number: index + 1 })}{' '}
                    {t(`timetable.builder.steps.${key}`)}
                  </span>
                  <span className="text-sm">
                    <StatusMark done={stepReady(key, data)} text={markText(key, data)} />
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <section aria-labelledby="builder-step" className={`${PANEL} grid content-start gap-4 p-6`}>
          <h2 id="builder-step" className={SECTION_TITLE}>
            {t(`timetable.builder.steps.${step}`)}
          </h2>
          {panel}
        </section>
      </div>
    </>
  );
}
