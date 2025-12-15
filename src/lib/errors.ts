import type { HTTPErrorOptions, LFSErrorResponse } from "../types/index.js";

export class HTTPError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(_options: HTTPErrorOptions) {
    // Stub: doesn't properly initialize (tests will fail)
    super("");
    this.status = 0;
    this.code = undefined;
  }

  toResponse(): Response {
    // Stub: returns empty response (tests will fail)
    return new Response();
  }
}

export class LFSError extends HTTPError {
  constructor(_status: number, _message: string) {
    // Stub: doesn't properly initialize (tests will fail)
    super({ status: 0, message: "" });
  }

  toLFSResponse(): Response {
    // Stub: returns empty response (tests will fail)
    return new Response();
  }

  toJSON(): LFSErrorResponse {
    // Stub: returns empty object (tests will fail)
    return { message: "" };
  }
}
