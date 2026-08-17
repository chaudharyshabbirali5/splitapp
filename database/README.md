# database/

The Postgres layer. Schema, migrations, and the acceptance test that proves the whole
thing still works.

There is **no backend runtime here** — no server, no API, no functions to deploy. The
browser talks straight to Supabase, and Row-Level Security *is* the security model. This
folder is the source of truth for that model.

```
splitapp.sql        The original validated schema. FROZEN — never edit.
supabase/
  config.toml       Supabase CLI project config
  migrations/       Applied in filename order. Never edit one that exists.
tests/
  acceptance-test.ts  51 checks. The regression net.
seed/               (empty — no seed scripts yet)
```

## Why `supabase/migrations/` and not `migrations/`

The Supabase CLI resolves migrations at `<workdir>/supabase/migrations` and there is no
flag or config key to point it elsewhere — `--workdir` only selects the directory that
*contains* a `supabase/` folder. Flattening this to `database/migrations/` would break
`supabase db push` entirely, so the CLI's expected layout is kept and `--workdir database`
is passed instead. Verified with a dry run: the CLI reads the history from here and
correctly reports the remote as up to date.

## Running migrations

The project has never been `supabase link`ed (linking needs a Personal Access Token), so
push with an explicit connection string:

```bash
npx supabase db push --workdir database --db-url "$SUPABASE_DB_URL"
```

`npm run db:push` from the repo root is the same command without `--db-url`; it will ask
you to link. Add the flag, or link the project once, whichever you prefer.

**Two connection gotchas**, both of which have cost time before:

- The **direct** database host is **IPv6-only**. If your machine has no IPv6 egress it
  will simply fail to connect. Use the **session pooler** host
  (`aws-1-ap-south-1.pooler.supabase.com:5432`).
- Special characters in the password must be **percent-encoded** in the URI (`@` → `%40`).

## Running the acceptance test

```bash
npm run test:acceptance          # from the repo root
npx tsx tests/acceptance-test.ts # from here — same result
```

It resolves `frontend/.env.local` from its own file location rather than the working
directory, so both forms behave identically.

It needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` and
`SUPABASE_DB_URL`. Those live in `frontend/.env.local` — one copy of the secrets, not two.

The test seeds a known scenario, asserts `group_balances()` to the paise, checks RLS is
enabled on all six tables, verifies a non-member is locked out, and **cleans up after
itself**, so it is safely re-runnable against the real database.

**It must stay at 51 passed / 0 failed.** If it drops, stop and find out why before
committing anything.

## Conventions

1. **Never edit `splitapp.sql` or an existing migration.** Ever. Every change is a new
   additive migration file. The base schema was validated before any application code
   existed and is treated as immutable.
2. **New RPCs:** `set search_path = public`, `grant execute` to `authenticated` **only**,
   `revoke` from `PUBLIC`.
3. **Never disable RLS. Never expose a table without a policy.**
4. **Never change an existing function's `SECURITY DEFINER` / `SECURITY INVOKER`
   setting.** That is a security decision, not a style one. Membership helpers are
   DEFINER (to escape RLS recursion); `group_balances()` and the write RPCs are INVOKER
   (so RLS still applies to them).
5. **All money is `bigint` paise.** No floats, no numerics, anywhere.
6. Multi-table writes go through an INVOKER RPC so they are atomic — a half-written
   expense corrupts the ledger.

The reasoning behind all of this is in `../docs/HANDOFF.md` §3.
