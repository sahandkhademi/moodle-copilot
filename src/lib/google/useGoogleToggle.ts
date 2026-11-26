// Shared state machine for every "Add to Google" button: optimistic add + always-available Undo.
//   idle ──click──▶ added (shown instantly, Zapier works in the background) ──fail──▶ error
//   added ──Undo──▶ undoing ──▶ idle        (Undo waits for a still-running add first)
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SyncResult, UndoResult } from './sync';

export type GooglePhase = 'idle' | 'added' | 'undoing' | 'error';

export interface GoogleToggle {
  phase: GooglePhase;
  /** true while Zapier is still creating (the tick is already shown). */
  pending: boolean;
  error: string;
  add: () => void;
  undo: () => void;
}

const failed = (r?: SyncResult) => !r || r.calendar === 'failed' || r.tasks === 'failed';

export function useGoogleToggle(opts: {
  ids: string[];
  /** Everything in `ids` is already in Google (from storage). */
  alreadySynced: boolean;
  add: () => Promise<SyncResult[]>;
  undo: (ids: string[]) => Promise<UndoResult[]>;
}): GoogleToggle {
  const [phase, setPhase] = useState<GooglePhase>(opts.alreadySynced ? 'added' : 'idle');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const inflight = useRef<Promise<unknown> | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Follow storage (e.g. added from another view, or undone elsewhere) when nothing is running here.
  useEffect(() => {
    if (inflight.current) return;
    setPhase((p) => (p === 'undoing' || p === 'error' ? p : opts.alreadySynced ? 'added' : 'idle'));
  }, [opts.alreadySynced]);

  const add = useCallback(() => {
    if (inflight.current || !optsRef.current.ids.length) return;
    setError('');
    setPhase('added'); // optimistic: instant feedback
    setPending(true);
    const run = optsRef.current
      .add()
      .then((rs) => {
        const bad = rs.find(failed);
        if (bad) {
          setError(bad.error ?? "Couldn't add to Google");
          setPhase('error');
        }
      })
      .catch((e) => {
        setError(String(e));
        setPhase('error');
      })
      .finally(() => {
        setPending(false);
        inflight.current = null;
      });
    inflight.current = run;
  }, []);

  const undo = useCallback(() => {
    const go = async () => {
      if (inflight.current) await inflight.current; // can't delete what is still being created
      setPhase('undoing');
      setError('');
      try {
        const rs = await optsRef.current.undo(optsRef.current.ids);
        const bad = rs.find((r) => !r.ok);
        if (bad) {
          setError(bad.error ?? "Couldn't undo");
          setPhase('added');
        } else setPhase('idle');
      } catch (e) {
        setError(String(e));
        setPhase('added');
      }
    };
    void go();
  }, []);

  return { phase, pending, error, add, undo };
}
