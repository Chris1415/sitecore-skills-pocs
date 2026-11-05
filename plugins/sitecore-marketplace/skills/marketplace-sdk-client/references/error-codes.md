# 8f. Error codes

Supporting reference for the `marketplace-sdk-client` skill. Moved out of `SKILL.md` on 2026-09-16 so the entry file stays under the Agent Skills spec's 5,000-token guidance.

## 8f. Error codes (from SKILL.md § 8f)


```typescript
enum ErrorCode {
  TIMEOUT = "TIMEOUT",                     // Handshake or request timeout
  CONNECTION_ERROR = "CONNECTION_ERROR",
  HANDSHAKE_FAILED = "HANDSHAKE_FAILED",   // Host didn't respond
  INVALID_ORIGIN = "INVALID_ORIGIN",       // Origin mismatch
  METHOD_NOT_FOUND = "METHOD_NOT_FOUND",   // Key not registered
  EXECUTION_ERROR = "EXECUTION_ERROR",     // Host-side error
  SUBSCRIPTION_ERROR = "SUBSCRIPTION_ERROR",
  NOT_CONNECTED = "NOT_CONNECTED",         // SDK not initialized
  TOKEN_ERROR = "TOKEN_ERROR",             // Auth token issue
  HOST_NOT_READY = "HOST_NOT_READY",       // Host not accepting messages
}
```

Handle at minimum: `TIMEOUT` (retry with backoff), `NOT_CONNECTED` (re-init), `TOKEN_ERROR` (prompt re-auth).
