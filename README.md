# SplitApp

India-first group expense splitting, built as an installable PWA. The differentiator is
**real UPI settle-up**: you don't just see "you owe Rahul ₹400" — you tap once, your UPI
app opens pre-filled, you pay, the debt clears.

Live: https://splitapp-bice.vercel.app

**New here? Read [`docs/HANDOFF.md`](docs/HANDOFF.md) first.** It is the full story — what
the app is, how it works, every decision and why, the traps already paid for, and how we
work.

---

## Layout

```
frontend/     Next.js App Router PWA. Talks straight to Supabase — no API server.
database/     Supabase / Postgres layer: frozen schema, migrations, acceptance tests.
docs/         HANDOFF, PRD, TRD, PROGRESS, DECISIONS_AND_BACKLOG.
```

Two areas, deliberately separated so two people can work without colliding. The split is
**purely organisational** — there is no backend runtime of our own, and adding one is
forbidden by TRD Section 11. "Backend" means Supabase.

`frontend/` is the only npm workspace; it owns every JS/TS dependency. The root
`package.json` holds no dependencies, just scripts that proxy to the right place.

## Commands (all from the repo root)

| Command | What it does |
|---------|--------------|
| `npm install` | Installs everything (hoists to the root `node_modules`) |
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` over the frontend |
| `npm run test:acceptance` | The 51-check database acceptance test |
| `npm run db:push` | Applies migrations (see `database/README.md` — needs `--db-url`) |

You can also work inside a folder directly: `cd frontend && npm run dev` behaves the same.

## Setup

1. `npm install`
2. `cp frontend/.env.local.example frontend/.env.local` and fill it in.
   **Credentials live in `frontend/.env.local` only.** It is gitignored and must never be
   committed. The database tests read that same file rather than keeping a second copy of
   the secrets.
3. `npm run dev`

## Deployment

Vercel auto-deploys `main`. **The project's Root Directory must be set to `frontend`** in
the Vercel dashboard — see `docs/HANDOFF.md` §2 for why this cannot be done from
`vercel.json`.

## The rules that matter

- **Never edit `database/splitapp.sql` or any existing migration.** Changes are always a
  new additive migration.
- **`npm run test:acceptance` must stay at 51 passed / 0 failed.**
- All money is integer paise. Never floats.
- Row-Level Security *is* the security model. Never disable it; never expose a table
  without a policy; never change a function's `SECURITY DEFINER` / `INVOKER` setting.
- Colour goes in a token in `frontend/app/globals.css`, never a hex in a component.

The full set, with reasoning, is in `docs/HANDOFF.md` §6.
