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

// A THIRD group carrying kind='friend' (migration 20260914103000). It is what
// proves my_group_positions() now excludes friend tabs and what
// my_friend_positions() reads.
//
// SEEDED BY DIRECT INSERT, pending M2. create_friend_tab() is the M2 write
// surface and does not exist yet, so these rows are written the same way every
// other fixture here is. When M2 lands, this seed should move to that RPC so the
// test exercises the real creation path rather than a hand-built row.
const GROUP_F = '5171a11a-0000-4000-8000-000000000003';
const MF_ASHA = '5171a11a-0000-4000-8000-0000000000a3';
const MF_BHAVI = '5171a11a-0000-4000-8000-0000000000b3';
const EXPENSE_F = '5171a11a-0000-4000-8000-0000000000e4';

// M2 (20260915093000) creates friend tabs through create_friend_tab(), which
// generates its own uuids — there is no fixture id to clean up by. Cleanup
// therefore finds them by joining friendships to the test users, and separately
// sweeps any kind='friend' group whose members are test users, which is what an
// orphan from a failed race would look like.
const ASHA_EMAIL = 'splitapp-acceptance-asha@example.com';
const BHAVI_EMAIL = 'splitapp-acceptance-bhavi@example.com';
const OUTSIDER_EMAIL = 'splitapp-acceptance-outsider@example.com';

// A FOURTH identity, existing only to be the other side of section 10's create
// race.
//
// The race has to make its participants real members of the tab it creates —
// that is what creating a tab MEANS. Running it as OUTSIDER_EMAIL therefore
// destroyed section 7's premise: that account stopped being a non-member, and
// "non-member sees 0 groups over the API" correctly started reporting 1.
//
// Rejected the alternative of tearing the race tab down before section 7: that
// would delete the very rows proving the race resolved to one tab, to protect a
// later assertion. A separate identity keeps BOTH tests at full strength and
// removes the ordering coupling entirely — section 7's outsider is now a true
// non-member no matter what section 10 does.
const RACER_EMAIL = 'splitapp-acceptance-racer@example.com';

// Derived from the four above rather than restated, so a changed address
// cannot leave cleanup hunting for an email nothing uses.
const TEST_EMAILS_FOR_CLEANUP = [ASHA_EMAIL, BHAVI_EMAIL, OUTSIDER_EMAIL, RACER_EMAIL];

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
    const { ashaUserId, bhaviUserId, outsiderUserId, racerUserId } = await createAuthUsers();
    await seed(ashaUserId, bhaviUserId);
    await assertSplitInvariant();
    await reportGrants();
    await assertBalances();
    await assertMyGroupPositions();
    await assertMyFriendPositions();
    await assertMemberUniqueness();
    await assertExactShares();
    await assertCashSettlements();
    await assertFriendTabCreation(ashaUserId, bhaviUserId, racerUserId);
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
  const racerUserId = await createUser(RACER_EMAIL);

  console.log(`  Asha     auth.users.id = ${ashaUserId}`);
  console.log(`  Bhavi    auth.users.id = ${bhaviUserId}`);
  console.log(`  Outsider auth.users.id = ${outsiderUserId}  (non-member, for the RLS check)`);
  console.log(`  Racer    auth.users.id = ${racerUserId}  (section 10's create race only)`);
  console.log('  Chin     has NO auth user — placeholder member, user_id stays NULL');

  return { ashaUserId, bhaviUserId, outsiderUserId, racerUserId };
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

  // ---- third group: a FRIEND TAB (kind='friend'), Asha + Bhavi ----
  // Seeded by direct insert pending M2 — create_friend_tab() does not exist yet.
  // Asha paid 4000, split 2 ways -> Bhavi owes Asha 2000. Chosen so the sign is
  // unambiguous: Asha is +2000 (owed), Bhavi is -2000 (owes), and the two must
  // be exact mirrors when the function is called from each side.
  await db.query(
    `insert into groups (id, name, group_type, kind, created_by)
     values ($1,'friend:asha:bhavi','other','friend',$2)`,
    [GROUP_F, ashaUserId],
  );
  await db.query(
    `insert into group_members (id, group_id, user_id, display_name, upi_id, role) values
       ($1,$3,$4,'Asha','asha@upi','admin'),
       ($2,$3,$5,'Bhavi','bhavi@upi','member')`,
    [MF_ASHA, MF_BHAVI, GROUP_F, ashaUserId, bhaviUserId],
  );
  await db.query(
    `insert into expenses (id, group_id, paid_by, amount_minor, description, created_by)
     values ($1,$2,$3,4000,'Cab to airport',$4)`,
    [EXPENSE_F, GROUP_F, MF_ASHA, ashaUserId],
  );
  await db.query(
    `insert into expense_splits (expense_id, member_id, share_minor, share_type) values
       ($1,$2,2000,'equal'), ($1,$3,2000,'equal')`,
    [EXPENSE_F, MF_ASHA, MF_BHAVI],
  );

  await db.query('commit');

  console.log('  group "Goa Trip" (trip), 3 members, 2 expenses, 6 splits, 1 confirmed settlement');
  console.log('  group "Lonavala Trip" (trip), 2 members, 1 expense, 2 splits');
  console.log('  FRIEND TAB kind=friend, 2 members, 1 expense — Bhavi owes Asha 2000');
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

  // Asha is in both seeded GROUPS, and in nothing else. She is also in the
  // friend tab — the count staying at 2 is precisely the regression guard, not
  // an accident of the seed: without the kind='group' filter this would be 3.
  check('returns one row per group the caller is in', rows.length === 2, `got ${rows.length}`);
  const ids = new Set(rows.map((r) => r.group_id));
  check('includes the placeholder group (Goa Trip)', ids.has(GROUP_ID));
  check('includes the second group (Lonavala Trip)', ids.has(GROUP_2));
  check('one row per group — no duplicates', ids.size === rows.length,
    `${ids.size} distinct vs ${rows.length} rows`);

  // ---- TEST 1: friend tabs are EXCLUDED (migration 20260914103000) --------
  // The whole point of the filter. Asha is a member of GROUP_F, so before the
  // filter this function returned it and the Groups home screen would have
  // listed a tab named 'friend:asha:bhavi'.
  check('EXCLUDES kind=friend tabs', !ids.has(GROUP_F),
    ids.has(GROUP_F) ? 'friend tab leaked into the groups list' : 'friend tab absent');

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
 * my_friend_positions() — the dedicated friend-tab read (migration 20260914103000).
 *
 * SECURITY INVOKER, so every call here goes through PostgREST with a real
 * member JWT: that is the path the app uses and the one where auth.uid() and
 * RLS actually apply.
 *
 * Fixture: GROUP_F carries kind='friend' with Asha + Bhavi. Asha paid 4000,
 * split 2 ways, so Asha is +2000 (owed) and Bhavi is -2000 (owes). Seeded by
 * direct insert pending M2 — create_friend_tab() does not exist yet.
 */
