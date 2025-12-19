# Deployment Guide

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 10+
- [Python](https://www.python.org/) 3.10+ (for E2E tests)
- Cloudflare account with:
  - Workers enabled
  - R2 enabled
  - KV enabled

## Cloudflare Setup

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Authenticate with Cloudflare

```bash
pnpm wrangler login
```

This opens a browser to authenticate with your Cloudflare account.

### 3. Create R2 Buckets

Create separate buckets for staging and production:

```bash
# Staging bucket
pnpm wrangler r2 bucket create lfs-objects-staging

# Production bucket
pnpm wrangler r2 bucket create lfs-objects-production
```

### 4. Create KV Namespaces

Create KV namespaces for permission caching:

```bash
# Staging namespace
pnpm wrangler kv namespace create lfs-auth-cache-staging
# Replace the staging kv_namespaces ID in wrangler.jsonc

# Production namespace
pnpm wrangler kv namespace create lfs-auth-cache-production
# Replace the production kv_namespaces ID in wrangler.jsonc
```

### 5. Customize Configuration

Update `wrangler.jsonc` with your actual values for:

| Variable | Description | Default |
|----------|-------------|---------|
| `ALLOWED_ORGS` | Comma-separated GitHub orgs | Required |
| `URL_EXPIRY` | Pre-signed URL lifetime (seconds) | `900` |
| `AUTH_CACHE_TTL` | Permission cache TTL (seconds) | `300` |

### 6. Generate R2 API Credentials

1. Go to Cloudflare Dashboard > R2 object storage > Manage API Tokens
2. Create account API token with:
   - Permissions: Object Read & Write
   - Scope: Apply to specific buckets (select both staging and production)
3. Set the secrets Access Key ID and Secret Access Key below

```bash
# Staging secrets
pnpm wrangler secret put R2_ACCESS_KEY_ID --env ""
pnpm wrangler secret put R2_SECRET_ACCESS_KEY --env ""

# Production secrets
pnpm wrangler secret put R2_ACCESS_KEY_ID --env production
pnpm wrangler secret put R2_SECRET_ACCESS_KEY --env production
```

### 7. Get Account ID

1. Go to Cloudflare Dashboard > Workers & Pages
2. Copy your Account ID from the right sidebar

```bash
# Staging secrets
pnpm wrangler secret put CLOUDFLARE_ACCOUNT_ID --env ""

# Production secrets
pnpm wrangler secret put CLOUDFLARE_ACCOUNT_ID --env production
```

## Deployment

```bash
# Deploy to staging
pnpm run deploy

# Deploy to production
pnpm run deploy:production
```

## Verification

### Health Check

```bash
curl https://gitlfsflare.your-account.workers.dev/health
```

Expected response:
```json
{"status":"ok"}
```

### E2E Tests

Run the automated test scripts against your deployed instance:

```bash
python3 test/scripts/test_endpoints.py \
  --url "https://gitlfsflare.your-account.workers.dev" \
  --token "ghp_your_token" \
  --org "your-org" \
  --repo "your-repo"

python3 test/scripts/test_git_lfs.py \
  --url "https://gitlfsflare.your-account.workers.dev" \
  --token "ghp_your_token" \
  --org "your-org" \
  --repo "your-repo"
```

## Monitoring

### Worker Analytics

View request metrics in Cloudflare Dashboard:
- Workers & Pages > your worker > Analytics

### R2 Metrics

View storage metrics in:
- R2 > your bucket > Metrics

### Logs

View real-time logs:

```bash
# Staging
pnpm wrangler tail

# Production
pnpm wrangler tail --env production
```
