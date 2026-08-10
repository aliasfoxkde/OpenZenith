# Security Policy

## Supported Versions

The following versions of OpenZenith are currently supported with security updates:

| Version | Supported          | Notes                                      |
|---------|--------------------|--------------------------------------------|
| 0.7.x   | :white_check_mark: | Current stable release                     |
| 0.6.x   | :x:                | Deprecated — upgrade to 0.7.x recommended  |
| < 0.6   | :x:                | End of life — no longer supported          |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue,
please report it responsibly.

**Please report vulnerabilities via email only:**

- **Email**: dev@openzenith.cyopsys.com
- **PGP Key**: _(contact dev@openzenith.cyopsys.com for PGP key)_

When reporting, please include as much of the following information as possible:

- Description of the vulnerability
- Steps to reproduce the issue
- Potential impact of the vulnerability
- Affected components (Python SDK, REST API, WASM, Rust core, etc.)
- Any suggested fixes (optional)

## Expected Response Times

We are committed to responding to security reports in a timely manner:

| Timeline | Action                                                   |
|----------|----------------------------------------------------------|
| < 48h    | **Acknowledgment** — We will confirm receipt of your report and begin investigation |
| < 7d     | **Initial Assessment** — We will provide an update on the severity and our planned fix |
| < 30d    | **Fix & Release** — For confirmed vulnerabilities, we aim to release a patch or new version within 30 days |

## Security Advisories

Published security advisories and their status are available at:

**https://github.com/aliasfoxkde/OpenZenith/security/advisories**

## Nature of This Project

OpenZenith is a geospatial data and API platform. It is important to understand
our threat model:

- **No user accounts** — OpenZenith does not authenticate end users. There are
  no user login systems, sessions, or stored credentials.
- **No client-side auth tokens** — The SDK and browser clients do not store
  authentication tokens. All elevation and terrain data is publicly available.
- **Data/API project** — The project serves and processes publicly available
  geospatial data (SRTM, GEBCO bathymetry). Attack surfaces are limited to:
  - The REST API endpoints (denial of service, malformed input)
  - Dependency supply chain (handled via Dependabot)
  - Data integrity (handled via checksums on tile formats)

## Dependency Scanning

This project uses **Dependabot** to automatically monitor dependencies for known
vulnerabilities. Pull requests are automatically opened when security advisories
affect our dependencies.

- Python dependencies are tracked in `pyproject.toml` / `requirements*.txt`
- JavaScript/TypeScript dependencies are tracked in `package.json`
- Rust dependencies are tracked in `Cargo.toml`

We aim to merge Dependabot security updates within 7 days of publication.

## Scope

This security policy applies to:

- The OpenZenith Python SDK (`openzenith/`)
- The OpenZenith REST API (`api/`)
- The OpenZenith Rust core (`openzenith-core/`)
- The OpenZenith WASM package (`api/public/pkg/`)

Third-party data sources (HuggingFace datasets, USGS, NOAA, etc.) are outside
the scope of this policy. Issues with external data sources should be reported
to their respective operators.
