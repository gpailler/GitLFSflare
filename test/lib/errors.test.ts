import { describe, expect, it } from "vitest";
import { HTTPError, LFSError } from "../../src/lib/errors.js";

describe("HTTPError", () => {
  describe("constructor", () => {
    it.each([
      [400, "Bad Request"],
      [401, "Unauthorized"],
      [403, "Forbidden"],
      [404, "Not Found"],
      [422, "Unprocessable Entity"],
      [500, "Internal Server Error"],
    ])("creates error with status %d and message '%s'", (status, message) => {
      const error = new HTTPError({ status, message });
      expect(error.status).toBe(status);
      expect(error.message).toBe(message);
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(HTTPError);
    });

    it("supports optional error code", () => {
      const error = new HTTPError({ status: 400, message: "Bad Request", code: "INVALID_INPUT" });
      expect(error.code).toBe("INVALID_INPUT");
    });

    it("has undefined code when not provided", () => {
      const error = new HTTPError({ status: 400, message: "Bad Request" });
      expect(error.code).toBeUndefined();
    });
  });

  describe("toResponse", () => {
    it("returns Response with correct status", () => {
      const error = new HTTPError({ status: 403, message: "Forbidden" });
      const response = error.toResponse();
      expect(response.status).toBe(403);
    });

    it("returns Response with JSON content type", () => {
      const error = new HTTPError({ status: 400, message: "Bad Request" });
      const response = error.toResponse();
      expect(response.headers.get("Content-Type")).toBe("application/json");
    });

    it("returns Response with error message in body", async () => {
      const error = new HTTPError({ status: 404, message: "Not Found" });
      const response = error.toResponse();
      const body = await response.json();
      expect(body).toEqual({ message: "Not Found" });
    });

    it("includes error code in body when provided", async () => {
      const error = new HTTPError({ status: 400, message: "Invalid", code: "VALIDATION_ERROR" });
      const response = error.toResponse();
      const body = await response.json();
      expect(body).toEqual({ message: "Invalid", code: "VALIDATION_ERROR" });
    });
  });

  describe("error inheritance", () => {
    it("can be caught as Error", () => {
      const error = new HTTPError({ status: 500, message: "Server Error" });
      expect(() => {
        throw error;
      }).toThrow(Error);
    });

    it("has correct name property", () => {
      const error = new HTTPError({ status: 400, message: "Bad Request" });
      expect(error.name).toBe("HTTPError");
    });

    it("has stack trace", () => {
      const error = new HTTPError({ status: 400, message: "Bad Request" });
      expect(error.stack).toBeDefined();
    });
  });
});

describe("LFSError", () => {
  describe("constructor", () => {
    it.each([
      [400, "Bad Request"],
      [401, "Credentials needed"],
      [403, "Forbidden"],
      [404, "Object not found"],
      [422, "Validation failed"],
      [500, "Internal server error"],
    ])("creates LFS error with status %d and message '%s'", (status, message) => {
      const error = new LFSError(status, message);
      expect(error.status).toBe(status);
      expect(error.message).toBe(message);
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(HTTPError);
      expect(error).toBeInstanceOf(LFSError);
    });
  });

  describe("toLFSResponse", () => {
    it("returns Response with correct status", () => {
      const error = new LFSError(403, "Forbidden");
      const response = error.toLFSResponse();
      expect(response.status).toBe(403);
    });

    it("returns Response with LFS content type", () => {
      const error = new LFSError(400, "Bad Request");
      const response = error.toLFSResponse();
      expect(response.headers.get("Content-Type")).toBe("application/vnd.git-lfs+json");
    });

    it("returns Response with LFS error format in body", async () => {
      const error = new LFSError(404, "Object not found");
      const response = error.toLFSResponse();
      const body = await response.json();
      expect(body).toEqual({
        message: "Object not found",
      });
    });
  });

  describe("toJSON", () => {
    it("returns LFS error response format", () => {
      const error = new LFSError(404, "Object not found");
      expect(error.toJSON()).toEqual({
        message: "Object not found",
      });
    });

    it("message is minimal (no sensitive information)", () => {
      const error = new LFSError(403, "Organization not allowed");
      const json = error.toJSON();
      expect(json.message).toBe("Organization not allowed");
      expect(json.message).not.toContain("myorg");
      expect(json.message).not.toContain("token");
    });
  });

  describe("error inheritance", () => {
    it("can be caught as HTTPError", () => {
      const error = new LFSError(500, "Server Error");
      expect(error).toBeInstanceOf(HTTPError);
    });

    it("has correct name property", () => {
      const error = new LFSError(400, "Bad Request");
      expect(error.name).toBe("LFSError");
    });
  });
});
