import {
  ASSISTANT_DATA_GROUPS,
  assistantSettingsRecordSchema,
  type AssistantSettings,
} from '@sodiq/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CHECKED, CheckboxField, NumberField } from '@/components/field';
import { wholeNumber } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { ErrorState, LoadingOutline } from '@/components/states';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { useMayView } from '@/features/access/use-view';
import { ASSISTANT_KEY, assistantSettingsQuery, saveAssistantSettings } from './assistant-api';

/**
 * Task 11.12 (`02`, Assistant: "The Super Admin can switch it off for the whole school or for one
 * of the three roles; it is off until switched on"; Limits): the switches, the daily limit per
 * person and the monthly cap, set by the Super Admin alone (`school_settings`, plan decision 3).
 */
export function AssistantSettingsSection(): React.JSX.Element | null {
  const { t } = useTranslation();
  const mayEdit = useMayView('school_settings', 'edit');
  const settings = useQuery(assistantSettingsQuery(mayEdit));
  if (!mayEdit) return null;
  let body;
  if (settings.isError) {
    body = (
      <ErrorState
        error={settings.error}
        onRetry={() => {
          void settings.refetch();
        }}
      />
    );
  } else if (settings.data === undefined) {
    body = <LoadingOutline />;
  } else {
    body = <AssistantSettingsForm settings={settings.data} />;
  }
  return (
    <section className={PANEL} aria-labelledby="assistant-settings">
      <h2 id="assistant-settings" className={SECTION_TITLE}>
        {t('assistant.settings.title')}
      </h2>
      {body}
    </section>
  );
}

type Field =
  | 'schoolOn'
  | 'dailyLimit'
  | 'monthlyCapDollars'
  | 'questionActions'
  | 'proposalSteps'
  | 'questionMinutes'
  | 'fallbackOn'
  | `role_${string}`
  | `group_${string}`;

function AssistantSettingsForm({ settings }: { settings: AssistantSettings }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const initial: Record<string, string> = {
    schoolOn: settings.schoolOn ? CHECKED : '',
    dailyLimit: String(settings.dailyLimit),
    monthlyCapDollars: String(settings.monthlyCapDollars),
    questionActions: String(settings.questionActions),
    proposalSteps: String(settings.proposalSteps),
    questionMinutes: String(settings.questionMinutes),
    fallbackOn: settings.fallbackOn ? CHECKED : '',
  };
  for (const group of ASSISTANT_DATA_GROUPS) {
    initial[`group_${group}`] = settings.dataGroupsOn.includes(group) ? CHECKED : '';
  }
  for (const role of settings.roles) {
    initial[`role_${role}`] = settings.rolesOn.includes(role) ? CHECKED : '';
  }
  const form = useRecordForm<Field, ReturnType<typeof assistantSettingsRecordSchema.parse>>({
    schema: assistantSettingsRecordSchema,
    initial: initial,
    read: (typed) => ({
      schoolOn: typed.schoolOn === CHECKED,
      // A role the screen does not show keeps what it had.
      rolesOn: [
        ...settings.rolesOn.filter((role) => !settings.roles.includes(role)),
        ...settings.roles.filter((role) => typed[`role_${role}`] === CHECKED),
      ],
      dailyLimit: wholeNumber(typed.dailyLimit),
      monthlyCapDollars: wholeNumber(typed.monthlyCapDollars),
      questionActions: wholeNumber(typed.questionActions),
      proposalSteps: wholeNumber(typed.proposalSteps),
      questionMinutes: wholeNumber(typed.questionMinutes),
      fallbackOn: typed.fallbackOn === CHECKED,
      // Task 11.20: the personal-data groups that reach the model.
      dataGroupsOn: ASSISTANT_DATA_GROUPS.filter((group) => typed[`group_${group}`] === CHECKED),
    }),
    save: async (record) => {
      const saved = await saveAssistantSettings(record);
      queryClient.setQueryData(assistantSettingsQuery(true).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: [...ASSISTANT_KEY, 'status'] });
    },
  });
  const spent = new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'USD' }).format(
    settings.spentThisMonthCents / 100,
  );
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        {settings.modelConfigured
          ? t('assistant.settings.spent', { amount: spent, model: settings.model ?? '' })
          : t('assistant.settings.noModel')}
      </p>
      <RecordForm form={form} label={t('assistant.settings.title')}>
        <CheckboxField label={t('assistant.settings.schoolOn')} {...form.bind('schoolOn')} />
        {settings.roles.map((role) => (
          <CheckboxField
            key={role}
            label={t('assistant.settings.roleOn', { role: t(`roles.${role}`) })}
            {...form.bind(`role_${role}`)}
          />
        ))}
        {/* Task 11.21 (`02`, Limits): 0 is no daily limit; the cap is always in force. */}
        <NumberField
          label={t('assistant.settings.dailyLimit')}
          note={t('assistant.settings.dailyLimitNote')}
          {...form.bind('dailyLimit')}
        />
        <NumberField
          label={t('assistant.settings.monthlyCap')}
          {...form.bind('monthlyCapDollars')}
        />
        <NumberField
          label={t('assistant.settings.questionActions')}
          {...form.bind('questionActions')}
        />
        <NumberField label={t('assistant.settings.proposalSteps')} {...form.bind('proposalSteps')} />
        <NumberField
          label={t('assistant.settings.questionMinutes')}
          {...form.bind('questionMinutes')}
        />
        {/* Task 11.15 (`02`, Where the model runs): on until switched off. */}
        <CheckboxField
          label={t('assistant.settings.fallbackOn')}
          note={t('assistant.settings.fallbackNote', {
            number: settings.fallbackQuestionsThisMonth,
          })}
          {...form.bind('fallbackOn')}
        />
        {/* Task 11.20 (`02`, Personal data and the model): all on at the start. */}
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-semibold">
            {t('assistant.settings.dataGroups')}
          </legend>
          {ASSISTANT_DATA_GROUPS.map((group) => (
            <CheckboxField
              key={group}
              label={t(`assistant.settings.dataGroup_${group}`)}
              {...form.bind(`group_${group}`)}
            />
          ))}
          <p className="text-sm text-muted-foreground">{t('assistant.settings.dataGroupsNote')}</p>
        </fieldset>
      </RecordForm>
    </div>
  );
}
