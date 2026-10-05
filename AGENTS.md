<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project notes

- Read README.md first. The architecture plan (linked there) is the source of truth for scope and phases; Aarif approves each phase.
- Business logic goes in `src/services/`; actions and pages stay thin. Check permissions with `can()` and write an audit row in the same transaction for every change.
- When access rules change, update both `src/lib/auth/permissions.ts` and the hand-written matrix in `tests/permissions.test.ts`.
- Run `npm run lint`, `npm run typecheck` and `npm test` before committing.
