/**
 * 中文敏感词库匹配器（Cloudflare Pages Functions / Workers）
 *
 * 设计要点
 * - 词库存放在 KV（binding: LEXICON_KV，key: lexicon:v1:words），更新词库无需重新部署。
 * - 索引按 isolate 缓存在模块作用域，TTL 5 分钟；KV 内容指纹一致时直接复用，不重建。
 * - 匹配算法：Set + 首字索引 + 长度分桶滑窗。content 已由 cleanText 限制在 1000 字符以内，
 *   单次扫描在毫秒级。
 * - 归一化：NFKC（全角→半角）+ 小写 + 剔除全部非字母/数字/汉字字符，
 *   用于对抗「色 情」「色-情」「ＳＥＸ」这类插字规避。
 * - KV 未绑定或读取失败时：isolate 内已有缓存则沿用缓存，无缓存则返回 null。
 *   两种情况下词库层都只是降级，不影响上游 NIM 审核。
 *
 * 注意：MIN_LEN 为 2，单字词条一概丢弃（噪声远大于收益）。
 */

const KV_KEY = 'lexicon:v1:words';
const CACHE_TTL_MS = 5 * 60 * 1000;
const MIN_LEN = 2;
const MAX_LEN = 32;
const MAX_HITS = 20;

let cache = null;

/**
 * 归一化。词库侧与待检文本侧必须使用同一函数，否则对不上。
 * scripts/build-lexicon.mjs 内有一份等价实现，修改时需同步。
 */
export function compact(text) {
  return String(text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function buildIndex(rawText, fingerprint) {
  const set = new Set();
  const firstChars = new Set();
  const lengths = new Set();
  let maxLen = 0;
  let skipped = 0;

  for (const line of rawText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const word = compact(trimmed);
    if (word.length < MIN_LEN || word.length > MAX_LEN) {
      skipped++;
      continue;
    }
    if (set.has(word)) continue;
    set.add(word);
    firstChars.add(word[0]);
    lengths.add(word.length);
    if (word.length > maxLen) maxLen = word.length;
  }

  return {
    fingerprint,
    set,
    firstChars,
    maxLen,
    lengths: [...lengths].sort((a, b) => a - b),
    size: set.size,
    skipped,
    loadedAt: Date.now()
  };
}

/**
 * 取词库索引。env.LEXICON_KV 未绑定时返回 null（调用方据此跳过词库层）。
 */
export async function loadLexicon(env) {
  const now = Date.now();
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) return cache;

  const kv = env?.LEXICON_KV;
  if (!kv) {
    if (!cache) console.warn('[Lexicon] 未绑定 LEXICON_KV，词库层跳过');
    return cache;
  }

  try {
    const value = await kv.get(KV_KEY);
    if (!value) {
      console.warn('[Lexicon] KV 中无词库数据，词库层跳过');
      return cache;
    }
    const fingerprint = `${value.length}:${value.slice(0, 48)}`;
    if (cache && cache.fingerprint === fingerprint) {
      cache.loadedAt = now;
      return cache;
    }
    cache = buildIndex(value, fingerprint);
    console.log(`[Lexicon] 索引重建完成：词条 ${cache.size} 条，最长 ${cache.maxLen}，跳过 ${cache.skipped}`);
    return cache;
  } catch (e) {
    console.error('[Lexicon] 读取 KV 失败：', e?.message);
    return cache;
  }
}

/**
 * 扫描文本。返回 { hit, words }，words 用于日志统计，不要落库。
 */
export function scanLexicon(text, lex) {
  const miss = { hit: false, words: [] };
  if (!lex || !lex.size || !text) return miss;

  const haystack = compact(text);
  const n = haystack.length;
  if (!n) return miss;

  const lengths = lex.lengths;
  const hits = new Set();

  for (let i = 0; i < n; i++) {
    if (!lex.firstChars.has(haystack[i])) continue;
    for (let k = 0; k < lengths.length; k++) {
      const len = lengths[k];
      if (i + len > n) break;
      if (lex.set.has(haystack.slice(i, i + len))) {
        hits.add(haystack.slice(i, i + len));
        if (hits.size >= MAX_HITS) return { hit: true, words: [...hits] };
      }
    }
  }

  return { hit: hits.size > 0, words: [...hits] };
}
