import type { MatcherConfig } from './config.js';

export type Bucket = 'auto_confirm' | 'propose' | 'skip';

export function bucket(confidence: number, cfg: MatcherConfig): Bucket {
  if (confidence >= cfg.confidence.autoConfirm) {
    return 'auto_confirm';
  }
  if (confidence >= cfg.confidence.propose) {
    return 'propose';
  }
  return 'skip';
}

export function withinTolerance(a: number, b: number, cents: number): boolean {
  return Math.abs(a - b) <= cents;
}
