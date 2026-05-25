import webpush from 'web-push';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';

function initWebPush() {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(env.VAPID_EMAIL, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  }
}

initWebPush();

export async function saveSubscription(
  userId: string,
  subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }
) {
  await prisma.pushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    create: {
      userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    update: { userId },
  });
}

export async function deleteSubscription(endpoint: string) {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
}

export async function sendToUser(
  userId: string,
  payload: { title: string; body: string; url?: string }
) {
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  const json = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        json
      )
    )
  );
  // Remove expired/invalid subscriptions
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'rejected') {
      const err = r.reason as { statusCode?: number };
      if (err.statusCode === 410 || err.statusCode === 404) {
        await prisma.pushSubscription.delete({ where: { id: subs[i].id } }).catch(() => null);
      }
    }
  }
}

export async function sendToCommunity(
  communityId: string,
  payload: { title: string; body: string; url?: string }
) {
  // Find all users who have units in this community
  const units = await prisma.unit.findMany({
    where: { communityId },
    select: {
      ownerships: { select: { ownerId: true } },
      occupancies: { select: { occupantId: true } },
    },
  });
  const userIds = new Set<string>();
  for (const unit of units) {
    for (const o of unit.ownerships) userIds.add(o.ownerId);
    for (const o of unit.occupancies) userIds.add(o.occupantId);
  }
  await Promise.allSettled([...userIds].map((uid) => sendToUser(uid, payload)));
}
