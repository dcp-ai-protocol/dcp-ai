# DCP-AI Early Adopter Program

**Status:** Open — rolling admission
**License:** Apache-2.0 (no cost to participate)

---

## What it is

DCP-AI is a portable accountability layer for AI agents: cryptographic identity, machine-readable intent, tamper-evident audit trails, agent-to-agent communication, lifecycle governance, and delegated representation. The full stack is open source and installable from every major registry.

The Early Adopter Program is an invitation to teams deploying AI agents in real systems to integrate DCP-AI, surface the edge cases a specification-only review cannot find, and directly shape the next iteration of the protocol.

This is not a beta test. The SDKs are published and used. This is a co-design partnership: your integration story becomes part of how v2.1 gets designed.

---

## Who should apply

- **AI platform teams** building agent frameworks or orchestration
- **Enterprise teams** deploying autonomous agents where liability, audit, or regulatory compliance matter
- **Financial, healthcare, or public-sector teams** that need verifiable agent identity
- **Researchers** working on agent safety, post-quantum crypto, or verifiable credentials
- **Independent developers** shipping novel agent products and willing to share what they learn

---

## What you get

### Everything in the public stack

You are not waiting on "access" to anything. These are already live:

| Artifact | Where |
|---|---|
| 9 protocol specifications (DCP-01..09) | [docs.dcp-ai.org](https://docs.dcp-ai.org/) |
| 5 SDKs at feature parity (TypeScript, Python, Go, Rust, WASM) | npm / PyPI / crates.io / Go modules |
| 10 framework integrations (LangChain, CrewAI, OpenAI, Express, FastAPI, Anthropic MCP, Google A2A, AutoGen, W3C DID, OpenClaw) | npm + dcp-ai[extras] |
| 4 `npm create @dcp-ai/*` scaffolders | npm |
| Docker images for the four services | `ghcr.io/dcp-ai-protocol/dcp-ai/*` |
| Interactive playground | [dcp-ai.org/playground](https://dcp-ai.org/playground/) |
| JSON-LD `@context` for Verifiable Credentials | [dcp-ai.org/credentials/v2](https://dcp-ai.org/credentials/v2) |

### What early adopters get on top

- **Direct channel to the maintainers** via GitHub Issues/Discussions — responses within 2 business days, highest-priority triage for blockers.
- **Co-design input** on the v2.1 roadmap: which security tiers, which algorithms, which wire-format decisions.
- **Conformance validation**: help you build test suites that exercise your specific integration paths; results feed back into the public conformance suite.
- **Case study collaboration** (opt-in): a published write-up of your integration — architecture decisions, challenges, outcomes — with your approval on every paragraph.
- **Governance path**: active contributors are invited to become Reviewers or Maintainers per [GOVERNANCE.md](../GOVERNANCE.md).

---

## What we ask

### Integration

1. Integrate the DCP-AI SDK into at least one staging or production path within 90 days of kickoff.
2. Implement the core flow end-to-end: identity binding → intent declaration → policy decision → audit entry → bundle verification.
3. For v2.0 use composite hybrid signatures (Ed25519 + ML-DSA-65). The SDKs do this for you; no hand-rolling.
4. Run the conformance test suite against your integration and share the result.

### Feedback

1. One structured feedback note per month — GitHub Discussion, email, or a short call, whichever is easier.
2. File bugs and edge cases as GitHub issues. For security-sensitive findings, use GitHub's private vulnerability reporting.
3. Participate in at least one open discussion thread where design decisions are being weighed.

### Testing

1. Run NIST KAT validation for the cryptographic primitives you rely on (Ed25519, ML-DSA-65; ML-KEM-768 and SLH-DSA-192f if applicable).
2. If you use multiple SDKs in the same system, run the cross-SDK interop vectors (`tests/interop/v2/`).
3. Validate backward compatibility with v1.0 bundles if any exist in your pipeline.
4. Try to break things: bundle tampering, signature stripping, session splicing, replay. If you break it, we want to know.

---

## Timeline

The program runs on rolling admission. Your clock starts when you accept.

| Phase | Typical duration | What happens |
|---|---|---|
| Onboarding | week 1 | Kickoff call / thread. Protocol walkthrough targeted at your stack. Integration plan drafted. |
| Integration | weeks 2-8 | Core flow built. First conformance run. First blocker surfaces. Unblock cycle with maintainer input. |
| Hardening | weeks 9-12 | Security tier tuning. NIST KAT coverage. Cross-SDK interop if applicable. Production-readiness review. |
| Graduation | week 13+ | You're a full ecosystem participant. Case study drafted if you opted in. Governance path opens. |

There is no formal "end date." You stay in the program as long as you're shipping and the feedback loop is active.

---

## How to apply

### Process

1. Open a GitHub Discussion on [`dcp-ai-protocol/dcp-ai`](https://github.com/dcp-ai-protocol/dcp-ai/discussions) using the **Early Adopter Application** template (or open an issue with the `early-adopter` label if discussions are not enabled for your path).
2. Alternatively, email the maintainers (see [GOVERNANCE.md](../GOVERNANCE.md) for current maintainer contacts).

### What to include

- Organization or team name, short description
- Use case: what agents do you deploy, or plan to deploy?
- Technical stack: languages, frameworks, infrastructure
- Which DCP components are most relevant to you (DCP-01 identity? DCP-03 audit? DCP-07 arbitration? all of them?)
- Timeline: when can you begin?
- Team size: how many engineers will touch the integration?

### Review

Applications are reviewed on a rolling basis, typically within 7 business days. We aim for a mix of use cases — enterprise compliance, research, indie builders — rather than selecting by size.

---

## Selection criteria

- **Diversity of use cases** — we actively want unusual applications, not just the expected enterprise paths.
- **Real deployment intent** — priority for teams shipping to real systems, not just evaluating.
- **Engagement** — willingness to share what you find, both positive and negative.
- **Technical capacity** — team has prior experience with cryptographic protocols, agent systems, or security-relevant infrastructure.

---

## Support channels

| Channel | Purpose | Access |
|---|---|---|
| GitHub Issues | Bugs, feature requests, conformance issues | Public |
| GitHub Discussions | Design questions, early-adopter threads, integration patterns | Public |
| Private vulnerability reports | Security-sensitive findings | GitHub's private reporting |
| Email | NDA-bounded work, contract discussions | Per [GOVERNANCE.md](../GOVERNANCE.md) |

No dedicated Slack, Discord, or office-hours call exists at this time. The program is run lean so maintainer bandwidth goes to actually solving your problems. If demand grows enough to justify a community channel, we'll add one and announce it here.

---

## Security disclosure

DCP-AI security issues are disclosed responsibly through GitHub's private vulnerability reporting. A monetary bug bounty may be offered on a case-by-case basis for high-impact findings; this is decided per-report based on severity and reproducibility, not a pre-committed tier. Researchers who prefer public credit are acknowledged in release notes.

See [SECURITY_MODEL.md](SECURITY_MODEL.md) for the threat model and reporting guidance.

---

## Success stories

*This section will be populated as early adopters publish their integrations.*

### [Your organization here]

If you integrate DCP-AI and are willing to share the story — architectural decisions, surprises, outcomes — we want to feature it. Contact the maintainers to start a case-study thread.

---

## FAQ

**Q: Is DCP-AI production-ready?**
A: Yes, for the deployments it is designed for. The v2.0 specification is complete, the public audit closed 6/6 recommendations (see [spec/AUDIT-v2.0-FINAL.md](../spec/AUDIT-v2.0-FINAL.md)), and the 5 SDKs are published and used. DCP-04 through DCP-09 are labelled "Published — v2.0 (extension; revisions tracked via adopter feedback)" in their headers; the wire format is stable and tested, and point-release revisions will be driven by adopter feedback rather than by breaking changes.

**Q: Is there a cost to join the Early Adopter Program?**
A: No. The program is free. The entire project is Apache-2.0.

**Q: Do I need to use the post-quantum features?**
A: For v2.0 bundles, yes — composite hybrid signatures (Ed25519 + ML-DSA-65) are required. The SDK does the heavy lifting. You do not write crypto by hand.

**Q: Can I participate as an individual developer?**
A: Yes. Individual developers and small teams are welcome and often surface the most interesting edge cases.

**Q: What happens when I finish the program?**
A: You keep using DCP-AI. Active contributors are invited to become Reviewers or Maintainers per [GOVERNANCE.md](../GOVERNANCE.md).

**Q: Can I run my own hosted instance of the services?**
A: Yes — that's the intended model. The verification server, anchor, transparency log, and revocation registry are all published as Docker images on GHCR with Fly.io configs ready in [`deploy/`](../deploy/). There is no first-party SaaS; every operator runs their own.

**Q: How do I cite DCP-AI in a paper?**
A: See [CITATION.cff](../CITATION.cff) for both the paper and software DOIs.

---

*The DCP-AI Early Adopter Program is an open invitation to build the accountability infrastructure that autonomous AI systems need, together.*
