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
- filter tool output with a deterministic built-in engine, preview optional RTK rewrites, run explicitly approved low-risk output comparisons, and register Provider-specific Hook Bridges with receipts and guarded rollback;
- preserve raw content locally and avoid claiming data the source never recorded.

The native engine currently executes tool-output filtering, diagnoses several additional context-governance surfaces, and labels progressive disclosure and workflow offload as planned. Configurable policy scopes, verified Agent-native Hook installers, broader optimization experiments, additional Agent adapters, and Token-aware workflows remain planned capabilities. A Tokray-managed Bridge registration must not be presented as a connected vendor Hook until that integration is verified.

## Product Direction

```text
Monitor        Govern         Optimize        Orchestrate
observe   ->   set policy ->  simulate/verify -> move deterministic work out of the model
```

- **Monitor**: real-time context, Usage, cache, tools, compaction, and issues.
- **Govern**: budgets, policies, alerts, capability-aware recommendations, and reversible actions.
- **Optimize**: compression, trimming, caching, tool selection, and model-routing experiments with before/after evidence.
- **Orchestrate**: focused Token-aware recipes in which scripts and APIs perform deterministic work and models retain semantic judgment.

Tokray is not becoming a generic workflow builder. A feature belongs in the core product only when it directly improves context efficiency, Token governance, or the verification loop.

## Users

- Engineers using coding agents who need to diagnose context growth, tool overhead, cache behavior, and compaction.
- Agent, Skill, and adapter developers who need compatibility tests and defensible Token attribution.
- Multi-Agent teams that need project, role, Agent, and model cost baselines.
- Platform teams that need self-hosted, privacy-preserving governance across developer machines.

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
