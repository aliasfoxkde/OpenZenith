# Publishing the Python SDK

Status (verified 2026-10-08): **`openzenith` is NOT on PyPI.**
`https://pypi.org/pypi/openzenith/json` returns 404, as do every name
variant checked. The README's `pip install openzenith` is an advertisement
of intent, not a working command — until a maintainer completes the one
credential-gated step below, install from source:

```bash
git clone https://github.com/aliasfoxkde/OpenZenith && cd OpenZenith
pip install .[all]        # or: pip install -e .[all,dev]  for development
```

## Why publishing is maintainer-gated

1. **Credentials never live in this repo** (standing rule). PyPI upload
   needs either an API token or a Trusted Publisher binding — both belong
   to the maintainer's PyPI account.
2. The GitHub Actions mirror is **billing-blocked**, so the usual
   "tag → trusted-publisher → PyPI" automation can never run here.
   `.github/workflows/publish-pypi.yml` is validation-only by design: it
   builds the sdist/wheel on version tags and uploads nothing.

## Release runbook (maintainer, from a clean checkout at the version tag)

```bash
git checkout v0.9.3
pip install build twine
python -m build                       # sdist + wheel into dist/
twine check dist/*                    # metadata validation
python3 -m pytest openzenith/tests/ -q   # the suite one last time, at the tag
twine upload dist/*                   # prompts for PyPI credentials
```

After the upload lands:

```bash
pip index versions openzenith         # verify the new version resolves
pip install openzenith==<version> -c /dev/null  # smoke-install in isolation
```

Then — and only then — flip the README/CONTRIBUTING/CLAUDE.md install
sections from "source install" to `pip install openzenith`, and update
`docs/PUBLISHING.md`'s status line. The docs-claims test
(`api/src/lib/__tests__/docs-claims.test.ts`) does not pin PyPI state;
the status line here is the single source of truth.

## Version sync points (every release)

| File | Field |
|---|---|
| `api/package.json` | `version` (source of truth for the API) |
| `openzenith/__init__.py` | `__version__` (the SDK) |
| `api/src/lib/openapi/base.json` | `info.version` (then `npm run openapi:generate`) |
| `api/package-lock.json` | regenerated via `npm install --package-lock-only` |
| README.md / docs receipts | refresh measured test totals + coverage (the numbers drift every cycle; the release cut is when they're re-measured) |

## Alternative: Trusted Publisher (when Actions is unblocked)

If the GitHub account's billing block is ever lifted, the maintainer can
bind `aliasfoxkde/OpenZenith` → the `validate-build` job as a PyPI
Trusted Publisher and re-add `pypa/gh-action-pypi-publish@release/v1`
with `id-token: write` as an explicit, documented publish step. Until
then this workflow must stay upload-free — its header and this file are
the contract.
