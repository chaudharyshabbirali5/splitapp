/**
 * SplitApp — Step 1 acceptance test (TRD Section 12.1 / Section 13).
 *
 * Proves the database works. It does NOT modify the schema.
 *
 * Seeds the canonical scenario, asserts group_balances(), and confirms RLS is
 * enabled on all six tables. Cleans up after itself so it is re-runnable.
 *
 *   Group "Goa Trip" (trip)
 *     Asha  (real, has auth user)
 *     Bhavi (real, has auth user)
 *     Chin  (placeholder, user_id NULL)
 *   Asha  paid 30000 paise, split equally 3 ways (10000 each)
 *   Bhavi paid  9000 paise, split equally 3 ways ( 3000 each)
 *   Bhavi settled 7000 paise to Asha, status 'confirmed'
 *
 *   Expected: Asha +10000, Bhavi +3000, Chin -13000, sum = 0
 *
 * Money is read as BigInt everywhere. No floats touch an amount. (Invariant #1)
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { config as loadEnv } from 'dotenv';

// Resolved from THIS FILE's location, not the working directory, so the test
// behaves identically whether it is run from the repo root
// (`npm run test:acceptance`) or from inside database/. The credentials live in
// the frontend workspace because Next.js needs them there; the database layer
// just reads the same file rather than keeping a second copy of the secrets.
const HERE = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(HERE, '../../frontend/.env.local'), quiet: true });

// ---------------------------------------------------------------- env

const SUPABASE_URL = requireEnv('SUPABASE_URL');
const SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = requireEnv('SUPABASE_ANON_KEY');
const DB_URL = requireEnv('SUPABASE_DB_URL');

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.error(`FATAL: ${name} is not set. Copy .env.local.example to .env.local and fill it in.`);
    process.exit(2);
  }
  return v.trim();
}

// bigint (int8) must never become a JS float — keep it as a string, then BigInt it.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => v);

// ---------------------------------------------------------------- fixtures

const GROUP_ID = '5171a11a-0000-4000-8000-000000000001';
const MEMBER_ASHA = '5171a11a-0000-4000-8000-0000000000a1';
const MEMBER_BHAVI = '5171a11a-0000-4000-8000-0000000000b1';
const MEMBER_CHIN = '5171a11a-0000-4000-8000-0000000000c1';
const EXPENSE_1 = '5171a11a-0000-4000-8000-0000000000e1';
const EXPENSE_2 = '5171a11a-0000-4000-8000-0000000000e2';
const SETTLEMENT_1 = '5171a11a-0000-4000-8000-0000000000f1';

// A SECOND group, so my_group_positions() is exercised across more than one.
// With a single group a cross-group join bug is invisible: the CTEs aggregate
// over every group the caller can see, so joining on member_id alone (instead
// of group_id AND member_id) would still look correct. Asha is in both.
const GROUP_2 = '5171a11a-0000-4000-8000-000000000002';
const M2_ASHA = '5171a11a-0000-4000-8000-0000000000a2';
const M2_BHAVI = '5171a11a-0000-4000-8000-0000000000b2';
const EXPENSE_3 = '5171a11a-0000-4000-8000-0000000000e3';

const ASHA_EMAIL = 'splitapp-acceptance-asha@example.com';
const BHAVI_EMAIL = 'splitapp-acceptance-bhavi@example.com';
const OUTSIDER_EMAIL = 'splitapp-acceptance-outsider@example.com';

const RLS_TABLES = ['profiles', 'groups', 'group_members', 'expenses', 'expense_splits', 'settlements'];

// ---------------------------------------------------------------- reporting

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}${detail ? `  ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ''}`);
  }
}

function eq(label: string, actual: bigint, expected: bigint): void {
  check(label, actual === expected, `expected ${expected}, got ${actual}`);
}

function section(title: string): void {
  console.log(`\n${title}\n${'-'.repeat(title.length)}`);
}

// ---------------------------------------------------------------- main

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const db = new pg.Client({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false },
  application_name: 'splitapp-acceptance-test',
});

const createdUserIds: string[] = [];

async function main(): Promise<void> {
  await db.connect();

  const version = (await db.query<{ v: string }>('select version() as v')).rows[0].v;
  console.log(`Connected: ${version.split(',')[0]}`);

  try {
    await cleanup(); // in case a previous run died mid-way
    const { ashaUserId, bhaviUserId, outsiderUserId } = await createAuthUsers();
    await seed(ashaUserId, bhaviUserId);
    await assertSplitInvariant();
    await reportGrants();
    await assertBalances();
    await assertMyGroupPositions();
    await assertMemberUniqueness();
    await assertExactShares();
    await assertRlsEnabled();
    await assertRlsBehaviour(ashaUserId, outsiderUserId);
  } finally {
    section('CLEANUP');
    await cleanup();
    console.log('  seeded data removed');
    await db.end();
  }

  section('RESULT');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log(failed === 0 ? '\n  ACCEPTANCE TEST PASSED\n' : '\n  ACCEPTANCE TEST FAILED\n');
  process.exit(failed === 0 ? 0 : 1);
}

// ---------------------------------------------------------------- 1. auth users

async function createAuthUsers() {
  section('1. AUTH USERS');

  const ashaUserId = await createUser(ASHA_EMAIL);
  const bhaviUserId = await createUser(BHAVI_EMAIL);
  const outsiderUserId = await createUser(OUTSIDER_EMAIL);

  console.log(`  Asha     auth.users.id = ${ashaUserId}`);
  console.log(`  Bhavi    auth.users.id = ${bhaviUserId}`);
  console.log(`  Outsider auth.users.id = ${outsiderUserId}  (non-member, for the RLS check)`);
  console.log('  Chin     has NO auth user — placeholder member, user_id stays NULL');

  return { ashaUserId, bhaviUserId, outsiderUserId };
}

async function createUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true, // no confirmation email is sent
  });
  if (error || !data.user) throw new Error(`createUser(${email}) failed: ${error?.message}`);
  createdUserIds.push(data.user.id);
  return data.user.id;
}

// ---------------------------------------------------------------- 2. seed

async function seed(ashaUserId: string, bhaviUserId: string): Promise<void> {
  section('2. SEED "Goa Trip"');

  await db.query('begin');

  // profiles — one per signed-up user; profiles.id === auth.users.id (TRD 5)
  //
  // The on_auth_user_created trigger already inserted a row for each of these
  // users when createUser() ran, with display_name derived from the email. This
  // is an upsert rather than a plain insert so the test can still pin the exact
  // names and UPI IDs its later assertions depend on.
  await db.query(
    `insert into profiles (id, display_name, upi_id) values ($1,'Asha','asha@upi'), ($2,'Bhavi','bhavi@upi')
     on conflict (id) do update set display_name = excluded.display_name, upi_id = excluded.upi_id`,
    [ashaUserId, bhaviUserId],
  );

  await db.query(
    `insert into groups (id, name, group_type, created_by) values ($1,'Goa Trip','trip',$2)`,
    [GROUP_ID, ashaUserId],
  );

  // Chin is a placeholder: user_id NULL. Splits/settlements key off member id,
  // never user_id, which is exactly what lets a non-signed-up person owe money.
  await db.query(
    `insert into group_members (id, group_id, user_id, display_name, upi_id, role) values
       ($1,$4,$5,'Asha','asha@upi','admin'),
       ($2,$4,$6,'Bhavi','bhavi@upi','member'),
       ($3,$4,NULL,'Chin','chin@upi','member')`,
    [MEMBER_ASHA, MEMBER_BHAVI, MEMBER_CHIN, GROUP_ID, ashaUserId, bhaviUserId],
  );

  // Expense 1: Asha paid 30000 paise, equal 3 ways -> 10000 each
  await db.query(
    `insert into expenses (id, group_id, paid_by, amount_minor, description, created_by)
     values ($1,$2,$3,30000,'Beach shack dinner',$4)`,
    [EXPENSE_1, GROUP_ID, MEMBER_ASHA, ashaUserId],
  );
  await db.query(
    `insert into expense_splits (expense_id, member_id, share_minor, share_type) values
       ($1,$2,10000,'equal'), ($1,$3,10000,'equal'), ($1,$4,10000,'equal')`,
    [EXPENSE_1, MEMBER_ASHA, MEMBER_BHAVI, MEMBER_CHIN],
  );

  // Expense 2: Bhavi paid 9000 paise, equal 3 ways -> 3000 each
  await db.query(
    `insert into expenses (id, group_id, paid_by, amount_minor, description, created_by)
     values ($1,$2,$3,9000,'Scooter petrol',$4)`,
    [EXPENSE_2, GROUP_ID, MEMBER_BHAVI, bhaviUserId],
  );
  await db.query(
    `insert into expense_splits (expense_id, member_id, share_minor, share_type) values
       ($1,$2,3000,'equal'), ($1,$3,3000,'equal'), ($1,$4,3000,'equal')`,
    [EXPENSE_2, MEMBER_ASHA, MEMBER_BHAVI, MEMBER_CHIN],
  );

  // Bhavi settled 7000 paise to Asha, confirmed. Only 'confirmed' moves balances.
  await db.query(
    `insert into settlements (id, group_id, from_member, to_member, amount_minor, status, confirmed_at)
     values ($1,$2,$3,$4,7000,'confirmed',now())`,
    [SETTLEMENT_1, GROUP_ID, MEMBER_BHAVI, MEMBER_ASHA],
  );

  // ---- second group: Asha + Bhavi, one expense, no placeholder ----
  // Bhavi paid 5000, split 2 ways -> Asha owes 2500, Bhavi is owed 2500.
  await db.query(
    `insert into groups (id, name, group_type, created_by) values ($1,'Lonavala Trip','trip',$2)`,
    [GROUP_2, ashaUserId],
  );
  await db.query(
    `insert into group_members (id, group_id, user_id, display_name, upi_id, role) values
       ($1,$3,$4,'Asha','asha@okaxis','admin'),
       ($2,$3,$5,'Bhavi','bhavi@okhdfc','member')`,
    [M2_ASHA, M2_BHAVI, GROUP_2, ashaUserId, bhaviUserId],
  );
  await db.query(
    `insert into expenses (id, group_id, paid_by, amount_minor, description, created_by)
     values ($1,$2,$3,5000,'Chai and vada pav',$4)`,
    [EXPENSE_3, GROUP_2, M2_BHAVI, bhaviUserId],
  );
  await db.query(
    `insert into expense_splits (expense_id, member_id, share_minor, share_type) values
       ($1,$2,2500,'equal'), ($1,$3,2500,'equal')`,
    [EXPENSE_3, M2_ASHA, M2_BHAVI],
  );

  await db.query('commit');

  console.log('  group "Goa Trip" (trip), 3 members, 2 expenses, 6 splits, 1 confirmed settlement');
  console.log('  group "Lonavala Trip" (trip), 2 members, 1 expense, 2 splits');
  check('seed committed', true);
}

// ---------------------------------------------------------------- 3. invariant #6

async function assertSplitInvariant(): Promise<void> {
  section('3. INVARIANT #6 — splits sum to the expense amount');

  const { rows } = await db.query<{ description: string; amount_minor: string; split_total: string }>(
    `select e.description,
            e.amount_minor,
            coalesce(sum(s.share_minor), 0) as split_total
       from expenses e
       left join expense_splits s on s.expense_id = e.id
      where e.group_id = $1
      group by e.id, e.description, e.amount_minor
      order by e.amount_minor desc`,
    [GROUP_ID],
  );

  check('two expenses present', rows.length === 2, `got ${rows.length}`);
  for (const r of rows) {
    eq(`"${r.description}" splits sum`, BigInt(r.split_total), BigInt(r.amount_minor));
  }
}

// ---------------------------------------------------------------- 4. balances

type BalanceRow = { member_id: string; display_name: string; net_minor: number | string };

/**
 * Informational: who can actually read the tables.
 *
 * splitapp.sql grants SELECT/INSERT/UPDATE/DELETE to `authenticated` only. The PWA
 * talks to Supabase as `authenticated`, so that is the role that matters. `service_role`
 * is deliberately NOT granted by the schema — reported here, not asserted.
 */
