/**
 * Token priors for content that never appears in the log as text.
 *
 * The request payload carries every resident tool schema and every
 * ToolSearch-materialized schema; the session log carries only NAMES. These
 * constants price those names. They are priors in the strict sense: shipped
 * guesses (TokenCount method 'prior', wide bands), sized against Claude Code
 * 2.1.x tool descriptions, and expected to drift across harness versions.
 * What keeps them honest is core's residentBreakdown(), which reconciles
 * their sum against the calibrated resident total instead of presenting the
 * priors as measurements.
 */

import type { TokenCount } from '@tokray/core';

/**
 * Per-tool schema priors (tokens) for well-known built-in tools. Sized from
 * the visible length of each tool's description + JSON schema; long-prompted
 * tools (Bash, Workflow) dominate.
 */
const BUILTIN_SCHEMA_TOKENS: Readonly<Record<string, number>> = {
  Bash: 1200,
  Read: 450,
  Edit: 350,
  Write: 250,
  Glob: 200,
  Grep: 600,
  Agent: 800,
  Task: 800,
  WebFetch: 300,
  WebSearch: 250,
  AskUserQuestion: 550,
  TodoWrite: 400,
  TaskCreate: 350,
  TaskUpdate: 300,
  NotebookEdit: 300,
  EnterPlanMode: 150,
  ExitPlanMode: 150,
  Skill: 350,
  ToolSearch: 250,
  SendUserFile: 250,
  Workflow: 2500,
  Artifact: 1200,
};

/** Fallback for names outside the table (MCP tools, new built-ins). */
const DEFAULT_SCHEMA_TOKENS = 350;

/** Band multipliers. Schemas vary wildly; claim little. */
const BAND: readonly [number, number] = [0.5, 2.5];

/** Price one tool schema by name. Always method 'prior', always banded. */
export function schemaPrior(name: string): TokenCount {
  // hasOwn, not plain indexing: `name` comes from an untrusted log, and
  // 'constructor'/'toString'/'__proto__' would resolve to inherited
  // functions, poisoning every downstream sum with NaN.
  const value = Object.hasOwn(BUILTIN_SCHEMA_TOKENS, name)
    ? BUILTIN_SCHEMA_TOKENS[name]!
    : DEFAULT_SCHEMA_TOKENS;
  return {
    value,
    method: 'prior',
    errorBand: [Math.round(value * BAND[0]), Math.round(value * BAND[1])],
  };
}
