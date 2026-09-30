#!/usr/bin/env node
// Generates the ES256 key pair used for the short-lived business database token
// (BUSINESS_SUPABASE_SIGNING_JWK) described in docs/OIDC_CLIENT.zh-CN.md section 14.
//
// Usage:
//   node scripts/generate-supabase-signing-key.mjs [kid]
//
// Why a script: Cloudflare Pages secrets are write-only, so the private key cannot be
// copied from one environment to another. If the original value is lost, generate a new
// pair here, register the public half in Supabase, and store the private half as the
// Cloudflare secret. Supabase trusts several signing keys at once, so a new key does not
// disturb an existing environment.
//
// The private half must never be committed, pasted into a chat, or put in a ZIP. It only
// ever belongs in the Cloudflare secret named BUSINESS_SUPABASE_SIGNING_JWK.
import { generateKeyPairSync } from 'node:crypto';
import { randomUUID } from 'node:crypto';

const kidArgument = process.argv[2];
const kid = kidArgument || '<把 Supabase 显示/分配给你的 kid 填在这里>';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const strip = (jwk, keep) => Object.fromEntries(Object.entries(jwk).filter(([key]) => keep.includes(key)));

const publicJwk = { ...strip(publicKey.export({ format: 'jwk' }), ['kty', 'crv', 'x', 'y']), alg: 'ES256', use: 'sig' };
const privateJwk = { kty: 'EC', crv: 'P-256', kid, ...strip(privateKey.export({ format: 'jwk' }), ['x', 'y', 'd']), alg: 'ES256' };

console.log('建议的 kid（如果 Supabase 允许你自己指定）:', randomUUID());
console.log('\n=== 1) 公钥 JWK —— 导入 Supabase：Project Settings -> JWT Signing Keys -> Import key -> JWK ===');
console.log(JSON.stringify(publicJwk));
console.log('\n=== 2) 记下 Supabase 为这把钥匙显示的 kid（形如 UUID）===');
if (!kidArgument) {
  console.log('    然后重新运行本脚本并把 kid 作为参数传入，或手工替换下面 JSON 里的 kid：');
  console.log('    node scripts/generate-supabase-signing-key.mjs <kid>');
}
console.log('\n=== 3) 私钥 JWK —— 只填进 Cloudflare 的 Secret 变量 BUSINESS_SUPABASE_SIGNING_JWK ===');
console.log(JSON.stringify(privateJwk));
console.log('\n注意：私钥必须与 Cloudflare 里配置的 kid 完全一致。kid 对不上时 Supabase 会返回');
console.log('      PGRST301 "No suitable key was found to decode the JWT"，登录会停在身份映射这一步。');
console.log('      请不要提交这个 JSON，也不要粘贴到任何聊天或压缩包里。');
