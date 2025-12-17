import { describe, expect, it } from "vitest";
import { generateDownloadUrl, generateObjectKey, generateUploadUrl, objectExists } from "../../src/services/r2.js";

describe("generateObjectKey", () => {
  it.each([
    ["myorg", "myrepo", `ab${"0".repeat(62)}`, `myorg/myrepo/ab/ab${"0".repeat(62)}`],
    ["org", "repo", `12${"0".repeat(62)}`, `org/repo/12/12${"0".repeat(62)}`],
    ["test-org", "test-repo", `ff${"0".repeat(62)}`, `test-org/test-repo/ff/ff${"0".repeat(62)}`],
  ])("generateObjectKey('%s', '%s', '%s') returns sharded path using first 2 OID chars", (org, repo, oid, expected) => {
    expect(generateObjectKey(org, repo, oid)).toBe(expected);
  });
});

describe("generateUploadUrl", () => {
  const mockEnv = {
    CLOUDFLARE_ACCOUNT_ID: "test-account-id",
    R2_ACCESS_KEY_ID: "test-access-key",
    R2_SECRET_ACCESS_KEY: "test-secret-key",
    R2_BUCKET_NAME: "test-bucket",
    URL_EXPIRY: 600,
  } as unknown as Env;

  it("generates a valid pre-signed URL with correct structure", async () => {
    const oid = `cd${"0".repeat(62)}`;
    const url = await generateUploadUrl(mockEnv, "myorg", "myrepo", oid);
    const params = new URL(url).searchParams;

    expect(url).toContain("https://test-account-id.r2.cloudflarestorage.com/test-bucket/");
    expect(url).toContain("myorg/myrepo/cd/");
    expect(params.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(params.get("X-Amz-Expires")).toBe("600");
    expect(params.get("X-Amz-Credential")).toMatch(/^test-access-key\/\d{8}\/auto\/s3\/aws4_request$/);
    expect(params.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("generateDownloadUrl", () => {
  const mockEnv = {
    CLOUDFLARE_ACCOUNT_ID: "test-account-id",
    R2_ACCESS_KEY_ID: "test-access-key",
    R2_SECRET_ACCESS_KEY: "test-secret-key",
    R2_BUCKET_NAME: "test-bucket",
    URL_EXPIRY: 900,
  } as unknown as Env;

  it("generates a valid pre-signed URL with correct structure", async () => {
    const oid = `ef${"0".repeat(62)}`;
    const url = await generateDownloadUrl(mockEnv, "myorg", "myrepo", oid);
    const params = new URL(url).searchParams;

    expect(url).toContain("https://test-account-id.r2.cloudflarestorage.com/test-bucket/");
    expect(url).toContain("myorg/myrepo/ef/");
    expect(params.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(params.get("X-Amz-Expires")).toBe("900");
    expect(params.get("X-Amz-Credential")).toMatch(/^test-access-key\/\d{8}\/auto\/s3\/aws4_request$/);
    expect(params.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("objectExists", () => {
  it("returns true when object exists", async () => {
    const env = {
      LFS_BUCKET: { head: async () => ({ size: 1024 }) },
    } as unknown as Env;

    const result = await objectExists(env, "org", "repo", "a".repeat(64));
    expect(result).toEqual({ exists: true, size: 1024 });
  });

  it("returns false when object does not exist", async () => {
    const env = {
      LFS_BUCKET: { head: async () => null },
    } as unknown as Env;

    const result = await objectExists(env, "org", "repo", "a".repeat(64));
    expect(result).toEqual({ exists: false });
  });

  it("uses correct object key for lookup", async () => {
    let capturedKey: string | undefined;
    const env = {
      LFS_BUCKET: {
        head: async (key: string) => {
          capturedKey = key;
          return null;
        },
      },
    } as unknown as Env;

    const oid = `ab${"c".repeat(62)}`;
    await objectExists(env, "myorg", "myrepo", oid);

    expect(capturedKey).toBe(`myorg/myrepo/ab/${oid}`);
  });
});
