# Deployment Guide

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 10+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) 4+
- Cloudflare account with:
  - Workers enabled
  - R2 enabled
  - KV enabled

## Cloudflare Setup

### 1. Create R2 Buckets

Create separate buckets for staging and production:

```bash
# Staging bucket
wrangler r2 bucket create lfs-objects-staging

# Production bucket
wrangler r2 bucket create lfs-objects-production
```

### 2. Create KV Namespaces

Create KV namespaces for permission caching:

```bash
# Staging namespace
wrangler kv namespace create AUTH_CACHE
# Note the ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# Production namespace
wrangler kv namespace create AUTH_CACHE --env production
# Note the ID: yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy
```

### 3. Generate R2 API Credentials

1. Go to Cloudflare Dashboard > R2 > Manage R2 API Tokens
2. Create API token with:
   - Permissions: Object Read & Write
   - Scope: Apply to specific buckets (select both staging and production)
3. Note the Access Key ID and Secret Access Key

### 4. Get Account ID

1. Go to Cloudflare Dashboard > Workers & Pages
2. Copy your Account ID from the right sidebar

## Configuration

### wrangler.jsonc

Update the configuration with your actual values:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "gitlfsflare",
  "main": "src/index.ts",
  "compatibility_date": "2024-12-01",

  // Default environment (staging)
  "r2_buckets": [
    {
      "binding": "LFS_BUCKET",
      "bucket_name": "lfs-objects-staging"
    }
  ],

  "kv_namespaces": [
    {
      "binding": "AUTH_CACHE",
      "id": "YOUR_STAGING_KV_NAMESPACE_ID"
    }
  ],

  "vars": {
    "ALLOWED_ORGS": "your-org",
    "URL_EXPIRY": 900,
    "AUTH_CACHE_TTL": 300,
    "R2_BUCKET_NAME": "lfs-objects-staging"
  },

  // Production environment
  "env": {
    "production": {
      "r2_buckets": [
        {
          "binding": "LFS_BUCKET",
          "bucket_name": "lfs-objects-production"
        }
      ],

      "kv_namespaces": [
        {
          "binding": "AUTH_CACHE",
          "id": "YOUR_PRODUCTION_KV_NAMESPACE_ID"
        }
      ],

      "vars": {
        "ALLOWED_ORGS": "your-org",
        "URL_EXPIRY": 900,
        "AUTH_CACHE_TTL": 300,
        "R2_BUCKET_NAME": "lfs-objects-production"
      }
    }
  }
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ALLOWED_ORGS` | Comma-separated GitHub orgs | Required |
| `URL_EXPIRY` | Pre-signed URL lifetime (seconds) | `900` |
| `AUTH_CACHE_TTL` | Permission cache TTL (seconds) | `300` |
| `R2_BUCKET_NAME` | R2 bucket name (must match `LFS_BUCKET` binding) | Required |

### Secrets

Set secrets via Wrangler (never commit these):

```bash
# Staging secrets
wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY

# Production secrets
wrangler secret put CLOUDFLARE_ACCOUNT_ID --env production
wrangler secret put R2_ACCESS_KEY_ID --env production
wrangler secret put R2_SECRET_ACCESS_KEY --env production
```

## Deployment

### Deploy to Staging

```bash
# Run tests first
pnpm test

# Deploy
pnpm run deploy
# or: wrangler deploy
```

### Deploy to Production

```bash
# Run tests first
pnpm test

# Deploy to production
pnpm run deploy:production
# or: wrangler deploy --env production
```

## Verification

### Health Check

```bash
# Staging
curl https://gitlfsflare.your-account.workers.dev/health

# Production
curl https://gitlfsflare-production.your-account.workers.dev/health
```

Expected response:
```json
{"status":"ok"}
```

### Test Authentication

```bash
# Should return 401 (no auth)
curl -X POST \
  "https://gitlfsflare.your-account.workers.dev/your-org/test-repo.git/info/lfs/objects/batch" \
  -H "Content-Type: application/json" \
  -d '{"operation":"download","objects":[]}'
```

### Test with Valid Token

```bash
curl -X POST \
  "https://gitlfsflare.your-account.workers.dev/your-org/test-repo.git/info/lfs/objects/batch" \
  -H "Authorization: Bearer ghp_your_token" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "download",
    "objects": [
      {"oid": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "size": 100}
    ]
  }'
```

## Custom Domain

### Add Custom Domain

1. Go to Cloudflare Dashboard > Workers & Pages > your worker
2. Click "Triggers" > "Custom Domains"
3. Add your domain (e.g., `lfs.example.com`)

### Update Git LFS Configuration

```bash
git config lfs.url https://lfs.example.com/your-org/your-repo.git/info/lfs
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
wrangler tail

# Production
wrangler tail --env production
```

## Troubleshooting

See [Architecture - Error Handling](ARCHITECTURE.md#error-handling) for complete HTTP status codes.

### 401 Authentication Required

- Verify token format (`ghp_`, `github_pat_`, or `ghs_` prefix)
- Check token hasn't expired
- Ensure token has `repo` scope

### 403 Organization Not Allowed

- Verify org is in `ALLOWED_ORGS`
- Check for typos in org name
- Org names are case-sensitive

### 403 Access Denied

- Verify GitHub token has access to the repository
- Check repository permissions in GitHub

### 429 Rate Limit Exceeded

- GitHub API rate limit hit
- Wait for `Retry-After` seconds
- Permission caching should prevent most rate limits

### 502 Upstream Service Error

- GitHub API is experiencing issues
- Check [GitHub Status](https://www.githubstatus.com/)

### Pre-signed URL Errors

If uploads/downloads fail with the pre-signed URL:

- Verify `CLOUDFLARE_ACCOUNT_ID` is correct
- Verify `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` are correct
- Check R2 bucket exists and name matches configuration
- Ensure R2 API token has correct permissions
