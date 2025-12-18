import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app.js";
import * as github from "../src/services/github.js";
import * as lfs from "../src/services/lfs.js";
import type { LFSBatchResponse } from "../src/types/index.js";

// Mock external dependencies
vi.mock("../src/services/github.js", () => ({
  getRepositoryPermission: vi.fn(),
  hasOperationPermission: vi.fn(),
  mapGitHubPermissions: vi.fn(),
  GitHubRateLimitError: class GitHubRateLimitError extends Error {
    resetAt?: number;
    retryAfter?: number;
    constructor(message: string, options?: { resetAt?: number; retryAfter?: number }) {
      super(message);
      this.name = "GitHubRateLimitError";
      this.resetAt = options?.resetAt;
      this.retryAfter = options?.retryAfter;
    }
  },
}));

vi.mock("../src/services/lfs.js", () => ({
  validateBatchRequest: vi.fn(),
  processBatchRequest: vi.fn(),
}));

// Test constants
const VALID_OID = "a".repeat(64);
const VALID_SIZE = 1024;
const TEST_ORG = "test-org";
const TEST_REPO = "test-repo";
const TEST_URL_EXPIRY = 600;
const VALID_TOKEN = "ghp_validtoken123";
const LFS_CONTENT_TYPE = "application/vnd.git-lfs+json";

// Helper to create mock KV namespace for caching
const createMockKV = () =>
  ({
    get: vi.fn(async () => null),
    put: vi.fn(async () => {}),
  }) as unknown as KVNamespace;

// Helper to create mock environment
const createMockEnv = (overrides: Record<string, unknown> = {}) =>
  ({
    ALLOWED_ORGS: TEST_ORG,
    URL_EXPIRY: TEST_URL_EXPIRY,
    AUTH_CACHE_TTL: 300,
    LFS_BUCKET: {},
    AUTH_CACHE: createMockKV(),
    ...overrides,
  }) as unknown as Env;

// Helper to create batch request
const createBatchRequest = (operation: "download" | "upload", objects = [{ oid: VALID_OID, size: VALID_SIZE }]) => ({
  operation,
  objects,
});

