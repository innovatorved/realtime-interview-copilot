# AGENTS.md

## Commands

- Package manager is **Bun** (`bun@1.3.10`); Node 22+ required. Use `bun install`, not npm/yarn.
- `bun run lint` — ESLint (root). `bun run fix` — Biome format/write.
- No root test suite exists. Only `realtime-worker-api` has tests: `cd realtime-worker-api && bun run test` (Node test runner + tsx).
- Typecheck Electron code: `bun run build:electron` (runs `tsc -p tsconfig.electron.json`).
- Dev app: `bun run electron:dev` (builds electron, starts Next dev on PORT=3000, waits for it, then launches Electron). Debug variant: `bun run electron:debug`.
- Production package: `bun run electron:build` (must run in this order internally: `build:electron` → `next build` → `scripts/apply-app-constants.js` → `electron-builder`). `clean` removes `.next out dist electron/*.js`.

## Architecture

Two packages in one repo:
1. **Root** — Next.js 16 static-export UI (`output: "export"`, relative `assetPrefix: "./"` for Electron file:// loading) wrapped in an Electron desktop shell (macOS + Windows).
2. **`realtime-worker-api/`** — separate Cloudflare Worker backend (own `package.json`, own lockfile, D1 + Drizzle, Better Auth, Gemini streaming, Deepgram keys). Run wrangler commands from that directory; deploy via `wrangler deploy`. Migrations live in `realtime-worker-api/drizzle/` managed by drizzle-kit.

Key wiring:
- **Electron sources are TypeScript** in `electron/*.ts`; the compiled `*.js` files next to them are gitignored build artifacts. Always edit `.ts`, never `.js`.
- **CSP has a single source of truth**: `lib/csp.mjs` (plain JS so both Next config and TS can import). `scripts/csp.mjs` and `electron/security/csp.ts` re-import from it — edit `lib/csp.mjs` only.
- `scripts/apply-app-constants.js` reads `APP_DISPLAY_NAME` from `lib/constant.ts` and rewrites `productName` / macOS permission strings in `package.json`. Change display name in `lib/constant.ts`, not `package.json`.
- Backend API URL appears in CSP allowlists; adding a new API host requires updating `lib/csp.mjs` (dev + prod).

## Env & secrets

- Root: `.env` holds `DEEPGRAM_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` (see `.env.example`). Never commit real values.
- Worker: `.dev.vars` (gitignored) supplies local wrangler dev secrets.

## Release flow

Pushing a tag `v*` triggers `.github/workflows/release.yml`: builds macOS + Windows with electron-builder (unsigned, `CSC_IDENTITY_AUTO_DISCOVERY=false`) and publishes to GitHub Releases. Version bumps happen in root `package.json`; artifact filenames are pinned for Homebrew/WinGet compatibility — don't change `artifactName` casually.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
