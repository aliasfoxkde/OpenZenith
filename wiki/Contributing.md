# Contributing

## Development Setup

### 1. Clone the Repository

```bash
git clone https://github.com/aliasfoxkde/OpenZenith.git
cd OpenZenith
```

### 2. Python SDK Setup

```bash
# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # Linux/macOS
# .venv\Scripts\activate  # Windows

# Install with all extras
pip install openzenith[all]

# Or install in development mode
pip install -e openzenith[all]
```

### 3. API Setup

```bash
cd api
npm install
```

### 4. Rust Core Setup (Optional)

For WASM bindings or CLI binary development:

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Build Rust core
cargo build --release --manifest-path openzenith-core/Cargo.toml

# For Python bindings
pip install maturin
cd openzenith-core/python
maturin develop --release
```

## Running Tests

### Python Tests

```bash
# Run all tests
pytest openzenith/tests/ -v

# Run specific test file
pytest openzenith/tests/test_elevation.py -v

# Run specific test
pytest openzenith/tests/test_elevation.py::test_get_elevation -v

# Run with coverage
pytest openzenith/tests/ --cov=openzenith --cov-report=term-missing
```

### TypeScript Tests

```bash
cd api

# Run all tests
npm run test

# Watch mode
npm run test:watch

# Run Playwright E2E tests
npx playwright test
```

### Rust Tests

```bash
cargo test --manifest-path openzenith-core/Cargo.toml
```

## Coding Standards

### Python

We use `ruff` for linting and `black` is not needed (ruff handles formatting).

```bash
# Lint
ruff check openzenith/

# Auto-fix
ruff check --fix openzenith/

# Format
ruff format openzenith/
```

**Rules**:
- No `unwrap()` in production code — use `?` or proper error handling
- No `panic!()` in library code — return `Result` instead
- No `unsafe` code without review
- Minimum 90% line coverage for new code
- No `TODO`/`FIXME`/`HACK` comments — create issues instead
- No versioned files (`file_v1.py`, `file_v2.py`)
- No duplicate implementations

### TypeScript/JavaScript

We use ESLint and Prettier.

```bash
cd api

# Lint
npm run lint

# Auto-fix
npm run lint:fix

# Check formatting
npx prettier --check "src/**/*.{ts,tsx}"
```

**Rules**:
- Use TypeScript for all new code
- Export `const runtime = 'edge'` for all API routes
- All components must have proper prop types
- No `any` types without explanation

### Rust

We use `clippy` for linting.

```bash
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all
```

**Rules**:
- No `unwrap()` on `Result` types
- No `unsafe` blocks without explicit safety documentation
- All public APIs must have doc comments
- Tests in `#[cfg(test)]` modules

## Git Commit Conventions

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <subject>

<body>
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation changes |
| `style` | Formatting (no code change) |
| `refactor` | Code restructuring |
| `test` | Adding tests |
| `chore` | Maintenance tasks |

### Examples

```
feat(elevation): add batch elevation query with async client

Added ElevationBatchProcessor class for high-throughput batch
processing with configurable concurrency and rate limiting.

Closes #123
```

```
fix(hydrology): correct flow direction for flat cells

Flat cells now return -1 instead of 0 to match GDAL convention.
Added test for depression handling.
```

## Project Structure

```
OpenZenith/
├── api/                    # Next.js 15 API and frontend
│   ├── src/
│   │   ├── app/           # App Router pages and API routes
│   │   ├── components/    # React components
│   │   └── lib/           # Shared utilities
│   └── tests/            # Vitest tests
├── openzenith/            # Python SDK
│   ├── elevation.py      # Elevation queries
│   ├── terrain.py        # Terrain analysis
│   ├── hydrology.py      # Hydrology functions
│   ├── cli.py            # CLI entry point
│   └── tests/            # pytest tests
├── openzenith-core/       # Rust crate
│   └── src/              # Rust source
├── docs/                  # Design docs
├── scripts/               # Utility scripts
└── wiki/                  # This documentation
```

## Pull Request Process

### 1. Create a Branch

```bash
git checkout -b feat/my-new-feature
git checkout -b fix/bug-description
```

### 2. Make Changes

- Write code following the coding standards above
- Add tests for new functionality
- Update documentation if needed

### 3. Pre-commit Checklist

- [ ] Tests pass: `pytest openzenith/tests/` and `npm run test`
- [ ] Linting clean: `ruff check openzenith/` and `npm run lint`
- [ ] Formatting: `ruff format openzenith/` and `npx prettier --write`
- [ ] No secrets committed
- [ ] Commit message follows conventions

### 4. Submit PR

- Fill out PR template completely
- Link related issues
- Request review from maintainers

### 5. After Approval

- Squash and merge preferred
- Delete branch after merge

## Issue Guidelines

### Bug Reports

Include:
- OpenZenith version (`openzenith info` or `pip show openzenith`)
- Python/Node.js/Rust version
- Operating system
- Minimal reproduction case
- Expected vs actual behavior

### Feature Requests

Include:
- Use case description
- Proposed API design (if applicable)
- Alternative solutions considered

## Documentation

Update documentation when:
- Adding new features
- Changing API signatures
- Updating configuration
- Adding new dependencies

Documentation lives in:
- `/wiki/` — Public wiki (this directory)
- `/docs/` — Internal design docs
- Code comments — API documentation

## Questions?

Open an issue at https://github.com/aliasfoxkde/OpenZenith/issues for:
- Bug reports
- Feature requests
- Questions about usage
- Documentation improvements
