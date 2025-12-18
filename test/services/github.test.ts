import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GitHubRateLimitError,
  getRepositoryPermission,
  hasOperationPermission,
  isValidGitHubRepository,
  mapGitHubPermissions,
} from "../../src/services/github.js";

describe("isValidGitHubRepository", () => {
  describe("valid responses", () => {
    it.each([
      ["public repo without permissions", { private: false }],
      ["private repo without permissions", { private: true }],
      ["repo with full permissions", { private: true, permissions: { admin: true, push: true, pull: true } }],
      ["repo with partial permissions", { private: false, permissions: { admin: false, push: false, pull: true } }],
      ["repo with extra fields", { private: true, id: 123, name: "test", full_name: "org/test" }],
    ])("returns true for %s", (_, data) => {
      expect(isValidGitHubRepository(data)).toBe(true);
    });
  });

  describe("invalid responses", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["string", "not an object"],
      ["number", 123],
      ["array", []],
      ["missing private field", { id: 123 }],
      ["non-boolean private field", { private: "true" }],
      ["permissions as null", { private: true, permissions: null }],
      ["permissions as string", { private: true, permissions: "admin" }],
      ["permissions missing admin", { private: true, permissions: { push: true, pull: true } }],
      ["permissions missing push", { private: true, permissions: { admin: true, pull: true } }],
      ["permissions missing pull", { private: true, permissions: { admin: true, push: true } }],
      ["permissions with non-boolean admin", { private: true, permissions: { admin: "true", push: true, pull: true } }],
      ["permissions with non-boolean push", { private: true, permissions: { admin: true, push: "true", pull: true } }],
      ["permissions with non-boolean pull", { private: true, permissions: { admin: true, push: true, pull: "true" } }],
    ])("returns false for %s", (_, data) => {
      expect(isValidGitHubRepository(data)).toBe(false);
    });
  });
});

describe("mapGitHubPermissions", () => {
  it.each([
    [{ admin: true, push: true, pull: true }, "admin"],
    [{ admin: true, push: false, pull: true }, "admin"],
    [{ admin: false, push: true, pull: true }, "write"],
    [{ admin: false, push: true, pull: false }, "write"],
    [{ admin: false, push: false, pull: true }, "read"],
    [{ admin: false, push: false, pull: false }, "none"],
  ] as const)("mapGitHubPermissions(%o) returns '%s'", (permissions, expected) => {
    expect(mapGitHubPermissions(permissions)).toBe(expected);
  });
});

describe("hasOperationPermission", () => {
  describe("download operation", () => {
    it.each([
      ["admin", true],
      ["write", true],
      ["read", true],
      ["none", false],
    ] as const)("hasOperationPermission('%s', 'download') returns %s", (permission, expected) => {
      expect(hasOperationPermission(permission, "download")).toBe(expected);
    });
  });

  describe("upload operation", () => {
    it.each([
      ["admin", true],
      ["write", true],
      ["read", false],
      ["none", false],
    ] as const)("hasOperationPermission('%s', 'upload') returns %s", (permission, expected) => {
      expect(hasOperationPermission(permission, "upload")).toBe(expected);
    });
  });
});

