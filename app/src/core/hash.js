// SHA-256 e serializzazione stabile: WebCrypto, identico in Node e in Workers.
const enc = new TextEncoder();
export const toBytes = d => (typeof d === 'string' ? enc.encode(d) : d);
export const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export const sha256Hex = async d => toHex(await crypto.subtle.digest('SHA-256', toBytes(d)));
export function stableStringify(x) {
  if (Array.isArray(x)) return `[${x.map(stableStringify).join(',')}]`;
  if (x !== null && typeof x === 'object') {
    return `{${Object.keys(x).sort().filter(k => x[k] !== undefined).map(k => JSON.stringify(k) + ':' + stableStringify(x[k])).join(',')}}`;
  }
  return JSON.stringify(x);
}
