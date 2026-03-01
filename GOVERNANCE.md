# DCP-AI Governance

This document describes the governance model for the DCP-AI (Digital Citizenship Protocol for AI Agents) project.

## Governance Model

DCP-AI uses an **open governance** model. The project is developed in the open, and contributions are welcome from anyone. Major decisions are made through consensus among maintainers, informed by community input.

## Roles

### Contributors

Anyone who submits a pull request, files an issue, participates in discussions, or otherwise contributes to the project. Contributors are expected to follow the [Contributing Guide](CONTRIBUTING.md) and the project's code of conduct.

### Reviewers

Trusted contributors who have demonstrated sustained, high-quality contributions and a solid understanding of the protocol. Reviewers can:

- Approve pull requests
- Triage and label issues
- Participate in design discussions with elevated weight

Reviewers are nominated by maintainers and confirmed by consensus.

### Maintainers

Maintainers have full write access to the repository and are responsible for the overall direction of the project. Maintainers can:

- Merge pull requests
- Create releases
- Manage CI/CD and infrastructure
- Nominate and approve new reviewers and maintainers
- Make final decisions when consensus cannot be reached

New maintainers are added by unanimous consent of existing maintainers.

## Decision-Making Process

1. **Proposals**: Significant changes (new protocol versions, breaking changes, new SDKs, governance changes) should be proposed as GitHub issues or discussions before implementation.

2. **Discussion**: All stakeholders are encouraged to provide feedback. Allow a minimum of 7 days for discussion on significant proposals.

3. **Consensus**: Decisions are made by consensus among maintainers. Consensus means no maintainer has a sustained objection after discussion.

4. **Voting**: If consensus cannot be reached, a simple majority vote among maintainers decides the outcome. Each maintainer has one vote. The vote must remain open for at least 72 hours.

5. **Documentation**: All significant decisions are documented in the relevant issue, PR, or discussion thread.

## Protocol Changes

Changes to the normative protocol specifications (`spec/`) require a higher bar:

- A written proposal describing the change, motivation, and backwards compatibility implications
- Review by at least two maintainers
- A minimum 14-day discussion period for breaking changes
- Updated conformance tests that validate the new behavior
- Updated schemas in `schemas/v1/` (or a new version directory)

## Release Process

1. **Versioning**: The project follows [Semantic Versioning](https://semver.org/). Protocol versions (e.g., DCP v1.0) are separate from implementation versions.

2. **Release Cadence**: Releases are made as needed. There is no fixed schedule.

3. **Release Steps**:
   - All CI checks must pass on `main`
   - A maintainer creates a release branch (if applicable) or tags from `main`
   - Changelog is updated with all notable changes
   - Release notes are published on GitHub
   - SDK packages are published to their respective registries (npm, PyPI, crates.io, pkg.go.dev)

4. **Hotfixes**: Critical security or correctness fixes may bypass the normal discussion period at maintainer discretion.

## Security Disclosure Policy

If you discover a security vulnerability in DCP-AI:

1. **Do NOT** open a public issue.
2. Email the maintainers privately at the address listed in `SECURITY.md` (or the repository's security advisory feature on GitHub).
3. Include a description of the vulnerability, steps to reproduce, and potential impact.
4. Maintainers will acknowledge receipt within 48 hours and provide an estimated timeline for a fix.
5. A security advisory will be published after the fix is released.

For full details, see [SECURITY.md](SECURITY.md) (if present) or use GitHub's private vulnerability reporting feature.

## Amendments

This governance document may be amended by consensus among maintainers, following the standard decision-making process with a minimum 14-day discussion period.