async function assertMyFriendPositions(): Promise<void> {
  section('6b. my_friend_positions() — signed net and counterparty resolution');

  await db.query(`notify pgrst, 'reload schema'`);
  await new Promise((r) => setTimeout(r, 1500));

  type FriendPos = {
    group_id: string;
    my_member_id: string;
    counterparty_member_id: string;
    counterparty_user_id: string;
    name: string;
    upi: string | null;
    net_minor: string;
    last_entry_description: string | null;
    last_entry_at: string | null;
  };

  const asha = await signInAs(ASHA_EMAIL);
  const bhavi = await signInAs(BHAVI_EMAIL);

  const readAs = async (client: Awaited<ReturnType<typeof signInAs>>) => {
    const { data, error } = await client.rpc('my_friend_positions');
    if (error) throw new Error(`rpc my_friend_positions failed: ${error.message}`);
    return (data ?? []) as FriendPos[];
  };

  // ---- shape: only friend tabs, never the real groups ---------------------
  const ashaRows = await readAs(asha);
  for (const r of ashaRows) {
    console.log(
      `  tab ${r.group_id.slice(0, 8)}  vs ${r.name.padEnd(6)}  net_minor = ${r.net_minor}`,
    );
  }

  check('returns only the friend tab', ashaRows.length === 1, `got ${ashaRows.length}`);
  const aTab = ashaRows.find((r) => r.group_id === GROUP_F);
  check('the row IS the friend tab', aTab !== undefined);
  const gids = new Set(ashaRows.map((r) => r.group_id));
  check('does NOT return kind=group rows', !gids.has(GROUP_ID) && !gids.has(GROUP_2));

  if (aTab) {
    // ---- TEST 2a: friend-owes-you (positive from Asha's POV) --------------
    eq('FRIEND OWES YOU — Asha net is +2000', BigInt(aTab.net_minor), 2000n);

    // ---- TEST 3a: counterparty resolution from Asha's side ----------------
    check('Asha my_member_id is her own member row', aTab.my_member_id === MF_ASHA,
      `${aTab.my_member_id.slice(0, 8)} vs ${MF_ASHA.slice(0, 8)}`);
    check('Asha counterparty_member_id is Bhavi', aTab.counterparty_member_id === MF_BHAVI,
      `${aTab.counterparty_member_id.slice(0, 8)} vs ${MF_BHAVI.slice(0, 8)}`);
    check('Asha sees the counterparty NAME as Bhavi', aTab.name === 'Bhavi', aTab.name);
    check('Asha sees the counterparty UPI as bhavi@upi', aTab.upi === 'bhavi@upi', String(aTab.upi));
    check('last_entry is the seeded expense', aTab.last_entry_description === 'Cab to airport',
      String(aTab.last_entry_description));

    // Parity with the existing balance source of truth, the same drift
    // assertion my_group_positions() carries. A change to one of the three
    // balance computations must be mirrored in the others, and this is what
    // fails if it is not.
    const gb = await db.query<{ net_minor: string }>(
      `select net_minor from group_balances($1) where member_id = $2`,
      [GROUP_F, MF_ASHA],
    );
    check('group_balances has Asha row for the friend tab', gb.rows.length === 1);
    if (gb.rows.length === 1) {
      eq('DRIFT — my_friend_positions === group_balances', BigInt(aTab.net_minor),
        BigInt(gb.rows[0].net_minor));
    }
  }

  // ---- TEST 2b + 3b: the SAME tab from Bhavi's POV ------------------------
  // Sign must invert and the counterparty must flip. Reading the same row from
  // both sides is the only way to catch a function that hardcodes one side.
  const bhaviRows = await readAs(bhavi);
  const bTab = bhaviRows.find((r) => r.group_id === GROUP_F);
  check('Bhavi also sees the friend tab', bTab !== undefined, `got ${bhaviRows.length} rows`);

  if (bTab && aTab) {
    eq('YOU OWE — Bhavi net is -2000', BigInt(bTab.net_minor), -2000n);
    eq('sign INVERTS between the two sides', BigInt(aTab.net_minor) + BigInt(bTab.net_minor), 0n);

    check('Bhavi my_member_id is his own member row', bTab.my_member_id === MF_BHAVI,
      `${bTab.my_member_id.slice(0, 8)} vs ${MF_BHAVI.slice(0, 8)}`);
    check('Bhavi counterparty_member_id is Asha', bTab.counterparty_member_id === MF_ASHA,
      `${bTab.counterparty_member_id.slice(0, 8)} vs ${MF_ASHA.slice(0, 8)}`);
    check('counterparty NAME flips to Asha', bTab.name === 'Asha', bTab.name);
    check('counterparty_user_id differs between the two sides',
      aTab.counterparty_user_id !== bTab.counterparty_user_id);
  }

  // ---- TEST 2c: SETTLED (net 0) ------------------------------------------
  // Bhavi pays Asha the full 2000 and Asha confirms, through the real two-step
  // UPI path — which is also the first proof that a kind='friend' group settles
  // through record_settlement unchanged.
  const rec = await bhavi.rpc('record_settlement', {
    p_group_id: GROUP_F,
    p_from_member: MF_BHAVI,
    p_to_member: MF_ASHA,
    p_amount_minor: 2000,
  });
  check('record_settlement works on a friend tab', !rec.error, rec.error?.message ?? '');

  if (rec.data) {
    const settlementId = rec.data as string;

    // Pending must NOT move the balance yet.
    const midA = (await readAs(asha)).find((r) => r.group_id === GROUP_F);
    eq('pending settlement does NOT move the net', BigInt(midA?.net_minor ?? '-1'), 2000n);

    const conf = await asha.rpc('confirm_settlement', { p_settlement_id: settlementId });
    check('confirm_settlement works on a friend tab', !conf.error, conf.error?.message ?? '');

    const doneA = (await readAs(asha)).find((r) => r.group_id === GROUP_F);
    const doneB = (await readAs(bhavi)).find((r) => r.group_id === GROUP_F);
    eq('SETTLED — Asha net is 0', BigInt(doneA?.net_minor ?? '-1'), 0n);
    eq('SETTLED — Bhavi net is 0', BigInt(doneB?.net_minor ?? '-1'), 0n);

    // Leave the tab as the seed built it, so this section is re-runnable and
    // nothing downstream sees a settled tab.
    await db.query(`delete from settlements where id = $1`, [settlementId]);
  }

  // ---- TEST 4: a non-member gets nothing (RLS / anchor scoping) -----------
  // Not a zero row, not an empty-named row — no row at all. The anchor is
  // gm.user_id = auth.uid(), and members_select backs it up.
  const outsider = await signInAs(OUTSIDER_EMAIL);
  const { data: oData, error: oErr } = await outsider.rpc('my_friend_positions');
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

  // ---- 8. EXACT SPLIT ROUND-TRIPS UNCHANGED -------------------------------
  // The corruption this guards against: the edit screen used to read only
  // member_id from expense_splits, so an exact split reopened in Equally mode
  // and a no-op re-save silently RE-DIVIDED it, destroying the shares the user
  // had typed. This asserts the shape the edit screen now sends -- the same
  // participants with the same p_shares -- leaves the stored figures identical.
  const rt = await asha.rpc('create_expense', {
    p_group_id: GROUP_ID,
    p_paid_by: MEMBER_ASHA,
    p_amount_minor: 10000,
    p_description: 'Round-trip',
    p_participants: [MEMBER_ASHA, MEMBER_BHAVI, MEMBER_CHIN],
    p_shares: [7000, 2500, 500],
  });
  check('round-trip: exact split created', !rt.error, rt.error?.message ?? '');

  if (rt.data) {
    created.push(rt.data as string);
    const rtId = rt.data as string;

    const loaded = await sharesFor(rtId);
    const loadedBy = new Map(loaded.map((r) => [r.member_id, BigInt(r.share_minor)]));

    // Re-save with exactly what a load would have produced -- no edits at all.
    const resave = await asha.rpc('update_expense', {
      p_expense_id: rtId,
      p_paid_by: MEMBER_ASHA,
      p_amount_minor: 10000,
      p_description: 'Round-trip',
      p_participants: [MEMBER_ASHA, MEMBER_BHAVI, MEMBER_CHIN],
      p_shares: [
        Number(loadedBy.get(MEMBER_ASHA) ?? -1n),
        Number(loadedBy.get(MEMBER_BHAVI) ?? -1n),
        Number(loadedBy.get(MEMBER_CHIN) ?? -1n),
      ],
    });
    check('round-trip: unchanged re-save accepted', !resave.error, resave.error?.message ?? '');

    const after = await sharesFor(rtId);
    const afterBy = new Map(after.map((r) => [r.member_id, BigInt(r.share_minor)]));

    eq('ROUND-TRIP Asha  share unchanged', afterBy.get(MEMBER_ASHA) ?? -1n, 7000n);
    eq('ROUND-TRIP Bhavi share unchanged', afterBy.get(MEMBER_BHAVI) ?? -1n, 2500n);
    eq('ROUND-TRIP Chin  share unchanged', afterBy.get(MEMBER_CHIN) ?? -1n, 500n);
    check('ROUND-TRIP share_type still exact', after.every((r) => r.share_type === 'exact'),
      after.map((r) => r.share_type).join(','));

    // The explicit negative: an equal re-division would have produced
    // 3334/3333/3333. If any of those appear, the corruption is back.
    const shares = after.map((r) => BigInt(r.share_minor)).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    check('ROUND-TRIP was NOT re-divided to equal',
      !(shares[0] === 3334n && shares[1] === 3333n && shares[2] === 3333n),
      shares.join('/'));
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

/**
 * Cash settlements for placeholder members (migration 20260902090000).
 *
 * record_cash_settlement is SECURITY DEFINER, so RLS is NOT a backstop inside
 * it: every guard in its body IS the security boundary. These checks exercise
 * that boundary through PostgREST with real member JWTs, which is the path an
 * attacker would use.
 *
 * Group layout: Asha (real, admin), Bhavi (real, member), Chin (placeholder).
 */
async function assertCashSettlements(): Promise<void> {
  section('9. record_cash_settlement - placeholder cash, counterparty or admin');

  await db.query(`notify pgrst, 'reload schema'`);
  await new Promise((r) => setTimeout(r, 1500));

  const asha = await signInAs(ASHA_EMAIL);   // admin + group creator
  const bhavi = await signInAs(BHAVI_EMAIL); // plain member
  const createdSettlements: string[] = [];

  const rowOf = async (id: string) =>
    (await db.query<{ method: string; status: string; recorded_by: string | null; amount_minor: string }>(
      `select method, status, recorded_by, amount_minor from settlements where id = $1`,
      [id],
    )).rows[0];

  const netOf = async (memberId: string) => {
    const r = await db.query<{ net_minor: string }>(
      `select net_minor from group_balances($1) where member_id = $2`,
      [GROUP_ID, memberId],
    );
    return BigInt(r.rows[0]?.net_minor ?? '0');
  };

  // ---- 1. counterparty records ------------------------------------------
  // Chin (placeholder) paid Asha in cash. Asha is the counterparty.
  const byParty = await asha.rpc('record_cash_settlement', {
    p_group_id: GROUP_ID,
    p_from_member: MEMBER_CHIN,
    p_to_member: MEMBER_ASHA,
    p_amount_minor: 1000,
  });
  check('counterparty can record a cash settlement', !byParty.error, byParty.error?.message ?? '');
  if (byParty.data) {
    createdSettlements.push(byParty.data as string);
    const row = await rowOf(byParty.data as string);
    check('cash row: method=cash', row.method === 'cash', row.method);
    check('cash row: status=confirmed immediately', row.status === 'confirmed', row.status);
    check('cash row: recorded_by = the recorder', row.recorded_by === MEMBER_ASHA,
      String(row.recorded_by));
  }

  // ---- 2. admin records on someone else's behalf --------------------------
  // Asha is admin AND creator, and is party to neither side here.
  const byAdmin = await asha.rpc('record_cash_settlement', {
    p_group_id: GROUP_ID,
    p_from_member: MEMBER_CHIN,
    p_to_member: MEMBER_BHAVI,
    p_amount_minor: 500,
  });
  check('admin can record on behalf of two others', !byAdmin.error, byAdmin.error?.message ?? '');
  if (byAdmin.data) {
    createdSettlements.push(byAdmin.data as string);
    const row = await rowOf(byAdmin.data as string);
    check('admin-recorded row: recorded_by = the admin', row.recorded_by === MEMBER_ASHA,
      String(row.recorded_by));
  }

  // ---- 3. a plain non-party member is REFUSED, and nothing is written -----
  // Bhavi is a member but neither party and not admin. This is the A1-shaped
  // hole in a new place: asserting a payment about other people's money.
  const before = Number(
    (await db.query<{ c: string }>(`select count(*) c from settlements where group_id = $1`, [GROUP_ID])).rows[0].c,
  );
  const byStranger = await bhavi.rpc('record_cash_settlement', {
    p_group_id: GROUP_ID,
    p_from_member: MEMBER_CHIN,
    p_to_member: MEMBER_ASHA,
    p_amount_minor: 9999,
  });
  check('plain non-party member is REFUSED', !!byStranger.error,
    byStranger.error?.message?.slice(0, 70) ?? 'no error raised');
  const after = Number(
    (await db.query<{ c: string }>(`select count(*) c from settlements where group_id = $1`, [GROUP_ID])).rows[0].c,
  );
  check('refused attempt created NO row (rollback)', after === before,
    `before=${before} after=${after}`);

  // ---- 4. two real accounts is REFUSED ------------------------------------
  // Without this guard, one account-holder could mark a payment to another as
  // confirmed without the payee ever agreeing - worse than the hole being closed.
  const twoReal = await asha.rpc('record_cash_settlement', {
    p_group_id: GROUP_ID,
    p_from_member: MEMBER_BHAVI,
    p_to_member: MEMBER_ASHA,
    p_amount_minor: 100,
  });
  check('two real-account parties are REFUSED', !!twoReal.error,
    twoReal.error?.message?.slice(0, 70) ?? 'no error raised');

  // ---- 5 + 6. balances move identically, and still sum to zero ------------
  // A confirmed cash row must be arithmetically indistinguishable from a
  // confirmed UPI one: group_balances() reads status, never method.
  const ashaBefore = await netOf(MEMBER_ASHA);
  const chinBefore = await netOf(MEMBER_CHIN);

  const moving = await asha.rpc('record_cash_settlement', {
    p_group_id: GROUP_ID,
    p_from_member: MEMBER_CHIN,
    p_to_member: MEMBER_ASHA,
    p_amount_minor: 2500,
  });
  check('cash settlement for the balance check accepted', !moving.error, moving.error?.message ?? '');
  if (moving.data) createdSettlements.push(moving.data as string);

  const ashaAfter = await netOf(MEMBER_ASHA);
  const chinAfter = await netOf(MEMBER_CHIN);

  // from_member +amount, to_member -amount - the same expression a confirmed
  // UPI settlement moves.
  eq('cash moves payer net by +amount', chinAfter - chinBefore, 2500n);
  eq('cash moves payee net by -amount', ashaAfter - ashaBefore, -2500n);

  const sum = (await db.query<{ s: string }>(
    `select coalesce(sum(net_minor),0) s from group_balances($1)`, [GROUP_ID],
  )).rows[0].s;
  eq('INVARIANT #7 - still sums to zero after cash', BigInt(sum), 0n);

  // ---- 7. reverse direction: a placeholder OWES you ----------------------
  const reverse = await asha.rpc('record_cash_settlement', {
    p_group_id: GROUP_ID,
    p_from_member: MEMBER_ASHA,
    p_to_member: MEMBER_CHIN,
    p_amount_minor: 700,
  });
  check('reverse direction (you pay a placeholder) works', !reverse.error,
    reverse.error?.message ?? '');
  if (reverse.data) {
    createdSettlements.push(reverse.data as string);
    const row = await rowOf(reverse.data as string);
    check('reverse row is cash + confirmed', row.method === 'cash' && row.status === 'confirmed',
      `${row.method}/${row.status}`);
  }

  // ---- 8. UPI REGRESSION -------------------------------------------------
  // record_settlement must still create PENDING rows, now defaulting to
  // method='upi', and confirm_settlement must still work unchanged.
  const upi = await bhavi.rpc('record_settlement', {
    p_group_id: GROUP_ID,
    p_from_member: MEMBER_BHAVI,
    p_to_member: MEMBER_ASHA,
    p_amount_minor: 300,
  });
  check('UPI regression: record_settlement still works', !upi.error, upi.error?.message ?? '');
  if (upi.data) {
    createdSettlements.push(upi.data as string);
    const row = await rowOf(upi.data as string);
    check('UPI regression: method defaults to upi', row.method === 'upi', row.method);
    check('UPI regression: still pending (two-step intact)', row.status === 'pending', row.status);
    check('UPI regression: recorded_by stays NULL', row.recorded_by === null, String(row.recorded_by));

    const conf = await asha.rpc('confirm_settlement', { p_settlement_id: upi.data });
    check('UPI regression: confirm_settlement unchanged', !conf.error, conf.error?.message ?? '');
    const after2 = await rowOf(upi.data as string);
    check('UPI regression: confirms to confirmed', after2.status === 'confirmed', after2.status);
  }

  // ---- 9. legacy rows -----------------------------------------------------
  // The seeded settlement predates these columns in spirit: it was inserted
  // directly, so it exercises the DEFAULT rather than the RPC.
  const legacy = await rowOf(SETTLEMENT_1);
  check('legacy row reads method=upi', legacy.method === 'upi', legacy.method);
  check('legacy row recorded_by IS NULL', legacy.recorded_by === null, String(legacy.recorded_by));
  check('legacy confirmed row still counts toward balances', legacy.status === 'confirmed',
    legacy.status);

  // Leave the group as the earlier sections expect it.
  for (const id of createdSettlements) {
    await db.query(`delete from settlements where id = $1`, [id]);
  }
  console.log(`  cleaned up ${createdSettlements.length} test settlements`);
}

/**
 * create_friend_tab() + the two-member cap (migration 20260915093000).
 *
 * Every call goes through PostgREST with a real member JWT. That is not a style
 * choice here: create_friend_tab reads auth.uid(), so it CANNOT be exercised
 * through the service-role pg connection the seed uses — a direct call would see
 * a null uid and raise 28000.
 *
 * These tests are ADDITIVE. M1's GROUP_F seed stays a direct insert: section 6b
 * asserts my_member_id === MF_ASHA against hardcoded fixture uuids, and
 * create_friend_tab generates its own, so switching the seed would mean
 * rewriting those assertions to chase generated ids. The task said leave it if
 * it complicates them, and it does.
 */
async function assertFriendTabCreation(
  ashaUserId: string,
  bhaviUserId: string,
  racerUserId: string,
): Promise<void> {
  section('10. create_friend_tab — idempotent, race-safe, capped at two');

  await db.query(`notify pgrst, 'reload schema'`);
  await new Promise((r) => setTimeout(r, 1500));

  const asha = await signInAs(ASHA_EMAIL);
  const bhavi = await signInAs(BHAVI_EMAIL);
  // The racer, NOT the outsider: creating a tab makes both parties real members
  // of it, and section 7 needs OUTSIDER_EMAIL to stay a true non-member.
  const racer = await signInAs(RACER_EMAIL);

  const lo = ashaUserId < bhaviUserId ? ashaUserId : bhaviUserId;
  const hi = ashaUserId < bhaviUserId ? bhaviUserId : ashaUserId;

  // ---- 1. CREATION SHAPE -------------------------------------------------
  const created = await asha.rpc('create_friend_tab', { p_other: bhaviUserId });
  check('create_friend_tab succeeds', !created.error, created.error?.message ?? '');

  const tabId = created.data as string | null;
  check('returns a group id', typeof tabId === 'string' && tabId.length === 36, String(tabId));

  if (tabId) {
    const g = await db.query<{ kind: string; group_type: string; name: string; created_by: string }>(
      `select kind, group_type, name, created_by from groups where id = $1`, [tabId],
    );
    check('group exists', g.rows.length === 1);
    check('group kind is friend', g.rows[0]?.kind === 'friend', g.rows[0]?.kind ?? 'missing');
    check('group_type is other (not overloaded)', g.rows[0]?.group_type === 'other',
      g.rows[0]?.group_type ?? 'missing');
    check('name is the deterministic sentinel',
      g.rows[0]?.name === `friend:${lo.slice(0, 8)}:${hi.slice(0, 8)}`, g.rows[0]?.name ?? 'missing');
    check('created_by is the caller', g.rows[0]?.created_by === ashaUserId);

    const m = await db.query<{ user_id: string | null; role: string; display_name: string }>(
      `select user_id, role, display_name from group_members where group_id = $1 order by joined_at`,
      [tabId],
    );
    check('exactly 2 members', m.rows.length === 2, `got ${m.rows.length}`);
    check('both members are REAL users (no placeholder)',
      m.rows.every((r) => r.user_id !== null), JSON.stringify(m.rows.map((r) => r.user_id)));
    check('caller is admin', m.rows.find((r) => r.user_id === ashaUserId)?.role === 'admin');
    check('other is member', m.rows.find((r) => r.user_id === bhaviUserId)?.role === 'member');
    check('display names came from profiles',
      m.rows.some((r) => r.display_name === 'Asha') && m.rows.some((r) => r.display_name === 'Bhavi'),
      JSON.stringify(m.rows.map((r) => r.display_name)));

    const f = await db.query<{ user_lo: string; user_hi: string; group_id: string }>(
      `select user_lo, user_hi, group_id from friendships where group_id = $1`, [tabId],
    );
    check('friendship row exists', f.rows.length === 1, `got ${f.rows.length}`);
    check('pair is CANONICALISED (lo < hi)', f.rows[0]?.user_lo === lo && f.rows[0]?.user_hi === hi,
      `${f.rows[0]?.user_lo?.slice(0, 8)} / ${f.rows[0]?.user_hi?.slice(0, 8)}`);
  }

  // ---- 2. IDEMPOTENCE ----------------------------------------------------
  const again = await asha.rpc('create_friend_tab', { p_other: bhaviUserId });
  check('second call succeeds', !again.error, again.error?.message ?? '');
  check('second call returns the SAME group id', again.data === tabId,
    `${String(again.data).slice(0, 8)} vs ${String(tabId).slice(0, 8)}`);

  const oneRow = await db.query<{ c: string }>(
    `select count(*) c from friendships where user_lo = $1 and user_hi = $2`, [lo, hi],
  );
  check('still exactly ONE friendship row', oneRow.rows[0].c === '1', oneRow.rows[0].c);

  // ---- 3. CANONICALISATION: the other direction --------------------------
  // Bhavi asks for a tab with Asha. least/greatest must land on the same pair.
  const reversed = await bhavi.rpc('create_friend_tab', { p_other: ashaUserId });
  check('reverse direction succeeds', !reversed.error, reversed.error?.message ?? '');
  check('B->A returns the SAME tab as A->B', reversed.data === tabId,
    `${String(reversed.data).slice(0, 8)} vs ${String(tabId).slice(0, 8)}`);

  const stillOne = await db.query<{ c: string }>(
    `select count(*) c from friendships where user_lo = $1 and user_hi = $2`, [lo, hi],
  );
  check('reverse direction created NO second row', stillOne.rows[0].c === '1', stillOne.rows[0].c);

  // ---- 4. THE RACE -------------------------------------------------------
  // Both calls fired without awaiting between them. On a real collision one
  // hits friendships_pair_unique and its whole create sequence rolls back to
  // the subtransaction savepoint. Asha <-> Racer is a fresh pair, so this is a
  // genuine create race rather than two fast-path reads.
  const [r1, r2] = await Promise.all([
    asha.rpc('create_friend_tab', { p_other: racerUserId }),
    racer.rpc('create_friend_tab', { p_other: ashaUserId }),
  ]);
  check('race: first call resolved without error', !r1.error, r1.error?.message ?? '');
  check('race: second call resolved without error', !r2.error, r2.error?.message ?? '');
  check('race: BOTH resolved to the same tab', r1.data === r2.data,
    `${String(r1.data).slice(0, 8)} vs ${String(r2.data).slice(0, 8)}`);

  const rLo = ashaUserId < racerUserId ? ashaUserId : racerUserId;
  const rHi = ashaUserId < racerUserId ? racerUserId : ashaUserId;
  const raceRows = await db.query<{ c: string }>(
    `select count(*) c from friendships where user_lo = $1 and user_hi = $2`, [rLo, rHi],
  );
  check('race: exactly ONE friendship row', raceRows.rows[0].c === '1', raceRows.rows[0].c);

  // The orphan check — the actual point of the savepoint. A losing call must
  // not leave a kind='friend' group with no friendship row behind it.
  //
  // count(DISTINCT g.id), not count(*): the group_members join fans out one row
  // PER MEMBER, so a single orphan would report as 2 and the number would be
  // meaningless.
  //
  // GROUP_F is excluded because it is not an orphan — M1 seeds it by direct
  // insert, deliberately without a friendships row, which is exactly the shape
  // this query looks for. Leaving it in made the assertion fail on a fixture
  // that is working as designed. Only tabs created THROUGH create_friend_tab
  // can orphan, and those are the ones this scopes to.
  const orphans = await db.query<{ c: string }>(
    `select count(distinct g.id) c
       from groups g
       left join friendships f on f.group_id = g.id
       join group_members gm on gm.group_id = g.id
       join profiles p on p.id = gm.user_id
       join auth.users u on u.id = p.id
      where g.kind = 'friend'
        and f.group_id is null
        and g.id <> $2
        and u.email = any($1)`,
    [TEST_EMAILS_FOR_CLEANUP, GROUP_F],
  );
  check('race: NO orphaned friend group without a friendship', orphans.rows[0].c === '0',
    `${orphans.rows[0].c} orphan(s)`);

  // ---- 5. REJECTIONS -----------------------------------------------------
  const self = await asha.rpc('create_friend_tab', { p_other: ashaUserId });
  check('self-friend is REJECTED', !!self.error, self.error?.message ?? 'NO ERROR — hole');

  const missing = await asha.rpc('create_friend_tab', {
    p_other: '5171a11a-0000-4000-8000-00000000dead',
  });
  check('unknown profile is REJECTED', !!missing.error, missing.error?.message ?? 'NO ERROR — hole');

  // anon reachability: the grant is execute-to-authenticated only, so an
  // unauthenticated client must be refused by the GRANT, before auth.uid() is
  // ever consulted.
  const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anonCall = await anonClient.rpc('create_friend_tab', { p_other: bhaviUserId });
  check('anon CANNOT execute create_friend_tab', !!anonCall.error,
    anonCall.error?.message ?? 'NO ERROR — hole');

  // ---- 6. THE CAP TRIGGER ------------------------------------------------
  // A third member into a friend tab, inserted directly as the table owner —
  // the most privileged path there is. The trigger is SECURITY DEFINER and
  // fires regardless, so this must still be refused.
  let capBlocked = false;
  let capDetail = '';
  if (tabId) {
    try {
      await db.query('begin');
      await db.query(
        `insert into group_members (group_id, user_id, display_name, role)
         values ($1,$2,'Third wheel','member')`,
        [tabId, racerUserId],
      );
      await db.query('rollback');
    } catch (e) {
      capBlocked = true;
      capDetail = (e as Error).message.split(String.fromCharCode(10))[0];
      await db.query('rollback');
    }
  }
  check('third member on a friend tab is REJECTED', capBlocked, capDetail);

  // The other half: the trigger must be a strict NO-OP for normal groups.
  // Goa Trip already holds three members; a fourth must still be allowed.
  let normalGroupOk = false;
  let normalDetail = '';
  try {
    await db.query('begin');
    await db.query(
      `insert into group_members (group_id, user_id, display_name, role)
       values ($1,null,'Fourth member','member')`,
      [GROUP_ID],
    );
    normalGroupOk = true;
    await db.query('rollback');
  } catch (e) {
    normalDetail = (e as Error).message.split(String.fromCharCode(10))[0];
    await db.query('rollback');
  }
  check('kind=group group can STILL add a 4th member (trigger is a no-op)',
    normalGroupOk, normalDetail);

  // ---- 7. INTEGRATION WITH M1 -------------------------------------------
  // The tab create_friend_tab just made must show up in my_friend_positions()
  // with the right counterparty — end to end, M2 write into M1 read.
  const { data: fpData, error: fpErr } = await asha.rpc('my_friend_positions');
  check('my_friend_positions still succeeds', !fpErr, fpErr?.message ?? '');
  type FP = { group_id: string; counterparty_user_id: string; name: string; net_minor: string };
  const fpRows = (fpData ?? []) as FP[];
  const newTab = fpRows.find((r) => r.group_id === tabId);
  check('the new tab appears in my_friend_positions', newTab !== undefined,
    `${fpRows.length} tabs visible`);
  if (newTab) {
    check('counterparty resolves to Bhavi', newTab.counterparty_user_id === bhaviUserId
      && newTab.name === 'Bhavi', `${newTab.name}`);
    eq('a brand-new tab nets to zero', BigInt(newTab.net_minor), 0n);
  }

  // ---- 8. FRIENDSHIPS RLS ------------------------------------------------
  // The racer is in the Asha<->Racer tab from the race, so they see that ONE
  // row — and must not see the Asha<->Bhavi pair they are not part of.
  const { data: oRows, error: oErr } = await racer.from('friendships').select('group_id');
  check('friendships select works for a party', !oErr, oErr?.message ?? '');
  const visible = new Set((oRows ?? []).map((r) => (r as { group_id: string }).group_id));
  check('a third party does NOT see a pair they are not in', !visible.has(tabId ?? ''),
    `sees ${visible.size} row(s)`);

  // Direct DML must be refused even though the default privileges would
  // otherwise have granted it — this is what the explicit revoke buys.
  const badInsert = await racer.from('friendships').insert({
    user_lo: lo, user_hi: hi, group_id: tabId,
  });
  check('direct INSERT into friendships is REFUSED', !!badInsert.error,
    badInsert.error?.message ?? 'NO ERROR — hole');
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

  // Friend tabs created by create_friend_tab() have GENERATED uuids, so they
  // cannot be named in the fixed list below. Resolve them from the test users:
  // any kind='friend' group holding a member row for one of the test accounts.
  // Without this the suite leaks a group + 2 members + a friendship into prod
  // on every run, and the idempotence assertions stop meaning anything because
  // the pair already exists before the run starts.
  const { rows: friendGroups } = await db.query<{ id: string }>(
    `select distinct g.id
       from groups g
       join group_members gm on gm.group_id = g.id
       join profiles p       on p.id = gm.user_id
       join auth.users u     on u.id = p.id
      where g.kind = 'friend' and u.email = any($1)`,
    [TEST_EMAILS_FOR_CLEANUP],
  );

  // friendships rows go first: group_id is ON DELETE CASCADE, so deleting the
  // group would take them anyway, but being explicit means a failure here is
  // visible rather than silently relying on cascade order.
  for (const g of [GROUP_ID, GROUP_2, GROUP_F, ...friendGroups.map((r) => r.id)]) {
    await db.query(`delete from friendships where group_id = $1`, [g]);
    await db.query(`delete from expense_splits where expense_id in (select id from expenses where group_id = $1)`, [g]);
    await db.query(`delete from settlements where group_id = $1`, [g]);
    await db.query(`delete from expenses where group_id = $1`, [g]);
    await db.query(`delete from group_members where group_id = $1`, [g]);
    await db.query(`delete from groups where id = $1`, [g]);
  }
  await db.query('commit');

  // profiles rows cascade from auth.users. Uses the derived list rather than a
  // second hardcoded one, so a new test identity cannot be left behind in prod.
  const emails = TEST_EMAILS_FOR_CLEANUP;
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