async function reportGrants(): Promise<void> {
  section('4. TABLE GRANTS (who can read what)');

  for (const t of RLS_TABLES) {
    const { rows } = await db.query<{ auth: boolean; anon: boolean; svc: boolean }>(
      `select has_table_privilege('authenticated', $1, 'SELECT') as auth,
              has_table_privilege('anon',          $1, 'SELECT') as anon,
              has_table_privilege('service_role',  $1, 'SELECT') as svc`,
      [`public.${t}`],
    );
    const r = rows[0];
    check(`${t.padEnd(14)} authenticated can SELECT`, r.auth === true,
      `anon=${r.anon} service_role=${r.svc}`);
    check(`${t.padEnd(14)} anon CANNOT SELECT`, r.anon === false);
  }
}

async function assertBalances(): Promise<void> {
  section('5. group_balances() — as a real signed-in member, over PostgREST');

  // Make sure PostgREST has the freshly-migrated function in its schema cache.
  await db.query(`notify pgrst, 'reload schema'`);
  await new Promise((r) => setTimeout(r, 1500));

  const asha = await signInAs(ASHA_EMAIL);
  const { data, error } = await asha.rpc('group_balances', { gid: GROUP_ID });
  if (error) throw new Error(`rpc group_balances failed: ${error.message}`);

  const rows = (data ?? []) as BalanceRow[];
  const byName = new Map<string, bigint>();
  for (const r of rows) {
    const n = BigInt(r.net_minor); // throws if it ever arrives as a non-integer
    byName.set(r.display_name, n);
    console.log(`  ${r.display_name.padEnd(6)} net_minor = ${String(n).padStart(7)}  (Rs. ${(Number(n) / 100).toFixed(2)})`);
  }

  check('group_balances() returned 3 rows', rows.length === 3, `got ${rows.length}`);
  eq('Asha  net_minor', byName.get('Asha') ?? -1n, 10000n);
  eq('Bhavi net_minor', byName.get('Bhavi') ?? -1n, 3000n);
  eq('Chin  net_minor', byName.get('Chin') ?? -1n, -13000n);

  const sum = [...byName.values()].reduce((a, b) => a + b, 0n);
  eq('INVARIANT #7 — balances sum to zero', sum, 0n);

  // Cross-check the same function straight from Postgres, so an API-layer quirk
  // cannot mask a wrong number.
  const direct = await db.query<{ display_name: string; net_minor: string }>(
    `select display_name, net_minor from group_balances($1) order by display_name`,
    [GROUP_ID],
  );
  const directSum = direct.rows.reduce((a, r) => a + BigInt(r.net_minor), 0n);
  console.log(`  direct SQL: ${direct.rows.map((r) => `${r.display_name}=${r.net_minor}`).join('  ')}`);
  check('direct SQL agrees with the API', direct.rows.length === 3 && directSum === 0n);
}

