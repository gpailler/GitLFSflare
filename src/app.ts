import { Hono } from "hono";
import { validateOrganization } from "./lib/index.js";
import { extractToken } from "./services/auth.js";
import { withCache } from "./services/cache.js";
import { GitHubRateLimitError, getRepositoryPermission, hasOperationPermission } from "./services/github.js";
import { processBatchRequest, validateBatchRequest } from "./services/lfs.js";
import type { LFSBatchRequest } from "./types/index.js";

const LFS_CONTENT_TYPE = "application/vnd.git-lfs+json";

export const app = new Hono<{ Bindings: Env }>();

function lfsJson(c: { json: (data: unknown, status?: number) => Response }, data: unknown, status = 200): Response {
  const response = c.json(data, status);
  response.headers.set("Content-Type", LFS_CONTENT_TYPE);
  return response;
}

// Health check endpoint
app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

// LFS Batch API endpoint
app.post("/:org/:repoGit/info/lfs/objects/batch", async (c) => {
  const { org, repoGit } = c.req.param();
  const repo = repoGit.replace(/\.git$/, "");

  // 1. Extract and validate token
  const token = extractToken(c.req.raw);
  if (!token) {
    const response = lfsJson(c, { message: "Authentication required" }, 401);
    response.headers.set("LFS-Authenticate", 'Basic realm="Git LFS"');
    return response;
  }

  // 2. Validate organization (format + allowlist)
  if (!validateOrganization(c.env, org)) {
    return lfsJson(c, { message: "Organization not allowed" }, 403);
  }

  // 3. Get GitHub permission (with caching)
  const getCachedPermission = withCache(c.env, getRepositoryPermission);
  let permission: Awaited<ReturnType<typeof getRepositoryPermission>>;
  try {
    permission = await getCachedPermission(token, org, repo);
  } catch (error) {
    if (error instanceof GitHubRateLimitError) {
      const retryAfter =
        error.retryAfter ?? (error.resetAt ? error.resetAt - Math.floor(Date.now() / 1000) : undefined);
      const response = lfsJson(c, { message: "Rate limit exceeded" }, 429);
      if (retryAfter !== undefined) {
        response.headers.set("Retry-After", String(retryAfter));
      }
      return response;
    }
    if (error instanceof Error && error.message.includes("GitHub API error:")) {
      return lfsJson(c, { message: "Upstream service error" }, 502);
    }
    return lfsJson(c, { message: "Internal server error" }, 500);
  }

  // 4. Check permission level (no access)
  if (permission === "none") {
    return lfsJson(c, { message: "Access denied" }, 403);
  }

  // 5. Parse request body
  let body: LFSBatchRequest;
  try {
    body = await c.req.json();
  } catch {
    return lfsJson(c, { message: "Invalid JSON body" }, 422);
  }

  // 6. Validate batch request
  const validation = validateBatchRequest(body);
  if (!validation.valid) {
    return lfsJson(c, { message: validation.error }, 422);
  }

  // 7. Check operation permission
  if (!hasOperationPermission(permission, body.operation)) {
    return lfsJson(c, { message: "Insufficient permissions for this operation" }, 403);
  }

  // 8. Process batch request
  const response = await processBatchRequest(c.env, org, repo, body);
  return lfsJson(c, response, 200);
});
