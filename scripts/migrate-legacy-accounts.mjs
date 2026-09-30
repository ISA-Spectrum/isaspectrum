#!/usr/bin/env node
// One-shot migration of legacy 3.4.2 accounts to the new identity model.
//
// What it does, per legacy user (no one has to log in first):
//   1. derives the business uuid with the SAME function the Worker uses
//      (functions/_lib/supabase.js identityUserId), so nothing diverges;
//   2. creates/updates the business_users row (user_id, identity_provider,
//      identity_subject, email) so the identity exists before the first login;
//   3. copies the old avatar to the pseudonymous new path
//      avatars/<legacy uuid> -> avatars/business/<business uuid>.webp
//      and points business_users.avatar_url at it (privacy option B: the public URL
//      then contains no legacy account id);
//   4. leaves everything else alone. display_name, is_checker and the login path are
//      untouched, and resolveIdentity()'s upsert does not write avatar_url, so a
//      migrated avatar survives the user's first login.
//
// Why the business uuid can be derived up front
// ---------------------------------------------
// The identity is (issuer, sub) hashed into a uuid; the Provider uses the Keycloak user
// id as `sub`. The Keycloak users must therefore be imported with their ORIGINAL Supabase
// uuid as the user id (scripts/supabase-users-to-keycloak.mjs does that). If they were
// imported with random ids instead, this script cannot know the future `sub` and must be
// skipped in favour of the "run it again after people log in" flow.
//
// Prerequisites
// -------------
// 1. Export the legacy avatars from the Supabase SQL editor as CSV:
//
//      select o.name            as legacy_object,
//             lower(u.email)    as email
//        from storage.objects o
//        join auth.users u on u.id::text = o.name
//       where o.bucket_id = 'avatars'
//         and o.name not like 'business/%'
//       order by email;
//
// 2. Put the project's service_role key in the environment (never as an argument, never
//    in git). It is used by this process only and is never printed.
//
// Usage
// -----
//   AUTH_ISSUER=https://idp.example/realms/x \
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_KEY=... \
//   node scripts/migrate-legacy-accounts.mjs legacy.csv            # dry run
//
//   ... node scripts/migrate-legacy-accounts.mjs legacy.csv --apply
//
// Optional columns: business_id (used as-is instead of being derived).
import { readFileSync } from 'node:fs';
import { identityUserId } from '../functions/_lib/supabase.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const csvPath = args.find(a => !a.startsWith('--'));
if (!csvPath) {
  console.error('usage: node scripts/migrate-legacy-accounts.mjs <legacy.csv> [--apply]');
  console.error('       env: AUTH_ISSUER, SUPABASE_URL, SUPABASE_SERVICE_KEY (with --apply)');
  process.exit(2);
}
const issuer = String(process.env.AUTH_ISSUER || '').trim().replace(/\/$/, '');
const supabaseUrl = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const serviceKey = String(process.env.SUPABASE_SERVICE_KEY || '');
if (!issuer) { console.error('AUTH_ISSUER is required (it must match the realm issuer exactly)'); process.exit(2); }
if (!supabaseUrl) { console.error('SUPABASE_URL is required'); process.exit(2); }
if (apply && !serviceKey) { console.error('SUPABASE_SERVICE_KEY is required with --apply'); process.exit(2); }

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') { if (source[i + 1] === '"') { field += '"'; i += 1; } else quoted = false; }
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (char !== '\r') field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

const rows = parseCsv(readFileSync(csvPath, 'utf8'));
if (rows.length < 2) { console.error('the CSV needs a header row and at least one user'); process.exit(2); }
const header = rows[0].map(h => h.trim().toLowerCase());
const legacyIndex = header.findIndex(h => ['legacy_object', 'legacy_id', 'old_id', 'name'].includes(h));
const emailIndex = header.findIndex(h => ['email', 'email_address'].includes(h));
const businessIndex = header.findIndex(h => ['business_id', 'business_user_id', 'user_id'].includes(h));
if (legacyIndex === -1 || emailIndex === -1) {
  console.error(`could not find the legacy/email columns. header was: ${header.join(', ')}`);
  process.exit(2);
}