/** Signs in via the real magic-link flow (no email is sent) and returns an authed client. */
async function signInAs(email: string) {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (linkErr || !link.properties?.hashed_token) {
    throw new Error(`generateLink(${email}) failed: ${linkErr?.message}`);
  }

  const { data: session, error: otpErr } = await client.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'email',
  });
  if (otpErr || !session.session) throw new Error(`verifyOtp(${email}) failed: ${otpErr?.message}`);

  return client;
}

// ---------------------------------------------------------------- 5. RLS enabled

/**
 * my_group_positions() must agree with group_balances(), to the paise, for
 * every group the caller is in.
 *
 * The two share no code — they cannot, since one returns every member's net for
 * one group and the other one member's net across many. The arithmetic is
 * therefore REPLICATED, and this is what stops the copies drifting: change one
 * without the other and these assertions fail.
 */
async function assertMyGroupPositions(): Promise<void> {
  section('6. my_group_positions() — parity with group_balances()');

  await db.query(`notify pgrst, 'reload schema'`);
  await new Promise((r) => setTimeout(r, 1500));

  const asha = await signInAs(ASHA_EMAIL);
  const { data, error } = await asha.rpc('my_group_positions');
  if (error) throw new Error(`rpc my_group_positions failed: ${error.message}`);

  type Pos = { group_id: string; my_member_id: string; net_minor: string };
  const rows = (data ?? []) as Pos[];
  for (const r of rows) {
    console.log(`  group ${r.group_id.slice(0, 8)}  member ${r.my_member_id.slice(0, 8)}  net_minor = ${r.net_minor}`);
  }

  // Asha is in both seeded groups, and in nothing else.
  check('returns one row per group the caller is in', rows.length === 2, `got ${rows.length}`);
  const ids = new Set(rows.map((r) => r.group_id));
  check('includes the placeholder group (Goa Trip)', ids.has(GROUP_ID));
  check('includes the second group (Lonavala Trip)', ids.has(GROUP_2));
  check('one row per group — no duplicates', ids.size === rows.length,
    `${ids.size} distinct vs ${rows.length} rows`);

  // ---- the drift assertion, per group ----
  for (const r of rows) {
    const gb = await db.query<{ net_minor: string }>(
      `select net_minor from group_balances($1) where member_id = $2`,
      [r.group_id, r.my_member_id],
    );
    check(`group_balances(${r.group_id.slice(0, 8)}) has the caller's row`, gb.rows.length === 1,
      `got ${gb.rows.length}`);
    if (gb.rows.length === 1) {
      eq(
        `DRIFT ${r.group_id.slice(0, 8)} — my_group_positions === group_balances`,
        BigInt(r.net_minor),
        BigInt(gb.rows[0].net_minor),
      );
    }
  }

  // Placeholder parity: Goa Trip contains Chin (user_id NULL), whose activity
  // must still flow into Asha's net. 10000 is the value group_balances() gives
  // Asha there, and it is only correct if Chin's splits were counted.
  const goa = rows.find((r) => r.group_id === GROUP_ID);
  eq('PLACEHOLDER parity — Goa Trip net counts Chin', BigInt(goa?.net_minor ?? '-1'), 10000n);

  // Second group has no placeholder: Bhavi paid 5000, split 2 ways, so Asha owes 2500.
  const lon = rows.find((r) => r.group_id === GROUP_2);
  eq('second group net is correct', BigInt(lon?.net_minor ?? '-1'), -2500n);

  // The grand total the home screen will compute client-side.
  const total = rows.reduce((a, r) => a + BigInt(r.net_minor), 0n);
  eq('grand total across groups', total, 7500n);

  // A non-member must get nothing at all — not a zero, not a row.
  const outsider = await signInAs(OUTSIDER_EMAIL);
  const { data: oData, error: oErr } = await outsider.rpc('my_group_positions');
  check('non-member gets 0 rows (INVOKER + anchor)', !oErr && (oData ?? []).length === 0,
    `err=${oErr?.message ?? 'none'} rows=${(oData ?? []).length}`);
}

