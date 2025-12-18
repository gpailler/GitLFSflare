# GitLFSflare

A production-ready Git LFS server running on Cloudflare Workers with R2 storage. Authenticates via GitHub API and generates pre-signed URLs for direct client-to-R2 transfers.

## Features

- **Cloudflare Workers** - Serverless, globally distributed
- **Cloudflare R2** - S3-compatible object storage with no egress fees
- **GitHub Authentication** - Validate permissions via GitHub API with PAT tokens
- **Pre-signed URLs** - Direct client-to-R2 transfers (no proxy overhead)
- **Permission Caching** - KV-based caching reduces GitHub API calls
- **Multi-Organization** - Support multiple GitHub organizations
- **Git LFS Spec Compliant** - Full Batch API implementation (Lock API not supported)

## Quick Start

```bash
git clone https://github.com/your-org/gitlfsflare.git
cd gitlfsflare
pnpm install
pnpm test

# Set allowed orgs before running dev server
echo 'ALLOWED_ORGS=your-github-org' > .dev.vars
pnpm dev
```

See [Prerequisites](docs/DEPLOYMENT.md#prerequisites) for required tools.

## Configuration

Configure your Worker in `wrangler.jsonc`:

```jsonc
{
  "vars": {
    "ALLOWED_ORGS": "your-org,another-org",
    "R2_BUCKET_NAME": "lfs-objects-staging"
  }
}
```

Set secrets via Wrangler:

```bash
wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

See [Deployment Guide](docs/DEPLOYMENT.md) for full setup instructions.

## Usage

### Git LFS Client Configuration

```bash
# Set the LFS endpoint
git config lfs.url https://your-worker.workers.dev/your-org/your-repo.git/info/lfs

# Configure authentication (use GitHub PAT as password)
git config lfs.https://your-worker.workers.dev/.access basic
```

Or add to `.lfsconfig`:

```ini
[lfs]
    url = https://your-worker.workers.dev/your-org/your-repo.git/info/lfs
```

### GitHub Token Setup

Create a GitHub Personal Access Token with `repo` scope:

1. Go to GitHub Settings > Developer settings > Personal access tokens
2. Generate new token (classic) with `repo` scope
3. Use the token as password when Git prompts for credentials

Supported token formats: `ghp_*`, `github_pat_*`, `ghs_*`

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/:org/:repo.git/info/lfs/objects/batch` | POST | LFS Batch API |

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design, request flow, security model |
| [Deployment](docs/DEPLOYMENT.md) | Prerequisites, environment variables, Cloudflare setup |
| [Contributing](docs/CONTRIBUTING.md) | Development workflow, code standards, testing |

## License

[MIT](LICENSE)
