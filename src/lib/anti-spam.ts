import { eq, and } from "drizzle-orm";
import type { Database } from "../db/index.js";
import type { Cache } from "../cache/index.js";
import { communitySettings } from "../db/schema/community-settings.js";
import { accountTrust } from "../db/schema/account-trust.js";
import { users } from "../db/schema/users.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AntiSpamSettings {
  wordFilter: string[];
  firstPostQueueCount: number;
  newAccountDays: number;
  newAccountWriteRatePerMin: number;
  establishedWriteRatePerMin: number;
  linkHoldEnabled: boolean;
  topicCreationDelayEnabled: boolean;
  burstPostCount: number;
  burstWindowMinutes: number;
  trustedPostThreshold: number;
}

export type QueueReason =
  | "word_filter"
  | "first_post"
  | "link_hold"
  | "burst"
  | "topic_delay";

export interface AntiSpamCheckResult {
  held: boolean;
  reasons: Array<{
    reason: QueueReason;
    matchedWords?: string[];
  }>;
}

// ---------------------------------------------------------------------------
// Defaults (match community_settings.moderationThresholds defaults)
// ---------------------------------------------------------------------------

const DEFAULTS: AntiSpamSettings = {
  wordFilter: [],
  firstPostQueueCount: 3,
  newAccountDays: 7,
  newAccountWriteRatePerMin: 3,
  establishedWriteRatePerMin: 10,
  linkHoldEnabled: true,
  topicCreationDelayEnabled: true,
  burstPostCount: 5,
  burstWindowMinutes: 10,
  trustedPostThreshold: 10,
};

const SETTINGS_CACHE_TTL = 60; // seconds

// ---------------------------------------------------------------------------
// Settings loader
// ---------------------------------------------------------------------------

export async function loadAntiSpamSettings(
  db: Database,
  cache: Cache,
  communityDid: string,
): Promise<AntiSpamSettings> {
  const cacheKey = `antispam:settings:${communityDid}`;

  try {
    const cached = await cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as AntiSpamSettings;
    }
  } catch {
    // Cache miss or error -- fall through to DB
  }

  const rows = await db
    .select({
      moderationThresholds: communitySettings.moderationThresholds,
      wordFilter: communitySettings.wordFilter,
    })
    .from(communitySettings)
    .where(eq(communitySettings.id, "default"));

  const row = rows[0];
  const thresholds = row?.moderationThresholds;

  const settings: AntiSpamSettings = {
    wordFilter: row?.wordFilter ?? DEFAULTS.wordFilter,
    firstPostQueueCount:
      thresholds?.firstPostQueueCount ?? DEFAULTS.firstPostQueueCount,
    newAccountDays: thresholds?.newAccountDays ?? DEFAULTS.newAccountDays,
    newAccountWriteRatePerMin:
      thresholds?.newAccountWriteRatePerMin ??
      DEFAULTS.newAccountWriteRatePerMin,
    establishedWriteRatePerMin:
      thresholds?.establishedWriteRatePerMin ??
      DEFAULTS.establishedWriteRatePerMin,
    linkHoldEnabled:
      thresholds?.linkHoldEnabled ?? DEFAULTS.linkHoldEnabled,
    topicCreationDelayEnabled:
      thresholds?.topicCreationDelayEnabled ??
      DEFAULTS.topicCreationDelayEnabled,
    burstPostCount: thresholds?.burstPostCount ?? DEFAULTS.burstPostCount,
    burstWindowMinutes:
      thresholds?.burstWindowMinutes ?? DEFAULTS.burstWindowMinutes,
    trustedPostThreshold:
      thresholds?.trustedPostThreshold ?? DEFAULTS.trustedPostThreshold,
  };

  try {
    await cache.set(cacheKey, JSON.stringify(settings), "EX", SETTINGS_CACHE_TTL);
  } catch {
    // Non-critical -- settings just won't be cached
  }

  return settings;
}

