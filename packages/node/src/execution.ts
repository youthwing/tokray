import type { ActionReceipt } from '@tokray/core';
import { compareRtkOutput } from './rtk.js';
import type { RtkOptions, RtkOutputComparison } from './rtk.js';
import { createActionReceipt } from './receipts.js';
import type { ActionReceiptStoreOptions } from './receipts.js';

export interface RtkComparisonExecution {
  comparison: RtkOutputComparison;
  receipt: ActionReceipt;
}

export async function runApprovedRtkComparison(
  command: string,
  approval: { approved: true; expectedRewrite: string },
  options: RtkOptions & ActionReceiptStoreOptions & { cwd?: string } = {},
): Promise<RtkComparisonExecution> {
  const approvedAt = new Date().toISOString();
  const comparison = await compareRtkOutput(command, approval, options);
  const completedAt = new Date().toISOString();
  const receipt = await createActionReceipt({
    action: 'compare-rtk-output',
    target: 'tokray',
    status: 'completed',
    actor: 'local-user',
    approvedAt,
    completedAt,
    summary: `Compared raw and RTK output for ${comparison.original.command}`,
    changes: [
      { kind: 'execute-command', target: comparison.original.command },
      { kind: 'execute-command', target: comparison.compact.command },
    ],
    rollback: { available: false, reason: 'comparison-has-no-persistent-change' },
    result: {
      workingDirectory: comparison.workingDirectory,
      originalBytes: comparison.original.bytes,
      compactBytes: comparison.compact.bytes,
      estimatedSavedTokens: comparison.estimatedSavedTokens,
      outputReductionPercentage: comparison.outputReductionPercentage,
      method: comparison.estimate.method,
      billingEquivalent: false,
    },
  }, options);
  return { comparison, receipt };
}
