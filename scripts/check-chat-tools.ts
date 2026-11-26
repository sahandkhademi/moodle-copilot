// Run: npx tsx scripts/check-chat-tools.ts
// Calls every chat tool executor against mock data. Optional real multi-turn Gemini conversation if GEMINI_API_KEY is set (pass it via env only).
declare const process: any;
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
(globalThis as any).window = { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
(globalThis as any).CustomEvent = class { constructor(public type: string, public init?: unknown) {} };

const { executeTool, TOOLS } = await import('../src/lib/ai/tools');

let failed = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failed++;
}
async function run(name: string, input: Record<string, unknown>) {
  const out = await executeTool(name, input);
  console.log(`\n--- ${name} ${JSON.stringify(input)}${out.isError ? '  [ERROR]' : ''}`);
  console.log(out.content.length > 900 ? out.content.slice(0, 900) + ' …' : out.content);
  return out;
}

console.log('tools:', TOOLS.map((t) => t.name).join(', '));
await run('get_courses', {});
const dl = await run('get_deadlines', { course_id: null, days_ahead: 7 });
await run('get_deadlines', { course_id: 101, days_ahead: null });
const gr = await run('get_grades', { course_id: 101 });
const at = await run('get_attendance', { course_id: null });
const n2 = await run('calculate_needed_score', { course_id: 101, target_grade: 2 });
const n1 = await run('calculate_needed_score', { course_id: 101, target_grade: 1 });
const wi = await run('what_if', { course_id: 101, percent_on_remaining: 85 });
const ids = (JSON.parse(dl.content) as { id: string }[]).slice(0, 3).map((d) => d.id);
const sync = await run('propose_google_sync', { deadline_ids: ids, calendar: true, tasks: true });
await run('propose_google_sync', { deadline_ids: ['nope'], calendar: true, tasks: true });

const j2 = JSON.parse(n2.content);
check('Logik grade 2: possible, 85% average', j2.status === 'possible' && j2.needed_average_percent_on_remaining === 85);
check('Logik grade 2: 42.5/50 on the final', j2.per_item[0].needed_points === 42.5 && j2.per_item[0].max_points === 50);
check('Logik grade 1: impossible', JSON.parse(n1.content).status === 'impossible');
check('Logik standing is a 3', JSON.parse(gr.content).standings[0].current_grade === 3);
const logAtt = JSON.parse(at.content).find((a: any) => a.course_id === 101);
check('Logik attendance warning, 1 left', logAtt.state === 'warning' && logAtt.absences_left === 1);
check('what_if 85% -> grade 2', JSON.parse(wi.content).projected_grade === 2);
check('propose_google_sync returns card + items', !!sync.syncProposal && sync.syncProposal.items.length === ids.length && ids.length > 0);

// Optional live run
const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.log('\nSKIP live request: no GEMINI_API_KEY set.');
} else {
  mem.set('settings', JSON.stringify({ geminiApiKey: key }));
  const { GoogleGenAI } = await import('@google/genai');
  const { Conversation, friendlyError } = await import('../src/lib/ai/chat');
  try {
    const pin = process.env.BENCH_MODEL;
    const fresh = () => Conversation.create(new GoogleGenAI({ apiKey: key }), { model: pin });
    const ask = async (conv: Awaited<ReturnType<typeof fresh>>, q: string) => {
      console.log(`\n>>> ${q}`);
      const tools: string[] = [];
      let card = false;
      const text = await conv.send(q, {
        onToolStart: (n) => (console.log('[tool]', n), tools.push(n)),
        onToolResult: (n, out) => n === 'propose_google_sync' && out.syncProposal && (card = true),
        onText: (t) => process.stdout.write(t),
      });
      console.log(`\n(length ${text.length}, model ${conv.model}, tools: ${tools.join(',') || 'none'})`);
      check(`live answer non-empty: ${q}`, text.trim().length > 0);
      return { text, tools, card };
    };
    // One multi-turn conversation (history + system instruction refresh must keep working)
    const conv = await fresh();
    const t1 = await ask(conv, 'How did I do in my last Logic test?');
    check('live: Logic test answer says grade 4 and 62%', /\b4\b/.test(t1.text) && /62/.test(t1.text));
    const t2 = await ask(conv, 'What do I need on the final for a 2?');
    check('live: "for a 2" says 85%', /85\s*%/.test(t2.text));
    check('live: "for a 2" says 42.5 of 50', /42\.5/.test(t2.text) && /50/.test(t2.text));
    // Fresh conversations for the other demo questions
    const abs = await ask(await fresh(), 'Am I at risk anywhere because of absences?');
    check('live: absence answer mentions Logic with 1 absence left', /logic/i.test(abs.text) && /\b(1|one)\b/i.test(abs.text));
    const cal = await ask(await fresh(), 'Put everything due this week in my calendar');
    check('live: calendar request calls propose_google_sync and produces the card', cal.tools.includes('propose_google_sync') && cal.card);
  } catch (e) {
    console.log('\nLIVE ERROR:', (e as Error).message.slice(0, 400));
    console.log('friendly:', friendlyError(e));
    failed++;
  }
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
