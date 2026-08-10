# Deployment

OpenZenith is deployed on Cloudflare Pages with Edge Workers for the API and static assets.

## Prerequisites

- Node.js 18+ (for API development)
- Python 3.10+ (for SDK)
- Cloudflare account with Pages and R2
- Wrangler CLI (`npm install -g wrangler`)

## Environment Setup

### 1. Clone Repository

```bash
git clone https://github.com/aliasfoxkde/OpenZenith.git
cd OpenZenith
```

### 2. Install Dependencies

```bash
# Python SDK
pip install openzenith[all]

# Node.js API
cd api
npm install
```

### 3. Configure Wrangler

```bash
# Login to Cloudflare
wrangler login

# Configure project
wrangler pages project create openzenith
```

## Cloudflare R2 Setup

R2 provides object storage for terrain tiles.

### Create R2 Bucket

```bash
wrangler r2 bucket create openzenith-terrain
```

### Get R2 Credentials

1. Go to Cloudflare Dashboard → R2 → Manage API Tokens
2. Create token with Object Read/Write permissions
3. Note: Account ID, Access Key ID, Secret Access Key

### Configure R2 in wrangler.toml

```toml
[[r2_buckets]]
binding = "TERRAIN_BUCKET"
bucket_name = "openzenith-terrain"
```

## Environment Variables

### Required Secrets

```bash
# Set via wrangler or Cloudflare Dashboard
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HUGGINGFACE_TOKEN` | — | HuggingFace API token for private datasets |
| `LOG_LEVEL` | `info` | Logging verbosity |
| `CACHE_TTL_TERRAIN` | `3600` | Terrain tile cache TTL (seconds) |
| `CACHE_TTL_API` | `300` | API response cache TTL (seconds) |

### Local Development

Create `.dev.vars` in the `api/` directory:

```
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_key_id
R2_SECRET_ACCESS_KEY=your_secret
HUGGINGFACE_TOKEN=hf_your_token
```

## Deployment

### Deploy to Cloudflare Pages

```bash
cd api

# Production deployment
wrangler pages deploy

# Or with custom domain
wrangler pages deploy --domain=api.openzenith.cyopsys.com
```

### Deploy via GitHub Actions

Add `.github/workflows/deploy.yml`:

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
        working-directory: api
      - uses: cloudflare/wrangler-action@v3
        with:
          api-token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          account-id: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy --project-name=openzenith
```

### Configure Secrets in GitHub

1. Go to GitHub → Settings → Secrets
2. Add:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `R2_ACCOUNT_ID`
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
   - `HUGGINGFACE_TOKEN`

## Custom Domain

### Configure Domain

```bash
# Add custom domain
wrangler pages domain add api.openzenith.cyopsys.com

# Or via Cloudflare Dashboard:
# Pages → openzenith → Custom domains → Add custom domain
```

### DNS Configuration

Ensure your DNS is configured to point to Cloudflare Pages:

| Type | Name | Target |
|------|------|--------|
| CNAME | api | openzenith.pages.dev |
| CNAME | openzenith | openzenith.pages.dev |

## HuggingFace Token Setup

For access to private datasets or higher rate limits:

```bash
# Get token from https://huggingface.co/settings/tokens
wrangler secret put HUGGINGFACE_TOKEN
```

In Python SDK:
```python
from huggingface_hub import login
login(token="hf_your_token")
```

## Build Commands

| Environment | Build Command |
|-------------|---------------|
| Production | `npm run build` |
| Preview | `npm run build` |
| Local | `npm run dev` |

Build output: `.vercel/output` or `.output` (depending on configuration)

## Monitoring

### Cloudflare Analytics

Go to Cloudflare Dashboard → Pages → openzenith for:
- Request counts
- Bandwidth usage
- Edge performance
- Cache hit rates

### Logs

Edge Worker logs available via:
```bash
wrangler tail
```

### Errors

```bash
# View recent errors
wrangler logs --project-name=openzenith
```

## Troubleshooting

### Deployment Fails

1. Check `wrangler pages project list` for existing project name
2. Ensure Cloudflare account has Pages enabled
3. Verify secrets are set correctly

### R2 Access Denied

1. Verify R2 bucket exists: `wrangler r2 bucket list`
2. Check API token has R2 permissions
3. Confirm credentials in environment

### CORS Issues

For browser WASM demos, ensure CORS headers are set in `api/src/middleware.ts`.

### Tile 404s

Tiles may not exist for:
- Ocean areas (if using SRTM-only backend)
- Antarctica (limited coverage)
- Very high zoom levels (z12+)

Use `OZT2HFBackend` for land coverage or `FusedDEM` for land+ocean.

## Local Development Server

```bash
cd api
npm run dev
# Opens on http://localhost:8788
```

Note: Local development bypasses Edge runtime and may not have full R2 access. Use HuggingFace backend for local tile fetching.

## Updating

```bash
# Pull latest changes
git pull

# Update dependencies
npm install
pip install --upgrade openzenith

# Redeploy
wrangler pages deploy
```
