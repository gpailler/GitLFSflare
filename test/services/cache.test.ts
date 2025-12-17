import { beforeEach, describe, expect, it, vi } from "vitest";
import * as cache from "../../src/services/cache.js";

// Test constants - use non-default TTL to verify config is read
const TEST_TOKEN = "ghp_testtoken123456789";
const TEST_ORG = "test-org";
const TEST_REPO = "test-repo";
const TEST_TTL = 600;

// Mock KV namespace - only mock get/put which are used by cache service
function createMockKV(store: Map<string, string> = new Map()): KVNamespace {
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  } as unknown as KVNamespace;
}

// Mock Env - only include properties used by cache service
function createMockEnv(overrides: Record<string, unknown> = {}): Env {
  return {
    AUTH_CACHE: createMockKV(),
    AUTH_CACHE_TTL: TEST_TTL,
    ...overrides,
  } as unknown as Env;
}

describe("cache service", () => {
  describe("hashToken", () => {
    it("returns a 64-character hex string (SHA-256)", async () => {
      const hash = await cache.hashToken(TEST_TOKEN);

      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("returns consistent hash for same token", async () => {
      const hash1 = await cache.hashToken(TEST_TOKEN);
      const hash2 = await cache.hashToken(TEST_TOKEN);

      expect(hash1).toBe(hash2);
    });

    it("returns different hashes for different tokens", async () => {
      const hash1 = await cache.hashToken("ghp_token1");
      const hash2 = await cache.hashToken("ghp_token2");

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("generateCacheKey", () => {
    it("generates key with correct format", async () => {
      const key = await cache.generateCacheKey(TEST_TOKEN, TEST_ORG, TEST_REPO);

      expect(key).toMatch(/^perm:[0-9a-f]{64}:test-org\/test-repo$/);
    });

    it("generates consistent keys for same inputs", async () => {
      const key1 = await cache.generateCacheKey(TEST_TOKEN, TEST_ORG, TEST_REPO);
      const key2 = await cache.generateCacheKey(TEST_TOKEN, TEST_ORG, TEST_REPO);

      expect(key1).toBe(key2);
    });

    it.each([
      ["tokens", "ghp_token1", TEST_ORG, TEST_REPO, "ghp_token2", TEST_ORG, TEST_REPO],
      ["repos", TEST_TOKEN, TEST_ORG, "repo1", TEST_TOKEN, TEST_ORG, "repo2"],
      ["orgs", TEST_TOKEN, "org1", TEST_REPO, TEST_TOKEN, "org2", TEST_REPO],
    ])("generates different keys for different %s", async (_, token1, org1, repo1, token2, org2, repo2) => {
      const key1 = await cache.generateCacheKey(token1, org1, repo1);
      const key2 = await cache.generateCacheKey(token2, org2, repo2);

      expect(key1).not.toBe(key2);
    });
  });

  describe("getCachedPermission", () => {
    it("returns null when cache is empty", async () => {
      const env = createMockEnv();

      const result = await cache.getCachedPermission(env, TEST_TOKEN, TEST_ORG, TEST_REPO);

      expect(result).toBeNull();
    });

    it.each([
      ["admin"],
      ["write"],
      ["read"],
      ["none"],
    ] as const)("retrieves %s permission from cache", async (permission) => {
      const store = new Map<string, string>();
      const kv = createMockKV(store);
      const env = createMockEnv({ AUTH_CACHE: kv });

      const key = await cache.generateCacheKey(TEST_TOKEN, TEST_ORG, TEST_REPO);
      store.set(key, permission);

      const result = await cache.getCachedPermission(env, TEST_TOKEN, TEST_ORG, TEST_REPO);

      expect(result).toBe(permission);
    });

    it("calls KV.get with correct key", async () => {
      const kv = createMockKV();
      const env = createMockEnv({ AUTH_CACHE: kv });

      await cache.getCachedPermission(env, TEST_TOKEN, TEST_ORG, TEST_REPO);

      const expectedKey = await cache.generateCacheKey(TEST_TOKEN, TEST_ORG, TEST_REPO);
      expect(kv.get).toHaveBeenCalledWith(expectedKey);
    });
  });

  describe("setCachedPermission", () => {
    it("stores permission in KV with TTL", async () => {
      const kv = createMockKV();
      const env = createMockEnv({ AUTH_CACHE: kv });

      await cache.setCachedPermission(env, TEST_TOKEN, TEST_ORG, TEST_REPO, "write");

      const expectedKey = await cache.generateCacheKey(TEST_TOKEN, TEST_ORG, TEST_REPO);
      expect(kv.put).toHaveBeenCalledWith(expectedKey, "write", { expirationTtl: TEST_TTL });
    });

    it.each([
      ["admin"],
      ["write"],
      ["read"],
      ["none"],
    ] as const)("stores %s permission correctly", async (permission) => {
      const kv = createMockKV();
      const env = createMockEnv({ AUTH_CACHE: kv });

      await cache.setCachedPermission(env, TEST_TOKEN, TEST_ORG, TEST_REPO, permission);

      const expectedKey = await cache.generateCacheKey(TEST_TOKEN, TEST_ORG, TEST_REPO);
      expect(kv.put).toHaveBeenCalledWith(expectedKey, permission, expect.any(Object));
    });

    it("uses TTL from environment", async () => {
      const kv = createMockKV();
      const customTtl = 900;
      const env = createMockEnv({ AUTH_CACHE: kv, AUTH_CACHE_TTL: customTtl });

      await cache.setCachedPermission(env, TEST_TOKEN, TEST_ORG, TEST_REPO, "read");

      expect(kv.put).toHaveBeenCalledWith(expect.any(String), "read", { expirationTtl: customTtl });
    });
  });

  describe("withCache (decorator)", () => {
    let mockGetPermission: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockGetPermission = vi.fn();
    });

    it("returns cached permission without calling wrapped function", async () => {
      const store = new Map<string, string>();
      const kv = createMockKV(store);
      const env = createMockEnv({ AUTH_CACHE: kv });

      // Pre-populate cache
      const key = await cache.generateCacheKey(TEST_TOKEN, TEST_ORG, TEST_REPO);
      store.set(key, "admin");

      const wrapped = cache.withCache(env, mockGetPermission);
      const result = await wrapped(TEST_TOKEN, TEST_ORG, TEST_REPO);

      expect(result).toBe("admin");
      expect(mockGetPermission).not.toHaveBeenCalled();
    });

    it("calls wrapped function on cache miss", async () => {
      const env = createMockEnv();
      mockGetPermission.mockResolvedValue("write");

      const wrapped = cache.withCache(env, mockGetPermission);
      const result = await wrapped(TEST_TOKEN, TEST_ORG, TEST_REPO);

      expect(result).toBe("write");
      expect(mockGetPermission).toHaveBeenCalledWith(TEST_TOKEN, TEST_ORG, TEST_REPO);
    });

    it("stores result in cache after calling wrapped function", async () => {
      const kv = createMockKV();
      const env = createMockEnv({ AUTH_CACHE: kv });
      mockGetPermission.mockResolvedValue("read");

      const wrapped = cache.withCache(env, mockGetPermission);
      await wrapped(TEST_TOKEN, TEST_ORG, TEST_REPO);

      const expectedKey = await cache.generateCacheKey(TEST_TOKEN, TEST_ORG, TEST_REPO);
      expect(kv.put).toHaveBeenCalledWith(expectedKey, "read", { expirationTtl: TEST_TTL });
    });

    it("propagates errors from wrapped function without caching", async () => {
      const kv = createMockKV();
      const env = createMockEnv({ AUTH_CACHE: kv });
      const error = new Error("GitHub API error");
      mockGetPermission.mockRejectedValue(error);

      const wrapped = cache.withCache(env, mockGetPermission);

      await expect(wrapped(TEST_TOKEN, TEST_ORG, TEST_REPO)).rejects.toThrow("GitHub API error");
      expect(kv.put).not.toHaveBeenCalled();
    });

    it("caches 'none' permission (valid result)", async () => {
      const kv = createMockKV();
      const env = createMockEnv({ AUTH_CACHE: kv });
      mockGetPermission.mockResolvedValue("none");

      const wrapped = cache.withCache(env, mockGetPermission);
      await wrapped(TEST_TOKEN, TEST_ORG, TEST_REPO);

      const expectedKey = await cache.generateCacheKey(TEST_TOKEN, TEST_ORG, TEST_REPO);
      expect(kv.put).toHaveBeenCalledWith(expectedKey, "none", expect.any(Object));
    });

    it.each([
      ["admin"],
      ["write"],
      ["read"],
      ["none"],
    ] as const)("caches and returns %s permission", async (permission) => {
      const store = new Map<string, string>();
      const kv = createMockKV(store);
      const env = createMockEnv({ AUTH_CACHE: kv });
      mockGetPermission.mockResolvedValue(permission);

      const wrapped = cache.withCache(env, mockGetPermission);

      // First call - cache miss
      const result1 = await wrapped(TEST_TOKEN, TEST_ORG, TEST_REPO);
      expect(result1).toBe(permission);
      expect(mockGetPermission).toHaveBeenCalledTimes(1);

      // Second call - cache hit
      const result2 = await wrapped(TEST_TOKEN, TEST_ORG, TEST_REPO);
      expect(result2).toBe(permission);
      expect(mockGetPermission).toHaveBeenCalledTimes(1); // Still 1, not called again
    });

    it.each([
      ["tokens", "ghp_token1", TEST_ORG, TEST_REPO, "ghp_token2", TEST_ORG, TEST_REPO],
      ["repos", TEST_TOKEN, TEST_ORG, "repo1", TEST_TOKEN, TEST_ORG, "repo2"],
      ["orgs", TEST_TOKEN, "org1", TEST_REPO, TEST_TOKEN, "org2", TEST_REPO],
    ])("uses different cache entries for different %s", async (_, token1, org1, repo1, token2, org2, repo2) => {
      const store = new Map<string, string>();
      const kv = createMockKV(store);
      const env = createMockEnv({ AUTH_CACHE: kv });
      mockGetPermission.mockResolvedValueOnce("admin").mockResolvedValueOnce("read");

      const wrapped = cache.withCache(env, mockGetPermission);

      await wrapped(token1, org1, repo1);
      await wrapped(token2, org2, repo2);

      expect(mockGetPermission).toHaveBeenCalledTimes(2);
    });
  });
});
