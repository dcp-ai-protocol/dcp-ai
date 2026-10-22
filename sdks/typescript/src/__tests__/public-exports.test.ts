import { describe, it, expect } from 'vitest';
import * as sdk from '../index.js';

describe('package entry point', () => {
  it('exports the Blinded RPR helpers', () => {
    for (const name of ['blindRpr', 'verifyBlindedRpr', 'isBlindedRpr', 'computePiiHash']) {
      expect(typeof (sdk as Record<string, unknown>)[name], name).toBe('function');
    }
  });
});
