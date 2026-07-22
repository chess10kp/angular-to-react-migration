import type { FixApplier, FixResult, ResidueItem, RetrievedContext } from './contracts.ts';

export type ApplyFn = (item: ResidueItem, ctx: RetrievedContext) => FixResult;

export class FixApplierV1 implements FixApplier {
  constructor(private readonly applyFn?: ApplyFn) {}

  apply(item: ResidueItem, ctx: RetrievedContext): FixResult {
    if (this.applyFn) {
      return this.applyFn(item, ctx);
    }
    // v1: pause for human/agent — self-report the target file only.
    return { files: [item.file] };
  }
}
