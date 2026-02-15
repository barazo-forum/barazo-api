import { sql } from "drizzle-orm";
import type { Database } from "../db/index.js";
import type { Cache } from "../cache/index.js";
import type { Logger } from "../lib/logger.js";
import { accountFilters } from "../db/schema/account-filters.js";

const GLOBAL_SENTINEL = "__global__";
const BAN_THRESHOLD = 2;

interface BanCountRow {
  ban_count: number;
}

/**
 * Check if a user has been banned across multiple communities and auto-filter
 * their account at the global level if the threshold is met.
 *
 * For each community, only the latest moderation action (ban or unban) counts.
 * If the user is currently banned in >= BAN_THRESHOLD communities, a global
 * account_filters entry is created with status "filtered".
 */
export async function checkBanPropagation(
  db: Database,
  cache: Cache,
  logger: Logger,
  targetDid: string,
): Promise<{ propagated: boolean; banCount: number }> {
  // Count distinct communities where the user's latest action is "ban"
  // (i.e., not followed by an "unban" in the same community)
  const result = await db.execute(sql`
    WITH latest_actions AS (
      SELECT DISTINCT ON (community_did)
        community_did,
        action
      FROM moderation_actions
      WHERE target_did = ${targetDid}
        AND action IN ('ban', 'unban')
      ORDER BY community_did, created_at DESC
    )
    SELECT count(*)::int AS ban_count
    FROM latest_actions
    WHERE action = 'ban'
  `) as unknown as BanCountRow[];

  const banCount = result[0]?.ban_count ?? 0;

  if (banCount >= BAN_THRESHOLD) {
    // Upsert global account filter
    await db
      .insert(accountFilters)
      .values({
        did: targetDid,
        communityDid: GLOBAL_SENTINEL,
        status: "filtered",
        reason: `Auto-filtered: banned in ${String(banCount)} communities`,
        banCount,
        filteredBy: "system",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [accountFilters.did, accountFilters.communityDid],
        set: {
          status: "filtered",
          reason: `Auto-filtered: banned in ${String(banCount)} communities`,
          banCount,
          filteredBy: "system",
          updatedAt: new Date(),
        },
      });

    // Invalidate any cached account filter status
    try {
      await cache.del(`account-filter:${targetDid}`);
    } catch {
      // Non-critical
    }

    logger.info(
      { targetDid, banCount },
      "Account auto-filtered due to cross-community bans",
    );

    return { propagated: true, banCount };
  }

  return { propagated: false, banCount };
}
