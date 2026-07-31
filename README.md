<p>
  <img src="packages/web/client/public/tokray-lockup.svg" alt="Tokray" width="228" />
</p>

**Make every agent token earn its place.** Tokray is an open-source, vendor-neutral context observability and Token governance project for coding agents.

Today, its working Monitor foundation runs entirely on your machine: turn by turn, see what the model was shown, how many tokens went to tools and messages, which results have remained in context, and what happened at compaction.

The product direction is a complete evidence loop: **Monitor -> Govern -> Optimize -> Orchestrate**. Tokray will detect waste, apply capability-aware and reversible policies, simulate changes, and verify whether an optimization reduced Token, cost, and latency without degrading task quality. It is not becoming a generic workflow builder.

No hosted service or account is required. Raw logs and conversation content remain local by default.

> **Status: early WIP.** Monitor and the local governance primitives work. The current milestone is a provider-neutral local model gateway for OpenAI- and Anthropic-compatible traffic, with Codex Hooks, SDK middleware, MCP middleware, and log adapters treated as capability-specific connectors. The gateway MVP is implemented; real Provider Usage and task-quality verification remain.

## Current target

Tokray is currently optimizing one workflow:

```text
Agent request -> local gateway -> governed request -> provider Usage + quality comparison -> policy adjustment
```

The gateway is the primary cross-model data plane. Hooks remain an optional connector for Agent-local tool paths that never reach a configurable model endpoint; MCP middleware covers only its MCP tools; log adapters remain observe-only. The milestone is not complete until one controlled real session proves lower Provider input Usage without degrading task quality. Gemini, Vertex, Bedrock, and proprietary stateful protocols require dedicated protocol adapters and are not claimed by the current MVP.

Read the [Chinese product plan](./PRODUCT_PLAN.zh-CN.md) and the [adapter compatibility contract](./ADAPTERS.md).

## Run the local UI

From source, the first run needs dependencies and a build:

```bash
pnpm install
pnpm build
pnpm start
```

Later launches only need:

```bash
pnpm start                                # local UI on 127.0.0.1:4319
```

Use `pnpm web:dev` while editing the Web client. The CLI equivalents are `node packages/cli/dist/main.js web` for the UI, `node packages/cli/dist/main.js` for the newest local session, and `node packages/cli/dist/main.js path/to/session.jsonl --json out.json` for JSON export. Once the CLI package is published, the intended user-facing entry point is `tokray web`; end users should not need to understand the pnpm workspace.

## Run the local model gateway

Start one gateway for a fixed Provider or OpenAI-compatible endpoint, then point the Agent's model base URL at `http://127.0.0.1:4318`. The incoming path and query string are appended to the upstream prefix, and authorization plus Provider-specific headers pass through without being stored:

```bash
pnpm gateway -- \
  --upstream https://api.openai.com \
  --port 4318 \
  --max-input-tokens 120000
```

Tool-description compaction and exact-schema deduplication are enabled by default. Model-visible tool-result compaction is deliberately opt-in because it can remove low-signal lines:

```bash
pnpm gateway -- \
  --upstream https://api.example.com \
  --compact-tool-results \
  --tool-result-min-chars 2000
```

The gateway recognizes OpenAI Chat `role: tool`, OpenAI Responses `function_call_output`, and Anthropic `tool_result` text while preserving ordinary messages and tool-result identifiers. It forwards streaming responses incrementally. Local health and aggregate metadata are available at `/__tokray/health` and `/__tokray/stats`; neither endpoint contains request bodies or credentials. Run separate gateway processes for different upstream prefixes in the current MVP.

The built-in output governor can also be used directly in a pipe without installing RTK:

```bash
node packages/cli/dist/main.js filter --profile auto < tool-output.txt
node packages/cli/dist/main.js filter --profile test --command "pnpm test" < test-output.txt
```

The Native Request Governor accepts OpenAI- and Anthropic-compatible request JSON. By default it preserves `system`, `messages`, and `input`; compacts natural-language tool descriptions; removes only byte-identical duplicate tool definitions; and never removes a named tool unless an explicit allowlist is supplied. The gateway can explicitly enable conservative tool-result compaction after protocol-aware detection:

```bash
node packages/cli/dist/main.js request govern --input request.json > governed-request.json
node packages/cli/dist/main.js request govern --input request.json \
  --max-input-tokens 8000 \
  --allow-tools read_file,search_code \
  --report-json
```

An over-budget request is returned for inspection but the command exits with status `3`, so it can act as a pipeline gate. Its `char-class-v1` estimate covers the serialized request body and is not provider-tokenizer output or billing Usage. The Web Governance Center exposes the same transformation and integrity checks.

