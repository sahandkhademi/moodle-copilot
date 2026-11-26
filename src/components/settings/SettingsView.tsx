import { useState, type ReactNode } from 'react';
import { useSettings, type Settings } from '@/lib/settings';
import { DemoTools } from '@/components/demo/DemoTools';
import { MoodleTest } from '@/components/moodle/MoodleTest';
import { ZapierTest } from '@/components/google/ZapierTest';

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

const input =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-900';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
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
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Settings</h1>
        <span className={`text-xs text-emerald-600 transition-opacity ${saved ? 'opacity-100' : 'opacity-0'}`}>Saved ✓</span>
      </div>

      <Section title="Demo">
        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-sm font-medium">Demo data (mock mode)</span>
            <span className="block text-xs text-slate-500">Seeded courses and grades. Google writes are faked.</span>
          </span>
          <input type="checkbox" className="h-5 w-5 accent-brand-500" checked={s.mockMode} onChange={(e) => set({ mockMode: e.target.checked })} />
        </label>
        <DemoTools />
      </Section>

      <Section title="Moodle">
        <Field label="Moodle URL" hint="Log in to Moodle in this browser. Copilot uses that session.">
          <input className={input} placeholder="https://moodle.yotkao.at" defaultValue={s.moodleUrl} onBlur={(e) => set({ moodleUrl: e.target.value.trim().replace(/\/$/, '') })} />
        </Field>
        <MoodleTest />
      </Section>

      <Section title="AI">
        <Field label="Claude API key" hint="Stored only on this computer.">
          <input className={input} type="password" placeholder="sk-ant-…" defaultValue={s.anthropicApiKey} onBlur={(e) => set({ anthropicApiKey: e.target.value.trim() })} />
        </Field>
        <Field label="Language">
          <select className={input} value={s.language} onChange={(e) => set({ language: e.target.value as Settings['language'] })}>
            <option value="de">Deutsch</option>
            <option value="en">English</option>
          </select>
        </Field>
        <label className="flex items-center justify-between">
          <span className="text-sm font-medium">Read answers aloud</span>
          <input type="checkbox" className="h-5 w-5 accent-brand-500" checked={s.voiceReadAloud} onChange={(e) => set({ voiceReadAloud: e.target.checked })} />
        </label>
      </Section>

      <Section title="Google Calendar & Tasks (Zapier)">
        <Field label="Zapier MCP server URL" hint={<>From mcp.zapier.com, with Google Calendar and Google Tasks actions enabled.</>}>
          <input className={input} placeholder="https://mcp.zapier.com/api/mcp/…" defaultValue={s.zapierMcpUrl} onBlur={(e) => set({ zapierMcpUrl: e.target.value.trim() })} />
        </Field>
        <Field label="Zapier token (optional)">
          <input className={input} type="password" defaultValue={s.zapierMcpToken} onBlur={(e) => set({ zapierMcpToken: e.target.value.trim() })} />
        </Field>
        <ZapierTest />
      </Section>

      <Section title="Grading">
        <div className="grid grid-cols-4 gap-2">
          {([1, 2, 3, 4] as const).map((n) => (
            <Field key={n} label={`${n} from`}>
              <div className="relative">
                <input
                  className={input + ' pr-6'}
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={s.gradeCutoffs[n]}
                  onBlur={(e) => set({ gradeCutoffs: { ...s.gradeCutoffs, [n]: Number(e.target.value) } })}
                />
                <span className="pointer-events-none absolute right-2 top-2 text-sm text-slate-400">%</span>
              </div>
            </Field>
          ))}
        </div>
        <Field label="Absence limit" hint="Share of all sessions you may miss, unless the course says otherwise.">
          <div className="relative">
            <input
              className={input + ' pr-6'}
              type="number"
              min={0}
              max={100}
              defaultValue={Math.round(s.absenceLimit * 100)}
              onBlur={(e) => set({ absenceLimit: Number(e.target.value) / 100 })}
            />
            <span className="pointer-events-none absolute right-2 top-2 text-sm text-slate-400">%</span>
          </div>
        </Field>
      </Section>

      <Section title="Appearance">
        <select className={input} value={s.darkMode} onChange={(e) => set({ darkMode: e.target.value as Settings['darkMode'] })}>
          <option value="system">Follow system</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </Section>
    </div>
  );
}
