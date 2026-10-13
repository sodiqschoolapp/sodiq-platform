import {
  nextDay,
  SLOT_LENGTH_MAX_MINUTES,
  SLOT_LENGTH_MIN_MINUTES,
  slotLengthChangeSchema,
  slotTypeRenameSchema,
  type SlotLengthChange,
  type SlotType,
  type SlotTypeRename,
} from '@sodiq/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { DateField, Field, NumberField } from '@/components/field';
import { wholeNumber } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { PanelActions } from '@/components/list/panel-actions';
import { usePanelEditing } from '@/components/list/use-panel-editing';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePreview } from './template-table';
import { invalidateTemplates } from './templates-api';
import { schoolDateText } from '@/lib/dates';
import { SECTION_TITLE } from '@/components/ui/control';

interface SlotTypePanelProps {
  slotType: SlotType;
  /** Today in branch time, from the server. */
  today: string;
  canEdit: boolean;
  canArchive: boolean;
}

/**
 * A slot type in the side panel: its name, its length with the date a new one
 * takes effect (tomorrow at the earliest, `03`; answer 12), the history of its
 * lengths, and archive or restore. A new length is saved after the preview of
 * the table (`03`: "saving … shows that table with the changes marked").
 */
export function SlotTypePanel({ slotType, today, canEdit, canArchive }: SlotTypePanelProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const preview = usePreview();
  const number = new Intl.NumberFormat(i18n.language);
  const archived = slotType.archivedAt !== null;
  const refresh = () => invalidateTemplates(queryClient);
  const path = { params: { path: { id: slotType.id }, header: branchHeader() } };
  // One form open at a time: the name or a new length (task 2.7c-2b-1).
  const panel = usePanelEditing();

  const rename = useMutation({
    mutationFn: (record: SlotTypeRename) =>
      answerOf(api.PATCH('/api/setup/slot-types/{id}', { ...path, body: record })),
    onSuccess: refresh,
  });
  const changeLength = useMutation({
    mutationFn: (change: SlotLengthChange) =>
      answerOf(api.POST('/api/setup/slot-types/{id}/lengths', { ...path, body: change })),
    onSuccess: refresh,
  });
  const archive = useMutation({
    mutationFn: (restore: boolean) =>
      answerOf(
        restore
          ? api.POST('/api/setup/slot-types/{id}/restore', path)
          : api.POST('/api/setup/slot-types/{id}/archive', path),
      ),
    onSuccess: refresh,
  });

  const renameForm = useRecordForm({
    schema: slotTypeRenameSchema,
    initial: { name: slotType.name },
    save: async (record) => {
      await rename.mutateAsync(record);
      panel.stop({ saved: true });
    },
  });
  const lengthForm = useRecordForm({
    schema: slotLengthChangeSchema,
    initial: { lengthMinutes: String(slotType.lengthMinutes), from: nextDay(today) },
    read: (typed) => ({ lengthMinutes: wholeNumber(typed.lengthMinutes), from: typed.from }),
    save: async (change) => {
      await preview.confirm({ kind: 'slot_length', slotTypeId: slotType.id, change });
      await changeLength.mutateAsync(change);
      panel.stop({ saved: true });
    },
  });

  const askArchive = async () => {
    if (
      await confirm({
        title: archived
          ? t('setup.slotTypes.restoreTitle', { name: slotType.name })
          : t('setup.slotTypes.archiveTitle', { name: slotType.name }),
        text: archived ? undefined : t('setup.slotTypes.archiveText'),
        names: [slotType.name],
        action: archived ? t('setup.slotTypes.restore') : t('setup.slotTypes.archive'),
        destructive: !archived,
      })
    ) {
      archive.mutate(archived);
    }
  };

  const close = () => {
    panel.stop();
  };
  const editing = canEdit && !archived ? panel.editing : null;

  return (
    <div ref={panel.root} className="grid gap-6">
      {editing === 'record' ? (
        // A form of the record takes the read view's place: its Save and Cancel are last.
        <RecordForm form={renameForm} label={slotType.name} onCancel={close}>
          <Field
            label={t('setup.slotTypes.name')}
            autoComplete="off"
            {...renameForm.bind('name')}
          />
        </RecordForm>
      ) : editing === 'length' ? (
        <section className="grid gap-3">
          <h3 className={SECTION_TITLE}>{t('setup.slotTypes.changeLength')}</h3>
          <RecordForm form={lengthForm} label={t('setup.slotTypes.changeLength')} onCancel={close}>
            <NumberField
              label={t('setup.slotTypes.length')}
              note={t('setup.slotTypes.lengthNote', {
                min: number.format(SLOT_LENGTH_MIN_MINUTES),
                max: number.format(SLOT_LENGTH_MAX_MINUTES),
              })}
              {...lengthForm.bind('lengthMinutes')}
            />
            <DateField label={t('setup.slotTypes.from')} {...lengthForm.bind('from')} />
          </RecordForm>
        </section>
      ) : (
        <>
          <dl className="grid gap-2 text-sm">
            <div className="grid gap-0.5">
              <dt className="text-muted-foreground">{t('setup.slotTypes.kind')}</dt>
              <dd>{t(`setup.slotTypes.kinds.${slotType.kind}`)}</dd>
            </div>
          </dl>
          <section className="grid gap-3">
            <h3 className={SECTION_TITLE}>{t('setup.slotTypes.lengths')}</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('setup.slotTypes.length')}</TableHead>
                  <TableHead>{t('setup.slotTypes.from')}</TableHead>
                  <TableHead>{t('setup.slotTypes.until')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slotType.lengths.map((length) => (
                  <TableRow key={length.validFrom}>
                    <TableCell>
                      {t('setup.slotTypes.minutes', { n: number.format(length.lengthMinutes) })}
                    </TableCell>
                    <TableCell>{schoolDateText(length.validFrom, i18n.language)}</TableCell>
                    <TableCell>
                      {length.validUntil === null
                        ? ''
                        : schoolDateText(length.validUntil, i18n.language)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        </>
      )}
      {preview.dialog}
      {(canEdit || canArchive) && panel.editing === null && (
        <PanelActions
          primary={
            canEdit &&
            !archived && (
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
            canEdit && !archived ? (
              <Button
                variant="secondary"
                {...panel.opener('length')}
                onClick={() => {
                  panel.start('length');
                }}
              >
                {t('setup.slotTypes.changeLength')}
              </Button>
            ) : (
              canArchive &&
              archived && (
                <Button
                  variant="secondary"
                  disabled={archive.isPending}
                  onClick={() => {
                    void askArchive();
                  }}
                >
                  {t('setup.slotTypes.restore')}
                </Button>
              )
            )
          }
          danger={
            canArchive &&
            !archived && (
              <Button
                variant="destructive"
                disabled={archive.isPending}
                onClick={() => {
                  void askArchive();
                }}
              >
                {t('setup.slotTypes.archive')}
              </Button>
            )
          }
          error={archive.error}
          saved={panel.saved}
        />
      )}
    </div>
  );
}