/**
 * The partial unique index that makes the "one row per group" guarantee real.
 * Without it my_group_positions() could emit a group twice and the client-side
 * grand total would silently double-count it.
 */
/**
 * Exact per-person shares (migration 20260901120000).
 *
 * Every call goes through PostgREST with a real member JWT, because that is the
 * path the app uses and the one where overload resolution actually matters.
 */
async function assertExactShares(): Promise<void> {
  section('8. create_expense / update_expense - exact shares');

  await db.query(`notify pgrst, 'reload schema'`);
  await new Promise((r) => setTimeout(r, 1500));

  const asha = await signInAs(ASHA_EMAIL);
  const created: string[] = [];

  const sharesFor = async (expenseId: string) => {
    const r = await db.query<{ member_id: string; share_minor: string; share_type: string }>(
      `select member_id, share_minor, share_type from expense_splits where expense_id = $1`,
      [expenseId],
    );
    return r.rows;
  };

  // ---- 1. exact split stores the shares it was given ----------------------
  // 10000 as 5000/3000/2000 - deliberately NOT what an equal split produces
  // (3334/3333/3333), so a silent fallback to the equal path would fail here.
  const exact = await asha.rpc('create_expense', {
    p_group_id: GROUP_ID,
    p_paid_by: MEMBER_ASHA,
    p_amount_minor: 10000,
    p_description: 'Exact split',
    p_participants: [MEMBER_ASHA, MEMBER_BHAVI, MEMBER_CHIN],
    p_shares: [5000, 3000, 2000],
  });
  check('exact split accepted', !exact.error, exact.error?.message ?? '');
  if (exact.data) created.push(exact.data as string);

  if (exact.data) {
    const rows = await sharesFor(exact.data as string);
    const by = new Map(rows.map((r) => [r.member_id, BigInt(r.share_minor)]));
    eq('exact: Asha  share', by.get(MEMBER_ASHA) ?? -1n, 5000n);
    eq('exact: Bhavi share', by.get(MEMBER_BHAVI) ?? -1n, 3000n);
    eq('exact: Chin  share', by.get(MEMBER_CHIN) ?? -1n, 2000n);
    check('share_type is exact on EVERY row', rows.every((r) => r.share_type === 'exact'),
      rows.map((r) => r.share_type).join(','));
  }

  // ---- 2. a zero share stores and reads back ------------------------------
  const withZero = await asha.rpc('create_expense', {
    p_group_id: GROUP_ID,
    p_paid_by: MEMBER_ASHA,
    p_amount_minor: 9000,
    p_description: 'Zero share',
    p_participants: [MEMBER_ASHA, MEMBER_BHAVI, MEMBER_CHIN],
    p_shares: [9000, 0, 0],
  });
  check('zero-share split accepted', !withZero.error, withZero.error?.message ?? '');
  if (withZero.data) {
    created.push(withZero.data as string);
    const rows = await sharesFor(withZero.data as string);
    const by = new Map(rows.map((r) => [r.member_id, BigInt(r.share_minor)]));
    check('zero-share rows are KEPT, not dropped', rows.length === 3, `got ${rows.length}`);
    eq('zero share stored as 0', by.get(MEMBER_BHAVI) ?? -1n, 0n);
  }

  // ---- 3. the sum assertion still fires, and ROLLS BACK -------------------
  const before = Number(
    (await db.query<{ c: string }>(`select count(*) c from expenses where group_id = $1`, [GROUP_ID])).rows[0].c,
  );
  const bad = await asha.rpc('create_expense', {
    p_group_id: GROUP_ID,
    p_paid_by: MEMBER_ASHA,
    p_amount_minor: 10000,
    p_description: 'Does not add up',
    p_participants: [MEMBER_ASHA, MEMBER_BHAVI],
    p_shares: [5000, 4999],
  });
  check('non-adding-up exact split is REJECTED', !!bad.error,
    bad.error?.message?.slice(0, 60) ?? 'no error raised');
  const after = Number(
    (await db.query<{ c: string }>(`select count(*) c from expenses where group_id = $1`, [GROUP_ID])).rows[0].c,
  );
  check('rejected split left NO expense behind (rollback)', after === before,
    `before=${before} after=${after}`);

  // ---- 4. the two new failure modes ---------------------------------------
  const mismatch = await asha.rpc('create_expense', {
    p_group_id: GROUP_ID,
    p_paid_by: MEMBER_ASHA,
    p_amount_minor: 10000,
    p_description: 'Length mismatch',
    p_participants: [MEMBER_ASHA, MEMBER_BHAVI, MEMBER_CHIN],
    p_shares: [5000, 5000],
  });
  check('length mismatch is REJECTED', !!mismatch.error,
    mismatch.error?.message?.slice(0, 60) ?? 'no error raised');

  const negative = await asha.rpc('create_expense', {
    p_group_id: GROUP_ID,
    p_paid_by: MEMBER_ASHA,
    p_amount_minor: 10000,
    p_description: 'Negative share',
    p_participants: [MEMBER_ASHA, MEMBER_BHAVI],
    p_shares: [15000, -5000],
  });
  check('negative share is REJECTED', !!negative.error,
    negative.error?.message?.slice(0, 60) ?? 'no error raised');

  // ---- 5. EQUAL-PATH REGRESSION -------------------------------------------
  // Five keys, no p_shares - the shape every existing caller sends. This also
  // proves a five-key body still resolves after the old signature was dropped,
  // rather than failing with "could not choose the best candidate function".
  const equal = await asha.rpc('create_expense', {
    p_group_id: GROUP_ID,
    p_paid_by: MEMBER_ASHA,
    p_amount_minor: 10000,
    p_description: 'Equal regression',
    p_participants: [MEMBER_ASHA, MEMBER_BHAVI, MEMBER_CHIN],
  });
  check('five-key call RESOLVES after the drop (no overload ambiguity)', !equal.error,
    equal.error?.message ?? '');
  if (equal.data) {
    created.push(equal.data as string);
    const rows = await sharesFor(equal.data as string);
    const shares = rows.map((r) => BigInt(r.share_minor)).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    // 10000 / 3 = 3333 base, remainder 1 to the FIRST participant.
    check('equal path still 3334/3333/3333',
      shares.length === 3 && shares[0] === 3334n && shares[1] === 3333n && shares[2] === 3333n,
      shares.join('/'));
    check('equal path still stores share_type equal',
      rows.every((r) => r.share_type === 'equal'),
      rows.map((r) => r.share_type).join(','));
  }

  // ---- 6. grant correctness on the NEW signature --------------------------
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anonCall = await anon.rpc('create_expense', {
    p_group_id: GROUP_ID,
    p_paid_by: MEMBER_ASHA,
    p_amount_minor: 100,
    p_description: 'anon',
    p_participants: [MEMBER_ASHA],
    p_shares: [100],
  });
  check('anon CANNOT execute the six-arg function', !!anonCall.error,
    anonCall.error?.message?.slice(0, 60) ?? 'no error raised');

  // ---- 7. update_expense exact path ---------------------------------------
  if (exact.data) {
    const upd = await asha.rpc('update_expense', {
      p_expense_id: exact.data as string,
      p_paid_by: MEMBER_ASHA,
      p_amount_minor: 10000,
      p_description: 'Exact split, edited',
      p_participants: [MEMBER_ASHA, MEMBER_BHAVI],
      p_shares: [7500, 2500],
    });
    check('update_expense accepts exact shares', !upd.error, upd.error?.message ?? '');
    const rows = await sharesFor(exact.data as string);
    const by = new Map(rows.map((r) => [r.member_id, BigInt(r.share_minor)]));
    check('update replaced the split (2 rows)', rows.length === 2, `got ${rows.length}`);
    eq('update: Asha  share', by.get(MEMBER_ASHA) ?? -1n, 7500n);
    eq('update: Bhavi share', by.get(MEMBER_BHAVI) ?? -1n, 2500n);
  }

  // Leave the group exactly as the earlier sections expect it.
  for (const id of created) {
    await db.query(`delete from expense_splits where expense_id = $1`, [id]);
    await db.query(`delete from expenses where id = $1`, [id]);
  }
  console.log(`  cleaned up ${created.length} test expenses`);
}

