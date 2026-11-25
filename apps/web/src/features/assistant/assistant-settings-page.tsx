import {
  ASSISTANT_ROLES,
  type AssistantActions,
  type AssistantArea,
  type AssistantRole,
  type AssistantSwitchChange,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { CHECKBOX, CHECKBOX_TARGET, FIELD, PANEL, SECTION_TITLE } from '@/components/ui/control';
import { Segmented } from '@/components/ui/segmented';
import { useMayView } from '@/features/access/use-view';
import { AssistantSettingsSection } from './assistant-settings-section';
import {
  ASSISTANT_ACTIONS_KEY,
  actionLabelKey,
  assistantActionsQuery,
  saveAssistantSwitches,
} from './assistant-api';

/**
 * Task 11.20 (`02`, Assistant, Switches): the Assistant settings page. The switches and limits of
 * 11.12 and the personal-data groups (the section), then every action of each of the three roles
 * grouped by area in the words of the screens, with a switch per action and per area. Each
 * switch is saved when it is pressed, and each change is in the audit log (plan decision 12;
 * review: a switch, not a form of 500 fields).
 */
export function AssistantSettingsPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader
        title={t('assistant.settingsPage.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('setup.title'), to: '/setup' },
        ]}
      />
      <div className="grid gap-4">
        <AssistantSettingsSection />
        <ActionsSection />
      </div>
    </>
  );
}

function ActionsSection() {
  const { t } = useTranslation();
  const mayEdit = useMayView('school_settings', 'edit');
  const actions = useQuery(assistantActionsQuery(true));
  const [role, setRole] = useState<AssistantRole>('super_admin');
  let body;
  if (actions.isError) {
    body = (
      <ErrorState
        error={actions.error}
        onRetry={() => {
          void actions.refetch();
        }}
      />
    );
  } else if (actions.data === undefined) {
    body = <LoadingOutline />;
  } else {
    body = <RoleActions actions={actions.data} role={role} mayEdit={mayEdit} />;
  }
  return (
    <section className={PANEL} aria-labelledby="assistant-actions">
      <div className="mb-4 grid gap-3">
        <h2 id="assistant-actions" className={SECTION_TITLE}>
          {t('assistant.settingsPage.actions')}
        </h2>
        <Segmented
          label={t('assistant.settingsPage.role')}
          options={ASSISTANT_ROLES.map((one) => ({ value: one, label: t(`roles.${one}`) }))}
          value={role}
          onChange={setRole}
        />
      </div>
      {body}
    </section>
  );
}

function RoleActions({
  actions,
  role,
  mayEdit,
}: {
  actions: AssistantActions;
  role: AssistantRole;
  mayEdit: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const save = useMutation({
    mutationFn: (changes: AssistantSwitchChange[]) => saveAssistantSwitches(changes),
    onSuccess: (saved) => {
      queryClient.setQueryData(ASSISTANT_ACTIONS_KEY, saved);
    },
  });
  const areas = useMemo(
    () => actions.roles.find((one) => one.role === role)?.areas ?? [],
    [actions, role],
  );
  const words = search.trim().toLowerCase();
  const shown = areas
    .map((area) => ({
      area,
      name: t(`assistant.areas.${area.area}`, { defaultValue: area.area }),
      actions: area.actions.filter((action) => {
        if (words === '') return true;
        const label = t(`assistant.actions.${actionLabelKey(action.operation)}`, {
          defaultValue: action.operation,
        });
        return (
          label.toLowerCase().includes(words) ||
          t(`assistant.areas.${area.area}`, { defaultValue: area.area })
            .toLowerCase()
            .includes(words)
        );
      }),
    }))
    .filter((one) => one.actions.length > 0);
  return (
    <div className="grid gap-4">
      <label className="grid max-w-md gap-1.5 text-sm font-medium">
        {t('assistant.settingsPage.search')}
        <input
          type="search"
          className={FIELD}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </label>
      {save.error !== null && <FailureAlert error={save.error} />}
      {shown.length === 0 ? (
        <EmptyState text={t('assistant.settingsPage.nothingFound')} />
      ) : (
        <ul className="grid gap-3">
          {shown.map(({ area, name, actions: listed }) => (
            <li key={area.area}>
              <AreaSwitches
                area={area}
                name={name}
                listed={listed}
                disabled={!mayEdit || save.isPending}
                onChange={(change) => {
                  save.mutate([{ role, area: area.area, ...change }]);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AreaSwitches({
  area,
  name,
  listed,
  disabled,
  onChange,
}: {
  area: AssistantArea;
  name: string;
  listed: AssistantArea['actions'];
  disabled: boolean;
  onChange: (change: { route?: string; on: boolean }) => void;
}) {
  const { t } = useTranslation();
  const on = area.actions.filter((action) => action.on).length;
  return (
    <details className="rounded-lg border px-3 py-2">
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">{name}</span>
        <span className="text-sm text-muted-foreground">
          {t('assistant.settingsPage.count', { on, total: area.actions.length })}
        </span>
      </summary>
      <div className="mt-2 grid gap-2">
        <label className={`${CHECKBOX_TARGET} text-sm font-semibold`}>
          <input
            type="checkbox"
            className={CHECKBOX}
            checked={area.on && on === area.actions.length}
            disabled={disabled}
            onChange={(event) => {
              onChange({ on: event.target.checked });
            }}
          />
          {t('assistant.settingsPage.areaSwitch', { area: name })}
        </label>
        <ul className="grid gap-1 sm:pl-6">
          {listed.map((action) => (
            <li key={action.route}>
              <label className={`${CHECKBOX_TARGET} flex-wrap text-sm`}>
                <input
                  type="checkbox"
                  className={CHECKBOX}
                  checked={action.on}
                  disabled={disabled}
                  onChange={(event) => {
                    onChange({ route: action.route, on: event.target.checked });
                  }}
                />
                <span>
                  {t(`assistant.actions.${actionLabelKey(action.operation)}`, {
                    defaultValue: action.operation,
                  })}
                </span>
                <span className="text-muted-foreground">
                  {t(`assistant.settingsPage.kind_${action.kind}`)}
                  {!action.hasTool && ` · ${t('assistant.settingsPage.noTool')}`}
                  {!action.defaultOn && ` · ${t('assistant.settingsPage.offAtStart')}`}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
