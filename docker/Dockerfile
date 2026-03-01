# DCP-AI v2.0 Services — Multi-stage Docker image
# Includes: verification server, anchoring, transparency log, revocation service
#
# V2 additions:
#   - Composite hybrid signature verification (Ed25519 + ML-DSA-65)
#   - Session binding, blinded RPR, PQ checkpoints
#   - Multi-party M-of-N authorization
#   - Algorithm advisory system
#   - Audit trail compaction

FROM node:20-alpine AS base
WORKDIR /app

RUN apk add --no-cache wget

COPY package.json ./
RUN npm install --production

COPY lib/ ./lib/
COPY tools/ ./tools/
COPY server/ ./server/
COPY services/ ./services/
COPY schemas/ ./schemas/

# ── Verification Server (V1 + V2) ──
FROM base AS verification
EXPOSE 3000
ENV PORT=3000
ENV DCP_VERSION="2.0"
ENV VERIFIER_MODE="hybrid_required"
ENV REQUIRE_SESSION_BINDING="true"
ENV REQUIRE_COMPOSITE_BINDING="true"
ENV MAX_KEY_AGE_DAYS="365"
ENV ALLOW_V1_BUNDLES="true"
ENV PQ_CHECKPOINT_INTERVAL="10"
ENV ADVISORY_POLL_INTERVAL_MS="86400000"
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "server/index.js"]

# ── Anchoring Service ──
FROM base AS anchor
EXPOSE 3001
ENV PORT=3001
ENV DCP_VERSION="2.0"
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1
CMD ["node", "services/anchor/index.js"]

# ── Transparency Log ──
FROM base AS transparency-log
EXPOSE 3002
ENV PORT=3002
ENV DCP_VERSION="2.0"
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3002/health || exit 1
CMD ["node", "services/transparency-log/index.js"]

# ── Revocation Service ──
FROM base AS revocation
EXPOSE 3003
ENV PORT=3003
ENV DCP_VERSION="2.0"
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3003/health || exit 1
CMD ["node", "services/revocation/index.js"]