describe("getRepositoryPermission", () => {
  let fetchSpy: MockInstance;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("successful API responses", () => {
    it.each([
      [{ admin: true, push: true, pull: true }, "admin"],
      [{ admin: false, push: true, pull: true }, "write"],
      [{ admin: false, push: false, pull: true }, "read"],
    ] as const)("returns '%s' permission level for %o", async (permissions, expected) => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 123,
            name: "test-repo",
            full_name: "test-org/test-repo",
            private: true,
            permissions,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const result = await getRepositoryPermission("ghp_validToken", "test-org", "test-repo");
      expect(result).toBe(expected);
    });

    it("calls GitHub API with correct URL and headers", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 123,
            name: "my-repo",
            full_name: "my-org/my-repo",
            private: false,
            permissions: { admin: false, push: false, pull: true },
          }),
          { status: 200 }
        )
      );

      await getRepositoryPermission("ghp_mytoken123", "my-org", "my-repo");

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.github.com/repos/my-org/my-repo");
      expect(options.headers).toMatchObject({
        Authorization: "Bearer ghp_mytoken123",
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      });
    });

    it("handles repository without permissions field (public repo)", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 456,
            name: "public-repo",
            full_name: "org/public-repo",
            private: false,
          }),
          { status: 200 }
        )
      );

      const result = await getRepositoryPermission("ghp_token", "org", "public-repo");
      expect(result).toBe("read");
    });

    it("returns 'none' for private repository without permissions field", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 789,
            name: "private-repo",
            full_name: "org/private-repo",
            private: true,
          }),
          { status: 200 }
        )
      );

      const result = await getRepositoryPermission("ghp_token", "org", "private-repo");
      expect(result).toBe("none");
    });
  });

  describe("error responses", () => {
    it("returns 'none' for 404 Not Found (no access or repo doesn't exist)", async () => {
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }));

      const result = await getRepositoryPermission("ghp_token", "org", "private-repo");
      expect(result).toBe("none");
    });

    it("returns 'none' for 401 Unauthorized (bad credentials)", async () => {
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 }));

      const result = await getRepositoryPermission("ghp_invalid", "org", "repo");
      expect(result).toBe("none");
    });

    it("returns 'none' for 403 Forbidden when token lacks required scope", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Resource not accessible by integration" }), {
          status: 403,
          headers: { "X-RateLimit-Remaining": "4999" },
        })
      );

      const result = await getRepositoryPermission("ghp_token", "org", "repo");
      expect(result).toBe("none");
    });

    it("throws error for 5xx server errors", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Internal Server Error" }), { status: 500 })
      );

      await expect(getRepositoryPermission("ghp_token", "org", "repo")).rejects.toThrow();
    });

    it("throws error for invalid response format", async () => {
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ unexpected: "format" }), { status: 200 }));

      await expect(getRepositoryPermission("ghp_token", "org", "repo")).rejects.toThrow(
        "GitHub API error: invalid response"
      );
    });

    it("throws error for network failures", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("Network error"));

      await expect(getRepositoryPermission("ghp_token", "org", "repo")).rejects.toThrow("Network error");
    });
  });

  describe("rate limiting", () => {
    it("throws GitHubRateLimitError when rate limited (X-RateLimit-Remaining: 0)", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
          status: 403,
          headers: {
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": "1234567890",
          },
        })
      );

      await expect(getRepositoryPermission("ghp_token", "org", "repo")).rejects.toThrow(GitHubRateLimitError);
    });

    it("includes reset timestamp in GitHubRateLimitError", async () => {
      const resetTimestamp = Math.floor(Date.now() / 1000) + 3600;
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
          status: 403,
          headers: {
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(resetTimestamp),
          },
        })
      );

      try {
        await getRepositoryPermission("ghp_token", "org", "repo");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(GitHubRateLimitError);
        expect((error as GitHubRateLimitError).resetAt).toBe(resetTimestamp);
      }
    });

    it("throws GitHubRateLimitError for 429 Too Many Requests", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Too many requests" }), {
          status: 429,
          headers: { "Retry-After": "60" },
        })
      );

      await expect(getRepositoryPermission("ghp_token", "org", "repo")).rejects.toThrow(GitHubRateLimitError);
    });

    it("includes Retry-After in GitHubRateLimitError for 429", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Too many requests" }), {
          status: 429,
          headers: { "Retry-After": "120" },
        })
      );

      try {
        await getRepositoryPermission("ghp_token", "org", "repo");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(GitHubRateLimitError);
        expect((error as GitHubRateLimitError).retryAfter).toBe(120);
      }
    });
  });

  describe("edge cases", () => {
    it("handles repository names with special characters", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 789,
            name: "my.repo-name_123",
            full_name: "org/my.repo-name_123",
            private: true,
            permissions: { admin: false, push: true, pull: true },
          }),
          { status: 200 }
        )
      );

      const result = await getRepositoryPermission("ghp_token", "org", "my.repo-name_123");
      expect(result).toBe("write");
      expect(fetchSpy).toHaveBeenCalledWith("https://api.github.com/repos/org/my.repo-name_123", expect.any(Object));
    });

    it("handles organization names with hyphens", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 101,
            name: "repo",
            full_name: "my-org-name/repo",
            private: true,
            permissions: { admin: true, push: true, pull: true },
          }),
          { status: 200 }
        )
      );

      const result = await getRepositoryPermission("ghp_token", "my-org-name", "repo");
      expect(result).toBe("admin");
    });
  });
});
