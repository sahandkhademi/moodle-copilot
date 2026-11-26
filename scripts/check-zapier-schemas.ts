// Reproduces the Zapier "ref loop" schema problem with a local MCP server and checks our fix with real Gemini.
// Run: GEMINI_API_KEY=... npx tsx scripts/check-zapier-schemas.ts   (without the key it only checks the sanitizer)
import http from 'node:http';
import assert from 'node:assert/strict';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { GoogleGenAI, mcpToTool } from '@google/genai';
import { sanitizeSchema, toFunctionDeclarations } from '../src/lib/google/mcpTools';
import { connectMcp, runToolLoop, buildSyncPrompt } from '../src/lib/google/zapier';

// A Zapier-like schema with a REQUIRED self-reference (what Gemini rejects).
const loopy = {
  type: 'object',
  $schema: 'http://json-schema.org/draft-07/schema#',
  properties: {
    instructions: { type: 'string', description: 'What to do' },
    summary: { type: 'string' },
    start__dateTime: { type: 'string' },
    end__dateTime: { type: 'string' },
    attendees: { $ref: '#/$defs/Node' },
  },
  required: ['instructions', 'attendees'],
  $defs: { Node: { type: 'object', properties: { email: { type: 'string' }, child: { $ref: '#/$defs/Node' } }, required: ['email', 'child'] } },
};

const s = sanitizeSchema(loopy);
assert.equal(JSON.stringify(s).includes('$ref'), false);
assert.equal(JSON.stringify(s).includes('$defs'), false);
console.log('sanitizer: no $ref / $defs left ✓');

const key = process.env.GEMINI_API_KEY;

const created: Record<string, unknown>[] = [];
function makeServer() {
  const server = new Server({ name: 'fake-zapier', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: 'google_calendar_create_detailed_event', description: 'Create a detailed event in Google Calendar', inputSchema: loopy },
      { name: 'google_calendar_find_events', description: 'Find events in Google Calendar', inputSchema: { type: 'object', properties: { instructions: { type: 'string' }, search_term: { type: 'string' } }, required: ['instructions'] } },
      { name: 'google_tasks_create_task', description: 'Create a task in Google Tasks', inputSchema: { type: 'object', properties: { instructions: { type: 'string' }, title: { type: 'string' }, due: { type: 'string' } }, required: ['instructions'] } },
      { name: 'slack_send_message', description: 'Send a Slack message', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    created.push({ tool: req.params.name, args: req.params.arguments });
    await new Promise((r) => setTimeout(r, 1500)); // a real Zapier action takes a moment
    const found = req.params.name.includes('find');
    return { content: [{ type: 'text', text: found ? JSON.stringify({ results: [] }) : JSON.stringify({ id: 'x' + created.length, status: 'created' }) }] };
  });
  return server;
}
const httpServer = http.createServer(async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await makeServer().connect(transport);
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => void transport.handleRequest(req, res, body ? JSON.parse(body) : undefined));
});
await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(httpServer.address() as { port: number }).port}/mcp`;
// 0. Fast direct path: no Gemini, all calls in parallel.
{
  const { directSync } = await import('../src/lib/google/direct');
  const mcp = await connectMcp({ url });
  const { tools } = await mcp.listTools();
  const mk = (id: string, title: string, due: string) => ({ item: { deadline: { id, courseId: 1, title, type: 'assignment', due }, course: { id: 1, shortname: 'LOG', fullname: 'VL / UE Logic', url: '' } }, calendar: true, tasks: true });
  const work = [mk('d1', 'Homework 7', '2026-11-30T22:59:00Z'), mk('d2', 'Sheet 8', '2026-12-01T22:59:00Z'), mk('d3', 'Quiz 3', '2026-12-02T17:00:00Z')] as never[];
  created.length = 0;
  const t = Date.now();
  const res = await directSync(mcp, tools, work);
  console.log(`direct path: ${res?.length} items in ${Date.now() - t} ms →`, res?.map((r) => `${r.deadlineId}:${r.calendar}/${r.tasks}`).join(' '));
  const cal = created.find((c) => String(c.tool).includes('calendar_create')) as { args: Record<string, unknown> };
  console.log('calendar args sample:', JSON.stringify(cal.args));
  assert.equal(res?.every((r) => r.calendar === 'created' && r.tasks === 'created'), true);
  assert.equal(created.length, 6);
  assert.match(String(cal.args.start__dateTime), /^2026-11-30T23:29:00$/);
  console.log('direct path check passed ✓');
  await mcp.close();
}
if (!key) {
  console.log('No GEMINI_API_KEY: skipping live Gemini checks');
  httpServer.close();
  process.exit(0);
}
const ai = new GoogleGenAI({ apiKey: key });
const model = process.env.GEMINI_MODEL ?? 'gemini-3.6-flash';

// 1. The old way (mcpToTool) — expected to fail with the ref-loop error.
{
  const mcp = await connectMcp({ url });
  try {
    await ai.models.generateContent({ model, contents: 'List my calendar events', config: { tools: [mcpToTool(mcp)], automaticFunctionCalling: { maximumRemoteCalls: 2 } } });
    console.log('old way: no error this time');
  } catch (e) {
    console.log('old way fails as reported:', String((e as Error).message).match(/ref loops[^"\\]*/)?.[0] ?? String(e).slice(0, 120));
  }
  await mcp.close();
}

// 2. Our way.
{
  const mcp = await connectMcp({ url });
  const { declarations } = toFunctionDeclarations((await mcp.listTools()).tools);
  console.log('declarations:', declarations.map((d) => d.name).join(', '));
  const prompt = buildSyncPrompt([
    { deadlineId: 'dl-1', title: '[LOG] Homework 7: Resolution', type: 'assignment', course: 'VL / UE Logic', calendar: true, tasks: true, eventStart: '2026-11-30 23:29', eventEnd: '2026-11-30 23:59', dueDay: '2026-11-30', link: 'https://moodle.example/mod/assign/view.php?id=1' },
  ] as never);
  const t = Date.now();
  const text = await runToolLoop(ai, mcp, model, prompt);
  console.log(`our way finished in ${Date.now() - t} ms; tool calls:`, created.map((c) => c.tool).join(', '));
  console.log('final:', text.slice(0, 200));
  assert.ok(created.some((c) => String(c.tool).includes('calendar_create')), 'calendar event created');
  assert.ok(created.some((c) => String(c.tool).includes('tasks_create')), 'task created');
  assert.ok(!created.some((c) => String(c.tool).includes('slack')), 'no unrelated tools');
  console.log('live Zapier-schema check passed ✓');
  await mcp.close();
}
httpServer.close();
