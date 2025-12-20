# gitLFSflare

[![Build](https://github.com/gpailler/gitLFSflare/actions/workflows/deploy-staging.yml/badge.svg)](https://github.com/gpailler/gitLFSflare/actions/workflows/deploy-staging.yml)
[![Version](https://img.shields.io/github/package-json/v/gpailler/gitLFSflare)](package.json)
[![Coverage](https://codecov.io/gh/gpailler/gitLFSflare/graph/badge.svg)](https://codecov.io/gh/gpailler/gitLFSflare)

A production-ready Git LFS server running on Cloudflare Workers with R2 storage. Authenticates via GitHub API and generates pre-signed URLs for direct client-to-R2 transfers.

## Features

- **Cloudflare Workers** - Serverless, globally distributed
- **Cloudflare R2** - S3-compatible object storage with no egress fees
- **GitHub Authentication** - Validate permissions via GitHub API with PAT tokens
- **Pre-signed URLs** - Direct client-to-R2 transfers (no proxy overhead)
- **Permission Caching** - KV-based caching reduces GitHub API calls
- **Multi-Organization** - Support multiple GitHub organizations
- **Git LFS Spec Compliant** - Full Batch API implementation (Lock API not supported)

## Why gitLFSflare?

Cloudflare R2 has **zero egress fees** - store and serve large files without bandwidth costs. Unlike GitHub LFS (which charges for storage and bandwidth) or self-hosted solutions (which require infrastructure), gitLFSflare gives you unlimited downloads at a fixed storage cost.

## Quick Start

```bash
git clone https://github.com/your-org/gitlfsflare.git
cd gitlfsflare
pnpm install
pnpm test
```

See [Deployment Guide](docs/DEPLOYMENT.md) for full setup and deployment instructions.

## Usage

Configure your local git repository to use your deployed LFS server.

### 1. Set LFS URL

```bash
cd your-repo
git config lfs.url https://gitlfsflare.your-account.workers.dev/your-org/your-repo.git/info/lfs
```

Or add to `.lfsconfig` in your repository:

```ini
[lfs]
    url = https://gitlfsflare.your-account.workers.dev/your-org/your-repo.git/info/lfs
```

### 2. Configure Authentication

Git LFS uses HTTP Basic authentication. The LFS URL path (`/your-org/your-repo.git/info/lfs`) determines which GitHub repository permissions are checked:

1. **Organization check**: The server verifies the org is in its allowed organizations list
2. **Permission check**: Your GitHub token is validated against the GitHub API to check your permissions on `your-org/your-repo`
3. **Action authorization**: Downloads require read access, uploads require write access

This mirrors GitHub's permission model - if you can push to a repo on GitHub, you can upload LFS objects for that repo.

**Option A: Credential Helper (Recommended)**

Store credentials securely using git's credential helper:

```bash
# Enable credential storage (stores in ~/.git-credentials)
git config credential.helper store

# Or use macOS Keychain
git config credential.helper osxkeychain

# Or use Windows Credential Manager
git config credential.helper manager
```

On first `git lfs push` or `git lfs pull`, git will prompt for credentials:
- **Username**: any value (e.g., `git` or your GitHub username)
- **Password**: your GitHub Personal Access Token (PAT)

**Option B: URL with Embedded Credentials**

For automation/CI, embed credentials directly (less secure):

```bash
git config lfs.url https://git:ghp_yourtoken@your-worker.workers.dev/your-org/your-repo.git/info/lfs
```

### 3. GitHub Token Requirements

The server validates tokens against the GitHub API to check repository permissions.

**Fine-grained Personal Access Token**
- Prefix: `github_pat_*`
- Create at: https://github.com/settings/personal-access-tokens
- Required permissions:
  - **Repository access**: Select specific repositories or all repositories
  - **Metadata**: Read-Only

**Classic Personal Access Token (PAT)**
- Prefix: `ghp_*`
- Create at: https://github.com/settings/tokens
- Required scope: `repo` (full access to private repositories)

**GitHub Actions Token**
- Prefix: `ghs_*`
- Automatically available as `GITHUB_TOKEN` in workflows
- Permissions inherited from workflow configuration

### 4. Verify Configuration

```bash
# Check LFS configuration
git lfs env

# Test with a push (if you have files tracked)
git lfs push origin main --dry-run
```

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design, request flow, security model |
| [Deployment](docs/DEPLOYMENT.md) | Prerequisites, environment variables, Cloudflare setup |
| [Contributing](docs/CONTRIBUTING.md) | Development workflow, code standards, testing |

## License

[MIT](LICENSE)
