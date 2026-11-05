# Vitest test-stack templates

Drop-in templates for the Vitest + testing-library + jsdom stack the Marketplace shadcn quickstart does **not** ship.

## Files

| File | Where it goes | Purpose |
|---|---|---|
| `vitest.config.ts` | project root next to `package.json` | Vitest config — jsdom environment, jest-dom setup, `@/` alias to project root |
| `vitest.setup.ts` | project root next to `package.json` | imports jest-dom matchers so `expect(el).toBeInTheDocument()` etc. work |

## Install command

```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @vitejs/plugin-react
```

## Required `package.json` scripts

```json
"test": "vitest run",
"test:watch": "vitest"
```

## Required `tsconfig.json` patch

Add this so `npm run typecheck` resolves `expect` / `it` / `describe` / `vi` / `toHaveBeenCalledWith` etc.:

```jsonc
{
  "compilerOptions": {
    // …existing options…
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  }
}
```

Without the `types` array, `tsc --noEmit` fails on every test file with `Cannot find name 'expect' / 'vi' / 'describe'`. The Vitest install + config files alone are not enough.

## Why this is shipped as an asset

Both `setup-marketplace-client-side` and `setup-marketplace-full-stack` need the same Vitest stack. Living here as drop-in files keeps the SKILL.md bodies short and lets agents copy `vitest.config.ts` / `vitest.setup.ts` verbatim instead of parsing markdown code-fences.
