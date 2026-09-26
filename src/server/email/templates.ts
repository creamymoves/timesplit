/**
 * Email templates. Pure functions returning subject + html + text so they can be unit-tested and
 * previewed without sending. Keep copy here, not in the pages.
 */
export interface Email { subject: string; html: string; text: string }

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

function layout(title: string, bodyHtml: string, cta?: { label: string; href: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f6f6f3;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1c1a">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px">
    <div style="font-weight:700;font-size:18px;margin-bottom:20px">Timesplit</div>
    <div style="background:#fff;border:1px solid #e4e2dc;border-radius:12px;padding:24px">
      <h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
      ${bodyHtml}
      ${cta ? `<p style="margin:24px 0 0"><a href="${cta.href}" style="display:inline-block;background:#0f6b5c;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">${esc(cta.label)}</a></p>` : ''}
    </div>
    <p style="color:#6b6b66;font-size:12px;margin-top:16px">You're receiving this because you have a Timesplit account. <a href="${APP}/settings" style="color:#6b6b66">Notification settings</a></p>
  </div></body></html>`;
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
const p = (s: string) => `<p style="margin:0 0 12px;line-height:1.5">${esc(s)}</p>`;

export const templates = {
  'welcome': (d: { name?: string | null }): Email => ({
    subject: 'Welcome to Timesplit',
    html: layout('Welcome to Timesplit', p(`Hi ${d.name ?? 'there'}, your account is ready. Browse listings from verified owners, or list your own week.`), { label: 'Browse listings', href: `${APP}/listings` }),
    text: `Hi ${d.name ?? 'there'}, your Timesplit account is ready. ${APP}/listings`,
  }),
  'verification.submitted': (): Email => ({
    subject: 'We received your owner verification',
    html: layout('Verification received', p('Thanks. Our team reviews most verifications within two business days. We will email you as soon as a decision is made.')),
    text: 'We received your owner verification. Most reviews finish within two business days.',
  }),
  'verification.approved': (): Email => ({
    subject: 'You are a verified owner',
    html: layout('You are verified', p('Your ownership and identity checks passed. Your listings can now be published and renters will see a verified badge on your profile.'), { label: 'Publish a listing', href: `${APP}/owner/listings` }),
    text: `Your owner verification was approved. Publish a listing: ${APP}/owner/listings`,
  }),
  'verification.rejected': (d: { reason?: string }): Email => ({
    subject: 'Your owner verification needs attention',
    html: layout('Verification not approved', p('We could not approve your verification.') + (d.reason ? p(`Reason: ${d.reason}`) : '') + p('You can start a new attempt with updated documents.'), { label: 'Try again', href: `${APP}/owner/verify` }),
    text: `Your owner verification was not approved.${d.reason ? ` Reason: ${d.reason}` : ''} Try again: ${APP}/owner/verify`,
  }),
  'listing.removed': (d: { title?: string; reason?: string; listingId?: string }): Email => ({
    subject: 'A listing was removed',
    html: layout('Listing removed', p(`Your listing "${d.title ?? ''}" was removed by our team.`) + (d.reason ? p(`Reason: ${d.reason}`) : '') + p('Reply to this email if you think this was a mistake.')),
    text: `Your listing "${d.title ?? ''}" was removed.${d.reason ? ` Reason: ${d.reason}` : ''}`,
  }),
  'message.received': (d: { from?: string; preview?: string; bookingId?: string }): Email => ({
    subject: `New message from ${d.from ?? 'a Timesplit user'}`,
    html: layout('New message', p(`${d.from ?? 'Someone'} wrote:`) + `<blockquote style="margin:0 0 12px;padding:8px 12px;border-left:3px solid #e4e2dc;color:#6b6b66">${esc(d.preview ?? '')}</blockquote>`, { label: 'Reply', href: `${APP}/dashboard` }),
    text: `${d.from ?? 'Someone'} wrote: ${d.preview ?? ''}`,
  }),
} as const;

export type NotificationType = keyof typeof templates;

/** In-app title/body for each type; email content comes from `templates`. */
export function inAppCopy(type: NotificationType, d: Record<string, unknown>): { title: string; body: string | null } {
  switch (type) {
    case 'welcome': return { title: 'Welcome to Timesplit', body: null };
    case 'verification.submitted': return { title: 'Verification received', body: 'We review most within two business days.' };
    case 'verification.approved': return { title: 'You are a verified owner', body: 'Your listings can now be published.' };
    case 'verification.rejected': return { title: 'Verification not approved', body: typeof d.reason === 'string' ? d.reason : null };
    case 'listing.removed': return { title: 'A listing was removed', body: typeof d.reason === 'string' ? d.reason : null };
    case 'message.received': return { title: `New message from ${String(d.from ?? 'a user')}`, body: typeof d.preview === 'string' ? d.preview : null };
  }
}
