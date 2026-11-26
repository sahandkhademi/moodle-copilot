// Animated "working on it" steps instead of typing dots. Steps advance on a timer; the last one keeps
// spinning until the answer starts streaming in. A real tool call (e.g. "Checked grades") is shown as a step too.
import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { stepsFor } from '@/lib/ai/workingSteps';
import { cx } from '@/components/ui/moodle';

const STEP_MS = 1100;

export function WorkingSteps({ prompt, compact = false }: { prompt: string; compact?: boolean }) {
  const { steps } = useMemo(() => stepsFor(prompt), [prompt]);
  const [i, setI] = useState(0);

  useEffect(() => {
    setI(0);
    let n = 0;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      n = Math.min(n + 1, steps.length - 1);
      setI(n);
      // Slightly irregular pacing reads as "real work"; stop advancing on the last step.
      if (n < steps.length - 1) t = setTimeout(tick, STEP_MS + Math.random() * 500);
    };
    t = setTimeout(tick, 700 + Math.random() * 300);
    return () => clearTimeout(t);
  }, [steps]);

  if (compact) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-[0.8125rem] text-muted" aria-live="polite">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-500" />
        <span className="copilot-shimmer">{steps[i]}…</span>
      </div>
    );
  }

  return (
    <ol className="space-y-1 text-[0.875rem]" aria-live="polite" aria-label="Working">
      {steps.slice(0, i + 1).map((s, k) => {
        const done = k < i;
        return (
          <li key={s} className={cx('flex items-center gap-2 transition-opacity', done ? 'text-muted' : 'text-ink')} style={{ animation: 'copilot-step-in 220ms ease-out' }}>
            {done ? <Check className="h-3.5 w-3.5 shrink-0 text-success" /> : <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-brand-500" />}
            <span className={done ? undefined : 'copilot-shimmer'}>{s}{done ? '' : '…'}</span>
          </li>
        );
      })}
    </ol>
  );
}
