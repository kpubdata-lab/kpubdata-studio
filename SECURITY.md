# Security Policy

## Reporting a vulnerability

**Do not open a public issue.** Use [Private Vulnerability Reporting](https://github.com/yeongseon/kpubdata-studio/security/advisories/new) — it is enabled on this repository.

Please include, as far as you can:

- What an attacker can do, not only what looks wrong
- The smallest way to reproduce it
- Which commit or release you looked at

You will get an acknowledgement. If the report turns out to be a defect rather
than a vulnerability, it is moved to a normal issue and you are told so.

## What counts as a vulnerability here

This project handles **user-supplied API keys for Korean public data services**
(BYOK). The things we most want to hear about:

- **A key leaving the browser to anywhere other than the configured Builder**,
  or being written to browser storage when it should stay in memory.
- **A key appearing in a screenshot, a HAR file, an error tracker payload or a
  URL.**
- **Content from Builder being executed** rather than displayed.

Also in scope: anything that lets one user reach another user's data, and
anything that makes published data violate its provider's terms.

## What does not count

- A missing hardening measure with no reachable consequence
- Denial of service by simply sending a lot of requests
- Outdated dependencies with no exploitable path in this code — open a normal issue
- Findings from a scanner, pasted without a reachable path

## Supported versions

Only the latest release receives fixes. Studio and KPubData Builder ship as one
application under one version
([kpubdata ADR 0004](https://github.com/yeongseon/kpubdata/blob/main/docs/adrs/0004-versioning-and-release.md)),
so report the release you looked at — the tag, such as `v0.4.0` — and, if you know
it, the version Builder reported in `GET /version`. For code on `main` that has not
been released yet, give the commit SHA.

## Known limits, stated deliberately

- The LLM assistant key is kept in `localStorage` on purpose, under a separate
  policy from provider credentials. Provider credentials are not stored.
- Hiding an administration screen is a convenience. The actual authorization
  check is Builder's, and a report that the UI merely hid something is expected
  to say what Builder allowed.
- A report in either Korean or English is fine.
