const NATIONAL_ID = /^[12]\d{9}$/;
const ARABIC = /[؀-ۿ]/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

export function maskDeep(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map(v => maskDeep(v, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, maskDeep(v, k)]));
  }
  if (typeof value !== 'string') return value;
  if (NATIONAL_ID.test(value)) return value[0] + String(100000000 + (hash(value) % 900000000));
  if (/name/i.test(key) && !/establishment|occupation/i.test(key)) return ARABIC.test(value) ? 'اسم مستعار' : 'Masked Name';
  if (/mobile|phone/i.test(key)) return '05' + String(10000000 + (hash(value) % 90000000));
  if (/email/i.test(key)) return `user${hash(value) % 1000}@example.com`;
  if (/birth/i.test(key) && DATE.test(value)) return value.slice(0, 4) + '-01-01';
  if (/iban/i.test(key)) return 'SA0000000000000000000000';
  return value;
}
