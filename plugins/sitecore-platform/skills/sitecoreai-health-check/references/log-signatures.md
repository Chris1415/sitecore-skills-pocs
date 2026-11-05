# Log signatures (level-aware)

Source of truth in code: `SIGNATURES` in `scripts/lib/detect.mjs`. A signature with a minimum level matches only WARN, ERROR or FATAL lines.

## Line and file formats (measured 2026-10-02)

- **CM line:** `<thread> DD Mon YYYY HH:mm:ss LEVEL  message`, e.g. `80880 01 Oct 2026 12:20:11 INFO  …`. **The date is on the line.** The thread can be `ManagedPoolThread #5`. Exception continuation lines carry no prefix (level unknown).
- **CM file:** `<Type>.log.<5-char instance>.YYYYMMDD.HHMMSS.txt` (main log: `Log.<inst>.…`). The instance segment changes per container restart.
- **Editing host:** `RenderingHost.<app>.log.YYYYMMDD.HHMMSS.txt`, listed **only under the EH env id**. Its `type` field is derived from the last dash segment of the app name: key EH files by the `RenderingHost.` prefix. Content is raw `next start` stdout with **no timestamps**.
- **Types** (`/types`, static): Client, ContentTransfer, Crawling, Log, Owin, Publishing, RenderingHost, Search, Spe.
- **Retention:** 90 days documented; the list shows at most 50 files per type.

## Signatures

| id | Pattern | Min level | Sev | Meaning / action |
|---|---|---|---|---|
| edge-ack-hung | `Error processing ack messages` / `EdgeApiException` / `status: 520` | any | P0 | Edge publish hung. Read the Publishing log around it |
| edge-media-blob | `Failed to upload media blob` | any | P1 | Edge publishing failure |
| edge-batch-failed | `Sending (layout) update batch failed` | any | P1 | Edge publishing failure |
| edge-delta-block | `CheckDeltaPublishBlock` | WARN | P1 | Delta publish blocked |
| edge-verify-status | `Could not verify publishing status` | any | P1 | Edge publishing failure |
| edge-rendered-entity | `Failed to generate RenderedEntity` | any | P1 | A page could not be rendered for Edge |
| edge-destinations | `Failed to set destinations` | any | P1 | Edge publishing failure |
| template-not-found | `Data template '{…}' not found for item '<path>'` | any | P1 | Item whose template is gone; fails publishing. The doctor collects the unique paths and confirms each on Authoring (T2) |
| solr-degraded | `IsSolrAliveAgent` / `IndexingStateSwitcher` / `Solr … not available` | **WARN** | P1 | Search degraded. **At INFO these agents log every minute (3,236 hits, 100 % noise).** A WARN state change *to* `'Running'` is a recovery and is ignored |
| editing-secret | `Missing or invalid editing secret` | any | P1 | Pages cannot render through this host |
| secret-leak-debug | `sent "…" expected "…"` | any | P1 | `DEBUG=content-sdk:editing` wrote the real secret. Rotate it. Samples are redacted |
| edge-quota | `API calls quota exceeded` | any | P1 | Edge rate limit hit |
| personalize-timeout | `IE-003` | any | P2 | Personalize timeout (default 400 ms) |
| media-hash | `MediaRequestProtection: An invalid/missing hash` | any | P3 | Unsigned media URL requests; usually crawler noise |
| owin-auth-failed | `OAuthBearerAuthenticationMiddleware - Authentication failed` | any | P3 | Expired or foreign bearer tokens (IDX10501); usually noise |

## Reading rules

- **Zero hits is a valid answer**, but only for the files scanned: the report names how many files and bytes were read, and when a file was capped.
- Only the newest file per type is scanned by default. An older incident needs `--log-max-bytes` and a targeted read of the older files.
- Never paste raw lines into a ticket without the redaction pass: the editing-debug namespace prints secrets.
- Deployment logs are all `info`: find a failed build from the deployment record (`calculatedStatus 4`, `*LastFailureMessage`), not from log levels.
