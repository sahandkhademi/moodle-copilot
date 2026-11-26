// Run: npx tsx scripts/check-chat-tools.ts
// Calls every chat tool executor against mock data. Optional real streamed request if ANTHROPIC_API_KEY is set.
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
const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.log('\nSKIP live request: no ANTHROPIC_API_KEY set.');
} else {
  mem.set('settings', JSON.stringify({ anthropicApiKey: key, language: 'en' }));
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const { runTurn } = await import('../src/lib/ai/chat');
  const history: any[] = [{ role: 'user', content: 'What do I need on the Logik final for a 2?' }];
  const text = await runTurn(
    history,
    { onToolStart: (n) => console.log('[tool]', n), onText: (t) => process.stdout.write(t) },
    new Anthropic({ apiKey: key }),
  );
  console.log('\n\nfinal length', text.length);
  check('live answer mentions 85', /85/.test(text));
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
