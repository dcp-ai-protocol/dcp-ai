# DCP-AI Services — Multi-stage Docker image
# Includes: verification server, anchoring, transparency log, revocation service

FROM node:20-alpine AS base
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .

# ── Verification Server ──
FROM base AS verification
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server/index.js"]

# ── Anchoring Service ──
FROM base AS anchor
EXPOSE 3001
ENV PORT=3001
CMD ["node", "services/anchor/index.js"]

# ── Transparency Log ──
FROM base AS transparency-log
EXPOSE 3002
ENV PORT=3002
CMD ["node", "services/transparency-log/index.js"]

# ── Revocation Service ──
FROM base AS revocation
EXPOSE 3003
ENV PORT=3003
CMD ["node", "services/revocation/index.js"]
