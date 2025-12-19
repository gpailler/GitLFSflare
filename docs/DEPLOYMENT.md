# Deployment Guide

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 10+
- [Python](https://www.python.org/) 3.10+ (for E2E tests)
- Cloudflare account with Workers, R2, and KV enabled

## Cloudflare Setup

> **Note**: All wrangler commands below can also be performed via the [Cloudflare Dashboard](https://dash.cloudflare.com).

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Authenticate with Cloudflare

```bash
pnpm wrangler login
```

### 3. Create R2 Buckets

```bash
pnpm wrangler r2 bucket create lfs-objects-staging
pnpm wrangler r2 bucket create lfs-objects-production
```

### 4. Create KV Namespaces

```bash
pnpm wrangler kv namespace create lfs-auth-cache-staging
pnpm wrangler kv namespace create lfs-auth-cache-production
```

Note the namespace IDs from the output - you'll need them later.

### 5. Generate R2 API Credentials

1. Go to Cloudflare Dashboard → R2 → Manage R2 API Tokens
2. Create token with Object Read & Write permissions
3. Set the secrets:

```bash
# Staging
pnpm wrangler secret put R2_ACCESS_KEY_ID --env ""
pnpm wrangler secret put R2_SECRET_ACCESS_KEY --env ""

# Production
pnpm wrangler secret put R2_ACCESS_KEY_ID --env production
pnpm wrangler secret put R2_SECRET_ACCESS_KEY --env production
```

### 6. Set Account ID

1. Go to Cloudflare Dashboard → Workers & Pages
2. Copy your Account ID from the right sidebar
3. Set the secret:

```bash
# Staging
pnpm wrangler secret put CLOUDFLARE_ACCOUNT_ID --env ""

# Production
pnpm wrangler secret put CLOUDFLARE_ACCOUNT_ID --env production
```

---

## Option A: Manual Deployment

For manual deployment, configure values directly in `wrangler.jsonc`:

### 1. Update Configuration

Edit `wrangler.jsonc`:

```jsonc
{
  // Staging (default environment)
  "kv_namespaces": [{ "binding": "AUTH_CACHE", "id": "<your-staging-kv-id>" }],
  "vars": { "ALLOWED_ORGS": "org1,org2" },

  // Production
  "env": {
    "production": {
      "kv_namespaces": [{ "binding": "AUTH_CACHE", "id": "<your-production-kv-id>" }],
      "vars": { "ALLOWED_ORGS": "org1" }
    }
  }
}
```

### 2. Deploy

```bash
pnpm deploy              # Staging
pnpm deploy:production   # Production
```

---

## Option B: CI/CD Deployment (GitHub Actions)

For automated deployment, configuration is stored in GitHub environments.

### 1. Add Repository Secret

In GitHub: Settings → Secrets and variables → Actions → New repository secret

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_DEPLOY_API_TOKEN` | Cloudflare API token with Workers/KV/R2 edit permissions |

To create the token:
1. Go to [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Use **"Edit Cloudflare Workers"** template

### 2. Create GitHub Environments

In GitHub: Settings → Environments → New environment

Create `staging` and `production` environments with these variables:

| Variable | Description |
|----------|-------------|
| `ALLOWED_ORGS` | Comma-separated GitHub organizations |
| `KV_NAMESPACE_ID` | KV namespace ID from step 4 above |

### 3. Workflows

| Workflow | Trigger | Action |
|----------|---------|--------|
| CI | Pull request to main | Run tests, post coverage report |
| Deploy Staging | Push to main | Deploy to staging |
| Deploy Production | Push tag `v*` | Deploy to production |

---

## Verification

### Health Check

```bash
curl https://gitlfsflare.<your-subdomain>.workers.dev/health
```

### E2E Tests

```bash
python3 test/scripts/test_endpoints.py \
  --url "https://gitlfsflare.<your-subdomain>.workers.dev" \
  --token "ghp_xxx" --org "your-org" --repo "your-repo"

python3 test/scripts/test_git_lfs.py \
  --url "https://gitlfsflare.<your-subdomain>.workers.dev" \
  --token "ghp_xxx" --org "your-org" --repo "your-repo"
```

## Monitoring

### Logs

```bash
pnpm wrangler tail              # Staging
pnpm wrangler tail --env production   # Production
```

### Dashboards

- **Worker Analytics**: Cloudflare Dashboard → Workers & Pages → gitlfsflare → Analytics
- **R2 Metrics**: Cloudflare Dashboard → R2 → your bucket → Metrics