const jobs = [];
const problems = [];
const seen = new Set();
for (const row of rows.slice(1)) {
  const legacy = (row[legacyIndex] || '').trim().replace(/^avatars\//, '');
  const email = (row[emailIndex] || '').trim().toLowerCase() || null;
  if (!legacy) continue;
  if (seen.has(legacy)) { problems.push(`${legacy}: duplicate row, skipped`); continue; }
  seen.add(legacy);
  const business = businessIndex !== -1 && (row[businessIndex] || '').trim()
    ? (row[businessIndex] || '').trim()
    : await identityUserId(issuer, legacy);
  jobs.push({
    legacy,
    email,
    business,
    source: `avatars/${legacy}`,
    target: `avatars/business/${business}.webp`,
    publicUrl: `${supabaseUrl}/storage/v1/object/public/avatars/business/${business}.webp`
  });
}

console.log(`${apply ? 'APPLYING' : 'DRY RUN'}  issuer=${issuer}`);
console.log(`resolved ${jobs.length} legacy user(s):\n`);
for (const job of jobs) {
  console.log(`  ${job.legacy}  ->  ${job.business}   ${job.email || '(no email in CSV)'}`);
}
if (problems.length) console.log(`\nnotes:\n  ${problems.join('\n  ')}`);
if (!apply) {
  console.log('\nnothing was changed. re-run with --apply to create the identity rows and copy the avatars');
  process.exit(0);
}

const authHeaders = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
const stats = { identities: 0, copied: 0, alreadyThere: 0, noAvatar: 0, failed: 0 };
for (const job of jobs) {
  let avatarReady = false;
  try {
    const copy = await fetch(`${supabaseUrl}/storage/v1/object/copy`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bucketId: 'avatars',
        sourceKey: job.source.replace(/^avatars\//, ''),
        destinationKey: job.target.replace(/^avatars\//, '')
      })
    });
    if (copy.ok) { stats.copied += 1; avatarReady = true; }
    else if (copy.status === 409) { stats.alreadyThere += 1; avatarReady = true; }
    else if (copy.status === 404) { stats.noAvatar += 1; console.log(`  no legacy avatar for ${job.email || job.legacy}, identity row only`); }
    else { stats.failed += 1; console.error(`  FAILED copy ${job.source}: HTTP ${copy.status} ${(await copy.text()).slice(0, 160)}`); }
  } catch (error) {
    stats.failed += 1;
    console.error(`  FAILED copy ${job.source}: ${error.message}`);
  }

  // The identity row is created even without an avatar, so old messages can be attributed
  // later. avatar_url is omitted when there is no file, which also means an existing value
  // is left untouched by the merge.
  const payload = {
    user_id: job.business,
    identity_provider: issuer,
    identity_subject: job.legacy,
    email: job.email
  };
  if (avatarReady) payload.avatar_url = job.publicUrl;
  try {
    const upsert = await fetch(`${supabaseUrl}/rest/v1/business_users?on_conflict=user_id`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(payload)
    });
    if (upsert.ok) stats.identities += 1;
    else { stats.failed += 1; console.error(`  FAILED identity ${job.business}: HTTP ${upsert.status} ${(await upsert.text()).slice(0, 160)}`); }
  } catch (error) {
    stats.failed += 1;
    console.error(`  FAILED identity ${job.business}: ${error.message}`);
  }
}
console.log(`\nidentities written ${stats.identities}, avatars copied ${stats.copied}, already present ${stats.alreadyThere}, no legacy avatar ${stats.noAvatar}, failed ${stats.failed}`);
console.log('\nnext: backfill message ownership where identity_subject matches the legacy user_id');
if (stats.failed) process.exitCode = 1;
