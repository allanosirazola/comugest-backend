import Stripe from 'stripe';
import { prisma } from '../../config/prisma';
import { audit } from '../audit/audit.service';
import { env } from '../../config/env';

const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-04-22.dahlia',
});

// Derive types from the stripe instance (compatible with Stripe v17+ / 2026-04-22.dahlia)
type StripeEvent = ReturnType<typeof stripe.webhooks.constructEvent>;
type StripeSubscription = Awaited<ReturnType<typeof stripe.subscriptions.retrieve>>;

export async function getOrCreateStripeCustomer(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true, firstName: true, lastName: true, stripeCustomerId: true },
  });
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: user.email,
    name: `${user.firstName} ${user.lastName}`,
    metadata: { userId: user.id },
  });

  await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

export async function createCheckoutSession(userId: string, frontendUrl: string) {
  const customerId = await getOrCreateStripeCustomer(userId);

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${frontendUrl}/billing`,
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    metadata: { userId },
  });

  return { url: session.url };
}

export async function createPortalSession(userId: string, frontendUrl: string) {
  const customerId = await getOrCreateStripeCustomer(userId);

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${frontendUrl}/billing`,
  });

  return { url: session.url };
}

export async function getBillingStatus(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      planStatus: true,
      planCurrentPeriodEnd: true,
      stripeSubscriptionId: true,
    },
  });
  return user;
}

function resolveSubscriptionStatus(status: StripeSubscription['status']): string {
  if (status === 'active' || status === 'trialing') return 'ACTIVE';
  if (status === 'past_due') return 'PAST_DUE';
  return 'CANCELLED';
}

function getPeriodEnd(sub: StripeSubscription): Date | null {
  // In Stripe API 2026-04-22.dahlia, current_period_end lives on subscription items
  const firstItem = sub.items?.data?.[0];
  if (firstItem && 'current_period_end' in firstItem && typeof firstItem.current_period_end === 'number') {
    return new Date(firstItem.current_period_end * 1000);
  }
  if (sub.trial_end) return new Date(sub.trial_end * 1000);
  if (sub.cancel_at) return new Date(sub.cancel_at * 1000);
  return null;
}

export async function handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
  let event: StripeEvent;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    throw new Error('Webhook signature verification failed');
  }

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as StripeSubscription;
      const customerId = sub.customer as string;
      const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
      if (!user) break;

      const status = resolveSubscriptionStatus(sub.status);
      const periodEnd = getPeriodEnd(sub);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          stripeSubscriptionId: sub.id,
          planStatus: status,
          ...(periodEnd ? { planCurrentPeriodEnd: periodEnd } : {}),
        },
      });

      if (status === 'ACTIVE') {
        void audit({
          action: 'SUBSCRIPTION_ACTIVATED',
          actorId: user.id,
          meta: { subscriptionId: sub.id },
        });
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as StripeSubscription;
      const customerId = sub.customer as string;
      const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
      if (!user) break;
      await prisma.user.update({
        where: { id: user.id },
        data: { planStatus: 'CANCELLED', stripeSubscriptionId: null },
      });
      void audit({
        action: 'SUBSCRIPTION_CANCELLED',
        actorId: user.id,
        meta: { subscriptionId: sub.id },
      });
      break;
    }
    default:
      break;
  }
}
