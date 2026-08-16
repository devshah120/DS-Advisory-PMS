/** Mirrors the API's SubscriptionStatus enum. */
export type SubscriptionStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'EXPIRED'
  | 'PAST_DUE'
  | 'CANCELLED';

export type BillingCycle = 'MONTHLY' | 'YEARLY';

/**
 * The settings screen's view of the plan.
 *
 * There is deliberately no `razorpayKeySecret` here: the API never returns it,
 * so the type has no field to put it in. `razorpaySecretSet` plus the last four
 * characters is everything the UI needs to prove a key is configured.
 */
export interface AppSettings {
  trialDays: number;
  monthlyAmount: number;
  yearlyAmount: number;
  currency: string;
  razorpayKeyId: string | null;
  razorpayMode: string;
  razorpaySecretSet: boolean;
  razorpaySecretLast4: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

/** What the PATCH accepts. Omitted fields are left untouched by the server. */
export interface UpdateSettingsInput {
  trialDays?: number;
  monthlyAmount?: number;
  yearlyAmount?: number;
  currency?: string;
  razorpayKeyId?: string;
  /** Send '' to clear the stored secret; omit to leave it as it is. */
  razorpayKeySecret?: string;
  razorpayMode?: 'test' | 'live';
}

/** One billable manager seat, with its countdown already resolved server-side. */
export interface Subscriber {
  id: string;
  name: string;
  email: string;
  active: boolean;
  status: SubscriptionStatus | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  billingCycle: BillingCycle | null;
  daysRemaining: number | null;
  createdAt: string;
}

export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  TRIALING: 'Trial',
  ACTIVE: 'Active',
  EXPIRED: 'Expired',
  PAST_DUE: 'Past due',
  CANCELLED: 'Cancelled',
};
