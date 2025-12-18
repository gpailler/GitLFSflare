import { isValidOID, isValidSize } from "../lib/validation.js";
import type { LFSBatchRequest, LFSBatchResponse, LFSObjectRequest, LFSObjectResponse } from "../types/index.js";
import { generateDownloadUrl, generateUploadUrl, objectExists } from "./r2.js";

export const MAX_BATCH_OBJECTS = 100;

export interface ValidationResult {
  valid: boolean;
  error?: string;
  status?: number;
}

export function validateBatchRequest(request: LFSBatchRequest): ValidationResult {
  if (request.operation !== "download" && request.operation !== "upload") {
    return { valid: false, error: "Invalid operation", status: 422 };
  }

  if (!Array.isArray(request.objects) || request.objects.length === 0) {
    return { valid: false, error: "Objects array is required and must not be empty", status: 422 };
  }

  if (request.objects.length > MAX_BATCH_OBJECTS) {
    return { valid: false, error: "Batch request contains too many objects", status: 413 };
  }

  for (const obj of request.objects) {
    if (!isValidOID(obj.oid)) {
      return { valid: false, error: "Invalid OID format", status: 422 };
    }
    if (!isValidSize(obj.size)) {
      return { valid: false, error: "Invalid size", status: 422 };
    }
  }

  if (request.transfers && !request.transfers.includes("basic")) {
    return { valid: false, error: "Only basic transfer adapter is supported", status: 422 };
  }

  if (request.hash_algo !== undefined && request.hash_algo !== "sha256") {
    return { valid: false, error: "Only sha256 hash algorithm is supported", status: 409 };
  }

  return { valid: true };
}

export async function processDownloadObject(
  env: Env,
  org: string,
  repo: string,
  obj: LFSObjectRequest
): Promise<LFSObjectResponse> {
  try {
    const result = await objectExists(env, org, repo, obj.oid);

    if (!result.exists) {
      return {
        oid: obj.oid,
        size: obj.size,
        error: { code: 404, message: "Object not found" },
      };
    }

    if (result.size !== obj.size) {
      return {
        oid: obj.oid,
        size: obj.size,
        error: { code: 422, message: "Object size mismatch" },
      };
    }

    const url = await generateDownloadUrl(env, org, repo, obj.oid);

    return {
      oid: obj.oid,
      size: obj.size,
      authenticated: true,
      actions: {
        download: {
          href: url,
          expires_in: env.URL_EXPIRY,
        },
      },
    };
  } catch {
    return {
      oid: obj.oid,
      size: obj.size,
      error: { code: 500, message: "Storage service error" },
    };
  }
}

export async function processUploadObject(
  env: Env,
  org: string,
  repo: string,
  obj: LFSObjectRequest
): Promise<LFSObjectResponse> {
  try {
    const result = await objectExists(env, org, repo, obj.oid);

    if (result.exists) {
      if (result.size === obj.size) {
        return {
          oid: obj.oid,
          size: obj.size,
          authenticated: true,
        };
      }
      return {
        oid: obj.oid,
        size: obj.size,
        error: { code: 422, message: "Object size mismatch" },
      };
    }

    const url = await generateUploadUrl(env, org, repo, obj.oid);

    return {
      oid: obj.oid,
      size: obj.size,
      authenticated: true,
      actions: {
        upload: {
          href: url,
          expires_in: env.URL_EXPIRY,
        },
      },
    };
  } catch {
    return {
      oid: obj.oid,
      size: obj.size,
      error: { code: 500, message: "Storage service error" },
    };
  }
}

export async function processBatchRequest(
  env: Env,
  org: string,
  repo: string,
  request: LFSBatchRequest
): Promise<LFSBatchResponse> {
  const processObject = request.operation === "download" ? processDownloadObject : processUploadObject;

  const objects = await Promise.all(request.objects.map((obj) => processObject(env, org, repo, obj)));

  const response: LFSBatchResponse = {
    transfer: "basic",
    objects,
  };

  if (request.hash_algo) {
    response.hash_algo = request.hash_algo;
  }

  return response;
}
