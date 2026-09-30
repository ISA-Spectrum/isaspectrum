#!/usr/bin/env node
// Copies legacy 3.4.2 avatars to the new pseudonymous path, so the public message list
// can show them without re-exposing legacy Supabase user ids.
//
// Background
// ----------
// The old site stored an avatar as the storage object "avatars/<supabase auth uuid>" and
// referenced it from profiles.avatar_url. The new site stores "avatars/business/<business
// user uuid>.webp" and references it from business_users.avatar_url. Publishing the legacy
// URL on the wall would leak the old auth uuid, so the files are copied to the new path
// first and only the new URL is exposed.
//
// Prerequisites
// -------------
// 1. Run this SQL in the Supabase SQL editor and download the result as CSV:
//
//      select o.name                as legacy_object,
//             bu.user_id::text      as business_id,
//             bu.email              as email
//        from storage.objects o
//        join auth.users u on u.id::text = o.name
//        join public.business_users bu on lower(bu.email) = lower(u.email)
//       where o.bucket_id = 'avatars'
//         and o.name not like 'business/%'
//       order by bu.email;
//
// 2. Put the project's service_role key in the environment (never on the command line,
//    never in git). The key is only used by this process and is not logged.
//
// Usage
// -----
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_KEY=... \
//   node scripts/migrate-legacy-avatars.mjs legacy-avatars.csv            # dry run
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
//   node scripts/migrate-legacy-avatars.mjs legacy-avatars.csv --apply    # really copy
//
// The dry run only prints what it would do.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const csvPath = args.find(a => !a.startsWith('--'));
if (!csvPath) {
  console.error('usage: node scripts/migrate-legacy-avatars.mjs <legacy-avatars.csv> [--apply]');
  process.exit(2);
}
const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = String(process.env.SUPABASE_SERVICE_KEY || '');
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
const legacyIndex = header.findIndex(h => ['legacy_object', 'name', 'legacy_id', 'old_id'].includes(h));
const businessIndex = header.findIndex(h => ['business_id', 'user_id', 'business_user_id'].includes(h));
if (legacyIndex === -1 || businessIndex === -1) {
  console.error(`could not find the legacy/business columns. header was: ${header.join(', ')}`);
  process.exit(2);
}

const jobs = [];
const seen = new Set();
for (const row of rows.slice(1)) {
  const legacy = (row[legacyIndex] || '').trim();
  const business = (row[businessIndex] || '').trim();
  if (!legacy || !business) continue;
  if (seen.has(business)) { console.log(`skip ${business} (already handled in this run)`); continue; }
  seen.add(business);
  jobs.push({
    source: `avatars/${legacy}`,
    target: `avatars/business/${business}.webp`,
    publicUrl: `${supabaseUrl}/storage/v1/object/public/avatars/business/${business}.webp`,
    business
  });
}

console.log(`${apply ? 'APPLYING' : 'DRY RUN'}: ${jobs.length} avatar(s) to copy into the new path`);
for (const job of jobs) console.log(`  ${job.source}  ->  ${job.target}`);
if (!apply) {
  console.log('\nnothing was changed. re-run with --apply to copy the files and update business_users.avatar_url');
  process.exit(0);
}

const authHeaders = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
let copied = 0, updated = 0, failed = 0;
for (const job of jobs) {
  try {
    const copy = await fetch(`${supabaseUrl}/storage/v1/object/copy`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucketId: 'avatars', sourceKey: job.source.split('/').slice(1).join('/'), destinationKey: job.target.split('/').slice(1).join('/') })
    });
    if (!copy.ok) throw new Error(`copy -> HTTP ${copy.status} ${(await copy.text()).slice(0, 160)}`);
    copied += 1;
  } catch (error) {
    failed += 1;
    console.error(`  FAILED copy ${job.source}: ${error.message}`);
    continue;
  }
  const patch = await fetch(`${supabaseUrl}/rest/v1/business_users?user_id=eq.${job.business}`, {
    method: 'PATCH',
    headers: { ...authHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ avatar_url: job.publicUrl })
  });
  if (patch.ok) updated += 1;
  else { failed += 1; console.error(`  FAILED update ${job.business}: HTTP ${patch.status} ${(await patch.text()).slice(0, 160)}`); }
}
console.log(`\ncopied ${copied}, updated ${updated}, failed ${failed}`);
if (failed) process.exitCode = 1;
