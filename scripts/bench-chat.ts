// Run: GEMINI_API_KEY=... npx tsx scripts/bench-chat.ts [runs=3] [label]
// Env: BENCH_THINK=minimal|low|default overrides the thinking level (see src/lib/ai/client.ts), BENCH_SHOW=1 prints answers.
// Measures time to first text token + total time for the demo questions on mock data (fresh conversation per run).
// Counts model rounds / tool calls by wrapping ai.models.generateContentStream; failed (503) attempts are subtracted and reported separately.
declare const process: any;
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
(globalThis as any).window = { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
(globalThis as any).CustomEvent = class { constructor(public type: string, public init?: unknown) {} };

const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error('Set GEMINI_API_KEY in the environment.');
  process.exit(1);
}
mem.set('settings', JSON.stringify({ geminiApiKey: key }));

const runs = Number(process.argv[2] ?? 3);
const label = process.argv[3] ?? 'run';
const QUESTIONS = [
  'How did I do in my last Logic test?',
  "What's due this week?",
  'What do I need on the Logic final to get a 2?',
  'Am I at risk anywhere because of absences?',
  'Put everything due this week in my calendar',
];

const { GoogleGenAI } = await import('@google/genai');
const { Conversation } = await import('../src/lib/ai/chat');
// BENCH_THINK / BENCH_MODEL exist only on the optimized code; on the baseline they are ignored.
const client: any = await import('../src/lib/ai/client');
if (process.env.BENCH_THINK && client.setThinkingOverride) client.setThinkingOverride(process.env.BENCH_THINK);
const pinModel: string | undefined = process.env.BENCH_MODEL;
if (process.env.BENCH_NOSNAP) (await import('../src/lib/ai/snapshot').catch(() => null))?.setSnapshotDisabled(true);
let snapshotChars: number | undefined;
try {
  const snap: any = await import('../src/lib/ai/snapshot');
  const s = await snap.buildSnapshot();
  snapshotChars = (typeof s === 'string' ? s : s.text).length;
  await snap.getSnapshot(); // mimic prewarm() on chat mount: the snapshot is ready before the first question
} catch {}

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
const rows: string[] = [];
for (const q of QUESTIONS) {
  const first: number[] = [];
  const total: number[] = [];
  const info: string[] = [];
  let wasted = 0;
  for (let i = 0; i < runs; i++) {
    const ai = new GoogleGenAI({ apiKey: key });
    let rounds = 0;
    let failMs = 0;
    const models: string[] = [];
    const orig = ai.models.generateContentStream.bind(ai.models);
    (ai.models as any).generateContentStream = async (p: any) => {
      const t = performance.now();
      try {
        const r = await orig(p);
        rounds++;
        models.push(p.model);
        return r;
      } catch (e) {
        failMs += performance.now() - t;
        throw e;
      }
    };
    const t0 = performance.now();
    let tFirst = NaN;
    const tools: string[] = [];
    let text = '';
    try {
      const conv = await Conversation.create(ai, { model: pinModel });
      text = await conv.send(q, {
        onText: () => (tFirst = Number.isNaN(tFirst) ? performance.now() - t0 : tFirst),
        onToolStart: (n) => tools.push(n),
      });
    } catch (e) {
      console.log(`  ERROR ${(e as Error).message.slice(0, 120)}`);
      continue;
    }
    const tot = performance.now() - t0;
    wasted += failMs;
    first.push(tFirst - failMs);
    total.push(tot - failMs);
    info.push(`${models[models.length - 1] ?? '?'}/r${rounds}/t${tools.length}`);
    console.log(`  [${label}] "${q}" #${i + 1} first=${(tFirst / 1000).toFixed(1)}s total=${(tot / 1000).toFixed(1)}s failed-attempt=${(failMs / 1000).toFixed(1)}s ${info[info.length - 1]} tools=[${tools}]`);
    if (process.env.BENCH_SHOW) console.log('   ' + text.replace(/\n/g, ' ').slice(0, 400));
  }
  if (first.length)
    rows.push(`| ${q} | ${(median(first) / 1000).toFixed(1)} | ${(median(total) / 1000).toFixed(1)} | ${[...new Set(info)].join(' ')} | ${(wasted / runs / 1000).toFixed(1)} |`);
}
console.log(`\n## ${label} (median of ${runs}, failed-attempt time subtracted)  snapshot chars: ${snapshotChars ?? 'n/a'}`);
console.log('| Question | first token s | total s | model/rounds/tools | avg failed-attempt s |\n|---|---|---|---|---|');
console.log(rows.join('\n'));
process.exit(0);
