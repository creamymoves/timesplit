import Link from 'next/link';
import { UNIT_LABEL } from '@/lib/format';
import { publicUrl } from '@/lib/storage';
import type { Enums } from '@/types/database';

export interface ListingCardData {
  id: string;
  title: string;
  unit_type: Enums<'unit_type'>;
  sleeps: number;
  bedrooms: number;
  resort: { name: string; city: string; state: string } | null;
  photo: string | null;
}

export function ListingCard({ l }: { l: ListingCardData }) {
  const img = publicUrl(l.photo);
  return (
    <Link href={`/listings/${l.id}`} className="card listing-card">
      <div className="photo">{img ? <img src={img} alt="" /> : null}</div>
      <div>
        <h3>{l.title}</h3>
        <div className="muted small">{l.resort ? `${l.resort.name} · ${l.resort.city}, ${l.resort.state}` : ''}</div>
        <div className="small">{UNIT_LABEL[l.unit_type]} · sleeps {l.sleeps}</div>
      </div>
    </Link>
  );
}

/** Shape the joined listing row from Supabase into card data. */
export function toCard(row: {
  id: string; title: string; unit_type: Enums<'unit_type'>; sleeps: number; bedrooms: number;
  resorts: { name: string; city: string; state: string } | { name: string; city: string; state: string }[] | null;
  listing_photos: { storage_path: string; sort_order: number }[] | null;
}): ListingCardData {
  const resort = Array.isArray(row.resorts) ? row.resorts[0] ?? null : row.resorts;
  const photo = [...(row.listing_photos ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0]?.storage_path ?? null;
  return { id: row.id, title: row.title, unit_type: row.unit_type, sleeps: row.sleeps, bedrooms: row.bedrooms, resort, photo };
}

export const LISTING_CARD_SELECT = 'id, title, unit_type, sleeps, bedrooms, resorts(name, city, state), listing_photos(storage_path, sort_order)';
