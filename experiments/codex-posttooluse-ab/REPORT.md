# Codex PostToolUse A/B Report

Date: 2026-07-28 (Asia/Shanghai)

## Scope

- Two temporary Codex CLI sessions used the requested `https://wingod.top` endpoint and received the same test prompt, automatically loaded project rules/metadata, and deterministic fixture output.
- Their event streams contain only the fixture command and no project source-reading tool calls.
- The expected answer was validated against `result.schema.json`.

## Results

| Arm | Thread | Input tokens | Cached input tokens | Output tokens | Model-visible fixture bytes | Quality |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Baseline | `019fa80c-8878-7eb2-bc8d-9f2df4d3d571` | 31,132 | 14,080 | 114 | 25,043 | 4/4 fields correct |
| Governed | `019fa80d-f43b-74d0-a0ae-2e75b70fcc74` | 31,131 | 14,080 | 113 | 25,043 | 4/4 fields correct |

Both answers were:

```json
{"artifact":"ctxray-ab-7f3c91","checksum":"sha256:6d8f3a917be245c0","passed":true,"records":480}
```

## Verdict

This run does not demonstrate provider-token savings. The one-token difference is noise, and the governed session still exposed all 25,043 fixture bytes to the model.

The local dispatcher is functional: the same 25,043-byte fixture becomes 240 bytes of Codex-supported `continue: false` feedback, including preserved execution metadata. That is a 99.04% local output reduction.

The earlier timestamp-based trust diagnosis was incorrect. A later authoritative local `hooks/list` query reports the current definition as enabled and `trusted`, and its `currentHash` exactly matches the saved `trusted_hash` (`sha256:0ae540e62e048c8085791f165e8c6e1c31af87d8ea2f99972b3f3443211cf337`). Codex hashes the normalized handler definition rather than the source file bytes, so rewriting an equivalent file does not invalidate trust.

The captured A/B event streams prove that the governed run retained the raw result, but they contain no Hook execution diagnostic. Therefore this experiment does not establish why that invocation skipped or failed to apply the Hook. Hooks are enabled in the installed CLI (`codex features list` reports `hooks stable true`), and `matcher: "*"` is a valid match-all value.

## Required Rerun

1. Run `tokray hook status --agent codex` and require `state: "active"` from Codex's local `hooks/list` API.
2. Run `tokray hook self-test --agent codex` and require `status: "passed"` with `modelCalls: 0`.
3. Use the same Codex executable, config home, project `cwd`, prompt, and fixture for both arms.
4. Accept the experiment only when the governed event stream contains Tokray replacement feedback and does not contain the 25,043-byte raw fixture.
5. Compare provider-reported input tokens and require the same 4/4 answer fields in both arms.

Official behavior reference: <https://learn.chatgpt.com/docs/hooks.md>
