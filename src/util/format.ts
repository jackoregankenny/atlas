const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatPubDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = raw.trim();
  // Pure year
  if (/^\d{4}$/.test(s)) return s;
  // ISO-ish date
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]) - 1;
    const d = Number(iso[3]);
    if (m >= 0 && m < 12) return `${MONTHS[m]} ${d}, ${y}`;
  }
  return s;
}

export function formatAdded(raw: string | null | undefined): string {
  if (!raw) return "";
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return raw;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

export function formatRelative(raw: string | null | undefined): string {
  if (!raw) return "";
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const then = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`).getTime();
  const now = Date.now();
  const days = Math.max(0, Math.floor((now - then) / 86400000));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return w === 1 ? "1 week ago" : `${w} weeks ago`;
  }
  if (days < 365) {
    const mo = Math.floor(days / 30);
    return mo === 1 ? "1 month ago" : `${mo} months ago`;
  }
  const y = Math.floor(days / 365);
  return y === 1 ? "1 year ago" : `${y} years ago`;
}

export function formatIsbn(isbn: string | null | undefined): string {
  if (!isbn) return "";
  const clean = isbn.replace(/[^0-9X]/gi, "");
  if (clean.length === 13) {
    return `${clean.slice(0, 3)}-${clean.slice(3, 4)}-${clean.slice(4, 9)}-${clean.slice(9, 12)}-${clean.slice(12)}`;
  }
  if (clean.length === 10) {
    return `${clean.slice(0, 1)}-${clean.slice(1, 4)}-${clean.slice(4, 9)}-${clean.slice(9)}`;
  }
  return clean;
}
