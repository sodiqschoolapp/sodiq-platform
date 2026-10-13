import type { SampleRecord } from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import type { Column } from '@/components/list/list-state';
import { PanelActions } from '@/components/list/panel-actions';
import { usePanelEditing } from '@/components/list/use-panel-editing';
import { Button } from '@/components/ui/button';
import { SampleForm } from './sample-form';
import type { SampleRow } from './sample-rows';

interface SamplePanelProps {
  row: SampleRow;
  /** The columns of the list: the read view shows each of them. */
  columns: readonly Column<SampleRow>[];
  onSave: (record: SampleRecord) => Promise<void>;
}

/**
 * The sample record in the side panel (task 2.7c-2b-1): read first, with its
 * actions at the bottom (`PanelActions`); Edit opens the form in the read
 * view's place, and Save or Cancel brings the read view back.
 */
export function SamplePanel({ row, columns, onSave }: SamplePanelProps) {
  const { t } = useTranslation();
  const panel = usePanelEditing();
  return (
    <div className="grid gap-6">
      {panel.editing === 'record' ? (
        <SampleForm
          row={row}
          onSave={async (record) => {
            await onSave(record);
            panel.stop({ saved: true });
          }}
          onCancel={() => {
            panel.stop();
          }}
        />
      ) : (
        <dl className="grid gap-3">
          {columns.map((column) => (
            <div key={column.key} className="grid gap-0.5">
              <dt className="text-sm text-muted-foreground">{column.header}</dt>
              <dd>{column.cell(row)}</dd>
            </div>
          ))}
        </dl>
      )}
      {panel.editing === null && (
        <PanelActions
          primary={
            <Button
              {...panel.opener('record')}
              onClick={() => {
                panel.start('record');
              }}
            >
              {t('form.edit')}
            </Button>
          }
          saved={panel.saved}
        />
      )}
    </div>
  );
}
