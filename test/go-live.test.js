import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { onRequest as middleware } from '../functions/_middleware.js';

test('the inner-test gate serves web manifests as static assets', async () => {
  let assetRequest;
  const response = await middleware({
    request: new Request('https://test.isaspectrum.pages.dev/images/site.webmanifest'),
    env: {
      INNER_TEST_PASSWORD: 'not-used-for-static-assets',
      ASSETS: {
        async fetch(request) {
          assetRequest = request;
          return new Response('{"name":"ISA Spectrum"}', {
            headers: { 'Content-Type': 'application/manifest+json' }
          });
        }
      }
    },
    async next() { throw new Error('manifest must bypass the HTML password gate'); }
  });

  assert.equal(assetRequest.url, 'https://test.isaspectrum.pages.dev/images/site.webmanifest');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type'), /manifest\+json/);
});

test('go-live SQL uses UUID message references and a PostgREST-compatible meal index', async () => {
  const baseline = await readFile(new URL('../supabase/oidc_client.sql', import.meta.url), 'utf8');
  const corrective = await readFile(new URL('../supabase/20260913_go_live_fixes.sql', import.meta.url), 'utf8');
  const checker = await readFile(new URL('../functions/api/checker/messages.js', import.meta.url), 'utf8');

  assert.match(baseline, /related_id uuid references public\.messages\(id\)/);
  assert.match(baseline, /message_id uuid not null references public\.messages\(id\)/);
  assert.match(baseline, /p_message_id uuid/);
  assert.doesNotMatch(baseline, /p_message_id bigint/);
  assert.match(baseline, /create unique index meal_ratings_business_user_date_key\s+on public\.meal_ratings \(business_user_id, rating_date\);/);
  assert.match(corrective, /Expected public\.messages\.id to be uuid/);
  assert.match(corrective, /notify pgrst, 'reload schema'/);
  assert.match(checker, /p_message_id: id/);
  assert.doesNotMatch(checker, /p_message_id: Number\(id\)/);
});
