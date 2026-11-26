import { useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { useSettings, type Settings } from '@/lib/settings';
import { DemoTools } from '@/components/demo/DemoTools';
import { MoodleTest } from '@/components/moodle/MoodleTest';
import { ZapierTest } from '@/components/google/ZapierTest';
import { Block, Input } from '@/components/ui/moodle';

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block font-semibold">{label}</span>
      {children}
      {hint && <span className="block text-[0.8125rem] text-muted">{hint}</span>}
    </label>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span>
        <span className="block font-semibold">{label}</span>
        {hint && <span className="block text-[0.8125rem] text-muted">{hint}</span>}
      </span>
      {/* Moodle-style switch */}
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-5 w-9 rounded-full border border-[#8f959e] bg-white transition-colors peer-checked:border-brand-500 peer-checked:bg-brand-500" />
        <span className="absolute left-[3px] top-[3px] h-3.5 w-3.5 rounded-full bg-[#8f959e] transition-transform peer-checked:translate-x-4 peer-checked:bg-white" />
      </span>
    </label>
  );
}

function Percent({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  return (
    <div className="relative">
      <Input className="pr-7" type="number" min={0} max={100} defaultValue={value} onBlur={(e) => onCommit(Number(e.target.value))} />
      <span className="pointer-events-none absolute right-2.5 top-1.5 text-muted">%</span>
    </div>
  );
}

export default function SettingsView() {
  const [s, update, loaded] = useSettings();
  const [saved, setSaved] = useState(false);
  if (!loaded) return null;

  const set = async (patch: Partial<Settings>) => {
    await update(patch);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  return (
    <div className="space-y-4 px-4 py-5">
      <div className="flex items-center justify-between">
        <h1 className="text-[1.75rem] font-bold leading-tight">Settings</h1>
        <span className={`flex items-center gap-1 text-[0.8125rem] text-success transition-opacity ${saved ? 'opacity-100' : 'opacity-0'}`}>
          <Check className="h-4 w-4" /> Saved
        </span>
      </div>

      <Block title="Demo">
        <div className="space-y-3">
          <Toggle label="Demo data" hint="Sample courses and grades. Google writes are simulated." checked={s.mockMode} onChange={(v) => set({ mockMode: v })} />
          <DemoTools />
        </div>
      </Block>

      <Block title="Moodle">
        <div className="space-y-3">
          <Field label="Moodle URL" hint="Log in to Moodle in this browser. Copilot uses that session.">
            <Input placeholder="https://moodle.jku.at" defaultValue={s.moodleUrl} onBlur={(e) => set({ moodleUrl: e.target.value.trim().replace(/\/$/, '') })} />
          </Field>
          <MoodleTest />
        </div>
      </Block>

      <Block title="Assistant">
        <div className="space-y-3">
          <Field label="Gemini API key" hint="From Google AI Studio. Stored only on this computer.">
            <Input type="password" placeholder="AIza… or AQ.…" defaultValue={s.geminiApiKey} onBlur={(e) => set({ geminiApiKey: e.target.value.trim() })} />
          </Field>
          <Toggle label="Read answers aloud" checked={s.voiceReadAloud} onChange={(v) => set({ voiceReadAloud: v })} />
        </div>
      </Block>

      <Block title="Google Calendar and Tasks">
        <div className="space-y-3">
          <Field label="Zapier MCP server URL" hint="From mcp.zapier.com, with Google Calendar and Google Tasks actions enabled.">
            <Input placeholder="https://mcp.zapier.com/api/mcp/…" defaultValue={s.zapierMcpUrl} onBlur={(e) => set({ zapierMcpUrl: e.target.value.trim() })} />
          </Field>
          <Field label="Zapier token (optional)">
            <Input type="password" defaultValue={s.zapierMcpToken} onBlur={(e) => set({ zapierMcpToken: e.target.value.trim() })} />
          </Field>
          <ZapierTest />
        </div>
      </Block>

      <Block title="Grading">
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            {([1, 2, 3, 4] as const).map((n) => (
              <Field key={n} label={`${n} from`}>
                <Percent value={s.gradeCutoffs[n]} onCommit={(v) => set({ gradeCutoffs: { ...s.gradeCutoffs, [n]: v } })} />
              </Field>
            ))}
          </div>
          <Field label="Absence limit" hint="Share of all sessions you may miss, unless the course says otherwise.">
            <Percent value={Math.round(s.absenceLimit * 100)} onCommit={(v) => set({ absenceLimit: v / 100 })} />
          </Field>
        </div>
      </Block>
    </div>
  );
}
