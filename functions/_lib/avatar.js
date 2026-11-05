// Avatar output is a 256px PNG. Validate the encoded data on the server, rather
// than trusting a multipart MIME label or a browser-only file restriction.
export const AVATAR_SIZE = 256;
export const AVATAR_LIMIT = 64;
export const AVATAR_RETENTION_MS = 7 * 86400000;
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export async function validateAvatar(file) {
  if (file.type !== 'image/png' || file.size < 57 || file.size > 1024 * 1024) throw new Error('invalid_avatar_image');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if ([137,80,78,71,13,10,26,10].some((value, i) => bytes[i] !== value)) throw new Error('invalid_avatar_image');
  const view = new DataView(bytes.buffer);
  let offset = 8, header = false, ended = false, dataEnded = false;
  const compressed = [];
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset), end = offset + 12 + length;
    if (end > bytes.length) throw new Error('invalid_avatar_image');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) throw new Error('invalid_avatar_image');
    if (!header && type !== 'IHDR') throw new Error('invalid_avatar_image');
    if (type === 'IHDR') {
      if (header || length !== 13 || view.getUint32(offset + 8) !== AVATAR_SIZE || view.getUint32(offset + 12) !== AVATAR_SIZE || bytes[offset + 16] !== 8 || ![2,6].includes(bytes[offset + 17]) || bytes[offset + 18] || bytes[offset + 19] || bytes[offset + 20]) throw new Error('invalid_avatar_image');
      header = bytes[offset + 17];
    } else if (type === 'IDAT') {
      if (dataEnded) throw new Error('invalid_avatar_image');
      compressed.push(bytes.slice(offset + 8, end - 4));
    } else if (type === 'IEND') {
      if (length || end !== bytes.length || !compressed.length) throw new Error('invalid_avatar_image');
      ended = true; break;
    } else {
      if (compressed.length) dataEnded = true;
      // Unknown critical chunks alter decoding semantics (including indexed PNGs).
      if (type[0] === type[0].toUpperCase()) throw new Error('invalid_avatar_image');
    }
    offset = end;
  }
  if (!ended) throw new Error('invalid_avatar_image');
  const stride = 1 + AVATAR_SIZE * (header === 6 ? 4 : 3), expected = stride * AVATAR_SIZE;
  const reader = new Blob(compressed).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  let count = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      if (count + value.length > expected) throw new Error('invalid_avatar_image');
      for (let i = (stride - count % stride) % stride; i < value.length; i += stride) if (value[i] > 4) throw new Error('invalid_avatar_image');
      count += value.length;
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (count !== expected) throw new Error('invalid_avatar_image');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
