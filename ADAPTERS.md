# Tokray Adapter Compatibility Contract

Tokray is Agent-neutral because it uses explicit adapters and capability declarations, not because one parser guesses every log format.

## Vocabulary

- **Agent**: the client or runtime that assembled the model request, such as Claude Code, Codex, Cursor, Trae, or CodeBuddy.
- **Model provider**: the API/model vendor, such as Anthropic, OpenAI, DeepSeek, or Google.
- **Adapter**: a parser that detects a source format and emits Tokray's normalized events.
- **Hook adapter**: a future runtime integration that can inspect or modify an Agent action.

Agent and model provider are separate fields. An Agent may use several providers, and the same provider may appear in several Agents.

## Built-in Compatibility

| Adapter | Agent/source | Logs | Exact Usage | Exact request | Compaction markers | Runtime controls |
| --- | --- | --- | --- | --- | --- | --- |
| `claude-code` | Claude Code | full | full | partial | full | unknown until Hook integration |
| `codex` | Codex | full | full | partial | full | partial for documented local-tool lifecycle Hooks |
| `raw-request` | OpenAI/Anthropic-compatible capture | full | partial | full | none | none |

`partial` and `unknown` are first-class results. They must not be rendered as full support.

Codex `PreToolUse` and `PostToolUse` cover Bash, `apply_patch`, MCP, and most local function tools, but not hosted tools or specialized paths that opt out. `PostToolUse` can replace a supported tool result with hook feedback, while direct `updatedMCPToolOutput` replacement is not supported. Tokray therefore declares `preToolHook` and `rewriteOutput` as `partial`, not `full`.

## Capability Matrix

Every adapter declares all of these capabilities:

```text
readLogs
exactUsage
exactRequest
compactionMarkers
preToolHook
rewriteOutput
toolAllowlist
modelRouting
compactionControl
```

Each value is one of:

```text
full / partial / none / unknown
```

`unknown` means Tokray has not verified the capability. It does not mean unsupported, and it must not enable an action in the UI.

## TypeScript Adapter Contract

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
  detect(probe) { /* return a scored match */ },
  async *parse(input, context) { /* yield ParseEvent values */ },
});
```

Frames emitted by the adapter set both identities explicitly where known:

```ts
{
  model: {
    agent: 'my-agent',
    provider: 'deepseek',
    model: 'deepseek-v3',
  }
}
```

## Conformance Requirements

An official or community adapter must provide tests for:

1. Positive detection using a representative, anonymized sample.
2. Rejection of unrelated text and other built-in formats.
3. One model call producing exactly one `ContextFrame`.
4. Correct Agent, provider, model, Usage, and cache semantics.
5. Stable, structurally addressable `SourceRef` values.
6. Complete `AgentCapabilities` with no omitted key.
7. Malformed and unknown records degrading to redacted `Anomaly` events instead of throwing.
8. Compaction reset behavior when the source exposes a boundary.
9. Tool call/result attribution and tail records after the final model call.
10. A documented `schemaRange` and source-version boundary.

Changes to detection, usage normalization, frame boundaries, or source pointers require a regression fixture.

## Declarative Adapters

The M1 JSONL MVP is implemented. Put a `tokray.config.json` in the working directory, or a global config at `~/.config/tokray/config.json`, and define `sources` plus one or more JSON Pointer-based adapters. The checked example and JSON Schema are [`tokray.config.example.json`](./tokray.config.example.json) and [`tokray.config.schema.json`](./tokray.config.schema.json).

The current declarative surface includes:

- source globs and platform-specific paths;
- detection signatures;
- JSON Pointer/JSONPath mappings;
- record type discrimination through exact pointer matches;
- message, tool, model, Usage, and cache mappings;
- structurally addressable message, system, and tool `SourceRef` rules;
- capability declarations and redaction;
- validation errors with config-file JSON paths.

The MVP intentionally supports JSONL only. YAML loading, stateful compaction mappings, JSONPath, multi-file joins, SQLite, and encrypted stores remain follow-up work. Complex SQLite, multi-file, encrypted, or stateful sources continue to use the TypeScript SDK or a Hook/request collector.

## Planned Agent Coverage

The first expansion group is Cursor, Cline/Roo Code, Continue, Windsurf, OpenCode, Aider, Gemini CLI, CodeBuddy, and Trae. Support is accepted only after local log and Hook behavior are verified; a product name on the roadmap is not a claim of exact Usage or runtime control.

For closed or incomplete logs, Tokray may use a local request collector or Hook bridge. Missing provider-side data remains `unobserved`.
