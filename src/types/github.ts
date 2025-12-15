export type PermissionLevel = "admin" | "write" | "read" | "none";

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  permissions?: {
    admin: boolean;
    push: boolean;
    pull: boolean;
  };
}

export interface AuthResult {
  permission: PermissionLevel;
  org: string;
  repo: string;
}
