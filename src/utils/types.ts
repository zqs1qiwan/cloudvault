// ─── Environment Bindings ─────────────────────────────────────────────
export interface Env {
  VAULT_BUCKET: R2Bucket;
  VAULT_KV: KVNamespace;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string;   // wrangler secret
  SESSION_SECRET: string;   // wrangler secret
  ENVIRONMENT: string;
}

// ─── File Metadata (stored in KV) ─────────────────────────────────────
export interface FileMeta {
  id: string;
  key: string;              // R2 object key (e.g. "photos/sunset.jpg")
  name: string;             // Original filename
  size: number;
  type: string;             // MIME type
  folder: string;           // Virtual folder path (e.g. "photos")
  uploadedAt: string;       // ISO 8601
  shareToken: string | null;
  sharePassword: string | null; // bcrypt-style hash (null = no password)
  shareExpiresAt: string | null; // ISO 8601 or null
  downloads: number;
}

// ─── Share Link Info ──────────────────────────────────────────────────
export interface ShareInfo {
  fileId: string;
  token: string;
  createdAt: string;
  expiresAt: string | null;
  hasPassword: boolean;
}

// ─── Session ──────────────────────────────────────────────────────────
export interface Session {
  id: string;
  createdAt: string;
  expiresAt: string;
}

// ─── API Response Types ───────────────────────────────────────────────
export interface FileListResponse {
  files: FileMeta[];
  cursor: string | null;
  totalFiles: number;
}

export interface StatsResponse {
  totalFiles: number;
  totalSize: number;
  totalDownloads: number;
  recentUploads: FileMeta[];
  topDownloaded: FileMeta[];
}

// ─── API Request Types ────────────────────────────────────────────────
export interface CreateShareRequest {
  fileId: string;
  password?: string;
  expiresInDays?: number;
}

export interface MultipartCreateResponse {
  uploadId: string;
  key: string;
}

export interface MultipartCompleteRequest {
  uploadId: string;
  key: string;
  parts: { partNumber: number; etag: string }[];
}

// ─── KV Key Patterns ─────────────────────────────────────────────────
// file:{id}         → FileMeta JSON
// share:{token}     → fileId string
// session:{id}      → Session JSON
// stats:totalFiles  → number string
// stats:totalSize   → number string

export const KV_PREFIX = {
  FILE: 'file:',
  SHARE: 'share:',
  SESSION: 'session:',
  STATS: 'stats:',
} as const;
