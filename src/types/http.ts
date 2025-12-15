export interface HTTPErrorOptions {
  status: number;
  message: string;
  code?: string;
}

export interface LFSErrorResponse {
  message: string;
  documentation_url?: string;
  request_id?: string;
}
