import { AwsV4Signer } from "aws4fetch";

export interface ObjectExistsResult {
  exists: boolean;
  size?: number;
}

export function generateObjectKey(org: string, repo: string, oid: string): string {
  const shardPrefix = oid.slice(0, 2);
  return `${org}/${repo}/${shardPrefix}/${oid}`;
}

async function generatePresignedUrl(env: Env, objectKey: string, method: "GET" | "PUT"): Promise<string> {
  const url = new URL(
    `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${objectKey}`
  );
  url.searchParams.set("X-Amz-Expires", String(env.URL_EXPIRY));

  const signer = new AwsV4Signer({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    url: url.toString(),
    method,
    service: "s3",
    region: "auto",
    signQuery: true,
  });

  const signedRequest = await signer.sign();
  return signedRequest.url.toString();
}

export async function generateUploadUrl(env: Env, org: string, repo: string, oid: string): Promise<string> {
  const objectKey = generateObjectKey(org, repo, oid);
  return generatePresignedUrl(env, objectKey, "PUT");
}

export async function generateDownloadUrl(env: Env, org: string, repo: string, oid: string): Promise<string> {
  const objectKey = generateObjectKey(org, repo, oid);
  return generatePresignedUrl(env, objectKey, "GET");
}

export async function objectExists(env: Env, org: string, repo: string, oid: string): Promise<ObjectExistsResult> {
  const objectKey = generateObjectKey(org, repo, oid);
  const head = await env.LFS_BUCKET.head(objectKey);

  if (!head) {
    return { exists: false };
  }

  return { exists: true, size: head.size };
}
