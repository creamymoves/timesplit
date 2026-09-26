/**
 * Database types.
 *
 * Regenerate with `npm run db:types` once the Supabase CLI is pointed at a running local
 * stack (`npm run db:start`). Until then this file carries the enums and the two tables the
 * auth scaffold touches, hand-written to match supabase/migrations/0001_foundation.sql.
 */
export type AppRole = 'renter' | 'owner' | 'admin';

export type OwnerVerificationStatus =
  | 'not_started'
  | 'in_progress'
  | 'pending_review'
  | 'approved'
  | 'rejected';

export type BookingStatus =
  | 'requested'
  | 'accepting'
  | 'payment_failed'
  | 'confirmed'
  | 'declined'
  | 'expired'
  | 'cancelled_by_renter'
  | 'cancelled_by_owner'
  | 'cancelled_by_admin'
  | 'checked_in'
  | 'completed'
  | 'disputed';

export type PayoutStatus = 'held' | 'releasable' | 'released' | 'reversed' | 'blocked';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  avatar_path: string | null;
  owner_verification_status: OwnerVerificationStatus;
  stripe_customer_id: string | null;
  us_state: string | null;
  terms_accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRole {
  user_id: string;
  role: AppRole;
  granted_by: string | null;
  granted_at: string;
}

/** Custom JWT claims added by public.custom_access_token_hook. */
export interface AppClaims {
  app_roles?: AppRole[];
  owner_status?: OwnerVerificationStatus;
}

// Minimal supabase-js generic. Replace with generated output from `npm run db:types`.
export type Database = {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile> & { id: string; email: string }; Update: Partial<Profile>; Relationships: [] };
      user_roles: { Row: UserRole; Insert: Pick<UserRole, 'user_id' | 'role'>; Update: never; Relationships: [] };
    };
    Views: Record<string, never>;
    Functions: {
      become_owner: { Args: Record<string, never>; Returns: undefined };
      has_role: { Args: { p_role: AppRole }; Returns: boolean };
      is_admin: { Args: Record<string, never>; Returns: boolean };
    };
    Enums: {
      app_role: AppRole;
      owner_verification_status: OwnerVerificationStatus;
      booking_status: BookingStatus;
      payout_status: PayoutStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