`tokray hook filter --agent codex --profile auto` is the post-tool dispatcher for a registered Tokray Native Bridge. It passes output through unchanged when the Bridge is absent or filtering cannot run. Registration alone does not connect an Agent-native Hook.

For Codex, the same dispatcher accepts the documented `PostToolUse` JSON object on stdin. It filters plain strings and conservative model-facing text shapes (`output`, `text`, or text content blocks), preserving common scalar execution metadata in replacement feedback. Unknown structured or binary results produce no hook output and continue unchanged. After registering the Tokray Bridge, preview the project-level `.codex/hooks.json` connection, then apply exactly that approved hash:

```bash
node packages/cli/dist/main.js hook connect --agent codex
node packages/cli/dist/main.js hook connect --agent codex \
  --apply --expected-after-hash sha256:<hash-from-preview>
node packages/cli/dist/main.js hook status --agent codex
node packages/cli/dist/main.js hook self-test --agent codex
```

The connector structurally preserves unrelated Hook groups, replaces stale or duplicate Tokray handlers with one canonical definition, and never rewrites a byte-identical configuration. It writes an action Receipt and supports guarded rollback. `hook status` asks Codex's local `hooks/list` API for the effective `trustStatus`; `hook self-test` runs a deterministic fixture through the local dispatcher with `modelCalls: 0`. The resulting configuration is equivalent to:

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "tokray hook filter --agent codex --profile auto",
        "timeout": 30,
        "statusMessage": "Filtering tool output with Tokray"
      }]
    }]
  }
}
```

Published installations use the `tokray` command shown above. Source checkouts store the absolute current Node and CLI paths so the Hook remains executable even when the workspace package has not been globally linked.

Codex requires non-managed Hooks to be reviewed and trusted with `/hooks` before they run. Tokray does not write `trusted_hash` on the user's behalf: that would bypass Codex's project-command approval boundary. The install, status, and self-test steps are scriptable; the first trust decision remains interactive. Its documented lifecycle surface does not include a pre-model-request event, so this connection governs supported local tool results, not complete model requests.

The gateway is now the primary cross-model integration when an Agent exposes a configurable model endpoint. Codex `PostToolUse` remains useful for supported local tools and deployments that cannot route requests through a gateway. MCP middleware covers only its MCP tools, and Shell/RTK wrappers cover commands but not other local tools. No single connector is presented as universal across opaque or server-side Agent runtimes.

Tokray is currently a source-distributed, local, single-user developer tool: not a signed desktop app and not a team SaaS. Its current architecture is designed for hundreds of discovered sessions and logs in the tens-of-megabytes range on one machine, using an incremental filesystem index, concurrent format probes, on-demand parsing, and an eight-report weighted LRU cache. Standalone binaries and package-manager distribution are release work, not prerequisites for the analysis model.

The default discovery scans supported logs under `~/.claude/projects`, `~/.codex/{sessions,archived_sessions}`, and `~/.tokray/captures`. A filesystem-backed incremental index reuses unchanged probes, publishes live invalidation events over SSE, and the Web UI virtualizes the complete matching session list. Analysis reports use a weighted LRU cache and concurrent requests for the same session share one parse.

### Custom paths and JSONL formats

Copy [`tokray.config.example.json`](./tokray.config.example.json) to `tokray.config.json`, then change the source path and JSON Pointer mappings for the Agent trace. A global config can live at `~/.config/tokray/config.json`; set `TOKRAY_CONFIG` to use an explicit file. Source paths support `~`, `$VAR`, `${VAR}`, and `%VAR%` expansion.

The declarative adapter MVP maps one JSONL model-call record to one standard `ContextFrame`, including Agent, provider, model, system content, messages, tool schemas, Usage, and cache accounting. [`tokray.config.schema.json`](./tokray.config.schema.json) provides editor validation. Invalid definitions are reported with structural paths and are skipped without crashing discovery.

Tokray also inventories known local storage locations for Cursor, Cline, Roo Code, Continue, Windsurf, Gemini CLI, CodeBuddy, Trae, and Trae CN. Inventory is not the same as parse support: for example, the locally verified Trae `ai-agent/database.db` is opaque/encrypted, so Tokray reports it as detected but not readable instead of inventing Usage or conversation data.

Output: one stacked bar per model call, plus a session summary — resident-layer estimate with an error band, calibration quality (r²), a per-tool cost table, per-MCP-server activity (idle servers called out), deferred-tool accounting, and a resident-layer breakdown reconciled against the calibrated total.

### Web capabilities

- English and Simplified Chinese UI with locally persisted language and light/dark theme preferences;
- live monitoring with SSE state, auto-follow/pause, newest-call-first activity, current context, per-call additions, cache reuse, cumulative input, and evidence-based findings;
- complete-session navigation with Agent switching, title/path/Session ID search, time grouping, virtual scrolling, and ID copy;
- an Agent source and adapter matrix that separates installation detection from verified parse access, including explicit opaque/adapter-required states;
- a searchable terminology reference covering definitions, calculations, evidence sources, and limitations;
- evidence-based session governance grouped into issues, optimization opportunities, and healthy signals, with direct navigation to the underlying call, block, tool, compaction, usage, calibration, or parser issue;
- a dedicated governance action queue that converts findings into read-only `ActionProposal` previews, showing the execution target, capability gate, future-call boundary, risk, evidence count, and estimated impact without claiming an action was applied;
- a Native Request Governor and fixed-upstream local model gateway for OpenAI- and Anthropic-compatible bodies, with tool-description compaction, exact-definition deduplication, explicit tool allowlists, an estimated input-budget gate, optional protocol-aware tool-result compaction, streaming response forwarding, and runtime integrity assertions;
- a built-in, deterministic output-governance laboratory with `auto`, test, build, JSON, Git-status, and generic profiles; it strips terminal noise, folds repetition, preserves diagnostic windows, marks omitted regions, exposes information-loss risk, and never reports its `bytes / 4` output estimate as billing savings;
- a native context-engine registry covering model-request governance, output filtering, progressive disclosure, context deduplication, on-demand tool schemas, memory externalization, stable cache prefixes, compaction protection, and deterministic workflow offload; every surface is labeled `available`, `diagnose`, or `planned` instead of being presented as uniformly shipped;
- optional RTK integration that detects the official `rtk-ai/rtk` binary, imports `rtk gain --all --format json`, previews `rtk rewrite`, and can run an explicitly approved raw/compact comparison for a narrow read-only command allowlist; comparison uses direct process arguments rather than a Shell and records an immutable action receipt;
- a Tokray-managed Hook Bridge registry for Claude Code, Codex, CodeBuddy, and Trae, where Tokray Native output filtering and optional RTK command rewriting can coexist per Agent; it includes config preview, explicit apply, append-only receipts, hash-guarded rollback, and separate `tokray hook filter` / `tokray hook rewrite` dispatchers;
- conservative duplicate-context and loaded-but-never-called rules with SourceRef evidence and explicitly prior-based Schema pricing;
- complete supported-session index with adapter filters, full-index search, and incremental list rendering;
- provider-normalized context timeline and selected-call accounting with uncertainty surfaced;
- provider-reported input, cache read/write, output, and reasoning usage aggregated by call and model;
- calibration epochs split at compaction and model boundaries, so one poor whole-session fit does not hide reliable local estimates;
- compaction inspection with before/after token deltas and block fates (`kept`, `summarized`, `truncated`, `dropped`, `added`, or `unobserved`);
- two conversation scopes: the context visible to the selected call, or the full session history including tail records;
- message/tool filters, full-content search, collapsible tool payloads, block-level evidence, tool accounting, and parser issues.

"Full session" means every reconstructable conversation block in a supported Claude Code or Codex log. It does not include unsupported harness directories, provider-side content that was never logged, or hidden material absent from the local record. When a compaction marker omits the generated summary body, Tokray labels unmatched history `unobserved`; it does not claim those blocks were dropped or summarized without evidence.

### Complete request captures

One JSON object per line is one model call. A request may be direct or wrapped with its response:

```json
{"type":"model_call","provider":"openai","request":{"model":"gpt-5","messages":[],"tools":[]},"response":{"usage":{"input_tokens":1200,"output_tokens":80}}}
{"type":"model_call","provider":"anthropic","request":{"model":"claude-sonnet","system":"...","messages":[],"tools":[],"max_tokens":1024},"response":{"usage":{"input_tokens":200,"cache_read_input_tokens":1000,"output_tokens":80}}}
```

OpenAI input usage includes cached tokens; Anthropic input usage excludes cache read/write tokens. The normalized contract records that distinction explicitly.

## Honesty rules

Agent logs often record *messages*, not the complete request payload. When resident content is missing, Tokray recovers it by regression against per-call API usage. Complete request captures instead use a zero-intercept accounting strategy because system prompts and tool schemas are present directly.

- every attribution carries a confidence level (`exact` / `inferred` / `guessed`);
- every token count states its method, and heuristics carry an error band;
- content the log knows only by *name* (tool schemas) is priced by shipped **priors** — marked `prior`, banded wide, and reconciled against the calibrated resident total instead of being presented as measurement;
- unknown log structures degrade to redacted, shareable anomaly reports — never a crash.

## Architecture

pnpm workspace and TypeScript. The Web UI uses a local Hono server with a React/Vite client.

| package | role |
| --- | --- |
| `@tokray/core` | normalization and governance contracts (`ContextFrame`, `AgentCapabilities`, `GovernanceFinding`, `PolicyDefinition`), calibration, and compaction alignment. Zero IO, isomorphic. |
| `@tokray/adapters` | `claude-code`, `codex`, and `raw-request` adapters plus the TypeScript SDK and JSONL declarative adapter factory. Streaming, never-throwing. |
| `@tokray/node` | cross-platform Agent source inventory, configurable session discovery, native request/output governance, Hook Bridges, receipts, and shared analysis orchestration for Node.js clients. |
| `tokray` (cli) | terminal renderer + JSON export. |
| `@tokray/web` | local-only Hono API and React analysis UI. |

The normalized `ContextFrame` records a provider-neutral model identity, provider-native usage semantics, normalized totals, structurally addressable `SourceRef`s, and frame-relative block residency. Adapter capabilities select one of three accounting strategies: `exact-request`, `usage-calibrated`, or `heuristic-only`.

### Adapter SDK

Third-party adapters implement only format detection and event parsing, then declare their observable capabilities:

```ts
import { defineAdapter, BlockBuilder } from '@tokray/adapters/sdk';

