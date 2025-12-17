const OID_REGEX = /^[0-9a-f]{64}$/;
const ORG_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;
const MAX_ORG_LENGTH = 255;
const REPO_NAME_REGEX = /^[a-zA-Z0-9_.-]+$/;
const MAX_REPO_LENGTH = 100;

export function isValidOID(oid: string): boolean {
  return OID_REGEX.test(oid);
}

export function isValidSize(size: number): boolean {
  return Number.isInteger(size) && size >= 0;
}

export function parseAllowedOrgs(allowedOrgs: string): string[] {
  return allowedOrgs
    .split(",")
    .map((org) => org.trim())
    .filter((org) => org.length > 0);
}

export function validateOrganization(env: Env, org: string): boolean {
  if (!org || org.length > MAX_ORG_LENGTH) {
    return false;
  }

  if (!ORG_NAME_REGEX.test(org)) {
    return false;
  }

  const allowedOrgs = parseAllowedOrgs(env.ALLOWED_ORGS);
  return allowedOrgs.includes(org);
}

export function validateRepoName(repo: string): boolean {
  if (!repo || repo.length > MAX_REPO_LENGTH) {
    return false;
  }

  if (!REPO_NAME_REGEX.test(repo)) {
    return false;
  }

  // Cannot start with a period
  if (repo.startsWith(".")) {
    return false;
  }

  return true;
}