// ---------------------------------------------------------------------------
// Account status checks
// ---------------------------------------------------------------------------

export async function isNewAccount(
  db: Database,
  authorDid: string,
  communityDid: string,
  newAccountDays: number,
): Promise<boolean> {
  if (newAccountDays <= 0) return false;

  // Check account_trust for community-specific history
  const trustRows = await db
    .select({ approvedPostCount: accountTrust.approvedPostCount })
    .from(accountTrust)
    .where(
      and(
        eq(accountTrust.did, authorDid),
        eq(accountTrust.communityDid, communityDid),
      ),
    );

  const trust = trustRows[0];
  // If they have any approved posts, check when they first appeared
  if (trust && trust.approvedPostCount > 0) {
    // Check firstSeenAt from users table as proxy for community activity start
    const userRows = await db
      .select({ firstSeenAt: users.firstSeenAt })
      .from(users)
      .where(eq(users.did, authorDid));

    const user = userRows[0];
    if (user) {
      const daysSinceFirstSeen =
        (Date.now() - user.firstSeenAt.getTime()) / (1000 * 60 * 60 * 24);
      return daysSinceFirstSeen < newAccountDays;
    }
  }

  // No trust record or no approved posts = new account
  return true;
}

export async function isAccountTrusted(
  db: Database,
  authorDid: string,
  communityDid: string,
  _trustThreshold: number,
): Promise<boolean> {
  const rows = await db
    .select({ isTrusted: accountTrust.isTrusted })
    .from(accountTrust)
    .where(
      and(
        eq(accountTrust.did, authorDid),
        eq(accountTrust.communityDid, communityDid),
      ),
    );

  return rows[0]?.isTrusted ?? false;
}

// ---------------------------------------------------------------------------
// Content checks (pure functions)
// ---------------------------------------------------------------------------

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function checkWordFilter(
  content: string,
  title: string | undefined,
  wordFilter: string[],
): { matches: boolean; matchedWords: string[] } {
  if (wordFilter.length === 0) {
    return { matches: false, matchedWords: [] };
  }

  const text = title ? `${title} ${content}` : content;
  const matchedWords: string[] = [];

  for (const word of wordFilter) {
    const pattern = new RegExp(`\\b${escapeRegex(word)}\\b`, "i");
    if (pattern.test(text)) {
      matchedWords.push(word);
    }
  }

  return { matches: matchedWords.length > 0, matchedWords };
}

const URL_PATTERN = /https?:\/\/[^\s]+|www\.[^\s]+/i;

export function checkForUrls(content: string): boolean {
  return URL_PATTERN.test(content);
}

// ---------------------------------------------------------------------------
// Rate limiting (Valkey sorted sets)
// ---------------------------------------------------------------------------

export async function checkWriteRateLimit(
  cache: Cache,
  authorDid: string,
  communityDid: string,
  isNew: boolean,
  settings: AntiSpamSettings,
): Promise<boolean> {
  const limit = isNew
    ? settings.newAccountWriteRatePerMin
    : settings.establishedWriteRatePerMin;

  const key = `antispam:rate:${communityDid}:${authorDid}`;
  const now = Date.now();
  const windowStart = now - 60_000; // 1 minute window

  try {
    // Remove expired entries and count current
    await cache.zremrangebyscore(key, "-inf", String(windowStart));
    const count = await cache.zcard(key);

    if (count >= limit) {
      return true; // rate-limited
    }

    // Add current write
    await cache.zadd(key, String(now), `${now}:${crypto.randomUUID()}`);
    await cache.expire(key, 120); // TTL = 2 minutes
  } catch {
    // If Valkey is down, allow the write (fail open for rate limiting)
    return false;
  }

  return false;
}

