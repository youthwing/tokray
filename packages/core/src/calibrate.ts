/**
 * Usage-anchored calibration.
 *
 * The source log records messages, not the request payload: the system prompt
 * and tool definitions never appear in it. But every frame carries an exact
 * total (input + cacheRead + cacheWrite). Modeling
 *
 *     T_i  =  s * E_i  +  R
 *
 * where E_i is our heuristic estimate of conversation tokens for frame i,
 * gives us two things at once via least squares:
 *
 * - s: a per-session scale correcting the estimator's systematic bias;
 * - R: the intercept — the resident layer (system prompt + tool definitions
 *   + skills) that is present on every call but absent from the log.
 *
 * The fit quality (r²) and residual spread are reported, not hidden: resident
 * is a `calibrated-heuristic` TokenCount with an error band, per the contract.
 */

import type { ContextFrame, TokenCount } from './types.js';

export interface Calibration {
  /** Multiplicative correction for heuristic estimates. */
  scale: number;
  /** Estimated resident-layer tokens (intercept). */
  resident: TokenCount;
  /** Coefficient of determination of the linear fit. */
  r2: number;
  /** Number of frames used. */
  n: number;
}

export interface FrameEstimate {
  seq: number;
  /** Exact total prompt tokens (ground truth from API usage). */
  truth: number;
  /** Heuristic estimate of conversation tokens (resident layer excluded). */
  estimated: number;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (pos - lo);
}

/**
 * Ordinary least squares of truth on estimate, with intercept.
 * Falls back to scale=1 when the session is too small or degenerate.
 */
export function calibrate(points: readonly FrameEstimate[]): Calibration {
  const n = points.length;
  if (n < 3) {
    // Too few frames to fit anything. "Unknown" must stay a first-class
    // state: never claim an exact zero with a zero-width band — return the
    // naive difference with a band spanning everything we cannot rule out.
    const meanT = n > 0 ? points.reduce((a, p) => a + p.truth, 0) / n : 0;
    const meanE = n > 0 ? points.reduce((a, p) => a + p.estimated, 0) / n : 0;
    return {
      scale: 1,
      resident: {
        value: Math.max(0, Math.round(meanT - meanE)),
        method: 'calibrated-heuristic',
        errorBand: [0, Math.round(meanT)],
      },
      r2: 0,
      n,
    };
  }

  let sumE = 0;
  let sumT = 0;
  for (const p of points) {
    sumE += p.estimated;
    sumT += p.truth;
  }
  const meanE = sumE / n;
  const meanT = sumT / n;

  let covET = 0;
  let varE = 0;
  let varT = 0;
  for (const p of points) {
    const de = p.estimated - meanE;
    const dt = p.truth - meanT;
    covET += de * dt;
    varE += de * de;
    varT += dt * dt;
  }

  // Degenerate: estimates barely vary (e.g. trivial conversation). Scale is
  // unidentifiable; report resident as the mean total with a wide band.
  if (varE < 1e-9 || varT < 1e-9) {
    return {
      scale: 1,
      resident: {
        // Estimator overshoot would push this negative; clamp like the main
        // path does — a negative token count is never a valid answer.
        value: Math.max(0, Math.round(meanT - meanE)),
        method: 'calibrated-heuristic',
        errorBand: [0, Math.round(meanT)],
      },
      r2: 0,
      n,
    };
  }

  let scale = covET / varE;
  // A negative or wild slope means the linear model does not hold (e.g. the
  // session compacted mid-way, or estimates are broken). Clamp to a sane
  // range rather than reporting nonsense.
  scale = Math.min(3, Math.max(0.2, scale));

  const residuals: number[] = [];
  for (const p of points) {
    residuals.push(p.truth - scale * p.estimated);
  }
  residuals.sort((a, b) => a - b);

  const resident = Math.max(0, Math.round(quantile(residuals, 0.5)));

  // r² is measured against the model we actually REPORT (clamped scale +
  // resident intercept), not the raw OLS line. When the clamp engages, the
  // reported model fits worse than the OLS optimum — and r² must say so,
  // otherwise the numbers are least trustworthy exactly when confidence
  // reads highest.
  let ssRes = 0;
  for (const p of points) {
    const e = p.truth - (scale * p.estimated + resident);
    ssRes += e * e;
  }
  const r2 = Math.max(0, Math.min(1, 1 - ssRes / varT));

  let lo = Math.max(0, Math.round(quantile(residuals, 0.25)));
  let hi = Math.max(0, Math.round(quantile(residuals, 0.75)));
  if (resident === 0 && hi === 0) {
    // Estimates systematically exceed truth: the intercept is unidentifiable,
    // not "exactly zero". A zero-width band at zero would claim precision we
    // do not have.
    lo = 0;
    hi = Math.round(meanT);
  }

  return {
    scale,
    resident: { value: resident, method: 'calibrated-heuristic', errorBand: [lo, hi] },
    r2,
    n,
  };
}

/**
 * Convenience: build calibration inputs from parsed frames.
 * Frames without usable usage (truth <= 0) are excluded — a single synthetic
 * placeholder record would otherwise poison the regression as an
 * (estimate > 0, truth = 0) outlier.
 */
export function frameEstimates(frames: readonly ContextFrame[]): FrameEstimate[] {
  return frames
    .filter((f) => f.totals.input > 0)
    .map((f) => {
      let est = 0;
      for (const b of f.blocks) est += b.tokens.value;
      return { seq: f.seq, truth: f.totals.input, estimated: est };
    });
}
