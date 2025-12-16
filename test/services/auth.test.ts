import { describe, expect, it } from "vitest";
import { extractToken, parseAuthHeader, validateTokenFormat } from "../../src/services/auth.js";

describe("parseAuthHeader", () => {
  describe("Bearer token", () => {
    it.each([
      ["Bearer ghp_abc123", { type: "bearer", token: "ghp_abc123" }],
      ["Bearer github_pat_abc123", { type: "bearer", token: "github_pat_abc123" }],
      ["Bearer ghs_actions_token123", { type: "bearer", token: "ghs_actions_token123" }],
      ["bearer ghp_lowercase", { type: "bearer", token: "ghp_lowercase" }],
      ["BEARER ghp_uppercase", { type: "bearer", token: "ghp_uppercase" }],
    ] as const)("parseAuthHeader(%s) returns %o", (header, expected) => {
      expect(parseAuthHeader(header)).toEqual(expected);
    });
  });

  describe("Basic auth", () => {
    it.each([
      [`Basic ${btoa("user:ghp_token123")}`, { type: "basic", token: "ghp_token123" }],
      [`Basic ${btoa("x-access-token:github_pat_abc")}`, { type: "basic", token: "github_pat_abc" }],
      [`Basic ${btoa("github-actions:ghs_actionstoken")}`, { type: "basic", token: "ghs_actionstoken" }],
      [`Basic ${btoa(":ghp_tokenonly")}`, { type: "basic", token: "ghp_tokenonly" }],
      [`basic ${btoa("user:ghp_token123")}`, { type: "basic", token: "ghp_token123" }],
      [`BASIC ${btoa("user:ghp_token123")}`, { type: "basic", token: "ghp_token123" }],
    ] as const)("parseAuthHeader(%s) returns %o", (header, expected) => {
      expect(parseAuthHeader(header)).toEqual(expected);
    });
  });

  describe("invalid headers", () => {
    it.each([
      null,
      "",
      "Invalid",
      "Bearer",
      "Bearer ",
      "Basic",
      "Basic ",
      "Basic !!!invalid-base64!!!",
      `Basic ${btoa("user")}`, // no colon
      "Digest abc123",
      "OAuth token",
    ])("parseAuthHeader(%s) returns null", (header) => {
      expect(parseAuthHeader(header)).toBeNull();
    });
  });
});

describe("validateTokenFormat", () => {
  describe("valid tokens", () => {
    it.each([
      "ghp_abcdefghijklmnop123456789",
      "github_pat_abcdefghijklmnop123456789",
      "ghs_actionsToken123456789",
      "ghp_ABC123def456",
      "github_pat_ABC123_def456",
      "ghs_ABC123_def456",
      "ghp_a",
      "github_pat_a",
      "ghs_a",
    ])("validateTokenFormat(%s) returns true", (token) => {
      expect(validateTokenFormat(token)).toBe(true);
    });
  });

  describe("invalid prefixes", () => {
    it.each([
      "gho_abc123",
      "ghu_abc123",
      "ghr_abc123",
      "pat_abc123",
      "token_abc123",
      "abc123",
      "",
    ])("validateTokenFormat(%s) returns false", (token) => {
      expect(validateTokenFormat(token)).toBe(false);
    });
  });

  describe("invalid characters", () => {
    it.each([
      "ghp_abc-def",
      "ghp_abc.def",
      "ghp_abc@def",
      "ghp_abc def",
      "ghp_abc\ndef",
      "github_pat_abc!def",
      "ghs_abc-def",
    ])("validateTokenFormat(%s) returns false", (token) => {
      expect(validateTokenFormat(token)).toBe(false);
    });
  });

  describe("length limits", () => {
    it("rejects tokens longer than 1000 characters", () => {
      const longToken = `ghp_${"a".repeat(1000)}`;
      expect(validateTokenFormat(longToken)).toBe(false);
    });

    it("accepts tokens at exactly 1000 characters", () => {
      const maxToken = `ghp_${"a".repeat(996)}`;
      expect(maxToken.length).toBe(1000);
      expect(validateTokenFormat(maxToken)).toBe(true);
    });

    it.each(["ghp_", "github_pat_", "ghs_"])("rejects empty token after prefix (%s)", (prefix) => {
      expect(validateTokenFormat(prefix)).toBe(false);
    });
  });
});

describe("extractToken", () => {
  function createRequest(authHeader: string | null): Request {
    const headers = new Headers();
    if (authHeader !== null) {
      headers.set("Authorization", authHeader);
    }
    return new Request("https://example.com", { headers });
  }

  describe("valid tokens", () => {
    it.each([
      ["Bearer ghp_validToken123", "ghp_validToken123"],
      ["Bearer github_pat_validToken456", "github_pat_validToken456"],
      ["Bearer ghs_actionsToken789", "ghs_actionsToken789"],
      [`Basic ${btoa("user:ghp_token123")}`, "ghp_token123"],
    ])("extractToken with header '%s' returns '%s'", (header, expected) => {
      const request = createRequest(header);
      expect(extractToken(request)).toBe(expected);
    });
  });

  describe("invalid tokens", () => {
    it.each([
      null,
      "",
      "Bearer invalid_prefix",
      "Bearer ghp_invalid-chars",
      "Basic invalid",
    ])("extractToken with header '%s' returns null", (header) => {
      const request = createRequest(header);
      expect(extractToken(request)).toBeNull();
    });
  });

  describe("missing Authorization header", () => {
    it("returns null when Authorization header is missing", () => {
      const request = new Request("https://example.com");
      expect(extractToken(request)).toBeNull();
    });
  });
});
