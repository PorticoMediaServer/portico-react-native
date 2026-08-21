/** Monotonic fence for rejecting stale async playback/native error work after session replacement. */
export class PlayerGenerationFence {
  private generation = 0;

  advance(): number { this.generation += 1; return this.generation; }
  capture(): number { return this.generation; }
  accepts(candidate: number): boolean { return candidate === this.generation; }
}
