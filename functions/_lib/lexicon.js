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
 * - Fail-Safe 策略：KV 未绑定或读取失败时，如果无历史缓存，强制返回 null。
 *   调用方（messages.js）必须拦截 null，直接拒绝发布，绝不允许漏过。
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
 * 取词库索引。
 * 🚨 Fail-Safe：如果无法获取任何有效词库，必须返回 null。
 */
export async function loadLexicon(env) {
  const now = Date.now();
  // 如果内存里有缓存且未过期，直接用
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) return cache;

  const kv = env?.LEXICON_KV;
  if (!kv) {
    console.error('[Lexicon] 🚨 严重错误：未绑定 LEXICON_KV！触发 Fail-Safe');
    // 如果有老缓存就用，没有就坚决返回 null 触发拦截
    return cache ? cache : null; 
  }

  try {
    const value = await kv.get(KV_KEY);
    if (!value) {
      console.error('[Lexicon] 🚨 严重错误：KV 中无词库数据！触发 Fail-Safe');
      return cache ? cache : null;
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
    console.error('[Lexicon] 🚨 读取 KV 异常：', e?.message);
    // 发生异常时同理，宁可拦截也不能放行
    return cache ? cache : null;
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