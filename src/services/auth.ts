export interface ParsedAuth {
  type: "bearer" | "basic";
  token: string;
}

const VALID_PREFIXES = ["ghp_", "github_pat_", "ghs_"];
const MAX_TOKEN_LENGTH = 1000;
const TOKEN_CHAR_REGEX = /^[a-zA-Z0-9_]+$/;

export function parseAuthHeader(header: string | null): ParsedAuth | null {
  if (!header) return null;

  const lowerHeader = header.toLowerCase();

  if (lowerHeader.startsWith("bearer ")) {
    const token = header.slice(7);
    if (!token) return null;
    return { type: "bearer", token };
  }

  if (lowerHeader.startsWith("basic ")) {
    const encoded = header.slice(6);
    if (!encoded) return null;

    try {
      const decoded = atob(encoded);
      const colonIndex = decoded.indexOf(":");
      if (colonIndex === -1) return null;
      const token = decoded.slice(colonIndex + 1);
      return { type: "basic", token };
    } catch {
      return null;
    }
  }

  return null;
}

export function validateTokenFormat(token: string): boolean {
  if (!token || token.length > MAX_TOKEN_LENGTH) return false;

  const prefix = VALID_PREFIXES.find((p) => token.startsWith(p));
  if (!prefix) return false;

  const suffix = token.slice(prefix.length);
  if (!suffix) return false;

  return TOKEN_CHAR_REGEX.test(suffix);
}

export function extractToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  const parsed = parseAuthHeader(header);
  if (!parsed) return null;

  return validateTokenFormat(parsed.token) ? parsed.token : null;
}
