export const GMAIL_CONNECTION_CHANGED_EVENT = "gmail-connection-changed";

export function announceGmailConnectionChange() {
  window.dispatchEvent(new Event(GMAIL_CONNECTION_CHANGED_EVENT));
}
