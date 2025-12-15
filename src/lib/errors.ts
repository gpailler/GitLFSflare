import type { HTTPErrorOptions, LFSErrorResponse } from "../types/index.js";

export class HTTPError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(options: HTTPErrorOptions) {
    super(options.message);
    this.name = "HTTPError";
    this.status = options.status;
    this.code = options.code;
  }

  toResponse(): Response {
    const body: { message: string; code?: string } = { message: this.message };
    if (this.code) {
      body.code = this.code;
    }
    return new Response(JSON.stringify(body), {
      status: this.status,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export class LFSError extends HTTPError {
  constructor(status: number, message: string) {
    super({ status, message });
    this.name = "LFSError";
  }

  toLFSResponse(): Response {
    return new Response(JSON.stringify(this.toJSON()), {
      status: this.status,
      headers: { "Content-Type": "application/vnd.git-lfs+json" },
    });
  }

  toJSON(): LFSErrorResponse {
    return { message: this.message };
  }
}
