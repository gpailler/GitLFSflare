import { describe, expect, it } from "vitest";
import { isValidOID, isValidSize, parseAllowedOrgs, validateOrganization } from "../../src/lib/validation.js";

const createMockEnv = (allowedOrgs: string): Env =>
  ({
    ALLOWED_ORGS: allowedOrgs,
    URL_EXPIRY: "900",
    AUTH_CACHE_TTL: "300",
    ENVIRONMENT: "staging",
    R2_BUCKET_NAME: "lfs-objects-staging",
    CLOUDFLARE_ACCOUNT_ID: "test-account",
    R2_ACCESS_KEY_ID: "test-key",
    R2_SECRET_ACCESS_KEY: "test-secret",
  }) as Env;

describe("isValidOID", () => {
  describe("valid OIDs", () => {
    it.each([
      ["a".repeat(64), "64 lowercase hex characters (a)"],
      ["abc123def456".padEnd(64, "0"), "64 lowercase hex characters (mixed)"],
      ["0".repeat(64), "64 zeros"],
      ["f".repeat(64), "64 f's"],
      ["0123456789abcdef".repeat(4), "all hex digits repeated"],
    ])("returns true for %s (%s)", (oid) => {
      expect(isValidOID(oid)).toBe(true);
    });
  });

  describe("invalid OIDs", () => {
    it.each([
      ["", "empty string"],
      ["a".repeat(63), "63 characters (too short)"],
      ["a".repeat(65), "65 characters (too long)"],
      ["A".repeat(64), "uppercase letters"],
      ["g".repeat(64), "invalid hex character (g)"],
      ["z".repeat(64), "invalid hex character (z)"],
      [`${"a".repeat(32)} ${"a".repeat(31)}`, "contains space"],
      [`${"a".repeat(32)}\n${"a".repeat(31)}`, "contains newline"],
      [`${"a".repeat(32)}G${"a".repeat(31)}`, "mixed case"],
      ["!".repeat(64), "special characters"],
      ["a_".repeat(32), "contains underscore"],
      [` ${"a".repeat(63)}`, "leading space"],
      [`${"a".repeat(63)} `, "trailing space"],
    ])("returns false for %s (%s)", (oid) => {
      expect(isValidOID(oid)).toBe(false);
    });
  });
});

describe("isValidSize", () => {
  describe("valid sizes", () => {
    it.each([
      [0, "zero"],
      [1, "one byte"],
      [1024, "1 KB"],
      [1048576, "1 MB"],
      [1073741824, "1 GB"],
      [5368709120, "5 GB"],
      [Number.MAX_SAFE_INTEGER, "max safe integer"],
    ])("returns true for %d (%s)", (size) => {
      expect(isValidSize(size)).toBe(true);
    });
  });

  describe("invalid sizes", () => {
    it.each([
      [-1, "negative number"],
      [-1000, "large negative number"],
      [0.5, "decimal number"],
      [1.1, "float"],
      [Number.NaN, "NaN"],
      [Number.POSITIVE_INFINITY, "Infinity"],
      [Number.NEGATIVE_INFINITY, "-Infinity"],
    ])("returns false for %d (%s)", (size) => {
      expect(isValidSize(size)).toBe(false);
    });
  });
});

describe("parseAllowedOrgs", () => {
  describe("valid inputs", () => {
    it.each([
      ["org1", ["org1"], "single org"],
      ["org1,org2", ["org1", "org2"], "two orgs"],
      ["org1,org2,org3", ["org1", "org2", "org3"], "three orgs"],
      ["  org1  ", ["org1"], "single org with whitespace"],
      ["org1 , org2", ["org1", "org2"], "orgs with spaces around comma"],
      ["  org1  ,  org2  ", ["org1", "org2"], "orgs with extra whitespace"],
      ["ORG1,org2", ["ORG1", "org2"], "mixed case preserved"],
      ["my-org,my_org", ["my-org", "my_org"], "orgs with hyphens and underscores"],
    ])("parses '%s' to %j (%s)", (input, expected) => {
      expect(parseAllowedOrgs(input)).toEqual(expected);
    });
  });

  describe("empty or invalid inputs", () => {
    it.each([
      ["", [], "empty string"],
      ["   ", [], "whitespace only"],
      [",", [], "single comma"],
      [",,", [], "multiple commas"],
      [" , , ", [], "commas with spaces"],
    ])("parses '%s' to %j (%s)", (input, expected) => {
      expect(parseAllowedOrgs(input)).toEqual(expected);
    });
  });

  describe("edge cases", () => {
    it.each([
      ["org1,,org2", ["org1", "org2"], "double comma"],
      [",org1,", ["org1"], "leading and trailing commas"],
      ["org1,,,org2", ["org1", "org2"], "multiple consecutive commas"],
    ])("parses '%s' to %j (%s)", (input, expected) => {
      expect(parseAllowedOrgs(input)).toEqual(expected);
    });
  });
});

describe("validateOrganization", () => {
  describe("valid organization", () => {
    it.each([
      ["myorg", "myorg", "exact match single org"],
      ["org1,org2", "org1", "first org in list"],
      ["org1,org2", "org2", "second org in list"],
      ["org1,org2,org3", "org2", "middle org in list"],
      ["  org1  ,  org2  ", "org1", "org with whitespace in config"],
    ])("returns true when ALLOWED_ORGS='%s' and org='%s' (%s)", (allowedOrgs, org) => {
      const env = createMockEnv(allowedOrgs);
      expect(validateOrganization(env, org)).toBe(true);
    });
  });

  describe("invalid organization", () => {
    it.each([
      ["myorg", "otherorg", "org not in list"],
      ["org1,org2", "org3", "org not in multi-org list"],
      ["", "anyorg", "empty ALLOWED_ORGS"],
      ["myorg", "", "empty org parameter"],
      ["myorg", "MYORG", "case mismatch (org is case-sensitive)"],
      ["myorg", "myorg/subpath", "path traversal attempt"],
      ["myorg", "../myorg", "parent directory traversal"],
      ["myorg", "myorg/../other", "path traversal in middle"],
      ["org1", "org1,org2", "comma injection attempt"],
    ])("returns false when ALLOWED_ORGS='%s' and org='%s' (%s)", (allowedOrgs, org) => {
      const env = createMockEnv(allowedOrgs);
      expect(validateOrganization(env, org)).toBe(false);
    });
  });

  describe("security edge cases", () => {
    it("rejects org names with special characters", () => {
      const env = createMockEnv("myorg");
      expect(validateOrganization(env, "my<script>org")).toBe(false);
      expect(validateOrganization(env, "my%00org")).toBe(false);
      expect(validateOrganization(env, "my\x00org")).toBe(false);
    });

    it("rejects org names that are too long", () => {
      const env = createMockEnv("a".repeat(100));
      expect(validateOrganization(env, "a".repeat(100))).toBe(true);
      expect(validateOrganization(env, "a".repeat(256))).toBe(false);
    });
  });
});
