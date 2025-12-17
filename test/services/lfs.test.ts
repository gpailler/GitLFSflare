import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  processBatchRequest,
  processDownloadObject,
  processUploadObject,
  validateBatchRequest,
} from "../../src/services/lfs.js";
import * as r2 from "../../src/services/r2.js";
import type { LFSBatchRequest, LFSObjectRequest } from "../../src/types/index.js";

// Mock r2 module
vi.mock("../../src/services/r2.js", () => ({
  objectExists: vi.fn(),
  generateDownloadUrl: vi.fn(),
  generateUploadUrl: vi.fn(),
  generateObjectKey: vi.fn(),
}));

// Test constants
const VALID_OID = "a".repeat(64);
const VALID_OID_2 = "b".repeat(64);
const VALID_SIZE = 1024;
const TEST_ORG = "test-org";
const TEST_REPO = "test-repo";
const TEST_URL_EXPIRY = 600;
const MOCK_SIGNED_URL = "https://r2.cloudflarestorage.com/bucket/object?signed";

const createMockEnv = (overrides: Record<string, unknown> = {}) =>
  ({
    URL_EXPIRY: TEST_URL_EXPIRY,
    ...overrides,
  }) as unknown as Env;

describe("LFS Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateBatchRequest", () => {
    describe("valid requests", () => {
      it.each([
        ["download operation", { operation: "download", objects: [{ oid: VALID_OID, size: VALID_SIZE }] }],
        ["upload operation", { operation: "upload", objects: [{ oid: VALID_OID, size: VALID_SIZE }] }],
        [
          "multiple objects",
          {
            operation: "download",
            objects: [
              { oid: VALID_OID, size: VALID_SIZE },
              { oid: VALID_OID_2, size: 2048 },
            ],
          },
        ],
        ["size of zero", { operation: "upload", objects: [{ oid: VALID_OID, size: 0 }] }],
      ])("accepts %s", (_, request) => {
        const result = validateBatchRequest(request as LFSBatchRequest);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it.each([
        ["transfers", { transfers: ["basic"] }],
        ["ref", { ref: { name: "refs/heads/main" } }],
        ["hash_algo", { hash_algo: "sha256" }],
      ])("accepts request with optional %s field", (_, optionalField) => {
        const request: LFSBatchRequest = {
          operation: "download",
          objects: [{ oid: VALID_OID, size: VALID_SIZE }],
          ...optionalField,
        };
        const result = validateBatchRequest(request);
        expect(result.valid).toBe(true);
      });
    });

    describe("invalid operation", () => {
      it.each([
        ["missing operation", undefined],
        ["invalid operation string", "invalid"],
        ["empty string", ""],
        ["mixed case", "Download"],
      ])("rejects %s", (_, operation) => {
        const request = {
          operation,
          objects: [{ oid: VALID_OID, size: VALID_SIZE }],
        } as LFSBatchRequest;
        const result = validateBatchRequest(request);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    describe("invalid objects array", () => {
      it.each([
        ["missing objects", { operation: "download" }],
        ["empty objects array", { operation: "download", objects: [] }],
        ["non-array objects", { operation: "download", objects: "not-an-array" }],
      ])("rejects %s", (_, request) => {
        const result = validateBatchRequest(request as unknown as LFSBatchRequest);
        expect(result.valid).toBe(false);
      });
    });

    describe("invalid object OID", () => {
      it.each([
        ["missing oid", undefined],
        ["empty oid", ""],
        ["too short", "abc123"],
        ["too long", "a".repeat(65)],
        ["uppercase hex", "A".repeat(64)],
        ["non-hex characters", "g".repeat(64)],
        ["mixed case", "A".repeat(32) + "a".repeat(32)],
      ])("rejects %s", (_, oid) => {
        const request: LFSBatchRequest = {
          operation: "download",
          objects: [{ oid: oid as string, size: VALID_SIZE }],
        };
        const result = validateBatchRequest(request);
        expect(result.valid).toBe(false);
      });
    });

    describe("invalid object size", () => {
      it.each([
        ["missing size", undefined],
        ["negative size", -1],
        ["float size", 1.5],
        ["string size", "1024"],
        ["NaN", Number.NaN],
        ["Infinity", Number.POSITIVE_INFINITY],
      ])("rejects %s", (_, size) => {
        const request: LFSBatchRequest = {
          operation: "download",
          objects: [{ oid: VALID_OID, size: size as number }],
        };
        const result = validateBatchRequest(request);
        expect(result.valid).toBe(false);
      });
    });

    describe("unsupported transfers", () => {
      it("rejects non-basic transfer adapter", () => {
        const request: LFSBatchRequest = {
          operation: "download",
          transfers: ["tus"],
          objects: [{ oid: VALID_OID, size: VALID_SIZE }],
        };
        const result = validateBatchRequest(request);
        expect(result.valid).toBe(false);
        expect(result.error).toContain("transfer");
      });

      it("accepts if basic is one of the transfers", () => {
        const request: LFSBatchRequest = {
          operation: "download",
          transfers: ["tus", "basic", "custom"],
          objects: [{ oid: VALID_OID, size: VALID_SIZE }],
        };
        const result = validateBatchRequest(request);
        expect(result.valid).toBe(true);
      });
    });

    describe("invalid hash_algo", () => {
      it.each([
        ["sha512", "sha512"],
        ["md5", "md5"],
        ["sha1", "sha1"],
        ["empty string", ""],
        ["arbitrary string", "invalid"],
      ])("rejects %s hash algorithm", (_, hashAlgo) => {
        const request: LFSBatchRequest = {
          operation: "download",
          objects: [{ oid: VALID_OID, size: VALID_SIZE }],
          hash_algo: hashAlgo,
        };
        const result = validateBatchRequest(request);
        expect(result.valid).toBe(false);
        expect(result.error).toContain("sha256");
      });

      it("accepts undefined hash_algo (defaults to sha256)", () => {
        const request: LFSBatchRequest = {
          operation: "download",
          objects: [{ oid: VALID_OID, size: VALID_SIZE }],
        };
        const result = validateBatchRequest(request);
        expect(result.valid).toBe(true);
      });

      it("accepts explicit sha256 hash_algo", () => {
        const request: LFSBatchRequest = {
          operation: "download",
          objects: [{ oid: VALID_OID, size: VALID_SIZE }],
          hash_algo: "sha256",
        };
        const result = validateBatchRequest(request);
        expect(result.valid).toBe(true);
      });
    });
  });

  describe("processDownloadObject", () => {
    const env = createMockEnv();

    it("returns download action for existing object", async () => {
      const obj: LFSObjectRequest = { oid: VALID_OID, size: VALID_SIZE };
      vi.mocked(r2.objectExists).mockResolvedValue({ exists: true, size: VALID_SIZE });
      vi.mocked(r2.generateDownloadUrl).mockResolvedValue(MOCK_SIGNED_URL);

      const result = await processDownloadObject(env, TEST_ORG, TEST_REPO, obj);

      expect(result.oid).toBe(VALID_OID);
      expect(result.size).toBe(VALID_SIZE);
      expect(result.authenticated).toBe(true);
      expect(result.actions?.download).toBeDefined();
      expect(result.actions?.download?.href).toBe(MOCK_SIGNED_URL);
      expect(result.actions?.download?.expires_in).toBe(TEST_URL_EXPIRY);
      expect(result.error).toBeUndefined();
    });

    it("returns 404 error for non-existent object", async () => {
      const obj: LFSObjectRequest = { oid: VALID_OID, size: VALID_SIZE };
      vi.mocked(r2.objectExists).mockResolvedValue({ exists: false });

      const result = await processDownloadObject(env, TEST_ORG, TEST_REPO, obj);

      expect(result.oid).toBe(VALID_OID);
      expect(result.size).toBe(VALID_SIZE);
      expect(result.actions).toBeUndefined();
      expect(result.error).toEqual({
        code: 404,
        message: "Object not found",
      });
    });

    it("returns 422 error for size mismatch", async () => {
      const obj: LFSObjectRequest = { oid: VALID_OID, size: VALID_SIZE };
      vi.mocked(r2.objectExists).mockResolvedValue({ exists: true, size: 2048 });

      const result = await processDownloadObject(env, TEST_ORG, TEST_REPO, obj);

      expect(result.error).toEqual({
        code: 422,
        message: "Object size mismatch",
      });
    });

    it("calls objectExists with correct parameters", async () => {
      const obj: LFSObjectRequest = { oid: VALID_OID, size: VALID_SIZE };
      vi.mocked(r2.objectExists).mockResolvedValue({ exists: true, size: VALID_SIZE });
      vi.mocked(r2.generateDownloadUrl).mockResolvedValue(MOCK_SIGNED_URL);

      await processDownloadObject(env, TEST_ORG, TEST_REPO, obj);

      expect(r2.objectExists).toHaveBeenCalledWith(env, TEST_ORG, TEST_REPO, VALID_OID);
    });
  });

  describe("processUploadObject", () => {
    const env = createMockEnv();

    it("returns upload action for non-existent object", async () => {
      const obj: LFSObjectRequest = { oid: VALID_OID, size: VALID_SIZE };
      vi.mocked(r2.objectExists).mockResolvedValue({ exists: false });
      vi.mocked(r2.generateUploadUrl).mockResolvedValue(MOCK_SIGNED_URL);

      const result = await processUploadObject(env, TEST_ORG, TEST_REPO, obj);

      expect(result.oid).toBe(VALID_OID);
      expect(result.size).toBe(VALID_SIZE);
      expect(result.authenticated).toBe(true);
      expect(result.actions?.upload).toBeDefined();
      expect(result.actions?.upload?.href).toBe(MOCK_SIGNED_URL);
      expect(result.actions?.upload?.expires_in).toBe(TEST_URL_EXPIRY);
      expect(result.error).toBeUndefined();
    });

    it("returns no actions for already existing object with same size", async () => {
      const obj: LFSObjectRequest = { oid: VALID_OID, size: VALID_SIZE };
      vi.mocked(r2.objectExists).mockResolvedValue({ exists: true, size: VALID_SIZE });

      const result = await processUploadObject(env, TEST_ORG, TEST_REPO, obj);

      expect(result.oid).toBe(VALID_OID);
      expect(result.size).toBe(VALID_SIZE);
      expect(result.authenticated).toBe(true);
      expect(result.actions).toBeUndefined();
      expect(result.error).toBeUndefined();
    });

    it("returns upload action for existing object with different size", async () => {
      const obj: LFSObjectRequest = { oid: VALID_OID, size: VALID_SIZE };
      vi.mocked(r2.objectExists).mockResolvedValue({ exists: true, size: 2048 });
      vi.mocked(r2.generateUploadUrl).mockResolvedValue(MOCK_SIGNED_URL);

      const result = await processUploadObject(env, TEST_ORG, TEST_REPO, obj);

      expect(result.actions?.upload).toBeDefined();
    });

    it("calls objectExists with correct parameters", async () => {
      const obj: LFSObjectRequest = { oid: VALID_OID, size: VALID_SIZE };
      vi.mocked(r2.objectExists).mockResolvedValue({ exists: false });
      vi.mocked(r2.generateUploadUrl).mockResolvedValue(MOCK_SIGNED_URL);

      await processUploadObject(env, TEST_ORG, TEST_REPO, obj);

      expect(r2.objectExists).toHaveBeenCalledWith(env, TEST_ORG, TEST_REPO, VALID_OID);
    });
  });

  describe("processBatchRequest", () => {
    const env = createMockEnv();

    describe("download operation", () => {
      it("processes download request with existing objects", async () => {
        const request: LFSBatchRequest = {
          operation: "download",
          objects: [
            { oid: VALID_OID, size: VALID_SIZE },
            { oid: VALID_OID_2, size: 2048 },
          ],
        };
        vi.mocked(r2.objectExists)
          .mockResolvedValueOnce({ exists: true, size: VALID_SIZE })
          .mockResolvedValueOnce({ exists: true, size: 2048 });
        vi.mocked(r2.generateDownloadUrl).mockResolvedValue(MOCK_SIGNED_URL);

        const result = await processBatchRequest(env, TEST_ORG, TEST_REPO, request);

        expect(result.transfer).toBe("basic");
        expect(result.objects).toHaveLength(2);
        expect(result.objects.at(0)?.actions?.download).toBeDefined();
        expect(result.objects.at(1)?.actions?.download).toBeDefined();
      });

      it("handles mixed existing and missing objects", async () => {
        const request: LFSBatchRequest = {
          operation: "download",
          objects: [
            { oid: VALID_OID, size: VALID_SIZE },
            { oid: VALID_OID_2, size: 2048 },
          ],
        };
        vi.mocked(r2.objectExists)
          .mockResolvedValueOnce({ exists: true, size: VALID_SIZE })
          .mockResolvedValueOnce({ exists: false });
        vi.mocked(r2.generateDownloadUrl).mockResolvedValue(MOCK_SIGNED_URL);

        const result = await processBatchRequest(env, TEST_ORG, TEST_REPO, request);

        expect(result.objects.at(0)?.actions?.download).toBeDefined();
        expect(result.objects.at(0)?.error).toBeUndefined();
        expect(result.objects.at(1)?.error?.code).toBe(404);
        expect(result.objects.at(1)?.actions).toBeUndefined();
      });
    });

    describe("upload operation", () => {
      it("processes upload request with new objects", async () => {
        const request: LFSBatchRequest = {
          operation: "upload",
          objects: [{ oid: VALID_OID, size: VALID_SIZE }],
        };
        vi.mocked(r2.objectExists).mockResolvedValue({ exists: false });
        vi.mocked(r2.generateUploadUrl).mockResolvedValue(MOCK_SIGNED_URL);

        const result = await processBatchRequest(env, TEST_ORG, TEST_REPO, request);

        expect(result.transfer).toBe("basic");
        expect(result.objects.at(0)?.actions?.upload).toBeDefined();
      });

      it("skips upload for already existing objects", async () => {
        const request: LFSBatchRequest = {
          operation: "upload",
          objects: [{ oid: VALID_OID, size: VALID_SIZE }],
        };
        vi.mocked(r2.objectExists).mockResolvedValue({ exists: true, size: VALID_SIZE });

        const result = await processBatchRequest(env, TEST_ORG, TEST_REPO, request);

        expect(result.objects.at(0)?.actions).toBeUndefined();
        expect(result.objects.at(0)?.error).toBeUndefined();
      });
    });

    describe("response format", () => {
      it("includes transfer field set to basic", async () => {
        const request: LFSBatchRequest = {
          operation: "download",
          objects: [{ oid: VALID_OID, size: VALID_SIZE }],
        };
        vi.mocked(r2.objectExists).mockResolvedValue({ exists: true, size: VALID_SIZE });
        vi.mocked(r2.generateDownloadUrl).mockResolvedValue(MOCK_SIGNED_URL);

        const result = await processBatchRequest(env, TEST_ORG, TEST_REPO, request);

        expect(result.transfer).toBe("basic");
      });

      it("includes hash_algo if provided in request", async () => {
        const request: LFSBatchRequest = {
          operation: "download",
          hash_algo: "sha256",
          objects: [{ oid: VALID_OID, size: VALID_SIZE }],
        };
        vi.mocked(r2.objectExists).mockResolvedValue({ exists: true, size: VALID_SIZE });
        vi.mocked(r2.generateDownloadUrl).mockResolvedValue(MOCK_SIGNED_URL);

        const result = await processBatchRequest(env, TEST_ORG, TEST_REPO, request);

        expect(result.hash_algo).toBe("sha256");
      });

      it("returns objects in same order as request", async () => {
        const request: LFSBatchRequest = {
          operation: "download",
          objects: [
            { oid: VALID_OID, size: VALID_SIZE },
            { oid: VALID_OID_2, size: 2048 },
          ],
        };
        vi.mocked(r2.objectExists)
          .mockResolvedValueOnce({ exists: true, size: VALID_SIZE })
          .mockResolvedValueOnce({ exists: true, size: 2048 });
        vi.mocked(r2.generateDownloadUrl).mockResolvedValue(MOCK_SIGNED_URL);

        const result = await processBatchRequest(env, TEST_ORG, TEST_REPO, request);

        expect(result.objects.at(0)?.oid).toBe(VALID_OID);
        expect(result.objects.at(1)?.oid).toBe(VALID_OID_2);
      });
    });

    describe("per-object error handling", () => {
      it("does not fail batch for individual object errors", async () => {
        const request: LFSBatchRequest = {
          operation: "download",
          objects: [
            { oid: VALID_OID, size: VALID_SIZE },
            { oid: VALID_OID_2, size: 2048 },
          ],
        };
        vi.mocked(r2.objectExists)
          .mockResolvedValueOnce({ exists: false })
          .mockResolvedValueOnce({ exists: true, size: 2048 });
        vi.mocked(r2.generateDownloadUrl).mockResolvedValue(MOCK_SIGNED_URL);

        const result = await processBatchRequest(env, TEST_ORG, TEST_REPO, request);

        expect(result.transfer).toBe("basic");
        expect(result.objects.at(0)?.error?.code).toBe(404);
        expect(result.objects.at(1)?.actions?.download).toBeDefined();
      });

      it("handles all objects missing gracefully", async () => {
        const request: LFSBatchRequest = {
          operation: "download",
          objects: [
            { oid: VALID_OID, size: VALID_SIZE },
            { oid: VALID_OID_2, size: 2048 },
          ],
        };
        vi.mocked(r2.objectExists).mockResolvedValue({ exists: false });

        const result = await processBatchRequest(env, TEST_ORG, TEST_REPO, request);

        expect(result.objects.at(0)?.error?.code).toBe(404);
        expect(result.objects.at(1)?.error?.code).toBe(404);
      });
    });

    describe("action format", () => {
      it.each([
        ["download", "download"],
        ["upload", "upload"],
      ])("includes expires_in in %s action", async (operation, actionKey) => {
        const request: LFSBatchRequest = {
          operation: operation as "download" | "upload",
          objects: [{ oid: VALID_OID, size: VALID_SIZE }],
        };
        if (operation === "download") {
          vi.mocked(r2.objectExists).mockResolvedValue({ exists: true, size: VALID_SIZE });
          vi.mocked(r2.generateDownloadUrl).mockResolvedValue(MOCK_SIGNED_URL);
        } else {
          vi.mocked(r2.objectExists).mockResolvedValue({ exists: false });
          vi.mocked(r2.generateUploadUrl).mockResolvedValue(MOCK_SIGNED_URL);
        }

        const result = await processBatchRequest(env, TEST_ORG, TEST_REPO, request);

        const action = result.objects.at(0)?.actions?.[actionKey as "download" | "upload"];
        expect(action?.expires_in).toBe(TEST_URL_EXPIRY);
      });

      it("uses URL_EXPIRY from env for expires_in", async () => {
        const customEnv = createMockEnv({ URL_EXPIRY: 3600 });
        const request: LFSBatchRequest = {
          operation: "download",
          objects: [{ oid: VALID_OID, size: VALID_SIZE }],
        };
        vi.mocked(r2.objectExists).mockResolvedValue({ exists: true, size: VALID_SIZE });
        vi.mocked(r2.generateDownloadUrl).mockResolvedValue(MOCK_SIGNED_URL);

        const result = await processBatchRequest(customEnv, TEST_ORG, TEST_REPO, request);

        expect(result.objects.at(0)?.actions?.download?.expires_in).toBe(3600);
      });
    });
  });
});
