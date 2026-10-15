import type { UseQueryResult } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

/**
 * The record named by an `already_exists` refusal, found in a list already
 * read (issue #105, H4). When the list does not hold it (an archived record
 * read before), the refusal keeps its general text and the list is read again
 * once for that refusal (`.claude/rules/web.md`: a refusal that names a record
 * by id).
 */
export function useTakenRecord<Item extends { id: string }>(
  taken: string | null,
  list: UseQueryResult<readonly Item[]>,
): Item | undefined {
  const found = taken === null ? undefined : list.data?.find((one) => one.id === taken);
  const asked = useRef<string | null>(null);
  const missing = taken !== null && list.data !== undefined && found === undefined;
  const { refetch } = list;
  useEffect(() => {
    if (missing && asked.current !== taken) {
      asked.current = taken;
      void refetch();
    }
  }, [missing, taken, refetch]);
  return found;
}
