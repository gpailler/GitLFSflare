# Git LFS Server - Implementation Plan (Fresh Start)

## Overview

This plan provides a structured approach to build a production-ready Git LFS server on Cloudflare Workers with R2 storage from scratch. The implementation prioritizes test-driven development, security, and clean architecture.

## Technology Stack

See the complete technology stack in [CLAUDE.md](./CLAUDE.md#technology-stack).

## Project Structure

```
project-root/
├── src/
│   ├── index.ts                     # Hono app initialization
│   ├── routes/
│   │   ├── health.ts                # Health check endpoint
│   │   └── lfs.ts                   # LFS Batch API routes
│   ├── middleware/
│   │   ├── auth.ts                  # Authentication middleware
│   │   ├── cors.ts                  # CORS headers
│   │   ├── error-handler.ts         # Global error handling
│   │   └── logger.ts                # Request logging
│   ├── services/
│   │   ├── github.ts                # GitHub API integration
│   │   ├── r2.ts                    # R2 operations
│   │   ├── cache.ts                 # Permission caching
│   │   └── lfs.ts                   # LFS business logic
│   ├── lib/
│   │   ├── auth-parser.ts           # Token parsing utilities
│   │   ├── validation.ts            # OID, size validation
│   │   └── errors.ts                # Custom error classes
│   └── types/
│       ├── env.ts                   # Environment bindings
│       ├── lfs.ts                   # LFS protocol types
│       ├── github.ts                # GitHub API types
│       └── http.ts                  # HTTP error types
├── test/
│   ├── middleware/
│   │   ├── auth.test.ts
│   │   └── error-handler.test.ts
│   ├── services/
│   │   ├── github.test.ts
│   │   ├── r2.test.ts
│   │   ├── cache.test.ts
│   │   └── lfs.test.ts
│   ├── lib/
│   │   ├── auth-parser.test.ts
│   │   ├── validation.test.ts
│   │   └── errors.test.ts
│   ├── routes/
│   │   ├── health.test.ts
│   │   └── lfs.test.ts
│   └── scripts/
│       ├── test-endpoints.sh
│       └── test-git-lfs.sh
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   └── CONTRIBUTING.md
├── .claude/
│   ├── CLAUDE.md                    # Instructions for Claude
│   └── PLAN.md                      # This implementation plan
├── .github/
│   └── workflows/
│       ├── ci.yml                   # CI on every PR
│       ├── deploy-staging.yml       # Deploy to staging
│       └── deploy-production.yml    # Deploy to production
├── package.json
├── wrangler.staging.jsonc           # Staging environment config
├── wrangler.production.jsonc        # Production environment config
├── tsconfig.json
├── biome.json
└── vitest.config.ts
```

## Workflow Protocol

**This protocol applies to ALL phases and steps. Follow it consistently.**

### User Checkpoint Structure

After completing any step (setup, tests, or implementation), present to the user:

1. **Summary of work done:**
   - Files created/modified
   - Key decisions made (with justification for any deviations from plan)
   - Test results and coverage (when applicable)

2. **Verification results:**
   ```bash
   pnpm typecheck    # Type checking
   pnpm lint         # Code quality
   pnpm test         # Run tests (with coverage when applicable)
   ```

3. **Ask for approval:**
   - "Ready to proceed to [next step/phase]?"
   - "Any changes or additional requirements?"

4. **After approval, propose a commit message** using [Conventional Commits](https://www.conventionalcommits.org/) format:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation
   - `test:` for tests
   - `chore:` for maintenance tasks
   - `refactor:` for code refactoring

5. **Wait for commit confirmation** before proceeding to the next step/phase.

### On User Rejection

1. Address the specific feedback
2. Re-run verification commands
3. Present updated changes
4. Ask for approval again

### TDD Checkpoint Flow (Phases 1-6)

Each phase with tests follows this pattern:

```
Step Xa: Write Tests First
  → Write comprehensive tests with it.each where applicable
  → Implement stub functions that compile but fail
  → Present test file(s) for review
  → User approves tests

Step Xb: Implement
  → Write minimal code to pass tests
  → Optimize and challenge code quality
  → Present implementation + test results
  → User approves to proceed to next phase
```

**Never proceed to implementation without test approval. Never proceed to next phase without implementation approval.**

### Test Quality Requirements

1. **Use `it.each`** for parameterized tests to reduce duplication
2. **Tests must be consistent** - similar patterns across test files
3. **Implement stubs first** - tests must compile before implementation
4. **No over-documentation** - tests should be self-explanatory

### Quality Gate (Apply to All Phases)

Before finalizing any phase implementation, review:
1. Can any code be simplified?
2. Are there unnecessary abstractions?
3. Is there duplicated logic that should be extracted?
4. Does the code follow existing patterns in the codebase?
5. Are there any security concerns?

### Progress Tracking

**Update `.claude/PROGRESS.md` after each checkpoint:**
1. Check off completed items in the Phase Checklist
2. Update "Current Status" section (Phase, Step, Blocked)
3. Add entry to Session Log with work done, decisions, and next steps

This file maintains continuity across sessions. Always read it at the start of a new session to resume context.

**Note:** `PROGRESS.md` should be added to `.gitignore` and not committed to the repository.

---

## Implementation Phases

### Phase 0: Project Setup

**Goal**: Initialize project with modern tooling and multi-environment support

**Tasks**:
1. Initialize package.json with pnpm
2. Install dependencies:
   - Hono for runtime
   - Vitest, @cloudflare/vitest-pool-workers for testing
   - Biome for code quality
   - TypeScript, Wrangler for Cloudflare
   - aws4fetch for R2 signing
3. Configure TypeScript (strict mode, path aliases)
4. Configure Vitest (Workers pool, coverage 90%+)
5. Configure Biome (strict linting rules)
6. Configure Wrangler for staging and production environments
7. Ensure all packages use their latest version
8. Create directory structure

**Files to create**:
- `package.json` with staging/production deploy scripts
- `tsconfig.json`
- `vitest.config.ts`
- `biome.json`
- `wrangler.staging.jsonc`
- `wrangler.production.jsonc`
- `.gitignore`
- Directory structure

**Success Criteria**:
- ✅ `pnpm install` succeeds
- ✅ `pnpm typecheck` passes
- ✅ `pnpm lint` passes
- ✅ `pnpm test` runs (no tests yet)

---

### Phase 1: Core Types & Validation

**Goal**: Define all types and validation logic

#### Step 1a: Write Tests First
**Files**: `test/lib/validation.test.ts`, `test/lib/errors.test.ts`

**Test Coverage**:
- LFS types (LFSBatchRequest, LFSBatchResponse, LFSObject, LFSAction)
- Environment types (Env bindings with ALLOWED_ORGS, AUTH_CACHE, ENVIRONMENT)
- GitHub types (GitHubRepository, AuthResult)
- HTTP error types (HTTPError, LFSError)
- Validation functions (isValidOID, isValidSize, validateOrganization with list support)

#### Step 1b: Implement After Approval

**Files to create**:
- `src/types/env.ts`
- `src/types/lfs.ts`
- `src/types/github.ts`
- `src/types/http.ts`
- `src/lib/validation.ts`
- `src/lib/errors.ts`

**Success Criteria**:
- ✅ All type tests pass
- ✅ Validation functions work correctly
- ✅ Custom error classes work
- ✅ Multi-org validation works
- ✅ 100% coverage on validation logic

---

### Phase 2: Authentication System

**Goal**: Parse tokens, validate GitHub permissions, enforce organization list (no caching yet)

#### Step 2a: Write Tests First
**Files**: `test/lib/auth-parser.test.ts`, `test/services/github.test.ts`, `test/middleware/auth.test.ts`

**Test Coverage**:
- Token parsing (Bearer, Basic auth)
- Token validation (prefixes, length, characters)
- Organization validation (list support, case-sensitive, path traversal)
- GitHub API integration (GET /repos/{org}/{repo})
- Permission level determination (admin, write, read, none)
- Auth middleware (header extraction, validation, context setting)
- Error scenarios (401, 403, GitHub API errors)

#### Step 2b: Implement After Approval

**Files to create**:
- `src/lib/auth-parser.ts`
- `src/services/github.ts`
- `src/middleware/auth.ts`

**Success Criteria**:
- ✅ All auth tests pass
- ✅ Multi-org validation works
- ✅ Auth formats supported
- ✅ Token security enforced
- ✅ 95%+ coverage

---

### Phase 3: R2 Integration & Pre-signed URLs

**Goal**: Generate AWS Signature V4 pre-signed URLs for R2

#### Step 3a: Write Tests First
**Files**: `test/services/r2.test.ts`

**Test Coverage**:
- Object key generation (`{org}/{repo}/{oid[:2]}/{oid}`)
- Upload URL generation (PUT)
- Download URL generation (GET)
- Object existence checks (HEAD request)
- Size verification
- AWS Signature V4 parameters
- Different OIDs generate different URLs
- Cloudflare account ID and bucket name in URLs
- Environment-specific bucket names

#### Step 3b: Implement After Approval

**Files to create**:
- `src/services/r2.ts`

**Success Criteria**:
- ✅ All R2 tests pass
- ✅ Pre-signed URLs work with R2
- ✅ Object key sharding implemented
- ✅ Expiration times configurable
- ✅ Environment-specific buckets supported
- ✅ 95%+ coverage

---

### Phase 4: LFS Business Logic

**Goal**: Implement LFS Batch API logic (upload/download operations)

#### Step 4a: Write Tests First
**Files**: `test/services/lfs.test.ts`

**Test Coverage**:
- Upload operation (generate upload URLs)
- Download operation (check existence, generate download URLs)
- Per-object error handling (404, 422, size mismatch)
- Transfer adapter selection (only "basic")
- Hash algorithm validation (only "sha256")
- Batch processing (100+ objects)
- Edge cases (empty batch, invalid OIDs, negative sizes)

#### Step 4b: Implement After Approval

**Files to create**:
- `src/services/lfs.ts`

**Success Criteria**:
- ✅ All LFS tests pass
- ✅ Upload/download operations work
- ✅ Per-object errors handled
- ✅ Batch processing efficient
- ✅ 95%+ coverage

---

### Phase 5: Hono Routes & Middleware

**Goal**: Wire up Hono app with routes and middleware (no caching yet)

#### Step 5a: Write Tests First
**Files**: `test/routes/*.test.ts`, `test/middleware/*.test.ts`

**Test Coverage**:
- Health endpoint (`GET /health`) with environment info
- LFS Batch API endpoint (`POST /:org/:repo/objects/batch`)
- CORS middleware (headers, preflight)
- Error handler middleware (404, 500, custom errors)
- Auth middleware integration
- End-to-end request flow
- Error response formats

#### Step 5b: Implement After Approval

**Files to create**:
- `src/index.ts`
- `src/routes/health.ts`
- `src/routes/lfs.ts`
- `src/middleware/cors.ts`
- `src/middleware/error-handler.ts`
- `src/middleware/logger.ts`

**Success Criteria**:
- ✅ All route tests pass
- ✅ Middleware chain works
- ✅ Error handling correct
- ✅ End-to-end tests pass
- ✅ Environment info in health endpoint
- ✅ 90%+ overall coverage

---

### Phase 6: GitHub Permission Caching

**Goal**: Add KV-based permission caching to reduce GitHub API calls

#### Step 6a: Write Tests First
**Files**: `test/services/cache.test.ts`

**Test Coverage**:
- Cache key generation (SHA-256 hash of token+org+repo)
- Cache hits (return cached permission)
- Cache misses (call GitHub API, store result)
- Cache TTL expiration (5-minute default, configurable)
- Cache invalidation scenarios
- Integration with auth middleware

#### Step 6b: Implement After Approval

**Files to create/modify**:
- `src/services/cache.ts`
- Update `src/middleware/auth.ts` to use caching

**Success Criteria**:
- ✅ All cache tests pass
- ✅ Permission caching reduces GitHub API calls
- ✅ Cache TTL enforced (5 minutes default)
- ✅ Cache key doesn't expose tokens
- ✅ 95%+ coverage

---

### Phase 7: Documentation

**Goal**: Comprehensive documentation for users and developers

**Files to create**:
- `README.md` - Project overview, quick start, usage
- `docs/ARCHITECTURE.md` - System design, data flow, decisions
- `docs/DEPLOYMENT.md` - Cloudflare deployment guide (staging and production)
- `docs/CONTRIBUTING.md` - Development guide, testing

**Content Structure**:

#### README.md
- Project description
- Features
- Quick start
- GitHub token setup
- Configuration
- Deployment (staging and production)
- Usage examples
- Troubleshooting

#### ARCHITECTURE.md
- System overview
- Request flow diagram
- Component responsibilities
- Design decisions
- Security model
- Performance considerations (including caching)

#### DEPLOYMENT.md
- Prerequisites
- Cloudflare setup (KV namespace creation for cache)
- R2 bucket creation (staging and production)
- Environment variables (ALLOWED_ORGS, AUTH_CACHE, ENVIRONMENT)
- Wrangler configuration (staging and production)
- Deployment steps
- Verification tests

**Success Criteria**:
- ✅ README clear and comprehensive
- ✅ Architecture documented
- ✅ API fully documented
- ✅ Deployment guide complete (both environments)
- ✅ Multi-org and caching explained
- ✅ Examples work

---

### Phase 8: Deployment & Testing Scripts

**Goal**: Automated deployment verification and end-to-end testing for both environments

**Files to create**:
- `test/scripts/test-endpoints.sh` - API endpoint validation against deployed worker
- `test/scripts/test-git-lfs.sh` - Full end-to-end Git LFS client test (16MB round-trip)

**Test Scripts**:

#### test-endpoints.sh
Tests real endpoints on the deployed worker:
1. Health check (verify environment and version)
2. Missing authentication token (401)
3. Wrong organization (403) - test against allowed list
4. Invalid token format (401)
5. Valid authentication - Upload request (single file)
6. Actual upload to R2 via pre-signed URL
7. Valid authentication - Download request (existing file)
8. Actual download from R2 via pre-signed URL
9. Download request (non-existent file, 404)
10. Upload request (multiple files)
11. Invalid request (bad OID format, 422)
12. Large file request (10GB)
13. Valid authentication - Download (second request, cache hit verification)

#### test-git-lfs.sh
Full end-to-end test with real Git LFS client:
1. Initialize Git repository with LFS
2. Create test files (1MB, 5MB, 10MB)
3. Configure LFS endpoint and authentication
4. Push LFS objects to Worker/R2
5. Clone repository
6. Pull LFS objects from Worker/R2
7. Verify file integrity (size + checksum)

**Important:** These scripts should only be run against the **staging environment**, never production.

**Success Criteria**:
- ✅ All endpoint tests pass on staging
- ✅ End-to-end Git LFS test passes on staging
- ✅ 16MB data transferred successfully
- ✅ Permission caching verified

---

### Phase 9: CI/CD Pipeline

**Goal**: Automated testing and deployment via GitHub Actions for both environments

**Files to create**:
- `.github/workflows/ci.yml` - Run on every PR
- `.github/workflows/deploy-staging.yml` - Deploy to staging on push to main
- `.github/workflows/deploy-production.yml` - Deploy to production on release tag

**Success Criteria**:
- ✅ CI runs on every PR
- ✅ All checks pass before merge
- ✅ Staging deploys on merge to main
- ✅ Production deploys on release tag
- ✅ Automatic deployment works for both environments