// Helper to create HTTP request
const createRequest = (
  options: {
    org?: string;
    repo?: string;
    body?: object;
    token?: string | null;
    contentType?: string;
    accept?: string;
  } = {}
) => {
  const {
    org = TEST_ORG,
    repo = TEST_REPO,
    body = createBatchRequest("download"),
    token = VALID_TOKEN,
    contentType = "application/json",
    accept = LFS_CONTENT_TYPE,
  } = options;

  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (contentType) headers["Content-Type"] = contentType;
  if (accept) headers.Accept = accept;

  return new Request(`https://lfs.example.com/${org}/${repo}.git/info/lfs/objects/batch`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
};

describe("LFS Server Application", () => {
  const env = createMockEnv();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(github.hasOperationPermission).mockReturnValue(true);
    vi.mocked(lfs.validateBatchRequest).mockReturnValue({ valid: true });
  });

  describe("Route: POST /:org/:repo.git/info/lfs/objects/batch", () => {
    describe("successful requests", () => {
      it("returns 200 with batch response for valid download request", async () => {
        vi.mocked(github.getRepositoryPermission).mockResolvedValue("read");
        vi.mocked(lfs.processBatchRequest).mockResolvedValue({
          transfer: "basic",
          objects: [
            {
              oid: VALID_OID,
              size: VALID_SIZE,
              actions: { download: { href: "https://r2.example.com/object", expires_in: TEST_URL_EXPIRY } },
            },
          ],
        });

        const request = createRequest();
        const response = await app.fetch(request, env);

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe(LFS_CONTENT_TYPE);

        const body = (await response.json()) as Record<string, unknown>;
        expect(body).toHaveProperty("transfer", "basic");
        expect(body).toHaveProperty("objects");
        expect(body.objects).toHaveLength(1);
      });

      it("returns 200 with batch response for valid upload request", async () => {
        vi.mocked(github.getRepositoryPermission).mockResolvedValue("write");
        vi.mocked(lfs.processBatchRequest).mockResolvedValue({
          transfer: "basic",
          objects: [
            {
              oid: VALID_OID,
              size: VALID_SIZE,
              actions: { upload: { href: "https://r2.example.com/object", expires_in: TEST_URL_EXPIRY } },
            },
          ],
        });

        const request = createRequest({ body: createBatchRequest("upload") });
        const response = await app.fetch(request, env);

        expect(response.status).toBe(200);
        const body = (await response.json()) as LFSBatchResponse;
        expect(body.objects[0]?.actions?.upload).toBeDefined();
      });

      it("passes org and repo from URL path to services", async () => {
        vi.mocked(github.getRepositoryPermission).mockResolvedValue("read");
        vi.mocked(lfs.processBatchRequest).mockResolvedValue({ transfer: "basic", objects: [] });

        const request = createRequest();
        await app.fetch(request, env);

        expect(github.getRepositoryPermission).toHaveBeenCalledWith(VALID_TOKEN, TEST_ORG, TEST_REPO);
        expect(lfs.processBatchRequest).toHaveBeenCalledWith(expect.anything(), TEST_ORG, TEST_REPO, expect.anything());
      });

      it("includes hash_algo in response when provided in request", async () => {
        vi.mocked(github.getRepositoryPermission).mockResolvedValue("read");
        vi.mocked(lfs.processBatchRequest).mockResolvedValue({
          transfer: "basic",
          objects: [],
          hash_algo: "sha256",
        });

        const request = createRequest({ body: { ...createBatchRequest("download"), hash_algo: "sha256" } });
        const response = await app.fetch(request, env);

        const body = (await response.json()) as Record<string, unknown>;
        expect(body.hash_algo).toBe("sha256");
      });
    });

    describe("per-object errors in batch", () => {
      it("returns 200 with per-object errors (not request-level error)", async () => {
        vi.mocked(github.getRepositoryPermission).mockResolvedValue("read");
        vi.mocked(lfs.processBatchRequest).mockResolvedValue({
          transfer: "basic",
          objects: [{ oid: VALID_OID, size: VALID_SIZE, error: { code: 404, message: "Object not found" } }],
        });

        const request = createRequest();
        const response = await app.fetch(request, env);

        expect(response.status).toBe(200);
        const body = (await response.json()) as LFSBatchResponse;
        expect(body.objects[0]?.error).toEqual({ code: 404, message: "Object not found" });
      });

      it("returns mixed success and error objects in same response", async () => {
        const oid2 = "b".repeat(64);
        vi.mocked(github.getRepositoryPermission).mockResolvedValue("read");
        vi.mocked(lfs.processBatchRequest).mockResolvedValue({
          transfer: "basic",
          objects: [
            {
              oid: VALID_OID,
              size: VALID_SIZE,
              actions: { download: { href: "https://r2.example.com/object", expires_in: TEST_URL_EXPIRY } },
            },
            { oid: oid2, size: 2048, error: { code: 404, message: "Object not found" } },
          ],
        });

        const request = createRequest({
          body: {
            operation: "download",
            objects: [
              { oid: VALID_OID, size: VALID_SIZE },
              { oid: oid2, size: 2048 },
            ],
          },
        });
        const response = await app.fetch(request, env);

        expect(response.status).toBe(200);
        const body = (await response.json()) as LFSBatchResponse;
        expect(body.objects[0]?.actions).toBeDefined();
        expect(body.objects[1]?.error).toBeDefined();
      });
    });
  });

  describe("Authentication", () => {
    describe("missing authentication", () => {
      it("returns 401 when Authorization header is missing", async () => {
        const request = createRequest({ token: null });
        const response = await app.fetch(request, env);

        expect(response.status).toBe(401);
        expect(response.headers.get("Content-Type")).toBe(LFS_CONTENT_TYPE);
      });

      it("includes LFS-Authenticate header on 401", async () => {
        const request = createRequest({ token: null });
        const response = await app.fetch(request, env);

        expect(response.headers.get("LFS-Authenticate")).toBe('Basic realm="Git LFS"');
      });

      it("returns error message in response body", async () => {
        const request = createRequest({ token: null });
        const response = await app.fetch(request, env);

        const body = (await response.json()) as Record<string, unknown>;
        expect(body).toHaveProperty("message");
      });
    });

    describe("invalid token format", () => {
      it.each([
        ["empty token", ""],
        ["invalid prefix", "invalid_token123"],
        ["missing prefix", "abc123def456"],
        ["too long token", `ghp_${"a".repeat(1000)}`],
      ])("returns 401 for %s", async (_, token) => {
        const request = createRequest({ token });
        const response = await app.fetch(request, env);

        expect(response.status).toBe(401);
      });
    });

    describe("valid authentication formats", () => {
      it("accepts Bearer token format", async () => {
        vi.mocked(github.getRepositoryPermission).mockResolvedValue("read");
        vi.mocked(lfs.processBatchRequest).mockResolvedValue({ transfer: "basic", objects: [] });

        const request = new Request(`https://lfs.example.com/${TEST_ORG}/${TEST_REPO}.git/info/lfs/objects/batch`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${VALID_TOKEN}`,
            "Content-Type": "application/json",
            Accept: LFS_CONTENT_TYPE,
          },
          body: JSON.stringify(createBatchRequest("download")),
        });
        const response = await app.fetch(request, env);

        expect(response.status).toBe(200);
      });

      it("accepts Basic auth format with token as password", async () => {
        vi.mocked(github.getRepositoryPermission).mockResolvedValue("read");
        vi.mocked(lfs.processBatchRequest).mockResolvedValue({ transfer: "basic", objects: [] });

        const credentials = btoa(`user:${VALID_TOKEN}`);
        const request = new Request(`https://lfs.example.com/${TEST_ORG}/${TEST_REPO}.git/info/lfs/objects/batch`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/json",
            Accept: LFS_CONTENT_TYPE,
          },
          body: JSON.stringify(createBatchRequest("download")),
        });
        const response = await app.fetch(request, env);

        expect(response.status).toBe(200);
      });
    });
  });

  describe("Organization Validation", () => {
    it("returns 403 when organization is not in allowed list", async () => {
      const request = createRequest({ org: "unauthorized-org" });
      const response = await app.fetch(request, env);

      expect(response.status).toBe(403);
      expect(response.headers.get("Content-Type")).toBe(LFS_CONTENT_TYPE);

      const body = (await response.json()) as Record<string, unknown>;
      expect(body.message).toContain("not allowed");
    });

    it("does not call GitHub API for unauthorized organizations", async () => {
      const request = createRequest({ org: "unauthorized-org" });
      await app.fetch(request, env);

      expect(github.getRepositoryPermission).not.toHaveBeenCalled();
    });

    it("accepts organization from allowed list", async () => {
      vi.mocked(github.getRepositoryPermission).mockResolvedValue("read");
      vi.mocked(lfs.processBatchRequest).mockResolvedValue({ transfer: "basic", objects: [] });

      const request = createRequest();
      const response = await app.fetch(request, env);

      expect(response.status).toBe(200);
    });

    it("supports multiple allowed organizations", async () => {
      vi.mocked(github.getRepositoryPermission).mockResolvedValue("read");
      vi.mocked(lfs.processBatchRequest).mockResolvedValue({ transfer: "basic", objects: [] });

      const multiOrgEnv = createMockEnv({ ALLOWED_ORGS: "org1,org2,org3" });
      const request = createRequest({ org: "org2" });
      const response = await app.fetch(request, multiOrgEnv);

      expect(response.status).toBe(200);
    });
  });

  describe("Repository Name Validation", () => {
    it.each([
      [".hidden", "starts with period"],
      ["a".repeat(101), "exceeds max length"],
      ["repo:name", "contains colon"],
      ["repo name", "contains space"],
    ])("returns 400 for invalid repo name: %s (%s)", async (repo) => {
      const request = createRequest({ repo });
      const response = await app.fetch(request, env);

      expect(response.status).toBe(400);
      expect(response.headers.get("Content-Type")).toBe(LFS_CONTENT_TYPE);
      expect(github.getRepositoryPermission).not.toHaveBeenCalled();
    });

    it("accepts valid repository names", async () => {
      vi.mocked(github.getRepositoryPermission).mockResolvedValue("read");
      vi.mocked(lfs.processBatchRequest).mockResolvedValue({ transfer: "basic", objects: [] });

      const request = createRequest({ repo: "my-valid.repo_123" });
      const response = await app.fetch(request, env);

      expect(response.status).toBe(200);
    });
  });

  describe("Permission Checking", () => {
    describe("insufficient permissions", () => {
      it("returns 403 when user has no access to repository", async () => {
        vi.mocked(github.getRepositoryPermission).mockResolvedValue("none");

        const request = createRequest();
        const response = await app.fetch(request, env);

        expect(response.status).toBe(403);
        expect(response.headers.get("Content-Type")).toBe(LFS_CONTENT_TYPE);

        const body = (await response.json()) as Record<string, unknown>;
        expect(body.message).toBeDefined();
      });

      it("returns 403 when user has read-only access for upload", async () => {
        vi.mocked(github.getRepositoryPermission).mockResolvedValue("read");
        vi.mocked(github.hasOperationPermission).mockReturnValue(false);

        const request = createRequest({ body: createBatchRequest("upload") });
        const response = await app.fetch(request, env);

        expect(response.status).toBe(403);
      });
    });

    describe("sufficient permissions", () => {
      it.each([
        ["read", "download"],
        ["write", "download"],
        ["admin", "download"],
        ["write", "upload"],
        ["admin", "upload"],
      ])("allows %s permission for %s operation", async (permission, operation) => {
        vi.mocked(github.getRepositoryPermission).mockResolvedValue(permission as "read" | "write" | "admin");
        vi.mocked(github.hasOperationPermission).mockReturnValue(true);
        vi.mocked(lfs.processBatchRequest).mockResolvedValue({ transfer: "basic", objects: [] });

        const request = createRequest({ body: createBatchRequest(operation as "download" | "upload") });
        const response = await app.fetch(request, env);

        expect(response.status).toBe(200);
      });
    });

    describe("rate limiting", () => {
      it("returns 429 when GitHub API is rate limited", async () => {
        vi.mocked(github.getRepositoryPermission).mockRejectedValue(
          new github.GitHubRateLimitError("Rate limit exceeded", { retryAfter: 60 })
        );

        const request = createRequest();
        const response = await app.fetch(request, env);

        expect(response.status).toBe(429);
        expect(response.headers.get("Content-Type")).toBe(LFS_CONTENT_TYPE);
      });

      it("includes Retry-After header when available", async () => {
        vi.mocked(github.getRepositoryPermission).mockRejectedValue(
          new github.GitHubRateLimitError("Rate limit exceeded", { retryAfter: 120 })
        );

        const request = createRequest();
        const response = await app.fetch(request, env);

        expect(response.headers.get("Retry-After")).toBe("120");
      });

      it("includes Retry-After header from resetAt when retryAfter not available", async () => {
        const resetAt = Math.floor(Date.now() / 1000) + 300;
        vi.mocked(github.getRepositoryPermission).mockRejectedValue(
          new github.GitHubRateLimitError("Rate limit exceeded", { resetAt })
        );

        const request = createRequest();
        const response = await app.fetch(request, env);

        const retryAfter = response.headers.get("Retry-After");
        expect(retryAfter).toBeDefined();
        // Should be approximately 300 seconds
        expect(Number.parseInt(retryAfter ?? "0", 10)).toBeGreaterThan(0);
      });
    });
  });

  describe("Request Validation", () => {
    describe("batch size limits", () => {
      it.each(["download", "upload"] as const)("returns 413 for %s with more than 100 objects", async (operation) => {
        vi.mocked(github.getRepositoryPermission).mockResolvedValue("write");
        vi.mocked(lfs.validateBatchRequest).mockReturnValue({
          valid: false,
          error: "Batch request contains too many objects",
          status: 413,
        });

        const request = createRequest({ body: { operation, objects: [] } });
        const response = await app.fetch(request, env);

        expect(response.status).toBe(413);
        expect(response.headers.get("Content-Type")).toBe(LFS_CONTENT_TYPE);
        const body = (await response.json()) as Record<string, unknown>;
        expect(body.message).toContain("too many objects");
      });
    });

    describe("invalid batch request", () => {
      it("returns 422 for invalid operation", async () => {
        vi.mocked(github.getRepositoryPermission).mockResolvedValue("read");
        vi.mocked(lfs.validateBatchRequest).mockReturnValue({ valid: false, error: "Invalid operation", status: 422 });

        const request = createRequest({ body: { operation: "invalid", objects: [] } });
        const response = await app.fetch(request, env);

        expect(response.status).toBe(422);
        expect(response.headers.get("Content-Type")).toBe(LFS_CONTENT_TYPE);
      });

      it("returns error message from validation", async () => {
        vi.mocked(github.getRepositoryPermission).mockResolvedValue("read");
        vi.mocked(lfs.validateBatchRequest).mockReturnValue({
          valid: false,
          error: "Objects array is required",
          status: 422,
        });

        const request = createRequest({ body: { operation: "download" } });
        const response = await app.fetch(request, env);

        const body = (await response.json()) as Record<string, unknown>;
        expect(body.message).toContain("Objects array is required");
      });

      it("returns 422 for invalid JSON body", async () => {
        vi.mocked(github.getRepositoryPermission).mockResolvedValue("read");

        const request = new Request(`https://lfs.example.com/${TEST_ORG}/${TEST_REPO}.git/info/lfs/objects/batch`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${VALID_TOKEN}`,
            "Content-Type": "application/json",
            Accept: LFS_CONTENT_TYPE,
          },
          body: "{ invalid json }",
        });
        const response = await app.fetch(request, env);

        expect(response.status).toBe(422);
      });
    });
  });

  describe("Content Negotiation", () => {
    it("always returns Content-Type: application/vnd.git-lfs+json", async () => {
      vi.mocked(github.getRepositoryPermission).mockResolvedValue("read");
      vi.mocked(lfs.processBatchRequest).mockResolvedValue({ transfer: "basic", objects: [] });

      const request = createRequest();
      const response = await app.fetch(request, env);

      expect(response.headers.get("Content-Type")).toBe(LFS_CONTENT_TYPE);
    });

    it.each([
      ["application/vnd.git-lfs+json"],
      ["application/json"],
      ["*/*"],
    ])("accepts %s in Accept header", async (accept) => {
      vi.mocked(github.getRepositoryPermission).mockResolvedValue("read");
      vi.mocked(lfs.processBatchRequest).mockResolvedValue({ transfer: "basic", objects: [] });

      const request = createRequest({ accept });
      const response = await app.fetch(request, env);

      expect(response.status).toBe(200);
    });
  });

  describe("Error Handling", () => {
    it("returns 500 for unexpected errors", async () => {
      vi.mocked(github.getRepositoryPermission).mockRejectedValue(new Error("Unexpected error"));

      const request = createRequest();
      const response = await app.fetch(request, env);

      expect(response.status).toBe(500);
      expect(response.headers.get("Content-Type")).toBe(LFS_CONTENT_TYPE);
    });

    it("does not expose internal error details", async () => {
      vi.mocked(github.getRepositoryPermission).mockRejectedValue(
        new Error("R2 signing failed: invalid credentials abc123xyz")
      );

      const request = createRequest();
      const response = await app.fetch(request, env);

      expect(response.status).toBe(500);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.message).toBe("Internal server error");
    });

    it("returns 404 for unknown routes", async () => {
      const request = new Request("https://lfs.example.com/unknown/path", {
        method: "GET",
      });
      const response = await app.fetch(request, env);

      expect(response.status).toBe(404);
    });
  });

  describe("GitHub API Errors", () => {
    it("returns 502 when GitHub API returns 5xx", async () => {
      vi.mocked(github.getRepositoryPermission).mockRejectedValue(new Error("GitHub API error: 503"));

      const request = createRequest();
      const response = await app.fetch(request, env);

      expect(response.status).toBe(502);
    });
  });
});

describe("Health Check Endpoint", () => {
  it("returns 200 with status ok for GET /health", async () => {
    const request = new Request("https://lfs.example.com/health", { method: "GET" });
    const response = await app.fetch(request, createMockEnv());

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("status", "ok");
  });
});