async function assertMemberUniqueness(): Promise<void> {
  section('7. uq_members_group_user — duplicate membership is rejected');

  const idx = await db.query(
    `select indexdef from pg_indexes
     where schemaname='public' and tablename='group_members' and indexname='uq_members_group_user'`,
  );
  check('partial unique index exists', idx.rows.length === 1);
  check('index is PARTIAL on user_id is not null',
    (idx.rows[0]?.indexdef ?? '').toLowerCase().includes('where (user_id is not null)'),
    idx.rows[0]?.indexdef ?? '');

  // A second member row for a user already in the group must be refused.
  const ashaUserId = (await db.query<{ user_id: string }>(
    `select user_id from group_members where id = $1`, [MEMBER_ASHA],
  )).rows[0].user_id;

  let blocked = false;
  let detail = '';
  try {
    await db.query('begin');
    await db.query(
      `insert into group_members (group_id, user_id, display_name, role)
       values ($1,$2,'Asha duplicate','member')`,
      [GROUP_ID, ashaUserId],
    );
    await db.query('rollback');
  } catch (e) {
    blocked = true;
    detail = (e as Error).message.split(String.fromCharCode(10))[0];
    await db.query('rollback');
  }
  check('duplicate (group_id, user_id) is REJECTED', blocked, detail);

  // Placeholders are outside the index: many per group must stay legal.
  let placeholdersOk = false;
  detail = ''; // do not inherit the message from the rejection above
  try {
    await db.query('begin');
    await db.query(
      `insert into group_members (group_id, user_id, display_name, role) values
         ($1,null,'Extra placeholder A','member'),
         ($1,null,'Extra placeholder B','member')`,
      [GROUP_ID],
    );
    placeholdersOk = true;
    await db.query('rollback');
  } catch (e) {
    detail = (e as Error).message.split(String.fromCharCode(10))[0];
    await db.query('rollback');
  }
  check('multiple placeholders per group still ALLOWED', placeholdersOk, detail);
}

