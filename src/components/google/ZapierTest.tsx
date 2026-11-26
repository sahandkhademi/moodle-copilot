// "Test Zapier connection" control in Settings (plan 3.2): asks Claude to list the MCP tools, no writes.
import { useState } from 'react';
import { useSettings } from '@/lib/settings';
import { testZapier, type ZapierTestResult } from '@/lib/google/zapier';
import { CheckIcon, Spinner, T } from './shared';

export function ZapierTest() {
  const [s] = useSettings();
  const t = T[s.language];
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ZapierTestResult | null>(null);

  if (s.mockMode) return <p className="text-xs text-slate-500 dark:text-slate-400">{t.testMock}</p>;
  if (!s.zapierMcpUrl) return <p className="text-xs text-slate-500 dark:text-slate-400">{t.testHint}</p>;

  const run = async () => {
    setBusy(true);
    setRes(null);
    setRes(await testZapier());
    setBusy(false);
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg border border-brand-500 px-3 py-1.5 text-sm font-medium text-brand-600 transition-all hover:bg-brand-50 active:scale-95 disabled:opacity-60 dark:text-brand-500 dark:hover:bg-brand-500/10"
      >
        {busy && <Spinner className="h-3.5 w-3.5" />}
        {busy ? t.testing : t.testBtn}
      </button>
      {res?.ok && (
        <div className="rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          <div className="flex items-center gap-1.5 font-semibold">
            <CheckIcon className="h-3.5 w-3.5" /> {t.connected}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {res.tools.map((n) => (
              <span key={n} className="rounded-md bg-white/70 px-1.5 py-0.5 font-mono text-[11px] dark:bg-slate-900/60">
                {n}
              </span>
            ))}
          </div>
        </div>
      )}
      {res && !res.ok && <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">✕ {res.error}</div>}
    </div>
  );
}
