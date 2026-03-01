export enum DcpErrorCode {
  // Schema errors (E001-E099)
  BUNDLE_SCHEMA_INVALID = 'DCP-E001',
  ARTIFACT_SCHEMA_INVALID = 'DCP-E002',
  VERSION_UNSUPPORTED = 'DCP-E003',
  MANIFEST_MISSING = 'DCP-E004',

  // Signature errors (E100-E199)
  CLASSICAL_SIG_INVALID = 'DCP-E100',
  PQ_SIG_INVALID = 'DCP-E101',
  COMPOSITE_BINDING_INVALID = 'DCP-E102',
  SIGNATURE_MISSING = 'DCP-E103',
  SIGNATURE_EXPIRED = 'DCP-E104',

  // Hash/Chain errors (E200-E299)
  HASH_CHAIN_BROKEN = 'DCP-E200',
  MANIFEST_HASH_MISMATCH = 'DCP-E201',
  MERKLE_ROOT_MISMATCH = 'DCP-E202',
  DUAL_HASH_MISMATCH = 'DCP-E203',
  INTENT_HASH_MISMATCH = 'DCP-E204',

  // Identity errors (E300-E399)
  AGENT_REVOKED = 'DCP-E300',
  KEY_EXPIRED = 'DCP-E301',
  KEY_REVOKED = 'DCP-E302',
  KID_MISMATCH = 'DCP-E303',
  RPR_INVALID = 'DCP-E304',

  // Policy errors (E400-E499)
  TIER_INSUFFICIENT = 'DCP-E400',
  POLICY_VIOLATION = 'DCP-E401',
  DOWNGRADE_ATTEMPT = 'DCP-E402',
  CAPABILITY_DENIED = 'DCP-E403',

  // Session errors (E500-E599)
  SESSION_NONCE_INVALID = 'DCP-E500',
  SESSION_EXPIRED = 'DCP-E501',
  SESSION_REPLAY = 'DCP-E502',
  SEQUENCE_OUT_OF_ORDER = 'DCP-E503',

  // A2A errors (E600-E699)
  A2A_HANDSHAKE_FAILED = 'DCP-E600',
  A2A_BUNDLE_REJECTED = 'DCP-E601',
  A2A_CAPABILITY_MISMATCH = 'DCP-E602',
  A2A_SESSION_CLOSED = 'DCP-E603',
  A2A_DECRYPT_FAILED = 'DCP-E604',

  // Rate limiting (E700-E799)
  RATE_LIMIT_EXCEEDED = 'DCP-E700',
  CIRCUIT_OPEN = 'DCP-E701',
  BACKPRESSURE = 'DCP-E702',

  // Internal (E900-E999)
  INTERNAL_ERROR = 'DCP-E900',
  ALGORITHM_UNAVAILABLE = 'DCP-E901',
  HSM_ERROR = 'DCP-E902',
}

export interface DcpError {
  code: DcpErrorCode;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
  timestamp: string;
}

