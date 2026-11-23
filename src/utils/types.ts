// ─── Environment Bindings ─────────────────────────────────────────────
export interface Env extends Cloudflare.Env {
  /**
   * Legacy single-password secret. Only read once, to seed the first account
   * on an existing deployment; accounts live in KV and are managed by the app.
   */
  ADMIN_PASSWORD?: string;
  /** Optional HMAC key for share-link cookies; falls back to a KV-held secret. */
  SESSION_SECRET?: string;
}

// ─── File Metadata ────────────────────────────────────────────────────
//
// A file is an R2 object; this is a *view* of one, built on demand from the
// object itself. Nothing here is persisted separately - `key` is the identity
// (`id` mirrors it for the UI), and everything else comes from R2 headers,
// `customMetadata.uploadedAt`, or the share record that points at the key.
export interface FileMeta {
  id: string;                 // === key
  key: string;                // R2 object key, also the logical path
  name: string;
  size: number;
  type: string;               // MIME type
  folder: string;             // 'root' or 'a/b'
  uploadedAt: string;         // ISO 8601, preserved across renames
  etag: string;               // R2 httpEtag - the one validator we publish
  shareToken: string | null;
  shareExpiresAt: string | null;
  hasSharePassword: boolean;
  downloads: number;
}

// ─── Share Records (KV, one key per token) ────────────────────────────
export interface ShareRecord {
  key: string;                // the file this token resolves to
  createdAt: string;
  passwordHash: string | null;
  expiresAt: string | null;
  downloads: number;
}

export interface FolderShareLink {
  folder: string;
  createdAt: string;
  passwordHash: string | null;
  expiresAt: string | null;
}

// ─── Accounts ─────────────────────────────────────────────────────────
//
// An account is the only credential in the system. `ADMIN_PASSWORD` was a
// single shared secret with no username, so it could not be rotated per person
// and could not be managed at all; accounts replaced it.
export type AccountRole = 'admin' | 'user';

export interface Account {
  id: string;
  username: string;
  /** Lower-cased username, used as the lookup key (usernames are case-insensitive). */
  usernameLower: string;
  role: AccountRole;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  /** Set when an admin reset the password, or when it came from a legacy secret. */
  mustChangePassword: boolean;
}

/** What the API and the UI are allowed to see about an account. */
export interface PublicAccount {
  id: string;
  username: string;
  role: AccountRole;
  createdAt: string;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
}

export const USERNAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,30}[a-zA-Z0-9]$/;

// ─── Session ──────────────────────────────────────────────────────────
export interface Session {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

// ─── API Response Types ───────────────────────────────────────────────
export interface FileListResponse {
  files: FileMeta[];
  cursor: string | null;
}

export interface StatsResponse {
  totalFiles: number;
  totalSize: number;
  totalDownloads: number;
  recentUploads: FileMeta[];
  topDownloaded: FileMeta[];
}

// ─── Site Settings ────────────────────────────────────────────────────
export interface SiteSettings {
  guestPageEnabled: boolean;
  showLoginButton: boolean;
  siteName: string;
  siteIconUrl: string;        // URL to custom logo/icon image (empty = default cloud icon)
}

export const DEFAULT_SETTINGS: SiteSettings = {
  guestPageEnabled: false,
  showLoginButton: true,
  siteName: 'CloudVault',
  siteIconUrl: '',
};

// ─── KV Key Patterns ─────────────────────────────────────────────────
export const KV_PREFIX = {
  /** Legacy file index. Never read by this code; purged by the sync endpoint. */
  LEGACY_FILE: 'file:',
  /** Legacy folder index. Same. */
  LEGACY_FOLDER: 'folder:',
  SHARE: 'share:',
  FOLDER_SHARE: 'foldershare:',
  FOLDER_SHARE_EXCLUDE: 'foldershare-exclude:',
  FOLDER_SHARE_LINK: 'foldersharelink:',
  SESSION: 'session:',
  SETTINGS: 'settings:',
  RATE_LIMIT: 'rl:',
  /** `user:<id>` - the account record. */
  ACCOUNT: 'user:',
  /** `userlookup:<lowercase username>` - username to account id. */
  ACCOUNT_LOOKUP: 'userlookup:',
} as const;