export async function checkBurstDetection(
  cache: Cache,
  authorDid: string,
  communityDid: string,
  settings: AntiSpamSettings,
): Promise<boolean> {
  const key = `antispam:burst:${communityDid}:${authorDid}`;
  const now = Date.now();
  const windowMs = settings.burstWindowMinutes * 60_000;
  const windowStart = now - windowMs;

  try {
    await cache.zremrangebyscore(key, "-inf", String(windowStart));
    const count = await cache.zcard(key);

    if (count >= settings.burstPostCount) {
      return true; // burst detected
    }

    await cache.zadd(key, String(now), `${now}:${crypto.randomUUID()}`);
    await cache.expire(key, settings.burstWindowMinutes * 60 + 60);
  } catch {
    return false;
  }

  return false;
}

// ---------------------------------------------------------------------------
// First-post moderation
// ---------------------------------------------------------------------------

export async function needsFirstPostModeration(
  db: Database,
  authorDid: string,
  communityDid: string,
  firstPostQueueCount: number,
): Promise<boolean> {
  if (firstPostQueueCount <= 0) return false;

  const rows = await db
    .select({ approvedPostCount: accountTrust.approvedPostCount })
    .from(accountTrust)
    .where(
      and(
        eq(accountTrust.did, authorDid),
        eq(accountTrust.communityDid, communityDid),
      ),
    );

  const trust = rows[0];
  const approvedCount = trust?.approvedPostCount ?? 0;
  return approvedCount < firstPostQueueCount;
}

// ---------------------------------------------------------------------------
// Topic creation delay
// ---------------------------------------------------------------------------

export async function canCreateTopic(
  db: Database,
  authorDid: string,
  communityDid: string,
  topicDelayEnabled: boolean,
): Promise<boolean> {
  if (!topicDelayEnabled) return true;

  const rows = await db
    .select({ approvedPostCount: accountTrust.approvedPostCount })
    .from(accountTrust)
    .where(
      and(
        eq(accountTrust.did, authorDid),
        eq(accountTrust.communityDid, communityDid),
      ),
    );

  const trust = rows[0];
  return (trust?.approvedPostCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function runAntiSpamChecks(
  db: Database,
  cache: Cache,
  params: {
    authorDid: string;
    communityDid: string;
    contentType: "topic" | "reply";
    title?: string;
    content: string;
  },
): Promise<AntiSpamCheckResult> {
  const settings = await loadAntiSpamSettings(db, cache, params.communityDid);

  // Check if user is trusted (bypasses all content checks)
  const trusted = await isAccountTrusted(
    db,
    params.authorDid,
    params.communityDid,
    settings.trustedPostThreshold,
  );

  if (trusted) {
    return { held: false, reasons: [] };
  }

  // Check if user is a moderator or admin (they bypass anti-spam)
  const userRows = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.did, params.authorDid));
  const userRole = userRows[0]?.role;
  if (userRole === "moderator" || userRole === "admin") {
    return { held: false, reasons: [] };
  }

  const reasons: AntiSpamCheckResult["reasons"] = [];

  const isNew = await isNewAccount(
    db,
    params.authorDid,
    params.communityDid,
    settings.newAccountDays,
  );

  // Word filter (applies to all users, not just new ones)
  const wordResult = checkWordFilter(
    params.content,
    params.title,
    settings.wordFilter,
  );
  if (wordResult.matches) {
    reasons.push({ reason: "word_filter", matchedWords: wordResult.matchedWords });
  }

  if (isNew) {
    // First-post moderation
    const needsQueue = await needsFirstPostModeration(
      db,
      params.authorDid,
      params.communityDid,
      settings.firstPostQueueCount,
    );
    if (needsQueue) {
      reasons.push({ reason: "first_post" });
    }

    // Link hold
    if (settings.linkHoldEnabled && checkForUrls(params.content)) {
      reasons.push({ reason: "link_hold" });
    }
  }

  // Burst detection (applies to all users)
  const burstDetected = await checkBurstDetection(
    cache,
    params.authorDid,
    params.communityDid,
    settings,
  );
  if (burstDetected) {
    reasons.push({ reason: "burst" });
  }

  return {
    held: reasons.length > 0,
    reasons,
  };
}
