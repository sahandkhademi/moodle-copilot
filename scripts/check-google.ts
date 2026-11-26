// Run: npx tsx scripts/check-google.ts
// Mock-mode sync on 3 deadlines, a request-shape dump, and (if env vars are set) a live "list tools" call.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
(globalThis as any).window = { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
(globalThis as any).CustomEvent = class {
  constructor(public type: string, public init?: unknown) {}
};

const { MOCK_DEADLINES, MOCK_COURSES } = await import('../src/lib/data/mock');
const { syncToGoogle, getSynced } = await import('../src/lib/google/sync');
const { buildSyncRequest } = await import('../src/lib/google/zapier');
const { updateSettings } = await import('../src/lib/settings');

const items = MOCK_DEADLINES.filter((d) => ['dl-log-hu7', 'dl-log-final', 'dl-prg-quiz'].includes(d.id)).map((deadline) => ({
  deadline,
  course: MOCK_COURSES.find((c) => c.id === deadline.courseId),
}));

console.log('--- mock sync (1st run) ---');
await updateSettings({ mockMode: true });
console.log(await syncToGoogle(items, { calendar: true, tasks: true }));
console.log('--- mock sync (2nd run, expect exists) ---');
console.log(await syncToGoogle(items, { calendar: true, tasks: true }));
console.log('synced map:', await getSynced());

console.log('--- request shape (2 deadlines, key never included) ---');
const req = buildSyncRequest(
  items.slice(0, 2).map((item) => ({ item, calendar: true, tasks: true })),
  { url: 'https://mcp.zapier.com/api/mcp/s/EXAMPLE/mcp', token: 'ZAPIER_TOKEN' },
);
console.log(JSON.stringify(req, null, 2));

const env = ((globalThis as any).process?.env ?? {}) as Record<string, string | undefined>;
const key = env.ANTHROPIC_API_KEY;
const url = env.ZAPIER_MCP_URL;
if (key && url) {
  console.log('--- live: list tools (no writes) ---');
  await updateSettings({ mockMode: false, anthropicApiKey: key, zapierMcpUrl: url, zapierMcpToken: env.ZAPIER_MCP_TOKEN ?? '' });
  const { testZapier } = await import('../src/lib/google/zapier');
  console.log(await testZapier());
} else {
  console.log('--- live check skipped: ANTHROPIC_API_KEY and ZAPIER_MCP_URL not both set ---');
}
