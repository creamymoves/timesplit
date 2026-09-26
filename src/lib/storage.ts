import { env } from '@/lib/env';

/** Public URL for an object in a public bucket (listing-photos, avatars). Path is `<bucket>/<key>`. */
export function publicUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${path}`;
}

/** Split `<bucket>/<key>` as stored in the DB into the pieces the storage API wants. */
export function splitPath(path: string): { bucket: string; key: string } {
  const [bucket, ...rest] = path.split('/');
  return { bucket: bucket ?? '', key: rest.join('/') };
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_DOC_BYTES = 25 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export function extFor(mime: string) {
  return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[mime] ?? 'bin';
}
