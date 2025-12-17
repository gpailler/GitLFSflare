import { Hono } from "hono";

export const app = new Hono<{ Bindings: Env }>();

// Health check endpoint
app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

// LFS Batch API endpoint - stub implementation
app.post("/:org/:repo.git/info/lfs/objects/batch", async (c) => {
  // TODO: Implement authentication, org validation, permission checking, and batch processing
  return c.json({ message: "Not implemented" }, 501);
});
