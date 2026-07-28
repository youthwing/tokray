import type {
  ActionAvailability,
  ActionExecutionTarget,
  ActionProposal,
  AgentCapabilities,
  AgentCapability,
  GovernanceFinding,
} from '@tokray/core';

interface TargetSpec {
  target: ActionExecutionTarget;
  requiredCapability?: AgentCapability;
}

function targetFor(action: string): TargetSpec {
  switch (action) {
    case 'defer-unused-tools':
      return { target: 'agent-config', requiredCapability: 'toolAllowlist' };
    case 'compress-tool-output':
      return { target: 'tool-hook', requiredCapability: 'rewriteOutput' };
    case 'inspect-context-peak':
    case 'review-compaction':
      return { target: 'agent-control', requiredCapability: 'compactionControl' };
    case 'review-persistent-block':
    case 'deduplicate-context-content':
    case 'stabilize-cache-prefix':
      return { target: 'request-proxy' };
    case 'preserve-cache-prefix':
    case 'inspect-calibration':
    case 'review-adapter-anomalies':
    default:
      return { target: 'tokray' };
  }
}

function availabilityFor(
  finding: GovernanceFinding,
  spec: TargetSpec,
  capabilities: AgentCapabilities,
): ActionAvailability {
  if (finding.recommendation.mode === 'observe' || spec.target === 'tokray') return 'inspect-only';
  if (spec.requiredCapability && capabilities[spec.requiredCapability] === 'none') return 'manual-only';
  return 'bridge-required';
}

/** Build read-only action proposals without claiming that an action provider exists. */
export function buildActionProposals(
  findings: readonly GovernanceFinding[],
  capabilities: AgentCapabilities,
): ActionProposal[] {
  return findings.map((finding, index) => {
    const spec = targetFor(finding.recommendation.action);
    const availability = availabilityFor(finding, spec, capabilities);
    const capabilitySupport = spec.requiredCapability
      ? capabilities[spec.requiredCapability]
      : undefined;
    return {
      id: `action:${finding.ruleId}:${index + 1}`,
      findingRuleId: finding.ruleId,
      action: finding.recommendation.action,
      mode: finding.recommendation.mode,
      risk: finding.recommendation.risk,
      evidence: finding.evidence,
      ...(finding.impact ? { impact: finding.impact } : {}),
      execution: {
        target: spec.target,
        availability,
        ...(spec.requiredCapability ? { requiredCapability: spec.requiredCapability } : {}),
        ...(capabilitySupport ? { capabilitySupport } : {}),
        appliesTo: availability === 'inspect-only' ? 'current-analysis' : 'future-calls',
      },
      preview: {
        writesFiles: false,
        changesRuntime: false,
        requiresApproval: availability !== 'inspect-only',
      },
    };
  });
}
