// next.config.mjs — Chrome Local Network Access (PNA) headers for Marketplace dev.
//
// The portal is served from a public origin (e.g. https://portal.sitecorecloud.io);
// Chrome's Local Network Access policy blocks public-origin iframes from loading
// `localhost` URLs unless the target advertises consent via these headers.
//
// IMPORTANT: do NOT combine `Access-Control-Allow-Origin: *` with
// `Access-Control-Allow-Credentials: true` — the spec forbids that combo and
// browsers silently reject the response. For iframe-embedding navigation the
// credentials header isn't needed (cookie credentialing uses cookie SameSite/Secure
// attributes, not CORS), so omit it entirely. If you later need credentials,
// replace the `*` origin with the specific portal origin.
//
// Harmless in production — production apps running under a public origin won't
// trigger the Local Network Access check.

const nextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Access-Control-Allow-Private-Network', value: 'true' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization, Access-Control-Request-Private-Network' },
        ],
      },
    ];
  },
};

export default nextConfig;
