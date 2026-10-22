import { describe, it, expect, vi } from 'vitest';

// The tier must count the policy decision's risk_score (spec §14.2). The pinned
// @dcp-ai/sdk 2.1.0 ignores that argument, so this checks what is passed to it.
vi.mock('@dcp-ai/sdk', async (importOriginal) => {
  const sdk = await importOriginal<typeof import('@dcp-ai/sdk')>();
  return { ...sdk, computeSecurityTier: vi.fn(sdk.computeSecurityTier) };
});

import { computeSecurityTier } from '@dcp-ai/sdk';
import { clearSession, executeDeclareIntent, executeIdentitySetup } from '../index.js';

describe('executeDeclareIntent security tier', () => {
  it('computes the tier with the risk score of its policy decision', async () => {
    clearSession('intent-tier');
    await executeIdentitySetup({
      session_id: 'intent-tier',
      owner_name: 'Test User',
      entity_type: 'natural_person',
      jurisdiction: 'US',
    });
    const result = await executeDeclareIntent({
      session_id: 'intent-tier',
      action_type: 'send_email',
      target_channel: 'email',
      estimated_impact: 'medium',
    });

    expect(computeSecurityTier).toHaveBeenCalledWith(
      expect.objectContaining({ intent_id: result.intent_id }),
      expect.objectContaining({ risk_score: result.risk_score }),
    );
  });
});
