// Compact MD5 (RFC 1321) returning lowercase hex.
// Diigo highlight ids are MD5(content + user + urlId + nth) computed by Diigo's old JavaScript MD5, which
// feeds each UTF-16 code unit's LOW BYTE into the digest (no UTF-8 encoding). Verified against a real
// record containing an em dash: only the low-byte variant reproduces Diigo's id, so we do the same.
const K = [];
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

export function md5(str) {
  const n = str.length;
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = str.charCodeAt(i) & 255;
  const w = new Int32Array((((n + 8) >>> 6) + 1) << 4);
  for (let i = 0; i < n; i++) w[i >> 2] |= b[i] << ((i & 3) << 3);
  w[n >> 2] |= 0x80 << ((n & 3) << 3);
  w[w.length - 2] = (n * 8) | 0;
  w[w.length - 1] = Math.floor((n * 8) / 4294967296) | 0;
  let a = 0x67452301, bb = -271733879, c = -1732584194, d = 0x10325476;
  for (let i = 0; i < w.length; i += 16) {
    let A = a, B = bb, C = c, D = d;
    for (let j = 0; j < 64; j++) {
      let f, g;
      if (j < 16) { f = (B & C) | (~B & D); g = j; }
      else if (j < 32) { f = (D & B) | (~D & C); g = (5 * j + 1) & 15; }
      else if (j < 48) { f = B ^ C ^ D; g = (3 * j + 5) & 15; }
      else { f = C ^ (B | ~D); g = (7 * j) & 15; }
      const x = (A + f + K[j] + w[i + g]) | 0;
      const s = S[((j >> 4) << 2) | (j & 3)];
      A = D; D = C; C = B;
      B = (B + ((x << s) | (x >>> (32 - s)))) | 0;
    }
    a = (a + A) | 0; bb = (bb + B) | 0; c = (c + C) | 0; d = (d + D) | 0;
  }
  let hex = '';
  for (const v of [a, bb, c, d]) for (let k = 0; k < 4; k++) hex += ((v >>> (k * 8)) & 255).toString(16).padStart(2, '0');
  return hex;
}
