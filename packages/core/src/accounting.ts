import { calibrate, frameEstimates } from './calibrate.js';
import type { AccountingStrategy, ContextFrame, ProviderUsage } from './types.js';
import type { Calibration, FrameEstimate } from './calibrate.js';

export interface CalibrationSegment {
  fromSeq: number;
  toSeq: number;
  model: string;
  reason: 'session-start' | 'compaction' | 'model-change';
  calibration: Calibration;
}

/** Normalize provider-specific cache semantics into total prompt tokens. */
export function normalizedInputTokens(usage: ProviderUsage): number {
  const input = usage.inputTokens ?? 0;
  if (usage.inputAccounting === 'excludes-cache') {
    return input + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  }
  return input;
}

function zeroIntercept(points: readonly FrameEstimate[]): Calibration {
  if (points.length === 0) {
    return {
      scale: 1,
      resident: { value: 0, method: 'calibrated-heuristic', errorBand: [0, 0] },
      r2: 0,
      n: 0,
    };
  }
  const ratios = points
    .filter((p) => p.estimated > 0)
    .map((p) => p.truth / p.estimated)
    .sort((a, b) => a - b);
  const rawScale = ratios.length > 0 ? ratios[Math.floor(ratios.length / 2)]! : 1;
  const scale = Math.min(3, Math.max(0.2, rawScale));
  let truthSq = 0;
  let residualSq = 0;
  for (const p of points) {
    truthSq += p.truth * p.truth;
    const residual = p.truth - scale * p.estimated;
    residualSq += residual * residual;
  }
  return {
    scale,
    resident: { value: 0, method: 'calibrated-heuristic', errorBand: [0, 0] },
    r2: truthSq > 0 ? Math.max(0, Math.min(1, 1 - residualSq / truthSq)) : 0,
    n: points.length,
  };
}

/** Select calibration behavior from adapter capabilities, not vendor names. */
export function calibrationFor(frames: readonly ContextFrame[], strategy: AccountingStrategy): Calibration {
  const points = frameEstimates(frames);
  if (strategy === 'exact-request') return zeroIntercept(points);
  if (strategy === 'usage-calibrated') return calibrate(points);
  return {
    scale: 1,
    resident: { value: 0, method: 'calibrated-heuristic', errorBand: [0, 0] },
    r2: 0,
    n: 0,
  };
}

/**
 * Fit independent calibration epochs when compaction or a model switch changes
 * the relationship between visible blocks and provider-reported usage.
 */
export function segmentedCalibrationFor(
  frames: readonly ContextFrame[],
  strategy: AccountingStrategy,
): CalibrationSegment[] {
  if (frames.length === 0) return [];
  const groups: Array<{ frames: ContextFrame[]; reason: CalibrationSegment['reason'] }> = [];
  let current: ContextFrame[] = [];
  let reason: CalibrationSegment['reason'] = 'session-start';
  const modelKey = (frame: ContextFrame) => `${frame.model.provider ?? ''}/${frame.model.model}`;
  for (const frame of frames) {
    const previous = current.at(-1);
    const boundary = previous && (frame.compactionRef !== undefined || modelKey(previous) !== modelKey(frame));
    if (boundary) {
      groups.push({ frames: current, reason });
      current = [];
      reason = frame.compactionRef !== undefined ? 'compaction' : 'model-change';
    }
    current.push(frame);
  }
  if (current.length > 0) groups.push({ frames: current, reason });
  return groups.map((group) => ({
    fromSeq: group.frames[0]!.seq,
    toSeq: group.frames.at(-1)!.seq,
    model: modelKey(group.frames[0]!),
    reason: group.reason,
    calibration: calibrationFor(group.frames, strategy),
  }));
}

export function calibrationForSeq(segments: readonly CalibrationSegment[], seq: number): Calibration {
  const segment = segments.find((candidate) => seq >= candidate.fromSeq && seq <= candidate.toSeq);
  return segment?.calibration ?? {
    scale: 1,
    resident: { value: 0, method: 'calibrated-heuristic', errorBand: [0, 0] },
    r2: 0,
    n: 0,
  };
}
