# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FileShare is a self-hosted file sharing system for small teams (10-50 people). It features hierarchical spaces (team/department/personal/project), four-tier role permissions (admin/editor/viewer/commenter), file versioning, optional encryption (SM4/AES-256/external SDK), operation audit logging, and a Wiki knowledge-base module (since v1.0.14) — Markdown editing with version history, full-text search, comments, attachments, subscriptions, and PDF export.

## Development Commands

```bash
# Install dependencies (both server and client)
npm install && cd client && npm install && cd ..

# Initialize database (first time setup)
npm run init

# Development mode (starts both server and client concurrently)
npm run dev

# Start server only (with auto-reload)
npm run server:dev

# Start client only
npm run client:dev

# Build client for production
npm run client:build

# Production: PM2 (serves client static files from server)
npm run client:build && pm2 start ecosystem.config.js --only fileshare

# Database backup
npm run backup

# Reset admin password
node server/scripts/reset-admin-password.js

# Re-apply schema migrations (idempotent CREATE IF NOT EXISTS)
node server/scripts/migrate-schema.js

# Repair legacy spaces.id NOT NULL constraint
npm run fix-db

# Print canonical project version (from upgrades/version.json)
npm run check-version

# Version upgrades — npm run upgrade always points to the LATEST scripted hop
# (currently v1.0.13 → v1.0.14, which adds the Wiki module). It is NOT "whatever
# your current version is to next" — if your deployment is older, run the
# matching upgrade:1.0.X first. Note: 1.0.13→1.0.14 contains DB schema changes
# (10 new wiki_* tables, spaces.space_kind column, permissions CHECK constraint
# rebuild). The upgrade script invokes db.init() automatically — no separate
# migration step needed.
npm run upgrade
npm run upgrade:latest   # force-set version.json to latest without running migrations
npm run upgrade:1.0.11   # run a specific hop (e.g. v1.0.10 → v1.0.11)
npm run upgrade:1.0.14   # current latest hop (Wiki module)
```

Dev server URLs: frontend at `http://localhost:5173` (Vite proxies `/api` → `http://localhost:3000`, override via `VITE_API_URL`), backend API at `http://localhost:3000`. Default admin: `admin / admin123`.

**Versioning quirk** — the `version` field in `package.json` is stale (`1.0.0`) and unused. The canonical version lives in `upgrades/version.json` and is what `/api/health`, `/api/version`, and the workbench UI read. Bump it via the upgrade scripts, not by editing `package.json`.

## Architecture

**Backend** — Express.js (Node.js) with SQLite3, no ORM. All DB access goes through `server/config/database.js` which exposes promise-based `query()`, `get()`, `run()`, and `transaction()` helpers wrapping the `sqlite3` driver directly.

**Frontend** — React 18 + TypeScript + Vite. Uses Ant Design (antd) for UI, Zustand for state management, React Query for server state, and React Router v6. Source lives in `client/src/`.

**Key architectural decisions:**
- The server forces `TZ=Asia/Shanghai` at startup (overrides `.env`); DB stores UTC, frontend displays Beijing time.
- Express runs with `app.set('trust proxy', 1)` so rate limiting reads `X-Forwarded-For` correctly behind Nginx.
- Authentication is JWT-based (`server/middleware/auth.js`). The `authenticate` middleware attaches `req.user` with `{id, username, email, role, realName}`. Use `requireRole(...roles)` or `requireAdmin` for route-level authorization.
- Permission checks are hierarchical: admin → resource owner/creator → direct user permission → user group permission → space-level permission. Default policy is deny. See `checkPermission()` and `getBatchFilePermissions()` in `server/middleware/auth.js`.
- File storage uses the filesystem (path configured via `STORAGE_PATH` env or defaults to `./storage/`). Files are served through API routes with auth + optional decryption, never via static file serving.
- Encryption is optional (default: none). Configured via `ENCRYPTION_MODE` env var (`none`/`sm4`/`aes256`/`external`). Logic in `server/utils/encryption.js`. The `external` mode loads a user-provided module via `EXTERNAL_SDK_PATH` — see `server/utils/external-encryption-sdk-example.js`.
- Uploads have two paths: regular `multipart/form-data` for files up to ~50MB and chunked uploads for larger files (state tracked in the `chunk_uploads` table; supports pause/resume). Both go through `/api/files/upload*`, which is **excluded** from rate limiting so retries on big uploads don't 429. Body limit defaults to 500MB and is configurable via `BODY_SIZE_LIMIT`.
- Rate limit defaults: 1000 req / 15 min per IP on `/api/*` (non-upload), tunable via `RATE_LIMIT_MAX`.
- Server `requestTimeout` is set to `UPLOAD_TIMEOUT_MS` (default 600000ms) so direct (no-Nginx) deployments don't cut off slow uploads.
- In production mode, the Express server serves the built client from `client/dist/` as static files with SPA fallback routing. `index.html` is served with `no-cache`/`must-revalidate` so users always get the latest hashed asset references after an upgrade.
- Auxiliary endpoints: `GET /api/health` (status + version), `GET /api/version`, and `GET /api/downloads/*` which serves desktop client installers from `./downloads/`.
- **Wiki module (v1.0.14+)** — independent top-level `/wiki` UI, but reuses `spaces` table (with new `space_kind` column distinguishing `'file'` vs `'wiki'`), `permissions` table (CHECK extended with `'wiki_page'` resource type), and `operation_logs`. Pages stored as Markdown in `wiki_pages.content`; full-text search uses `content_text` (stripped Markdown) + LIKE. Optimistic-lock conflict detection: every `PUT /pages/:id` requires `expectedVersion`, mismatch returns HTTP 409 + current content. PDF export uses `puppeteer` (in core deps since v1.0.14, ~250MB Chromium). Trash retention: 30 days, configurable via `WIKI_TRASH_RETENTION_DAYS`. Notifications (front-end red dot only): writes to `wiki_notifications` table on @-mention or subscription updates — no email/IM channel.

