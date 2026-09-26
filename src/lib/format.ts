export const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO',
  'MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
] as const;

export const UNIT_TYPES = ['studio', '1br', '2br', '3br', '4br', 'lockoff', 'other'] as const;
export const UNIT_LABEL: Record<(typeof UNIT_TYPES)[number], string> = {
  studio: 'Studio', '1br': '1 bedroom', '2br': '2 bedroom', '3br': '3 bedroom', '4br': '4 bedroom', lockoff: 'Lock-off', other: 'Other',
};

export const CANCELLATION_POLICIES = ['flexible', 'moderate', 'strict', 'non_refundable'] as const;
export const POLICY_LABEL: Record<(typeof CANCELLATION_POLICIES)[number], string> = {
  flexible: 'Flexible', moderate: 'Moderate', strict: 'Strict', non_refundable: 'Non-refundable',
};

export const AMENITIES = [
  'Full kitchen', 'Washer/dryer', 'Pool', 'Hot tub', 'Gym', 'Beach access', 'Ocean view', 'Balcony', 'Parking',
  'Wi-Fi', 'Air conditioning', 'Kids club', 'Golf', 'Spa', 'Restaurant on site', 'Accessible',
] as const;

export function money(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}

export function shortDate(iso: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));
}

export function relTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  return rtf.format(-Math.round(diff / 86400), 'day');
}

export function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
