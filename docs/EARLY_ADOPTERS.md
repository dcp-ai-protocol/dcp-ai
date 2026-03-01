# DCP-AI Early Adopter Program

**Program Launch:** Q1 2026
**Status:** Open for Applications

---

## What Is the DCP Early Adopter Program?

The DCP-AI Early Adopter Program is an invitation for organizations, developers, and AI platform builders to be among the first to integrate the Digital Citizenship Protocol into their systems. Early adopters gain direct access to the DCP-AI team, influence over protocol design decisions, and priority support as they build on the world's first post-quantum digital citizenship framework for AI agents.

This is not a beta test — it is a co-design partnership. Early adopters help shape DCP-AI by integrating it into real-world systems, surfacing edge cases, and providing feedback that directly informs the protocol's evolution.

---

## Who Should Apply?

- **AI platform companies** building agent frameworks (LangChain, CrewAI, AutoGen, etc.)
- **Enterprise teams** deploying autonomous AI agents in production
- **Government agencies** exploring AI governance and agent accountability
- **Financial institutions** requiring verifiable AI agent identity for compliance
- **Healthcare organizations** handling sensitive data with AI agents
- **Infrastructure providers** building API gateways, middleware, or agent orchestration
- **Security researchers** focused on post-quantum cryptography and agent safety
- **Independent developers** building novel AI agent applications

---

## Benefits

### Technical Access

- **Early SDK access**: Pre-release versions of TypeScript, Python, and Go SDKs with direct bug-fix priority.
- **Private repository access**: Access to unreleased features, experimental branches, and internal roadmap documents.
- **Reference implementations**: Working examples tailored to your stack (Express, FastAPI, gRPC, WebSocket).
- **Integration templates**: Pre-built templates for OpenAI, LangChain, CrewAI, and custom agent frameworks.

### Direct Support

- **Dedicated Slack channel**: Private channel with DCP-AI core team for technical questions and integration support.
- **Weekly office hours**: 30-minute weekly sessions with protocol architects (video call).
- **Priority issue resolution**: Bug reports from early adopters are triaged with highest priority.
- **Migration assistance**: Hands-on help migrating from v1.0 to v2.0 composite signatures.

### Co-Design Influence

- **Protocol RFCs**: Early access to propose and review protocol changes before they are finalized.
- **Feedback loop**: Direct input into security tier definitions, algorithm selection, and wire format decisions.
- **Conformance testing**: Co-develop conformance test suites that validate your integration.
- **Case study collaboration**: Published case study highlighting your integration (with your approval).

### Recognition

- **Early Adopter badge**: Recognized on the DCP-AI website and in documentation.
- **Conference speaking**: Priority for co-presenting at security and AI conferences.
- **Governance participation**: Path to becoming a DCP-AI Reviewer or Maintainer (see [GOVERNANCE.md](../GOVERNANCE.md)).

---

## Requirements

Early adopters commit to the following:

### Integration

1. **Integrate the DCP-AI SDK** into at least one production or staging system within 90 days of acceptance.
2. **Implement the core flow**: Agent identity creation, intent declaration, policy decision, audit trail, and bundle verification.
3. **Use composite signatures** (Ed25519 + ML-DSA-65) for v2.0 bundles.
4. **Run the conformance test suite** and report results.

### Feedback

1. **Provide structured feedback** via a shared form or Slack at least once per month.
2. **Report bugs and edge cases** via GitHub issues (private repo for security issues).
3. **Participate in at least two office hours** sessions during the program period.
4. **Complete an exit survey** at the end of the program period.

### Testing

1. **Run NIST KAT validation** for all cryptographic operations.
2. **Test cross-SDK verification** if using multiple languages.
3. **Validate backward compatibility** with v1.0 bundles (if applicable).
4. **Perform basic security testing**: attempt bundle tampering, signature stripping, and replay attacks against your verifier.

### Confidentiality

- Pre-release features and internal roadmap details shared under NDA.
- Bug reports and security issues follow responsible disclosure (see [GOVERNANCE.md](../GOVERNANCE.md)).

---

## Timeline

### Q1 2026: Foundation

| Week | Milestone |
|------|-----------|
| 1-2 | Applications open. Accepted adopters receive SDK access and Slack invite. |
| 3-4 | Kickoff office hours: protocol walkthrough, SDK setup, integration planning. |
| 5-8 | Initial integration. Core flow (identity, intent, audit, verify) operational. |
| 9-12 | Composite signature integration. NIST KAT validation. First feedback cycle. |

### Q2 2026: Expansion

| Week | Milestone |
|------|-----------|
| 13-16 | A2A communication (DCP-04) integration for multi-agent adopters. |
| 17-20 | Security tier tuning. Production hardening. Cross-SDK interop testing. |
| 21-24 | Case study drafting. Conformance certification. Program retrospective. |

