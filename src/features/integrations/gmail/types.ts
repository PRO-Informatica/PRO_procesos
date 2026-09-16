export const GMAIL_REQUIRED_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
] as const;

export type GmailConnectionStatus =
  | "CONNECTED"
  | "REAUTH_REQUIRED"
  | "DISCONNECTED";

export type GmailConnectionRow = {
  id: string;
  user_id: string;
  google_user_id: string;
  email: string;
  encrypted_refresh_token: string | null;
  encryption_iv: string | null;
  encryption_auth_tag: string | null;
  encryption_key_version: number;
  granted_scopes: string[];
  status: GmailConnectionStatus;
  connected_at: string;
  last_token_refresh_at: string | null;
  last_sync_at: string | null;
  reauth_required_at: string | null;
  disconnected_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GmailConnectionPublicStatus = {
  connected: boolean;
  email: string | null;
  status: GmailConnectionStatus | "NOT_CONNECTED";
  lastSyncAt: string | null;
};

export type GmailOAuthStateRow = {
  id: string;
  user_id: string;
  state_hash: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};