const ERROR_DESCRIPTIONS: Record<DcpErrorCode, { message: string; retryable: boolean }> = {
  [DcpErrorCode.BUNDLE_SCHEMA_INVALID]: { message: 'Bundle does not conform to DCP schema', retryable: false },
  [DcpErrorCode.ARTIFACT_SCHEMA_INVALID]: { message: 'Artifact does not conform to DCP schema', retryable: false },
  [DcpErrorCode.VERSION_UNSUPPORTED]: { message: 'DCP version not supported', retryable: false },
  [DcpErrorCode.MANIFEST_MISSING]: { message: 'Bundle manifest is missing', retryable: false },
  [DcpErrorCode.CLASSICAL_SIG_INVALID]: { message: 'Classical (Ed25519) signature verification failed', retryable: false },
  [DcpErrorCode.PQ_SIG_INVALID]: { message: 'Post-quantum signature verification failed', retryable: false },
  [DcpErrorCode.COMPOSITE_BINDING_INVALID]: { message: 'Composite signature binding is invalid', retryable: false },
  [DcpErrorCode.SIGNATURE_MISSING]: { message: 'Required signature is missing', retryable: false },
  [DcpErrorCode.SIGNATURE_EXPIRED]: { message: 'Signature has expired', retryable: false },
  [DcpErrorCode.HASH_CHAIN_BROKEN]: { message: 'Audit hash chain integrity check failed', retryable: false },
  [DcpErrorCode.MANIFEST_HASH_MISMATCH]: { message: 'Manifest hash does not match artifact', retryable: false },
  [DcpErrorCode.MERKLE_ROOT_MISMATCH]: { message: 'Merkle root does not match audit entries', retryable: false },
  [DcpErrorCode.DUAL_HASH_MISMATCH]: { message: 'Dual hash chain inconsistency detected', retryable: false },
  [DcpErrorCode.INTENT_HASH_MISMATCH]: { message: 'Intent hash does not match', retryable: false },
  [DcpErrorCode.AGENT_REVOKED]: { message: 'Agent has been revoked', retryable: false },
  [DcpErrorCode.KEY_EXPIRED]: { message: 'Signing key has expired', retryable: false },
  [DcpErrorCode.KEY_REVOKED]: { message: 'Signing key has been revoked', retryable: false },
  [DcpErrorCode.KID_MISMATCH]: { message: 'Key identifier does not match public key', retryable: false },
  [DcpErrorCode.RPR_INVALID]: { message: 'Responsible Principal Record is invalid', retryable: false },
  [DcpErrorCode.TIER_INSUFFICIENT]: { message: 'Security tier does not meet minimum requirement', retryable: false },
  [DcpErrorCode.POLICY_VIOLATION]: { message: 'Action violates policy', retryable: false },
  [DcpErrorCode.DOWNGRADE_ATTEMPT]: { message: 'Security tier downgrade is not allowed', retryable: false },
  [DcpErrorCode.CAPABILITY_DENIED]: { message: 'Requested capability is not authorized', retryable: false },
  [DcpErrorCode.SESSION_NONCE_INVALID]: { message: 'Session nonce is invalid or missing', retryable: false },
  [DcpErrorCode.SESSION_EXPIRED]: { message: 'Session has expired', retryable: true },
  [DcpErrorCode.SESSION_REPLAY]: { message: 'Session replay detected', retryable: false },
  [DcpErrorCode.SEQUENCE_OUT_OF_ORDER]: { message: 'Message sequence number is out of order', retryable: false },
  [DcpErrorCode.A2A_HANDSHAKE_FAILED]: { message: 'A2A handshake failed', retryable: true },
  [DcpErrorCode.A2A_BUNDLE_REJECTED]: { message: 'A2A bundle verification failed', retryable: false },
  [DcpErrorCode.A2A_CAPABILITY_MISMATCH]: { message: 'Requested capabilities not available', retryable: false },
  [DcpErrorCode.A2A_SESSION_CLOSED]: { message: 'A2A session is closed', retryable: true },
  [DcpErrorCode.A2A_DECRYPT_FAILED]: { message: 'A2A message decryption failed', retryable: false },
  [DcpErrorCode.RATE_LIMIT_EXCEEDED]: { message: 'Rate limit exceeded', retryable: true },
  [DcpErrorCode.CIRCUIT_OPEN]: { message: 'Circuit breaker is open, service temporarily unavailable', retryable: true },
  [DcpErrorCode.BACKPRESSURE]: { message: 'Service under backpressure, try again later', retryable: true },
  [DcpErrorCode.INTERNAL_ERROR]: { message: 'Internal error', retryable: true },
  [DcpErrorCode.ALGORITHM_UNAVAILABLE]: { message: 'Requested algorithm is not available', retryable: false },
  [DcpErrorCode.HSM_ERROR]: { message: 'HSM operation failed', retryable: true },
};

export function createDcpError(code: DcpErrorCode, details?: Record<string, unknown>): DcpError {
  const desc = ERROR_DESCRIPTIONS[code];
  return {
    code,
    message: desc.message,
    details,
    retryable: desc.retryable,
    timestamp: new Date().toISOString(),
  };
}

export class DcpProtocolError extends Error {
  public readonly dcpError: DcpError;

  constructor(code: DcpErrorCode, details?: Record<string, unknown>) {
    const dcpError = createDcpError(code, details);
    super(`${dcpError.code}: ${dcpError.message}`);
    this.name = 'DcpProtocolError';
    this.dcpError = dcpError;
  }

  get code(): DcpErrorCode { return this.dcpError.code; }
  get retryable(): boolean { return this.dcpError.retryable; }
}

export function isDcpError(error: unknown): error is DcpProtocolError {
  return error instanceof DcpProtocolError;
}