### Q3 2026: Graduation

- Early adopters graduate to full DCP-AI ecosystem participants.
- Production deployments are publicly recognized.
- Governance participation path opens for active contributors.

---

## How to Apply

### Application Process

1. **Submit an application** via GitHub Discussion in the `dcp-ai-genesis` repository (use the "Early Adopter Application" template) or email the maintainers.

2. **Include the following:**
   - Organization name and description
   - Use case: What AI agents do you deploy or plan to deploy?
   - Technical stack: Languages, frameworks, infrastructure
   - Integration scope: Which DCP components are you most interested in?
   - Timeline: When can you begin integration?
   - Team size: How many developers will work on the integration?

3. **Review:** The DCP-AI maintainers review applications on a rolling basis (typically within 7 business days).

4. **Acceptance:** Accepted applicants receive a welcome packet with SDK access, Slack invite, and kickoff scheduling.

### Selection Criteria

Applications are evaluated on:

- **Diversity of use cases**: We aim to cover a broad range of agent types and deployment scenarios.
- **Production readiness**: Priority for teams planning real deployments (not just evaluation).
- **Technical capacity**: Team has experience with cryptographic protocols or agent systems.
- **Feedback commitment**: Willingness to engage actively in the co-design process.
- **Security posture**: Commitment to responsible handling of pre-release material.

---

## Support Channels

| Channel | Purpose | Access |
|---------|---------|--------|
| **GitHub Issues** | Bug reports, feature requests, conformance issues | Public (security issues via private advisory) |
| **Slack (Private)** | Daily technical support, integration questions | Early adopters only |
| **Discord** | Community discussion, general questions | Public |
| **Office Hours** | Weekly video call with protocol architects | Early adopters only |
| **Email** | Formal communications, NDA, program logistics | Early adopters only |

### Office Hours Schedule

- **Weekly**: Wednesdays 10:00 AM Pacific / 1:00 PM Eastern / 6:00 PM UTC
- **Duration**: 30 minutes
- **Format**: Open agenda — bring questions, demos, or issue walkthroughs
- **Recording**: Sessions are recorded and shared with early adopter group (not public)

---

## Bug Bounty for Security Issues

Early adopters (and the broader community) are encouraged to report security vulnerabilities in DCP-AI. We offer a bug bounty for qualifying security issues.

### Scope

- Cryptographic implementation flaws (signature bypass, key leakage, etc.)
- Protocol-level vulnerabilities (stripping attacks, replay, session splicing)
- SDK implementation bugs that compromise security guarantees
- Verification pipeline bypasses

### Out of Scope

- Denial-of-service attacks
- Social engineering
- Issues in third-party dependencies (report to the dependency maintainer)
- Issues requiring physical access to hardware

### Reward Tiers

| Severity | Description | Reward |
|----------|------------|--------|
| **Critical** | Complete signature verification bypass, private key extraction | $5,000–$15,000 |
| **High** | Composite binding circumvention, session key leakage, audit chain break | $2,000–$5,000 |
| **Medium** | Domain separation bypass, kid collision, canonicalization exploit | $500–$2,000 |
| **Low** | Information disclosure, timing side-channel, non-security conformance issue | $100–$500 |

### Disclosure Process

1. **Do NOT** open a public issue for security vulnerabilities.
2. Use GitHub's private vulnerability reporting feature or email the maintainers.
3. Include: description, reproduction steps, impact assessment, and suggested fix (if any).
4. Maintainers acknowledge within 48 hours and provide fix timeline.
5. Bounty is paid after the fix is released and the reporter is credited (unless anonymity is requested).

---

## Success Stories

*This section will be populated as early adopters complete their integrations.*

---

### [Your Organization Here]

We're looking for the first early adopters to share their integration stories. If you integrate DCP-AI into your system, we'd love to feature your experience — the challenges, the architecture decisions, and the outcomes.

Contact the DCP-AI team to discuss a case study collaboration.

---

## FAQ

**Q: Is there a cost to join the Early Adopter Program?**
A: No. The program is free. We invest in early adopters because their feedback is invaluable.

**Q: Do I need to use the post-quantum features?**
A: For v2.0 integrations, yes — composite signatures (Ed25519 + ML-DSA-65) are required. The SDK handles the complexity; the API is straightforward.

**Q: Can I participate as an individual developer?**
A: Yes. Individual developers and small teams are welcome.

**Q: What happens after the program ends?**
A: You continue using DCP-AI as a production participant. Active contributors may be invited to become Reviewers or Maintainers per the governance model.

**Q: Is DCP-AI production-ready?**
A: The v2.0 specification is finalized and all 13 implementation gaps are verified closed. SDKs are in active development. The Early Adopter Program is the bridge between specification completeness and broad production deployment.

---

*The DCP-AI Early Adopter Program is an open invitation to build the future of AI agent accountability — together.*
