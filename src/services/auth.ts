export interface ParsedAuth {
  type: "bearer" | "basic";
  token: string;
}

export function parseAuthHeader(_header: string | null): ParsedAuth | null {
  throw new Error("Not implemented");
}

export function validateTokenFormat(_token: string): boolean {
  throw new Error("Not implemented");
}

export function extractToken(_request: Request): string | null {
  throw new Error("Not implemented");
}
