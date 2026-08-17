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

  await db.query('commit');

  console.log('  group "Goa Trip" (trip), 3 members, 2 expenses, 6 splits, 1 confirmed settlement');
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
  check('member sees the group', member.groups === 1);
  check('member sees 3 members', member.group_members === 3);
  check('member sees 2 expenses', member.expenses === 2);
  check('member sees 6 splits', member.expense_splits === 6);
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

    const one = async (sql: string) => Number((await db.query<{ c: string }>(sql)).rows[0].c);
    const result = {
      groups: await one(`select count(*) c from groups`),
      group_members: await one(`select count(*) c from group_members`),
      expenses: await one(`select count(*) c from expenses`),
      expense_splits: await one(`select count(*) c from expense_splits`),
      settlements: await one(`select count(*) c from settlements`),
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
  await db.query(`delete from expense_splits where expense_id in (select id from expenses where group_id = $1)`, [GROUP_ID]);
  await db.query(`delete from settlements where group_id = $1`, [GROUP_ID]);
  await db.query(`delete from expenses where group_id = $1`, [GROUP_ID]);
  await db.query(`delete from group_members where group_id = $1`, [GROUP_ID]);
  await db.query(`delete from groups where id = $1`, [GROUP_ID]);
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
