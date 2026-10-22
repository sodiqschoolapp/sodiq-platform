import {
  classDisplayName,
  versionExportRequestSchema,
  type GridAnswer,
  type TimetableVersion,
  type ViewExportFormat,
} from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { SelectField } from '@/components/field';
import { ErrorState, LoadingOutline } from '@/components/states';
import { SECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { gridQuery } from './timetable-api';
import { TimetableFileButtons } from './timetable-file-buttons';

/** A choice of the select: the school, or a class, teacher or room by id (`<kind>:<id>`). */
type Choice = 'branch' | `${'class' | 'teacher' | 'room'}:${string}`;

/** The classes, teachers and rooms the version's board names, in the board's order. */
function choicesOf(grid: GridAnswer) {
  const teachers = new Map<string, string>();
  for (const row of grid.rows) {
    if (row.teacher.name !== null) teachers.set(row.teacher.id, row.teacher.name);
  }
  return {
    classes: grid.classes.map((one) => ({
      id: one.id,
      name: classDisplayName(one.grade, one.name),
    })),
    teachers: [...teachers.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    rooms: grid.rooms,
  };
}

/** The body of the export route for a choice and a format (each kind its own id). */
function bodyOf(choice: Choice, format: ViewExportFormat) {
  if (choice === 'branch') return versionExportRequestSchema.parse({ kind: 'branch', format });
  const [kind, id] = choice.split(':');
  return versionExportRequestSchema.parse(
    kind === 'class'
      ? { kind, classId: id, format }
      : kind === 'teacher'
        ? { kind, staffId: id, format }
        : { kind, roomId: id, format },
  );
}

/**
 * Print, PDF and Excel of a version's weekly pattern (task 5.9c-2, pull
 * request #200; `06`, step 8 "Print and export"; `edge/timetable`, "The wall
 * timetable is out of date"): the whole school, a class, a teacher or a
 * room, chosen from what the version's board names. The server stamps the
 * file (a draft DRAFT) and logs it; the part is shown to the roles with
 * `timetable` `export`, and the server decides anyway.
 */
export function VersionFiles({ version }: { version: TimetableVersion }) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const grid = useQuery(gridQuery(branchId, version.id));
  const choices = useMemo(
    () => (grid.data === undefined ? null : choicesOf(grid.data)),
    [grid.data],
  );
  const [picked, setPicked] = useState<Choice>('branch');
  const options = useMemo(
    () =>
      choices === null
        ? []
        : [
            { value: 'branch', label: t('timetable.history.printOptions.branch') },
            ...choices.classes.map((one) => ({
              value: `class:${one.id}`,
              label: t('timetable.history.printOptions.class', { name: one.name }),
            })),
            ...choices.teachers.map((one) => ({
              value: `teacher:${one.id}`,
              label: t('timetable.history.printOptions.teacher', { name: one.name }),
            })),
            ...choices.rooms.map((one) => ({
              value: `room:${one.id}`,
              label: t('timetable.history.printOptions.room', { name: one.name }),
            })),
          ],
    [choices, t],
  );
  // A choice no longer offered (the board read again) falls back to the school.
  const choice: Choice = options.some((one) => one.value === picked) ? picked : 'branch';

  return (
    <section aria-labelledby={`print-${version.id}`} className="grid gap-3">
      <h3 id={`print-${version.id}`} className={SECTION_TITLE}>
        {t('timetable.history.printTitle')}
      </h3>
      {grid.isError ? (
        <ErrorState
          error={grid.error}
          onRetry={() => {
            void grid.refetch();
          }}
        />
      ) : choices === null ? (
        <LoadingOutline />
      ) : (
        <>
          <SelectField
            label={t('timetable.history.printWhat')}
            name="printWhat"
            value={choice}
            options={options}
            onChange={(event) => {
              setPicked(event.target.value as Choice);
            }}
          />
          <TimetableFileButtons
            send={(format) =>
              api.POST('/api/timetable/versions/{id}/export', {
                params: { header: branchHeader(), path: { id: version.id } },
                body: bodyOf(choice, format),
                parseAs: 'blob',
              })
            }
          />
        </>
      )}
    </section>
  );
}
