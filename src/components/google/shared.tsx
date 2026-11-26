// Small helpers shared by the Google sync UI.
import { useEffect, useState } from 'react';
import { KEYS, watchItem } from '@/lib/storage';
import { getSynced, type SyncedMap, type SyncResult } from '@/lib/google/sync';

/** Live "already synced" map. */
export function useSynced(): SyncedMap {
  const [map, setMap] = useState<SyncedMap>({});
  useEffect(() => {
    let alive = true;
    getSynced().then((m) => alive && setMap(m));
    const off = watchItem(KEYS.googleSynced, () => getSynced().then((m) => alive && setMap(m)));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return map;
}

export const failedResult = (r?: SyncResult) => !r || r.calendar === 'failed' || r.tasks === 'failed';
