/**
 * Redaction for anomaly samples.
 *
 * Anomalies exist to be pasted into GitHub issues, which means their samples
 * WILL leave the user's machine. Structure must survive (it reproduces the
 * bug); content must not.
 *
 * The critical subtlety: key names like `type` or `model` are structural in
 * the RECORD's own schema, but the same names routinely appear inside
 * user-space payloads (tool inputs, MCP results, file contents). SAFE_KEYS
 * therefore only applies while walking the record's structural zone; the
 * moment the walk enters a content-bearing subtree, everything — values AND
 * keys — is masked.
 */

/**
 * Keys whose values are structural — but ONLY outside content subtrees.
 */
const SAFE_KEYS: ReadonlySet<string> = new Set([
  'type',
  'subtype',
  'role',
  'model',
  'level',
  'stop_reason',
  'version',
  'userType',
  'entrypoint',
  'isSidechain',
  'isCompactSummary',
]);

/**
 * Entering any of these keys switches the walk to unsafe mode for the whole
 * subtree: from here on, every string is user space.
 */
const CONTENT_SUBTREES: ReadonlySet<string> = new Set([
  'content',
  'input',
  'toolUseResult',
  'text',
  'thinking',
  'attachment',
  'summary',
  'prompt',
  'title',
  'data',
]);

function mask(value: string): string {
  return `«${value.length} chars»`;
}

function walk(node: unknown, keyHint: string | undefined, unsafe: boolean): unknown {
  if (typeof node === 'string') {
    if (!unsafe && keyHint !== undefined && SAFE_KEYS.has(keyHint)) return node;
    return mask(node);
  }
  if (typeof node === 'number' || typeof node === 'boolean' || node === null) return node;
  if (Array.isArray(node)) return node.map((v) => walk(v, undefined, unsafe));
  if (typeof node === 'object' && node !== null) {
    const out: Record<string, unknown> = {};
    let i = 0;
    for (const [k, v] of Object.entries(node)) {
      const childUnsafe = unsafe || CONTENT_SUBTREES.has(k);
      // In unsafe territory even key names can be user data (paths, queries,
      // emails used as map keys). Keep count and length, drop the name.
      const outKey = unsafe ? `«k${i}:${k.length}»` : k;
      out[outKey] = walk(v, k, childUnsafe);
      i++;
    }
    return out;
  }
  return node;
}

/**
 * Redact one raw JSONL line down to a shareable structural sample.
 * Falls back to key-skeleton extraction when the line is not valid JSON
 * (which is precisely when `unparseable` anomalies occur).
 */
export function redactLine(raw: string, maxLength: number): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const redacted = JSON.stringify(walk(parsed, undefined, false));
    return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}…` : redacted;
  } catch {
    // Not valid JSON: keep only structural characters and quoted keys' shape.
    const skeleton = raw.replace(/[^{}[\]",:]+/g, (m) => `«${m.length}»`);
    return skeleton.length > maxLength ? `${skeleton.slice(0, maxLength)}…` : skeleton;
  }
}
