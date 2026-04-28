import { describe, it, expect } from 'vitest';
import { jaroWinkler } from '../../src/matcher/jaro-winkler.js';

describe('jaroWinkler', () => {
  it('returns 1 for identical', () => expect(jaroWinkler('acme', 'acme')).toBe(1));
  it('returns 0 for disjoint', () => expect(jaroWinkler('abc', 'xyz')).toBe(0));
  it('close strings exceed 0.88', () => expect(jaroWinkler('acme', 'acme corp'.substring(0, 4))).toBeGreaterThan(0.88));
});
