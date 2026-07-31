# Product

## Register

product

## Product Mission

Make every Agent Token earn its place.

Tokray helps developers understand, govern, optimize, and verify the context used by coding agents. It treats context as a finite engineering resource: every conclusion must be traceable to evidence, and every optimization must be measured against task quality rather than compression rate alone.

## Current Product

Tokray currently provides the Monitor and evidence foundation:

- reconstruct model-visible context from supported local Agent logs and complete request captures;
- attribute Token usage to messages, tools, schemas, files, memory, and compaction summaries;
- expose provider-reported Usage, cache semantics, uncertainty, and source references;
- diagnose context peaks, persistent blocks, tool overhead, cache efficiency, compaction, calibration, and parser issues;
- govern and forward OpenAI- and Anthropic-compatible model requests through a fixed-upstream local gateway with tool-description compaction, exact-schema deduplication, explicit tool allowlists, optional protocol-aware tool-result compaction, and an estimated input-budget gate;
- filter tool output with a deterministic built-in engine, preview optional RTK rewrites, run explicitly approved low-risk output comparisons, and register Provider-specific Hook Bridges with receipts and guarded rollback;
- preserve raw content locally and avoid claiming data the source never recorded.

The native engine currently executes model-request governance and tool-output filtering. A local gateway can apply the request policy to compatible traffic without an Agent Hook, preserve streaming responses, and block over-budget requests before the upstream call. Hooks, SDK middleware, MCP middleware, and log adapters remain capability-specific connectors. Persisted policy scopes, Provider routing profiles, Gemini/Vertex/Bedrock adapters, broader optimization experiments, and Token-aware workflows remain planned capabilities.

## Current Focus

Tokray has one active product goal: **make one provider-neutral gateway governance loop reliable and verifiable before broadening protocol coverage**.

The loop is complete only when a user can:

1. route one configurable Agent through a fixed-upstream local gateway;
2. govern tool schemas, tool results, and an estimated input budget without rebuilding Provider-specific fields;
3. preserve authentication, request paths, response status, and streaming output;
4. expose local health and metadata-only request statistics;
5. compare Provider Usage and a task-quality signal against an ungoverned baseline.

Monitor remains the evidence foundation. Codex Hooks remain useful for Agent-local tool paths, but they are no longer the product's universal data plane. The product promise is protocol and capability driven: an opaque Agent or server-side context that never exposes a complete request cannot receive full governance.

Until this loop is verified, additional Agent adapters, cross-session analytics, persisted team policy, model routing, workflow orchestration, self-hosted collection, and broader RTK integration remain secondary. The next protocol adapters are selected from observed user traffic rather than an unsupported claim of universal coverage.

## Product Direction

```text
Monitor        Govern         Optimize        Orchestrate
observe   ->   set policy ->  simulate/verify -> move deterministic work out of the model
```

- **Monitor**: real-time context, Usage, cache, tools, compaction, and issues.
- **Govern**: budgets, policies, alerts, capability-aware recommendations, and reversible actions.
- **Optimize**: compression, trimming, caching, tool selection, and model-routing experiments with before/after evidence.
- **Orchestrate**: focused Token-aware recipes in which scripts and APIs perform deterministic work and models retain semantic judgment.

These are sequential horizons, not simultaneous commitments. Tokray is currently finishing the first Monitor-to-Govern loop. It is not becoming a generic workflow builder. A feature belongs in the active scope only when it is necessary to complete or verify that loop.

## Users

- **Primary now**: individual developers using Codex or Claude Code locally who need to find and safely reduce context waste in a real session.
- **Secondary later**: Agent, Skill, and adapter developers who need compatibility tests and defensible Token attribution.
- **Not current scope**: team policy administration and multi-machine platform operations.

## Primary User Outcomes

1. Identify which content consumes Token budget and how long it remains resident.
2. Understand whether the cost comes from the Agent, model provider, tool chain, cache behavior, or workflow structure.
3. Receive a recommendation with confidence, evidence, expected impact, risk, and action availability.
4. Preview and approve a reversible optimization.
5. Verify actual Token, cost, latency, retry, and quality changes against a baseline.

## Identity Model

Agent and model provider are independent dimensions:

```text
Agent: Claude Code, Codex, Cursor, Trae, CodeBuddy, Cline
Provider: Anthropic, OpenAI, DeepSeek, ByteDance, Alibaba, Google
```

Every adapter and UI filter must preserve this distinction. A source capability matrix states what can be observed and what can be controlled; unsupported data degrades to partial, unknown, or unobserved rather than a fabricated value.

## Product Principles

- Evidence before interpretation: every estimate exposes method, confidence, and source.
- Quality before compression rate: fewer Tokens are not a win when task success degrades.
- Context is temporal: growth, persistence, reference, and compaction must remain legible across calls.
- Capability-driven behavior: the UI only offers actions supported by the current Agent/runtime.
- Local is a boundary: raw logs and conversation content remain local by default.
- Read-only by default: installing hooks or changing Agent configuration requires explicit approval.
- Reversible governance: actions have previews, receipts, and rollback paths.
- Provider differences remain explicit instead of being normalized into ambiguity.
- Coverage claims name their boundary: discovered logs, selected-call context, and full-session reconstruction are separate scopes.

## Deployment Model

- `tokray web`: direct local analysis and monitoring.
- `tokray agent`: planned local collector and action runner.
- `tokray serve`: planned self-hosted, multi-machine control center.

Collectors send normalized metrics or fingerprints by default. Sending redacted full content is an explicit configuration choice. Tokray does not require a hosted SaaS.

## Brand Personality

Precise, candid, forensic, and operational. The interface should feel focused and technically credible, with uncertainty exposed rather than smoothed over.

## Anti-references

Not a marketing dashboard, generic cloud observability suite, general-purpose workflow canvas, playful AI assistant, or decorative analytics gallery. Avoid oversized metrics, nested cards, dark sci-fi styling, glass surfaces, unexplained scores, and color used without data meaning.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Never rely on color alone, preserve keyboard navigation and visible focus, support reduced motion, keep technical labels readable at desktop and mobile sizes, and provide Chinese and English terminology explanations.
