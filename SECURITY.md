# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately**, not through public issues.

Use GitHub's private vulnerability reporting for this repository:
**[Report a vulnerability](https://github.com/mchacher/sowel/security/advisories/new)**
(Security tab → Advisories → Report a vulnerability).

This opens a private channel visible only to the maintainer. Public issues are
visible to everyone and must not be used for undisclosed vulnerabilities.

When reporting, please include:

- affected version (see `package.json`) and deployment (Docker, bare metal);
- a description of the issue and its impact;
- steps to reproduce, or a proof of concept, where possible.

## Supported versions

Security fixes are applied to the latest released version. Please upgrade to the
most recent release before reporting, in case the issue is already fixed.

## Disclosure process

1. You report privately through the advisory channel above.
2. The maintainer confirms the report and works on a fix, coordinating with you
   as needed.
3. Once a fix is released, the advisory is published (with credit, if you wish).

## Scope

This repository is the Sowel engine. Integration and recipe plugins live in
their own repositories; please report issues specific to a plugin against that
plugin's repository. Plugin supply-chain integrity (registry hashes, install
flow) is in scope here.
