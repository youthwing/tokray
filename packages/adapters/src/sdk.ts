import { blockFeatures, contentHash, heuristicTokenEstimator } from '@tokray/core';
import type {
  Adapter,
  Attribution,
  BlockId,
  ContextBlock,
  ParseContext,
  TokenCount,
  TokenEstimator,
  UsageSignal,
} from '@tokray/core';

/** Compile-time checked adapter definition for third-party packages. */
export function defineAdapter<T extends Adapter>(adapter: T): T {
  return adapter;
}

/** Shared block construction with stable ids and frame-relative usage data. */
export class BlockBuilder {
  readonly #ctx: ParseContext;
  readonly #prefix: string;
  readonly #introduced = new Map<BlockId, number>();
  readonly #estimator: TokenEstimator;
  #counter = 0;

  constructor(ctx: ParseContext, prefix = 'b', estimator: TokenEstimator = heuristicTokenEstimator) {
    this.#ctx = ctx;
    this.#prefix = prefix;
    this.#estimator = estimator;
  }

  create(args: {
    record: number;
    pointer?: string;
    text: string;
    attribution: Attribution;
    introducedSeq: number;
    tokens?: TokenCount;
  }): ContextBlock {
    const id = `${this.#prefix}${++this.#counter}` as BlockId;
    this.#introduced.set(id, args.introducedSeq);
    const sourceRef = { sourceId: this.#ctx.sourceId, record: args.record } as ContextBlock['sourceRef'];
    if (args.pointer !== undefined) sourceRef.pointer = args.pointer;
    return {
      id,
      attribution: args.attribution,
      sourceRef,
      tokens: args.tokens ?? this.#estimator.estimate(args.text),
      hash: contentHash(args.text),
      features: blockFeatures(args.text),
    };
  }

  usage(blocks: readonly ContextBlock[], seq: number): UsageSignal[] {
    return blocks.map((block) => {
      const introducedSeq = this.#introduced.get(block.id) ?? seq;
      return { blockId: block.id, introducedSeq, ageFrames: seq - introducedSeq + 1 };
    });
  }
}
