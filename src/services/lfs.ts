import { isValidOID, isValidSize } from "../lib/validation.js";
import type { LFSBatchRequest, LFSBatchResponse, LFSObjectRequest, LFSObjectResponse } from "../types/index.js";
import { generateDownloadUrl, generateUploadUrl, objectExists } from "./r2.js";

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateBatchRequest(request: LFSBatchRequest): ValidationResult {
  if (request.operation !== "download" && request.operation !== "upload") {
    return { valid: false, error: "Invalid operation" };
  }

  if (!Array.isArray(request.objects) || request.objects.length === 0) {
    return { valid: false, error: "Objects array is required and must not be empty" };
  }

  for (const obj of request.objects) {
    if (!isValidOID(obj.oid)) {
      return { valid: false, error: "Invalid OID format" };
    }
    if (!isValidSize(obj.size)) {
      return { valid: false, error: "Invalid size" };
    }
  }

  if (request.transfers && !request.transfers.includes("basic")) {
    return { valid: false, error: "Only basic transfer adapter is supported" };
  }

  return { valid: true };
}

export async function processDownloadObject(
  env: Env,
  org: string,
  repo: string,
  obj: LFSObjectRequest
): Promise<LFSObjectResponse> {
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
  const expiresIn = Number.parseInt(env.URL_EXPIRY, 10);

  return {
    oid: obj.oid,
    size: obj.size,
    actions: {
      download: {
        href: url,
        expires_in: expiresIn,
      },
    },
  };
}

export async function processUploadObject(
  env: Env,
  org: string,
  repo: string,
  obj: LFSObjectRequest
): Promise<LFSObjectResponse> {
  const result = await objectExists(env, org, repo, obj.oid);

  if (result.exists && result.size === obj.size) {
    return {
      oid: obj.oid,
      size: obj.size,
    };
  }

  const url = await generateUploadUrl(env, org, repo, obj.oid, obj.size);
  const expiresIn = Number.parseInt(env.URL_EXPIRY, 10);

  return {
    oid: obj.oid,
    size: obj.size,
    actions: {
      upload: {
        href: url,
        expires_in: expiresIn,
      },
    },
  };
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
