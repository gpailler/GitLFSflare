# Contributing

## Development Setup

### Prerequisites

See [Deployment Guide - Prerequisites](DEPLOYMENT.md#prerequisites) for required tools.

### Installation

```bash
git clone https://github.com/your-org/gitlfsflare.git
cd gitlfsflare
pnpm install
```

### Generate Types

```bash
pnpm types
```

This generates `worker-configuration.d.ts` from your Wrangler configuration.

## Development Workflow

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage
```

### Code Quality

```bash
# Type checking
pnpm typecheck

# Linting
pnpm lint

# Auto-fix lint issues
pnpm lint:fix

# Format code
pnpm format
```

### Local Development Server

```bash
pnpm dev
```

This starts a local Wrangler dev server at `http://localhost:8787`.

## Coding Standards

### TypeScript

- Strict mode enabled
- No implicit `any`
- Explicit return types on exported functions

### Code Style

We use [Biome](https://biomejs.dev/) for linting and formatting:

- 2 spaces for indentation
- 120 character line width
- Double quotes for strings

### Testing

- Use [Vitest](https://vitest.dev/) for testing
- Tests run in Cloudflare Workers runtime via `@cloudflare/vitest-pool-workers`
- Minimum 90% coverage required

#### Test Patterns

Use `it.each` for parameterized tests:

```typescript
it.each([
  ["admin", true],
  ["write", true],
  ["read", false],
  ["none", false],
])("hasUploadPermission(%s) returns %s", (permission, expected) => {
  expect(hasUploadPermission(permission)).toBe(expected);
});
```

Group tests by behavior:

```typescript
describe("auth service", () => {
  describe("parseAuthHeader", () => {
    describe("Bearer token", () => {
      it("extracts token from Bearer header", () => { ... });
    });

    describe("Basic auth", () => {
      it("extracts token from Basic header", () => { ... });
    });
  });
});
```

### Documentation

- Self-documenting code preferred over comments
- Only add comments to explain "why", not "what"
- JSDoc only for non-obvious behavior

## Pull Request Process

### Before Submitting

1. Run all checks:
   ```bash
   pnpm typecheck && pnpm lint && pnpm test
   ```

2. Ensure coverage meets threshold:
   ```bash
   pnpm test:coverage
   ```

3. Update documentation if needed

### PR Guidelines

- Use conventional commit messages
- Keep PRs focused (one feature/fix per PR)
- Include tests for new functionality
- Update relevant documentation

## Architecture Guidelines

See [Architecture](ARCHITECTURE.md) for detailed documentation on:
- Security model (token handling, minimal error disclosure)
- Performance considerations (pre-signed URLs, caching, sharding)
- Error handling (per-object errors, status codes)

### Code Organization

- Services: Business logic
- Lib: Pure utility functions
- Types: TypeScript definitions
- App: HTTP routing only

## Getting Help

- Open an issue for bugs
- Discussions for questions
- PRs welcome for improvements
