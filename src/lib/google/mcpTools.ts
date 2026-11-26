// Turns Zapier MCP tools into Gemini function declarations that Gemini accepts.
// Why not mcpToTool(): Zapier's schemas contain $ref loops of required fields, which Gemini rejects with
// 400 "ref loops are only supported if they include optional or nullable property values".
import type { FunctionDeclaration } from '@google/genai';

type Json = Record<string, unknown>;

const DROP = new Set(['$schema', '$id', '$defs', 'definitions', '$comment', 'examples', 'additionalProperties', 'unevaluatedProperties', 'patternProperties', 'dependentRequired', 'dependentSchemas', 'if', 'then', 'else', 'not', 'const', 'readOnly', 'writeOnly', 'deprecated']);
const MAX_DEPTH = 6;

function lookup(root: Json, ref: string): Json | undefined {
  if (!ref.startsWith('#/')) return undefined;
  let cur: unknown = root;
  for (const part of ref.slice(2).split('/')) {
    if (cur && typeof cur === 'object') cur = (cur as Json)[decodeURIComponent(part.replace(/~1/g, '/').replace(/~0/g, '~'))];
    else return undefined;
  }
  return cur && typeof cur === 'object' ? (cur as Json) : undefined;
}

/**
 * Inlines local $refs (each ref at most once per path, so loops are cut), drops keywords Gemini doesn't take,
 * and caps nesting depth. The result is plain JSON Schema without $ref.
 */
export function sanitizeSchema(schema: unknown, root: Json = (schema as Json) ?? {}, seen: string[] = [], depth = 0): Json {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { type: 'string' };
  let s = schema as Json;
  if (typeof s.$ref === 'string') {
    const ref = s.$ref;
    const target = lookup(root, ref);
    if (!target || seen.includes(ref) || depth >= MAX_DEPTH) {
      // Loop or unknown ref: accept any object/value here instead of recursing.
      return { type: 'object', description: typeof s.description === 'string' ? s.description : 'Nested value' };
    }
    const { $ref: _r, ...rest } = s;
    return sanitizeSchema({ ...target, ...rest }, root, [...seen, ref], depth + 1);
  }
  if (depth >= MAX_DEPTH) return { type: typeof s.type === 'string' ? s.type : 'string', description: s.description };

  const out: Json = {};
  for (const [k, v] of Object.entries(s)) {
    if (DROP.has(k)) continue;
    if (k === 'properties' && v && typeof v === 'object') {
      out.properties = Object.fromEntries(Object.entries(v as Json).map(([pk, pv]) => [pk, sanitizeSchema(pv, root, seen, depth + 1)]));
    } else if (k === 'items') {
      out.items = Array.isArray(v) ? sanitizeSchema(v[0], root, seen, depth + 1) : sanitizeSchema(v, root, seen, depth + 1);
    } else if ((k === 'anyOf' || k === 'oneOf' || k === 'allOf') && Array.isArray(v)) {
      out.anyOf = v.slice(0, 6).map((x) => sanitizeSchema(x, root, seen, depth + 1));
    } else if (k === 'type' && Array.isArray(v)) {
      // ["string","null"] → "string" + nullable
      const types = v.filter((t) => t !== 'null');
      out.type = types[0] ?? 'string';
      if (v.includes('null')) out.nullable = true;
    } else {
      out[k] = v;
    }
  }
  if (out.type === 'object' && !out.properties) out.properties = {};
  if (Array.isArray(out.required) && out.properties) {
    out.required = (out.required as string[]).filter((r) => r in (out.properties as Json));
  }
  return out;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/** Gemini function names: letters, digits, _ . - and at most 64 chars. Keeps a map back to the MCP name. */
function geminiName(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64);
}

/** Only the tools this job needs (Calendar + Tasks) — fewer, smaller declarations = faster and more reliable. */
export function relevantTools(tools: McpToolInfo[]): McpToolInfo[] {
  const wanted = tools.filter((t) => /calendar|task/i.test(`${t.name} ${t.description ?? ''}`));
  return wanted.length ? wanted : tools;
}

export function toFunctionDeclarations(tools: McpToolInfo[]): { declarations: FunctionDeclaration[]; nameMap: Map<string, string> } {
  const nameMap = new Map<string, string>();
  const declarations = tools.map((t) => {
    const gname = geminiName(t.name);
    nameMap.set(gname, t.name);
    return {
      name: gname,
      description: (t.description ?? '').slice(0, 1000),
      parametersJsonSchema: sanitizeSchema(t.inputSchema ?? { type: 'object', properties: {} }),
    } satisfies FunctionDeclaration;
  });
  return { declarations, nameMap };
}
