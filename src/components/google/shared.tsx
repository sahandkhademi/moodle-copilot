// Small helpers shared by the Google sync UI.
import { useEffect, useState } from 'react';
import { KEYS, watchItem } from '@/lib/storage';
import { getSynced, type SyncedMap, type SyncResult } from '@/lib/google/sync';
import { useSettings } from '@/lib/settings';

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

export function useLang(): 'de' | 'en' {
  const [s] = useSettings();
  return s.language;
}

export const T = {
  de: {
    add: 'Zu Google hinzufügen',
    added: 'In Google',
    syncAll: 'In Google übernehmen',
    syncing: 'Übertrage…',
    allDone: 'Alles in Google',
    inBoth: 'in Kalender & Aufgaben',
    calendar: 'Kalender',
    tasks: 'Aufgaben',
    confirmTitle: 'In Google übernehmen?',
    confirm: 'Bestätigen',
    cancel: 'Abbrechen',
    cancelled: 'Abgebrochen',
    retry: 'Erneut versuchen',
    nothing: 'Nichts ausgewählt',
    done: 'Fertig',
    exists: 'schon vorhanden',
    created: 'erstellt',
    failed: 'Fehler',
    testBtn: 'Verbindung testen',
    testing: 'Teste…',
    testHint: 'Zapier-URL eintragen, dann kann die Verbindung getestet werden.',
    testMock: 'Mock-Modus aktiv: Zapier wird nicht benutzt.',
    connected: 'Verbunden. Tools:',
  },
  en: {
    add: 'Add to Google',
    added: 'In Google',
    syncAll: 'Sync all to Google',
    syncing: 'Syncing…',
    allDone: 'All in Google',
    inBoth: 'in Calendar & Tasks',
    calendar: 'Calendar',
    tasks: 'Tasks',
    confirmTitle: 'Add to Google?',
    confirm: 'Confirm',
    cancel: 'Cancel',
    cancelled: 'Cancelled',
    retry: 'Try again',
    nothing: 'Nothing selected',
    done: 'Done',
    exists: 'already there',
    created: 'created',
    failed: 'failed',
    testBtn: 'Test connection',
    testing: 'Testing…',
    testHint: 'Enter the Zapier URL to test the connection.',
    testMock: 'Mock mode is on: Zapier is not used.',
    connected: 'Connected. Tools:',
  },
} as const;

export const failedResult = (r?: SyncResult) => !r || r.calendar === 'failed' || r.tasks === 'failed';

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function CheckIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function CalendarIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
      <path d="M12 13.5v4M10 15.5h4" />
    </svg>
  );
}