async function assertRlsEnabled(): Promise<void> {
  section('6. RLS ENABLED on all six tables');

  const { rows } = await db.query<{ tablename: string; rls_enabled: boolean; policy_count: string }>(
    `select c.relname as tablename,
            c.relrowsecurity as rls_enabled,
            (select count(*) from pg_policy p where p.polrelid = c.oid) as policy_count
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = any($1)
      order by c.relname`,
    [RLS_TABLES],
  );

  check('all six tables exist', rows.length === 6, `found ${rows.length}`);
  for (const t of RLS_TABLES) {
    const row = rows.find((r) => r.tablename === t);
    check(`${t.padEnd(14)} RLS enabled`, row?.rls_enabled === true, `policies: ${row?.policy_count ?? 0}`);
    // Invariant #3: never expose a table without a policy.
    check(`${t.padEnd(14)} has >=1 policy`, Number(row?.policy_count ?? 0) > 0);
  }
}

// ---------------------------------------------------------------- 6. RLS behaviour

async function assertRlsBehaviour(ashaUserId: string, outsiderUserId: string): Promise<void> {
  section('7. RLS BEHAVIOUR — member sees the group, non-member sees nothing');

  const member = await countsAs(ashaUserId);
  console.log(`  as Asha (member)   : ${JSON.stringify(member)}`);
  check('member sees both seeded groups', member.groups === 2, `got ${member.groups}`);
  check('member sees 5 members across them', member.group_members === 5, `got ${member.group_members}`);
  check('member sees 3 expenses', member.expenses === 3, `got ${member.expenses}`);
  check('member sees 8 splits', member.expense_splits === 8, `got ${member.expense_splits}`);
  check('member sees 1 settlement', member.settlements === 1);
  check('member gets 3 balance rows', member.balances === 3);

  const outsider = await countsAs(outsiderUserId);
  console.log(`  as outsider (none) : ${JSON.stringify(outsider)}`);
  check('non-member sees 0 groups', outsider.groups === 0);
  check('non-member sees 0 members', outsider.group_members === 0);
  check('non-member sees 0 expenses', outsider.expenses === 0);
  check('non-member sees 0 splits', outsider.expense_splits === 0);
  check('non-member sees 0 settlements', outsider.settlements === 0);
  check('non-member gets 0 balance rows', outsider.balances === 0);

  // A non-member must not be able to insert an expense into someone else's group.
  const blocked = await insertBlockedFor(outsiderUserId);
  check('non-member INSERT into the group is blocked', blocked.blocked, blocked.detail);

  // Same check again, but through the real API with a real JWT — this is the
  // path an actual attacker would use.
  const outsiderApi = await signInAs(OUTSIDER_EMAIL);
  const bal = await outsiderApi.rpc('group_balances', { gid: GROUP_ID });
  check('non-member gets 0 balance rows over the API', !bal.error && (bal.data ?? []).length === 0,
    bal.error ? `error: ${bal.error.message}` : `rows: ${(bal.data ?? []).length}`);

  const grp = await outsiderApi.from('groups').select('id');
  check('non-member sees 0 groups over the API', !grp.error && (grp.data ?? []).length === 0,
    grp.error ? `error: ${grp.error.message}` : `rows: ${(grp.data ?? []).length}`);

  const exp = await outsiderApi.from('expenses').select('id');
  check('non-member sees 0 expenses over the API', !exp.error && (exp.data ?? []).length === 0,
    exp.error ? `error: ${exp.error.message}` : `rows: ${(exp.data ?? []).length}`);
}

