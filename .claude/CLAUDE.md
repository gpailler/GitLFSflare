# Claude Instructions for Git LFS Server Development

## Project Overview

You are building a **production-ready Git LFS (Large File Storage) server** on CloudFlare Workers with R2 storage. This server authenticates via GitHub API and generates pre-signed URLs for direct client-to-R2 transfers (no proxy).

## Core Requirements

### Functional Requirements
1. **CloudFlare Workers** serverless runtime (TypeScript)
2. **CloudFlare R2** object storage backend
3. **GitHub PAT authentication** - Validate user permissions via GitHub API
4. **Pre-signed URLs** - Direct client-to-R2 uploads/downloads (no server proxy)
5. **Organization enforcement** - Validate against list of allowed organizations before GitHub API calls
6. **Permission caching** - Cache GitHub API permission checks (5-minute TTL) to reduce API calls
7. **Permission-based access**:
   - Download requires: `read`, `write`, or `admin` permission
   - Upload requires: `write` or `admin` permission only
8. **Git LFS Batch API** - Full implementation per [spec](https://github.com/git-lfs/git-lfs/blob/main/docs/api/batch.md)

### Non-Functional Requirements
1. **Test Coverage**: >90% across all metrics (lines, functions, branches, statements)
2. **Type Safety**: Strict TypeScript with no implicit any
3. **Security First**: Never log tokens, validate all inputs, minimal error disclosure
4. **Performance**: Direct R2 access, object key sharding, permission caching for better performance
5. **Documentation**: Comprehensive README, API docs, deployment guides
6. **Multi-Environment**: Support for staging and production environments

## Technology Stack

| Component | Tool | Purpose |
|-----------|------|---------|
| **Runtime** | CloudFlare Workers | Serverless execution |
| **Storage** | CloudFlare R2 | Object storage |
| **Cache** | CloudFlare KV | Permission caching |
| **Language** | TypeScript | Type-safe development |
| **Testing** | Vitest | Test framework |
| **Test Runner** | @cloudflare/vitest-pool-workers | Workers runtime testing |
| **Code Quality** | Biome | Linting + formatting |
| **Build/Deploy** | Wrangler | CloudFlare CLI |
| **Package Manager** | pnpm | Fast, efficient |
| **AWS Signing** | aws4fetch | Pre-signed URL generation |
| **Requests handling** | Hono | Request handling + validation |

## Architecture

```
┌─────────────┐
│  Git Client │
└──────┬──────┘
       │ LFS Batch Request (with GitHub token)
       ↓
┌─────────────────────┐
│ CloudFlare Worker   │
│  ┌───────────────┐  │
│  │ 1. Validate   │  │  Step 1: Organization validation (MANDATORY)
│  │    Org        │  │  → HTTP 403 if org not in ALLOWED_ORGS list
│  └───────┬───────┘  │
│          ↓          │
│  ┌───────────────┐  │  Step 2: Extract & validate GitHub token
│  │ 2. Parse PAT  │  │  → Supports Bearer, Basic auth
│  └───────┬───────┘  │  → HTTP 401 if invalid
│          ↓          │
│  ┌───────────────┐  │  Step 3: Check GitHub permissions (with caching)
│  │ 3. Check GH   │──┼──→ GitHub API: GET /repos/{org}/{repo}
│  │    Permissions│  │  → Cache result for 5 minutes
│  └───────┬───────┘  │  → HTTP 403 if no access
│          ↓          │
│  ┌───────────────┐  │  Step 4: Operation-specific permission check
│  │ 4. Generate   │  │  → Upload requires write/admin
│  │    Pre-signed │  │  → Download requires read/write/admin
│  │    URLs       │  │
│  └───────┬───────┘  │
│          │          │
└──────────┼──────────┘
           │ Pre-signed URLs
           ↓
    ┌─────────────┐
    │ CloudFlare  │
    │     R2      │  Direct client access
    │  Storage    │  (no Worker proxy)
    └─────────────┘
```

## Critical Design Decisions

### 1. Organization Validation FIRST
```typescript
// ALWAYS validate org BEFORE calling GitHub API
if (!validateOrganization(env, org)) {
  return HTTP 403 "Organization not allowed."
}
// ONLY THEN call GitHub API
```
**Why**: Prevents quota waste, fail fast, security boundary

### 2. Authentication Formats
Support the following Git LFS client auth formats:
- `Authorization: Bearer {token}` (LFS standard)
- `Authorization: Basic base64(user:token)` (Git HTTP)

### 3. Token Security
- Only accept `ghp_`, `github_pat_`, or `ghs_` (GitHub Actions) prefixes
- Reject tokens >1000 chars (DoS prevention)
- Only alphanumeric + underscore characters
- **NEVER** log or expose tokens in errors

### 4. Direct R2 Access via Pre-signed URLs
```
Worker generates → Time-limited URLs (AWS Sig V4)
Client uses → Direct HTTP PUT/GET to R2
No payload streaming through Worker
```

### 5. Object Key Sharding
```
Format: {org}/{repo}/{oid[:2]}/{oid}
Example: myorg/myrepo/ab/abcdef1234...

Purpose:
- Logical separation by org/repo
- Sharding by first 2 OID chars (256 buckets)
- Better R2 performance
```

### 6. Per-Object Error Handling
```json
{
  "transfer": "basic",
  "objects": [
    { "oid": "...", "size": 1024, "actions": {...} },
    { "oid": "...", "size": 2048, "error": {"code": 404, "message": "..."} }
  ]
}
```
**Why**: Partial failures handled gracefully, batch operations don't fail completely

### 7. Permission Hierarchy
```
admin → upload ✓, download ✓, read ✓, write ✓
write → upload ✓, download ✓, read ✓
read  → upload ✗, download ✓
none  → upload ✗, download ✗
```

### 8. Minimal Error Disclosure
```typescript
// ❌ DON'T: Expose details
"Organization 'foo' is not allowed. This server only serves 'bar'."

// ✅ DO: Minimal information
"Organization not allowed."
```

### 9. OID Validation
```typescript
export function isValidOID(oid: string): boolean {
  // Must be exactly 64 lowercase hex characters
  return /^[0-9a-f]{64}$/.test(oid);
}
```

## Test-Driven Development (TDD) Workflow

**CRITICAL**: Always write tests BEFORE implementation

### Step-by-Step Process
1. **Write comprehensive tests** covering all cases (happy path, edge cases, errors)
2. **Implement stub functions** that make tests compile but fail
3. **Present tests** for review and approval
4. **Implement minimal code** to make tests pass
5. **Run tests** and verify 100% pass
6. **Optimize and refactor** - challenge yourself to improve code quality
7. **Show results** with test output
8. **Wait for approval** before moving to next component

### Test Best Practices

1. **Use test cases (`it.each`)** to reduce duplication:
```typescript
it.each([
  ["ghp_valid123", true],
  ["github_pat_valid", true],
  ["invalid", false],
  ["", false],
])("validateToken(%s) should return %s", (token, expected) => {
  expect(validateToken(token)).toBe(expected);
});
```

2. **Tests must be consistent** - shared setup, similar patterns, predictable naming

3. **Test structure** - group by behavior, not implementation:
```typescript
describe("Feature", () => {
  describe("when valid input", () => { ... });
  describe("when invalid input", () => { ... });
  describe("edge cases", () => { ... });
});
```

### Coverage Requirements
```json
{
  "lines": 90,
  "functions": 90,
  "branches": 90,
  "statements": 90
}
```

## Code Quality Standards

### TypeScript Configuration
- TypeScript rules are configured in `tsconfig.json` and should be strictly enforced

### Code Quality Tools
- **Biome**: Enforces consistent code style and linting rules
- Linter rules are configured in `biome.json` and should be strictly enforced

### Code Style Principles

1. **Minimal code** - Write the simplest solution that works
2. **Self-documenting** - Code should be readable without comments
3. **No unnecessary documentation** - Only add JSDoc when:
   - The function signature isn't self-explanatory
   - There are non-obvious side effects
   - Complex business logic needs clarification
4. **Comments only when needed** - Explain "why", not "what"

```typescript
// ❌ DON'T: Over-documented
/**
 * Check if OID is valid
 * @param oid - The OID to check
 * @returns true if valid
 */
function isValidOID(oid: string): boolean {
  // Check if string is 64 hex chars
  return /^[0-9a-f]{64}$/.test(oid);
}

// ✅ DO: Self-explanatory code
function isValidOID(oid: string): boolean {
  return /^[0-9a-f]{64}$/.test(oid);
}

// ✅ DO: Comment explains non-obvious "why"
// GitHub API returns 404 for both "repo not found" and "no access"
if (response.status === 404) {
  return "none";
}
```

## Environment Variables

| Variable | Type | Description | Example |
|----------|------|-------------|---------|
| `ALLOWED_ORGS` | string | Comma-separated list of allowed organizations | `<org1>[,<org2>...]` |
| `LFS_BUCKET` | R2Bucket | R2 bucket binding | (CloudFlare binding) |
| `AUTH_CACHE` | KVNamespace | KV namespace for permission caching | (CloudFlare binding) |
| `URL_EXPIRY` | number | Pre-signed URL lifetime (seconds) | `900` (15 min) |
| `AUTH_CACHE_TTL` | number | Permission cache TTL (seconds) | `300` (5 min) |
| `CLOUDFLARE_ACCOUNT_ID` | string (secret) | For R2 endpoint URL | From CloudFlare dashboard |
| `R2_ACCESS_KEY_ID` | string (secret) | R2 credentials | Auto-generated |
| `R2_SECRET_ACCESS_KEY` | string (secret) | R2 credentials | Auto-generated |
| `R2_BUCKET_NAME` | string | R2 bucket name | `lfs-objects-staging` or `lfs-objects-production` |
| `ENVIRONMENT` | string | Deployment environment | `staging` or `production` |

## Common Patterns

### Dependency Injection
```typescript
// ✅ Functions receive dependencies as parameters
async function handleBatchRequest(
  env: Env,
  org: string,
  repo: string,
  request: LFSBatchRequest
): Promise<LFSBatchResponse> {
  // Use env, not global state
}
```

### Error as Data
```typescript
// ✅ Errors are part of response data, not thrown
{
  oid: "abc123...",
  size: 1024,
  error: {
    code: 404,
    message: "Object not found"
  }
}
```

### Functional Composition
```typescript
// ✅ Pure functions, no classes
export const parseAuthHeader = (header: string) => { ... };
export const validateTokenFormat = (token: string) => { ... };
export const extractToken = (request: Request) => {
  const header = request.headers.get("Authorization");
  const parsed = parseAuthHeader(header);
  return parsed ? validateTokenFormat(parsed.token) : null;
};
```

## Development Workflow

### Local Development
```bash
# Install dependencies
pnpm install

# Run tests in watch mode
pnpm test

# Run local dev server
pnpm dev

# Type checking
pnpm typecheck

# Linting
pnpm lint
pnpm lint:fix
```

### Deployment
```bash
# Run full test suite with coverage
pnpm test:coverage

# Deploy to staging environment
pnpm run deploy

# Deploy to production environment
pnpm run deploy:production
```

### Testing Deployed Service (Staging Only)
```bash
# Run endpoint tests against staging (never production)
bash test/scripts/test-endpoints.sh

# Run end-to-end Git LFS tests against staging (16MB upload/download round-trip)
bash test/scripts/test-git-lfs.sh
```

## Critical Reminders

1. **Organization validation ALWAYS comes first** - Before GitHub API calls
2. **Never log tokens** - In errors, console, or anywhere
3. **Write tests first** - TDD is mandatory, implement stubs before tests
4. **Security over convenience** - Validate all inputs, minimal error messages
5. **Type safety** - Use strict TypeScript, no shortcuts
6. **Minimal documentation** - Only document when code isn't self-explanatory
7. **Test coverage** - 90%+ on all metrics
8. **Performance** - Direct R2 access, no proxy
9. **Error handling** - Per-object errors, not batch failures
10. **Clean code** - Functional, composable, testable, minimal
11. **Use test cases** - `it.each` to reduce test duplication
12. **Optimize each phase** - Challenge yourself to meet highest quality standards

## Git LFS Protocol Compliance

This server MUST fully implement the [Git LFS API specification](https://github.com/git-lfs/git-lfs/blob/main/docs/api/README.md). Refer to the spec for:
- HTTP status codes (request-level and per-object errors)
- Error response format (`message`, optional `request_id`, optional `documentation_url`)
- Required headers (`Accept`, `Content-Type`, `LFS-Authenticate`)
- Batch API request/response structure

### Rate Limiting Behavior
- GitHub API rate limits are detected via `X-RateLimit-Remaining: 0` header or HTTP 429
- When GitHub is rate limited, propagate as HTTP 429 to LFS client (never silently return "no permission")
- Include `Retry-After` header when available from upstream

## Resources

- **Git LFS Specification:**
  - [Pointer/OID Spec](https://github.com/git-lfs/git-lfs/blob/main/docs/spec.md) - OID format, pointer files
  - [API Overview](https://github.com/git-lfs/git-lfs/blob/main/docs/api/README.md)
  - [Batch API](https://github.com/git-lfs/git-lfs/blob/main/docs/api/batch.md)
  - [Authentication](https://github.com/git-lfs/git-lfs/blob/main/docs/api/authentication.md)
  - [Basic Transfers](https://github.com/git-lfs/git-lfs/blob/main/docs/api/basic-transfers.md)
  - [Server Discovery](https://github.com/git-lfs/git-lfs/blob/main/docs/api/server-discovery.md)
  - [Request Schema](https://github.com/git-lfs/git-lfs/blob/main/tq/schemas/http-batch-request-schema.json)
  - [Response Schema](https://github.com/git-lfs/git-lfs/blob/main/tq/schemas/http-batch-response-schema.json)
- [GitHub API - Repository Permissions](https://docs.github.com/en/rest/repos/repos)
- [CloudFlare Workers Docs](https://developers.cloudflare.com/workers/)
- [CloudFlare R2 Docs](https://developers.cloudflare.com/r2/)
- [Vitest Documentation](https://vitest.dev/)
- [Hono Framework](https://hono.dev/)

---

**Remember**: You are building a production-ready, security-focused system. Every decision should prioritize security, correctness, and maintainability over convenience or speed.
