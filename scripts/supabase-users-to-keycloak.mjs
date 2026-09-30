#!/usr/bin/env node
// Turns a Supabase Auth user export into a Keycloak "Partial import" file.
//
// Why this exists
// ---------------
// Supabase Auth stores passwords as bcrypt hashes and Keycloak does not support bcrypt
// out of the box, so passwords cannot be carried over without installing a third-party
// provider on the Keycloak server. Instead, import the users with no password and let
// each person set their own through "Forgot password?" (which works for accounts that
// never had a password) or through a bulk "Update password" email.
//
// The Keycloak user id is set to the original Supabase UUID on purpose: Keycloak uses
// the user id as the `sub` claim, and this project maps (issuer, sub) to a business user.
// Keeping the original UUID is what makes it possible to re-link people to messages they
// wrote on the old 3.4.2 site (see the backfill SQL in the project docs).
//
// Usage
// -----
//   1. In the Supabase SQL editor run:
//        select id, email from auth.users order by created_at;
//      and download the result as CSV.
//   2. node scripts/supabase-users-to-keycloak.mjs users.csv > keycloak-import.json
//   3. Keycloak admin console -> Users -> Action -> Partial import -> upload the JSON.
//
// Options
//   --username-from=email|local   what to use as the Keycloak username (default: email)
//   --if-exists=SKIP|OVERWRITE|FAIL
//   --keep-required-action        keep "UPDATE_PASSWORD" as a required action
//   --emit-invite-sql=PATH        also write SQL that lists users needing an invite mail
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const options = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => {
  const [key, value] = a.replace(/^--/, '').split('=');
  return [key, value ?? true];
}));
const inputPath = args.find(a => !a.startsWith('--'));
if (!inputPath) {
  console.error('usage: node scripts/supabase-users-to-keycloak.mjs <supabase-users.csv> [--username-from=email|local]');
  process.exit(2);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (char !== '\r') field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

const rows = parseCsv(readFileSync(inputPath, 'utf8'));
if (rows.length < 2) {
  console.error('the CSV needs a header row and at least one user');
  process.exit(2);
}
const header = rows[0].map(h => h.trim().toLowerCase());
const idIndex = header.findIndex(h => ['id', 'uid', 'user_id'].includes(h));
const emailIndex = header.findIndex(h => ['email', 'email_address'].includes(h));
if (idIndex === -1 || emailIndex === -1) {
  console.error(`could not find the id/email columns. header was: ${header.join(', ')}`);
  process.exit(2);
}

const usernameFrom = options['username-from'] === 'local' ? 'local' : 'email';
const ifResourceExists = ['SKIP', 'OVERWRITE', 'FAIL'].includes(String(options['if-exists']).toUpperCase())
  ? String(options['if-exists']).toUpperCase() : 'SKIP';

const seen = new Set();
const users = [];
const skipped = [];
for (const row of rows.slice(1)) {
  const id = (row[idIndex] || '').trim();
  const email = (row[emailIndex] || '').trim().toLowerCase();
  if (!id || !email) { skipped.push(`(missing id or email: ${row.join('|')})`); continue; }
  const username = usernameFrom === 'local' ? email.split('@')[0] : email;
  const dedupeKey = `${id}|${username}`;
  if (seen.has(dedupeKey)) { skipped.push(`${email} (duplicate row)`); continue; }
  if (users.some(u => u.username === username)) { skipped.push(`${email} (username ${username} already used)`); continue; }
  seen.add(dedupeKey);
  const user = { id, username, email, enabled: true, emailVerified: true };
  if (options['keep-required-action']) user.requiredActions = ['UPDATE_PASSWORD'];
  users.push(user);
}

const payload = { ifResourceExists, users };
process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

if (options['emit-invite-sql']) {
  const values = users.map(u => `('${u.id}'::uuid, '${u.email}')`).join(',\n  ');
  writeFileSync(options['emit-invite-sql'], `-- Users imported into Keycloak that still need a password.
-- Send each of them a "Update password" email, or ask them to use "Forgot password?".
select * from (values
  ${values}
) as imported(id, email);
`);
}

if (skipped.length) console.error(`skipped ${skipped.length} row(s):\n  ${skipped.join('\n  ')}`);
console.error(`wrote ${users.length} user(s) for realm import (username from ${usernameFrom}, ifResourceExists=${ifResourceExists})`);