**API route structure** — all routes are prefixed `/api/`:
| Prefix | Router file |
|---|---|
| `/api/auth` | `server/routes/auth.js` |
| `/api/users` | `server/routes/users.js` |
| `/api/files` | `server/routes/files.js` |
| `/api/spaces` | `server/routes/spaces.js` |
| `/api/permissions` | `server/routes/permissions.js` |
| `/api/shares` | `server/routes/shares.js` |
| `/api/comments` | `server/routes/comments.js` |
| `/api/search` | `server/routes/search.js` |
| `/api/admin` | `server/routes/admin.js` |
| `/api/logs` | `server/routes/logs.js` |
| `/api/wiki` | `server/routes/wiki.js` (v1.0.14+) |

Wiki module endpoints under `/api/wiki/*` (~50 endpoints): spaces CRUD, pages CRUD with optimistic lock, tree (with drag-and-drop move), versions/diff/rollback, search, comments, attachments, tags, favorites, views/popular/recent, subscriptions, contributors, batch operations, trash, archive, draft/publish, import (zip), export (md/pdf), notifications.

**Database schema** — defined inline in `server/config/database.js` via `CREATE TABLE IF NOT EXISTS`. Key tables: `users`, `spaces`, `folders`, `files`, `file_versions`, `permissions`, `user_groups`, `user_group_members`, `external_shares`, `comments`, `operation_logs`, `system_config`, `chunk_uploads`. Wiki module (v1.0.14+) adds 11 tables: `wiki_pages`, `wiki_page_versions`, `wiki_tags`, `wiki_page_tags`, `wiki_favorites`, `wiki_page_views`, `wiki_page_links`, `wiki_page_attachments`, `wiki_subscriptions`, `wiki_comments`, `wiki_notifications`; plus `spaces.space_kind` column (`'file' | 'wiki'`) and extends `permissions.resource_type` CHECK to include `'wiki_page'` (latter requires table rebuild — handled by `ensurePermissionsResourceType()` in `database.js`). Schema migrations live in two places: version-specific scripts under `upgrades/` (one per minor version, e.g. `upgrade-v1.0.13-to-v1.0.14.js`), and `ensureXxx()` helpers in `database.js` that `ALTER TABLE` to add missing columns idempotently on startup. `server/scripts/migrate-schema.js` re-runs the full `CREATE IF NOT EXISTS`/`CREATE INDEX IF NOT EXISTS` set without touching existing data.

**Frontend layout** — `client/src/{pages,components,services,stores,utils}`. State is split between Zustand (`stores/authStore.ts` for auth) and React Query (server state). API calls go through `services/api.ts` (axios instance with auth interceptor) and feature modules under `services/`.

**Electron** — desktop client wrapper in `electron/`. Build with `npm run electron:build`.

## Environment Configuration

Configured via `.env` file (see `.env.example`). Critical variables:
- `JWT_SECRET` — required, server refuses to start in production with default value
- `ENCRYPTION_MODE` / `ENCRYPTION_KEY` — file encryption settings (`none`/`sm4`/`aes256`/`external`)
- `EXTERNAL_SDK_PATH` / `EXTERNAL_SDK_CONFIG` — only when `ENCRYPTION_MODE=external`
- `PORT` — server port (default 3000)
- `DB_PATH` — SQLite database path (default `./data/fileshare.db`)
- `CLIENT_URL` — comma-separated allowed CORS origins (use `*` to allow all; production also auto-allows any origin)
- `STORAGE_PATH` — file storage directory
- `BODY_SIZE_LIMIT` — max JSON/urlencoded body size (default `500mb`)
- `UPLOAD_TIMEOUT_MS` — server `requestTimeout` for upload endpoints (default `600000`, i.e. 10 min)
- `RATE_LIMIT_MAX` — requests per 15-min window per IP for non-upload `/api/*` (default `1000`)
- `VITE_API_URL` — frontend dev: target URL for the Vite `/api` proxy (default `http://localhost:3000`)

Wiki module (v1.0.14+):
- `WIKI_TRASH_RETENTION_DAYS` — soft-deleted wiki pages permanently purged after this many days (default `30`); cleanup job runs every 12h.
- `PUPPETEER_SKIP_DOWNLOAD` — set to `1` in offline / restricted-network deploys to skip Chromium auto-download during `npm install`. Then point puppeteer at a system-installed Chrome via `PUPPETEER_EXECUTABLE_PATH`.
- `PUPPETEER_EXECUTABLE_PATH` — absolute path to a Chrome/Chromium binary (e.g. `/usr/bin/google-chrome` on Linux, `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` on macOS). Required if `PUPPETEER_SKIP_DOWNLOAD=1`.

## Language

This is a Chinese-language project. All UI text, error messages, comments, and documentation are in Chinese (Simplified). Maintain this convention when adding code.
