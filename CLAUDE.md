# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FileShare is a self-hosted file sharing system for small teams (10-50 people). It features hierarchical spaces (team/department/personal/project), four-tier role permissions (admin/editor/viewer/commenter), file versioning, optional encryption (SM4/AES-256/external SDK), and operation audit logging.

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

# Version upgrades (sequential, version-to-version)
npm run upgrade          # current version to next
npm run upgrade:latest   # force upgrade to latest
```

Dev server URLs: frontend at `http://localhost:5173`, backend API at `http://localhost:3000`. Default admin: `admin / admin123`.

## Architecture

**Backend** — Express.js (Node.js) with SQLite3, no ORM. All DB access goes through `server/config/database.js` which exposes promise-based `query()`, `get()`, `run()`, and `transaction()` helpers wrapping the `sqlite3` driver directly.

**Frontend** — React 18 + TypeScript + Vite. Uses Ant Design (antd) for UI, Zustand for state management, React Query for server state, and React Router v6. Source lives in `client/src/`.

**Key architectural decisions:**
- The server forces `TZ=Asia/Shanghai` at startup; DB stores UTC, frontend displays Beijing time
- Authentication is JWT-based (`server/middleware/auth.js`). The `authenticate` middleware attaches `req.user` with `{id, username, email, role, realName}`. Use `requireRole(...roles)` or `requireAdmin` for route-level authorization.
- Permission checks are hierarchical: admin → resource owner/creator → direct user permission → user group permission → space-level permission. Default policy is deny. See `checkPermission()` and `getBatchFilePermissions()` in `server/middleware/auth.js`.
- File storage uses the filesystem (path configured via `STORAGE_PATH` env or defaults to `./storage/`). Files are served through API routes with auth + optional decryption, never via static file serving.
- Encryption is optional (default: none). Configured via `ENCRYPTION_MODE` env var (`none`/`sm4`/`aes256`/`external`). Logic in `server/utils/encryption.js`.
- Rate limiting is applied to all `/api/` routes except upload endpoints.
- In production mode, the Express server serves the built client from `client/dist/` as static files with SPA fallback routing.

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

**Database schema** — defined inline in `server/config/database.js` via `CREATE TABLE IF NOT EXISTS`. Key tables: `users`, `spaces`, `folders`, `files`, `file_versions`, `permissions`, `user_groups`, `user_group_members`, `external_shares`, `comments`, `operation_logs`, `system_config`, `chunk_uploads`. Schema migrations are handled by version-specific upgrade scripts in `upgrades/` and `ensureXxx()` functions in `database.js` that `ALTER TABLE` if columns are missing.

**Electron** — desktop client wrapper in `electron/`. Build with `npm run electron:build`.

## Environment Configuration

Configured via `.env` file (see `.env.example`). Critical variables:
- `JWT_SECRET` — required, server refuses to start in production with default value
- `ENCRYPTION_MODE` / `ENCRYPTION_KEY` — file encryption settings
- `PORT` — server port (default 3000)
- `DB_PATH` — SQLite database path (default `./data/fileshare.db`)
- `CLIENT_URL` — comma-separated allowed CORS origins
- `STORAGE_PATH` — file storage directory

## Language

This is a Chinese-language project. All UI text, error messages, comments, and documentation are in Chinese (Simplified). Maintain this convention when adding code.