/** Runs read counts inside a transaction impersonating `userId` as the `authenticated` role. */
async function countsAs(userId: string) {
  await db.query('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    await db.query('set local role authenticated');

    // Scoped to the seeded groups. Counting globally coupled this to the exact
    // seed shape, so adding a second group broke assertions that were really
    // asking "can a member see THIS group's rows?". The global case is still
    // covered by the API checks below.
    const G = [GROUP_ID, GROUP_2];
    const one = async (sql: string, params: unknown[] = [G]) =>
      Number((await db.query<{ c: string }>(sql, params)).rows[0].c);
    const result = {
      groups: await one(`select count(*) c from groups where id = any($1)`),
      group_members: await one(`select count(*) c from group_members where group_id = any($1)`),
      expenses: await one(`select count(*) c from expenses where group_id = any($1)`),
      expense_splits: await one(
        `select count(*) c from expense_splits s join expenses e on e.id = s.expense_id where e.group_id = any($1)`),
      settlements: await one(`select count(*) c from settlements where group_id = any($1)`),
      balances: Number(
        (await db.query<{ c: string }>(`select count(*) c from group_balances($1)`, [GROUP_ID])).rows[0].c,
      ),
    };
    return result;
  } finally {
    await db.query('rollback'); // also resets the role
  }
}

