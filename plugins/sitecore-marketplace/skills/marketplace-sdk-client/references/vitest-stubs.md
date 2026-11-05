# Vitest stubs for the Marketplace Client SDK surface

Unit-testing harness code that calls `client.query` / `client.mutate` / `client.subscribe` / `client.destroy` requires a stubbed `ClientSDK`. The SDK's call signatures are overloaded and generic, so **naked `vi.fn()` will fail `tsc --noEmit`** with:

```
TS2348: Value of type 'Mock<Procedure | Constructable>' is not callable.
```

Vitest's `Mock` default type unions a callable shape with a constructable shape; without an explicit signature it can't pick one, and the call site no longer typechecks. Always pass the call signature as a generic.

## 1. Stub each verb with its real signature

```typescript
import { vi, type Mock } from 'vitest';
import type { ClientSDK } from '@sitecore-marketplace-sdk/client';

type QueryFn = ClientSDK['query'];
type MutateFn = ClientSDK['mutate'];
type SubscribeFn = ClientSDK['subscribe'];
type DestroyFn = ClientSDK['destroy'];

const query: Mock<QueryFn> = vi.fn<QueryFn>();
const mutate: Mock<MutateFn> = vi.fn<MutateFn>();
const subscribe: Mock<SubscribeFn> = vi.fn<SubscribeFn>();
const destroy: Mock<DestroyFn> = vi.fn<DestroyFn>();

const stubClient = { query, mutate, subscribe, destroy } as unknown as ClientSDK;
```

The `as unknown as ClientSDK` cast on the assembled stub object is the only allowed cast — it covers the methods you don't stub. Individual `vi.fn<Signature>()` calls are typed and do not need casts. **Do not** cast individual mocks with `as any` / `as never` — that defeats the call-shape contract the test exists to enforce.

## 2. Default return values that satisfy the signature

`query` and `mutate` are async; the resolved value must match the SDK's wrapper shape (`{ data, error?, status?, … }` for queries; the direct response object for mutations — see the SKILL.md § 8b for the matrix). Set defaults per test rather than once globally so each test states its own contract:

```typescript
query.mockResolvedValueOnce({ data: { id: 'site-1' } } as never);
mutate.mockResolvedValueOnce({ data: { ok: true } } as never);
```

The `as never` here is on the **resolved value of a stub**, not on the SDK call site — it sidesteps the deep generic resolution Vitest can't infer for arbitrary keys. This is the one place the cast is acceptable; the call-shape assertion below is what proves the test is doing real work.

## 3. Assert call shape (key + params) — what the test exists to check

```typescript
import { expect, it } from 'vitest';

it('listLanguages query uses the right key and params', async () => {
  query.mockResolvedValueOnce({ data: { data: [] } } as never);

  await loadLanguages(stubClient, 'context-id-123');

  expect(query).toHaveBeenCalledWith('xmc.sites.listLanguages', {
    params: { query: { sitecoreContextId: 'context-id-123' } },
  });
});

it('renamePage mutation passes sitecoreContextId in query', async () => {
  mutate.mockResolvedValueOnce({ data: { ok: true } } as never);

  await renamePage(stubClient, { pageId: 'p-1', newName: 'Test', contextId: 'ctx-1' });

  expect(mutate).toHaveBeenCalledWith('xmc.pages.renamePage', {
    params: {
      path: { pageId: 'p-1' },
      body: { newName: 'Test' },
      query: { sitecoreContextId: 'ctx-1' },
    },
  });
});
```

The point: if the `marketplace-sdk-xmc` skill says a key takes `params: { query: { sitecoreContextId } }` and the harness omits it (a common silent-rename trap), this test fails — with the typed stub, the assertion is the doc-contract enforcement.

## 4. Subscribe — assert subscribe + cleanup call shapes

```typescript
it('subscribes to pages.context with a cleanup that runs on unmount', async () => {
  const teardown = vi.fn();
  subscribe.mockReturnValueOnce(teardown as never);

  const { unmount } = render(<PagesPanel client={stubClient} />);

  expect(subscribe).toHaveBeenCalledWith('pages.context', expect.objectContaining({
    onData: expect.any(Function),
  }));

  unmount();
  expect(teardown).toHaveBeenCalledOnce();
  expect(destroy).toHaveBeenCalledOnce();
});
```

Three assertions cover the full subscribe lifecycle: (1) correct event key + handler shape, (2) the returned teardown is invoked, (3) `client.destroy()` runs on unmount.

## 5. Why this matters

These tests are the acceptance bar for harness code. They verify the call shape the skill files document is what the code actually emits — without them, a doc-drift bug like a silent `renamePage` omitting mandatory `sitecoreContextId` cannot be surfaced before live run.
