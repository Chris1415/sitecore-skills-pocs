# HTTPS dev-server traps — mkcert, Chrome cert rejection, Local Network Access

This file holds the three load-bearing HTTPS-mode traps that bite when running a Marketplace app's dev server against the real Cloud Portal. The SKILL.md § 3 has the rule "HTTPS is mandatory for Scaffold 3, optional for Scaffold 2"; this reference unpacks the three failure modes in detail. Read this when you're actively debugging cert / iframe / network-access errors.

## 1. mkcert + the Windows non-interactive trap (Scaffold 3 only)

Next's `--experimental-https` invokes `mkcert -install` on first run, which installs a local root CA into the OS trust store. **On Windows the install step needs elevation** and fails silently under a non-interactive shell — Next then falls back to plain HTTP and you spend an hour wondering why the portal keeps blocking the iframe.

Three things to do up front:

1. **Run `mkcert -install` once from an elevated PowerShell** (admin). The binary lives at `%LOCALAPPDATA%\mkcert\mkcert-v1.4.4-windows-amd64.exe` after Next installs it. This installs the mkcert CA into the Windows trusted-root store.
2. If step 1 isn't feasible (no admin), **pre-generate the cert without `-install`**:
   ```bash
   mkcert -key-file <project>/certificates/localhost-key.pem \
          -cert-file <project>/certificates/localhost.pem \
          localhost 127.0.0.1 ::1
   ```
   Next will reuse an existing cert dir and skip the `-install` step. The cert isn't system-trusted so you'll click through Chrome's warning on first visit — see § 2 below for why iframe loads still fail with that approach.
3. When the cert is freshly regenerated or moved, **fully close and restart the browser** — Chrome caches trust decisions per profile and will reject an iframe load even after you've accepted the cert on a top-level page until the process restarts.

## 2. Self-signed cert rejected inside iframe → `chrome-error://chromewebdata/` (Scaffold 3 only)

Accepting a self-signed cert via Chrome's *Advanced → Proceed* click-through only grants trust for the exact top-level navigation you clicked through on. **That trust decision does NOT transfer to iframe subresource loads from a public origin** (e.g. the Sitecore portal loading your `https://localhost:3000/...` route inside its shell).

Symptom: the portal iframe parent frame ends up as `chrome-error://chromewebdata/`, and the browser console fills with:

```
Unsafe attempt to load URL https://localhost:3000/<route>?... from frame with URL chrome-error://chromewebdata/. Domains, protocols and ports must match.
```

Every subsequent request dies on that cross-origin check even after the server is fine. Fix:

- **Install the mkcert CA system-trust (§ 1 step 1 above)** — makes your self-signed cert trusted like a real one, so Chrome doesn't fall back to its error page inside iframes. This is the clean path.
- OR tunnel the dev server via `cloudflared` / `ngrok` to get a public-CA-signed HTTPS URL, register the tunnel URL in the portal instead of `localhost`. Heavier but no admin rights needed.

## 3. Chrome's Local Network Access block — applies to both Scaffold 2 and Scaffold 3

Independent of HTTPS/cert trust, modern Chrome (2025+) enforces **Local Network Access** preflight checks: a page served from a public origin (the portal) attempting to load an iframe at `http://localhost:*` or `https://localhost:*` is treated as a "public → private network" navigation and blocked unless the target advertises consent. **This is the only dev-server configuration step actually required for client-side (Scaffold 2) Mode A apps** — add these headers and HTTP localhost works end-to-end.

Add these headers to every response from your dev server (they're harmless in prod too — production apps running under a public origin won't trigger the check):

```js
// next.config.mjs
const nextConfig = {
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Access-Control-Allow-Private-Network", value: "true" },
        { key: "Access-Control-Allow-Origin", value: "*" },
        { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, OPTIONS" },
        { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, Access-Control-Request-Private-Network" },
      ],
    }];
  },
};
export default nextConfig;
```

**Do not combine `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true`** — the spec forbids that combo and browsers silently reject the response. For iframe-embedding navigation the credentials header isn't needed at all (cookie credentialing is governed by cookie `SameSite` / `Secure` attributes, not CORS), so omit it entirely. If you later need credentials, replace the `*` origin with the specific portal origin (`https://portal.sitecorecloud.io` or equivalent).