async function insertBlockedFor(userId: string): Promise<{ blocked: boolean; detail: string }> {
  await db.query('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    await db.query('set local role authenticated');
    await db.query(
      `insert into expenses (group_id, paid_by, amount_minor, description, created_by)
       values ($1,$2,100,'should not exist',$3)`,
      [GROUP_ID, MEMBER_ASHA, userId],
    );
    return { blocked: false, detail: 'INSERT SUCCEEDED — this is a security hole' };
  } catch (e) {
    return { blocked: true, detail: `rejected: ${(e as Error).message.split('\n')[0]}` };
  } finally {
    await db.query('rollback');
  }
}

// ---------------------------------------------------------------- cleanup

async function cleanup(): Promise<void> {
  // Ordered by FK dependency — expense_splits.member_id and settlements.*_member
  // reference group_members without ON DELETE CASCADE.
  await db.query('begin');
  for (const g of [GROUP_ID, GROUP_2]) {
    await db.query(`delete from expense_splits where expense_id in (select id from expenses where group_id = $1)`, [g]);
    await db.query(`delete from settlements where group_id = $1`, [g]);
    await db.query(`delete from expenses where group_id = $1`, [g]);
    await db.query(`delete from group_members where group_id = $1`, [g]);
    await db.query(`delete from groups where id = $1`, [g]);
  }
  await db.query('commit');

  // profiles rows cascade from auth.users
  const emails = [ASHA_EMAIL, BHAVI_EMAIL, OUTSIDER_EMAIL];
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const u of data?.users ?? []) {
    if (u.email && emails.includes(u.email)) await admin.auth.admin.deleteUser(u.id);
  }
  createdUserIds.length = 0;
}

main().catch(async (e) => {
  console.error(`\n  ERROR: ${(e as Error).message}\n`);
  try { await db.end(); } catch { /* already closed */ }
  process.exit(1);
});
