import { trustedDeviceListSchema } from '@sodiq/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { answerOf } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AccountSection } from './account-section';
import { refreshSession } from '../session';
import { useLeaveSignedOut } from '../use-sign-out';
import { DEVICES_KEY, sessionsQuery } from './sessions-section';
import { formatMoment } from '@/lib/dates';
import { deviceName } from '@/lib/device-name';

export const devicesQuery = queryOptions({
  queryKey: DEVICES_KEY,
  queryFn: async () =>
    trustedDeviceListSchema.parse(await answerOf(api.GET('/api/auth/trusted-devices'))),
});

/**
 * Edge cases, "Trust this device": the profile lists trusted devices and each
 * can be removed; removing one ends its session at once. Removing the device
 * that asks works like sign-out (decided by the owner, task 0.6d).
 */
export function TrustedDevicesSection() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const leave = useLeaveSignedOut();
  const devices = useQuery(devicesQuery);

  const remove = useMutation({
    mutationFn: async (device: { id: string; current: boolean }) => {
      await answerOf(
        api.DELETE('/api/auth/trusted-devices/{id}', { params: { path: { id: device.id } } }),
      );
      return device;
    },
    onSuccess: async (device) => {
      if (device.current) {
        leave();
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DEVICES_KEY }),
        queryClient.invalidateQueries({ queryKey: sessionsQuery.queryKey }),
        refreshSession(queryClient),
      ]);
    },
  });

  const ask = async (device: { id: string; current: boolean; userAgent: string | null }) => {
    if (
      await confirm({
        title: t('account.removeTitle'),
        text: device.current ? t('account.removeThisText') : t('account.removeText'),
        names: [deviceName(t, device.userAgent) ?? t('account.unknownDevice')],
        action: t('account.remove'),
        destructive: true,
      })
    ) {
      remove.mutate(device);
    }
  };

  let body;
  if (devices.data !== undefined) {
    body =
      devices.data.devices.length === 0 ? (
        <EmptyState text={t('account.devicesEmpty')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('account.device')}</TableHead>
              <TableHead>{t('account.started')}</TableHead>
              <TableHead>{t('account.trustedUntil')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('account.marks')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices.data.devices.map((device) => (
              <TableRow key={device.id}>
                <TableCell className="max-w-xs truncate" title={device.userAgent ?? undefined}>
                  {deviceName(t, device.userAgent) ?? t('account.unknownDevice')}
                </TableCell>
                <TableCell>{formatMoment(i18n.language, device.startedAt)}</TableCell>
                <TableCell>{formatMoment(i18n.language, device.trustedUntil)}</TableCell>
                <TableCell className="space-x-3">
                  {device.current && (
                    <span className="text-muted-foreground">{t('account.thisDevice')}</span>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={remove.isPending}
                    aria-label={t('account.removeNamed', {
                      name: deviceName(t, device.userAgent) ?? t('account.unknownDevice'),
                    })}
                    onClick={() => {
                      void ask(device);
                    }}
                  >
                    {t('account.remove')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
  } else if (devices.isError) {
    body = (
      <ErrorState
        error={devices.error}
        onRetry={() => {
          void devices.refetch();
        }}
      />
    );
  } else {
    body = <LoadingOutline />;
  }

  return (
    <AccountSection title={t('account.devicesTitle')} text={t('account.devicesText')}>
      {body}
      <FailureAlert error={remove.error} />
    </AccountSection>
  );
}
