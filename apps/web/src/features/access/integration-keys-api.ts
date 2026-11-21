import {
  integrationKeyChoicesSchema,
  integrationKeyCreatedSchema,
  integrationKeyListSchema,
  integrationKeySchema,
  type IntegrationKeyRecord,
} from '@sodiq/shared';
import { queryOptions } from '@tanstack/react-query';
import { api } from '@/api/client';
import { answerOf } from '@/api/failure';

export const INTEGRATION_KEYS_KEY = ['integration-keys'] as const;

/** Every key of the school, newest first (task 10.9); school-wide, the Super Admin's. */
export const integrationKeysQuery = () =>
  queryOptions({
    queryKey: INTEGRATION_KEYS_KEY,
    queryFn: async () =>
      integrationKeyListSchema.parse(await answerOf(api.GET('/api/integration-keys'))),
  });

/** The people who may be put on a key now, in every branch. */
export const integrationKeyChoicesQuery = () =>
  queryOptions({
    queryKey: [...INTEGRATION_KEYS_KEY, 'choices'],
    queryFn: async () =>
      integrationKeyChoicesSchema.parse(await answerOf(api.GET('/api/integration-keys/choices'))),
  });

/** Creates a key; the answer holds its secret this one time. */
export const createIntegrationKey = async (record: IntegrationKeyRecord) =>
  integrationKeyCreatedSchema.parse(
    await answerOf(api.POST('/api/integration-keys', { body: record })),
  );

export const changeIntegrationKeyPeople = async (id: string, staffRecordIds: string[]) =>
  integrationKeySchema.parse(
    await answerOf(
      api.PUT('/api/integration-keys/{id}/people', {
        params: { path: { id } },
        body: { staffRecordIds },
      }),
    ),
  );

export const changeIntegrationKeyEnd = async (id: string, endsOn: string) =>
  integrationKeySchema.parse(
    await answerOf(
      api.PUT('/api/integration-keys/{id}/end-date', {
        params: { path: { id } },
        body: { endsOn },
      }),
    ),
  );

export const revokeIntegrationKey = async (id: string) =>
  integrationKeySchema.parse(
    await answerOf(api.POST('/api/integration-keys/{id}/revoke', { params: { path: { id } } })),
  );
