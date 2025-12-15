declare global {
  interface Env {
    // Secrets (set via `wrangler secret put`)
    CLOUDFLARE_ACCOUNT_ID: string;
    R2_ACCESS_KEY_ID: string;
    R2_SECRET_ACCESS_KEY: string;
  }
}

export {};
