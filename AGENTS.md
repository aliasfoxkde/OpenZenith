# OpenZenith contributor handoff

OpenZenith is a multi-surface elevation platform: Python/Rust core libraries,
a TypeScript/Next API and UI, and an optional MCP server. Keep those surfaces
versioned and validated independently; do not call an API/UI pass evidence for
the Rust/Python core or vice versa.

## Validation policy

Run heavy work on the Fedora executor, one resource class at a time. For the
core, use the repository's Python and Rust toolchains and run tests, strict
formatting, and Clippy. For the API/UI, use lockfile-based installation and
bounded lint, typecheck, unit, build, and Playwright checks. Record exact SHA,
toolchain versions, coverage, and artifact paths.

Offline behavior is a product requirement: tests must not silently download
terrain data or require provider credentials. Use disposable cache roots under
`/nas/Temp/artifacts` for qualification and never use `/tmp` for managed work.

Do not add credentials, fabricated geospatial results, or placeholder
implementations. Update the appropriate component documentation when a public
contract changes.
