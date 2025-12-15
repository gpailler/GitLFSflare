export type LFSOperation = "upload" | "download";

export interface LFSObjectRequest {
  oid: string;
  size: number;
}

export interface LFSBatchRequest {
  operation: LFSOperation;
  transfers?: string[];
  ref?: { name: string };
  objects: LFSObjectRequest[];
  hash_algo?: string;
}

export interface LFSAction {
  href: string;
  header?: Record<string, string>;
  expires_in?: number;
  expires_at?: string;
}

export interface LFSObjectResponse {
  oid: string;
  size: number;
  authenticated?: boolean;
  actions?: {
    upload?: LFSAction;
    download?: LFSAction;
    verify?: LFSAction;
  };
  error?: {
    code: number;
    message: string;
  };
}

export interface LFSBatchResponse {
  transfer?: string;
  objects: LFSObjectResponse[];
  hash_algo?: string;
}
