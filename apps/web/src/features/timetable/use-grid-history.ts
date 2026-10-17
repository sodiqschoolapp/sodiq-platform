import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { EMPTY_HISTORY, type GridHistory } from './grid-history';

/**
 * The undo and redo history of the grid of one version (task 5.4c-2,
 * decision 6): held by the builder page, so moving to another step and back
 * keeps it; another version starts empty, and a reload loses it.
 */
export function useGridHistory(
  versionId: string | null,
): [GridHistory, Dispatch<SetStateAction<GridHistory>>] {
  const [held, setHeld] = useState<{ versionId: string | null; history: GridHistory }>({
    versionId,
    history: EMPTY_HISTORY,
  });
  const history = held.versionId === versionId ? held.history : EMPTY_HISTORY;
  const setHistory = useCallback<Dispatch<SetStateAction<GridHistory>>>(
    (next) => {
      setHeld((current) => {
        const base = current.versionId === versionId ? current.history : EMPTY_HISTORY;
        return { versionId, history: typeof next === 'function' ? next(base) : next };
      });
    },
    [versionId],
  );
  return [history, setHistory];
}
