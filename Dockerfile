FROM python:3.13-slim

WORKDIR /app

# Install Node.js for frontend build
RUN apt-get update && apt-get install -y --no-install-recommends \
    nodejs npm curl git \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY pyproject.toml ./
RUN pip install --break-system-packages -e .[all,dev]

# Node deps (frontend) — use npm ci for reproducible builds
COPY api/package.json api/package-lock.json* ./api/
RUN cd api && npm ci

# Copy source
COPY . .

# Default command: run tests
CMD ["python3", "-m", "pytest", "openzenith/tests/", "-q"]
