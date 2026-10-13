import { nextDay, type CalendarEntry, type CalendarEntryRecord } from '@sodiq/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { PanelActions } from '@/components/list/panel-actions';
import { usePanelEditing } from '@/components/list/use-panel-editing';
import { Button } from '@/components/ui/button';
import { hasStarted, invalidateCalendar, isPast } from './calendar-api';
import { CalendarEntryForm } from './calendar-entry-form';
import { datesText, gradesText, useCalendarPreview } from './calendar-preview';
import { weekdayName } from '@/lib/dates';

interface CalendarEntryPanelProps {
  entry: CalendarEntry;
  /** Today in branch time, from the server. */
  today: string;
  templates: readonly { id: string; name: string }[];
  canEdit: boolean;
  canArchive: boolean;
}

/**
 * An entry of the calendar in the side panel: what it is, its form, and
 * archive or restore. Only dates after today change (answer 16, decision 3
 * of pull request #47): an entry wholly in the past is read-only, a started
 * one offers its name and its last date, and is shortened instead of archived.
 * Every save that can change a date shows its preview first.
 */
export function CalendarEntryPanel({
  entry,
  today,
  templates,
  canEdit,
  canArchive,
}: CalendarEntryPanelProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const preview = useCalendarPreview();
  const archived = entry.archivedAt !== null;
  const past = isPast(entry, today);
  const started = hasStarted(entry, today);
  const path = { params: { path: { id: entry.id }, header: branchHeader() } };
  const refresh = () => invalidateCalendar(queryClient);
  // The form is behind Edit (task 2.7c-2b-1).
  const panel = usePanelEditing();

  const edit = useMutation({
    mutationFn: (record: CalendarEntryRecord) =>
      answerOf(api.PATCH('/api/setup/calendar-entries/{id}', { ...path, body: record })),
    onSuccess: refresh,
  });
  const archive = useMutation({
    mutationFn: async (restore: boolean) => {
      await preview.confirm({ action: restore ? 'restore' : 'archive', id: entry.id });
      return answerOf(
        restore
          ? api.POST('/api/setup/calendar-entries/{id}/restore', path)
          : api.POST('/api/setup/calendar-entries/{id}/archive', path),
      );
    },
    onSuccess: refresh,
  });

  const save = async (record: CalendarEntryRecord) => {
    // A new name alone changes no date: it is saved without the preview (decision 11).
    const nameOnly =
      record.firstDate === entry.firstDate &&
      record.lastDate === entry.lastDate &&
      record.gradeFrom === entry.gradeFrom &&
      record.gradeTo === entry.gradeTo &&
      record.dayTemplateId === entry.dayTemplateId &&
      record.followsWeekday === entry.followsWeekday &&
      record.examWeek === entry.examWeek;
    if (!nameOnly) {
      await preview.confirm({ action: 'edit', id: entry.id, record });
    }
    await edit.mutateAsync(record);
    panel.stop({ saved: true, key: 'record' });
  };

  const details: [string, string][] = [
    [t('setup.calendar.kind'), t(`setup.calendar.kinds.${entry.kind}`)],
    [t('setup.calendar.dates'), datesText(entry.firstDate, entry.lastDate, i18n.language)],
    [t('setup.calendar.scope'), gradesText(t, entry.gradeFrom, entry.gradeTo)],
    ...(entry.kind === 'special_day'
      ? ([
          [t('setup.calendar.template'), entry.dayTemplateName ?? ''],
          [
            t('setup.calendar.follows'),
            entry.followsWeekday === null
              ? t('setup.calendar.ownWeekday')
              : weekdayName(i18n.language, entry.followsWeekday),
          ],
          [
            t('setup.calendar.examWeek'),
            entry.examWeek === null
              ? t('setup.calendar.notExamWeek')
              : t(`setup.calendar.examWeeks.${entry.examWeek}`),
          ],
        ] as [string, string][])
      : []),
  ];

  const editable = canEdit && !archived && !past;
  // A started entry is shortened, not archived; a past one is left as it is.
  const archivable = canArchive && (!started || archived) && !past;

  return (
    <div className="grid gap-6">
      {editable && panel.editing === 'record' ? (
        // The form takes the read view's place: its Save and Cancel are last.
        <CalendarEntryForm
          entry={entry}
          firstDate={nextDay(today)}
          templates={templates}
          limited={started}
          label={entry.name}
          onSave={save}
          onCancel={() => {
            panel.stop();
          }}
        />
      ) : (
        <dl className="grid gap-2 text-sm">
          {details.map(([term, value]) => (
            <div key={term} className="grid gap-0.5">
              <dt className="text-muted-foreground">{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {preview.dialog}
      {(canEdit || canArchive) && panel.editing === null && (
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
            archivable &&
            archived && (
              <Button
                variant="secondary"
                disabled={archive.isPending}
                onClick={() => {
                  archive.mutate(true);
                }}
              >
                {t('setup.calendar.restore')}
              </Button>
            )
          }
          danger={
            archivable &&
            !archived && (
              <Button
                variant="destructive"
                disabled={archive.isPending}
                onClick={() => {
                  archive.mutate(false);
                }}
              >
                {t('setup.calendar.archive')}
              </Button>
            )
          }
          note={canEdit && !archived && past ? t('setup.calendar.pastNote') : null}
          error={archive.error}
          saved={panel.saved}
        />
      )}
    </div>
  );
}