export default defineAdapter({
  id: 'my-agent',
  schemaRange: '>=1 <2',
  capabilities: {
    accounting: 'usage-calibrated',
    exactSystemPrompt: false,
    exactToolSchemas: false,
    exactUsage: true,
    compaction: 'marker',
  },
  agentCapabilities: {
    readLogs: 'full',
    exactUsage: 'full',
    exactRequest: 'partial',
    compactionMarkers: 'full',
    preToolHook: 'unknown',
    rewriteOutput: 'unknown',
    toolAllowlist: 'unknown',
    modelRouting: 'unknown',
    compactionControl: 'unknown',
  },
  detect(probe) { /* ... */ },
  async *parse(input, context) { /* yield ParseEvent values */ },
});
```

## Roadmap

- [x] Contract + claude-code adapter + calibration + terminal renderer
- [x] Vendor-neutral usage/model/source contract; complete request and Codex adapters; adapter SDK
- [x] Per-tool cost table; deferred-roster tracking (exact, from `deferred_tools_delta` / `tool_reference` records); loaded-but-never-called detection; resident-layer breakdown via priors reconciled against calibration
- [ ] MCP roster from local config files (opt-in `--mcp-config`): tool-level never-called detection for servers the log can't see
- [x] Compaction diff: kept / summarized / truncated / dropped / unobserved / added as first-class, inspectable objects
- [x] Local Web UI (`tokray web`): provider filters, session search, normalized timeline, segmented calibration, provider usage, compaction inspection, on-demand conversation content, frame inspector, tool accounting, anomaly view, bilingual UI, and persisted light/dark themes
- [x] M0 product foundation: separate Agent/provider identity, explicit Agent capability matrix, evidence-bearing governance findings, policy contract, and adapter conformance rules
- [ ] M1 Monitor: real-time watch/SSE, professional session navigation/search, JSONL declarative adapters, source inventory, capability matrix, terminology reference, CodeBuddy/Trae research, and Tokray-managed Bridge registration are implemented; verified Cursor/Cline/Continue adapters, vendor-native Hook connections, YAML configuration, and scale acceptance remain
- [ ] M2 Govern: evidence rules, grouped governance, ActionProposal previews, native request budgeting/tool governance, built-in output filtering, fixed-upstream OpenAI/Anthropic-compatible gateway, multi-Provider Hook Bridges, RTK detection/gain/rewrite, action receipts, and guarded rollback are implemented; Provider-specific routing profiles, persisted policy scopes, additional protocols, and Usage-backed savings verification remain
- [ ] M3 Optimize: context simulations, before/after experiments, capability-driven pricing, quality checks, and sanitized reports
- [ ] M4 Orchestrate: focused Token-aware workflow recipes and CLI runner for deterministic steps
- [ ] M5 Ecosystem: `tokray agent` + `tokray serve`, self-hosting, binaries, package managers, and community adapter/action SDKs
- [ ] Cross-session and cross-provider comparison with aligned model-call ranges
- [ ] Capability-driven model pricing, cost attribution, budgets, and regression alerts
- [ ] Project grouping and sanitized report export
- [ ] Cursor, Cline, Continue, OpenCode, and other harness adapters

## License

MIT
