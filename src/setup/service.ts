import { eq, sql } from "drizzle-orm";
import { communitySettings } from "../db/schema/community-settings.js";
import type { Database } from "../db/index.js";
import type { Logger } from "../lib/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of getStatus(): either not initialized, or initialized with name. */
export type SetupStatus =
  | { initialized: false }
  | { initialized: true; communityName: string };

/** Result of initialize(): either success with details, or already initialized. */
export type InitializeResult =
  | { initialized: true; adminDid: string; communityName: string }
  | { alreadyInitialized: true };

/** Setup service interface for dependency injection and testing. */
export interface SetupService {
  getStatus(): Promise<SetupStatus>;
  initialize(did: string, communityName?: string): Promise<InitializeResult>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_COMMUNITY_NAME = "Barazo Community";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a setup service for managing community initialization.
 *
 * The first authenticated user to call initialize() becomes the community admin.
 *
 * @param db - Drizzle database instance
 * @param logger - Pino logger instance
 * @returns SetupService with getStatus and initialize methods
 */
export function createSetupService(db: Database, logger: Logger): SetupService {
  /**
   * Check whether the community has been initialized.
   *
   * @returns SetupStatus indicating initialization state
   */
  async function getStatus(): Promise<SetupStatus> {
    try {
      const rows = await db
        .select({
          initialized: communitySettings.initialized,
          communityName: communitySettings.communityName,
        })
        .from(communitySettings)
        .where(eq(communitySettings.id, "default"));

      const row = rows[0];

      if (!row || !row.initialized) {
        return { initialized: false };
      }

      return { initialized: true, communityName: row.communityName };
    } catch (err: unknown) {
      logger.error({ err }, "Failed to get setup status");
      throw err;
    }
  }

  /**
   * Initialize the community with the first admin user.
   *
   * Uses an atomic upsert to prevent race conditions: INSERT new row, or
   * UPDATE existing if not yet initialized. The WHERE clause ensures an
   * already-initialized row is never overwritten.
   *
   * @param did - DID of the authenticated user who becomes admin
   * @param communityName - Optional community name override
   * @returns InitializeResult with the new state or conflict indicator
   */
  async function initialize(
    did: string,
    communityName?: string,
  ): Promise<InitializeResult> {
    try {
      // Atomic upsert: INSERT new row, or UPDATE existing if not yet initialized.
      // The WHERE clause ensures an already-initialized row is never overwritten.
      const rows = await db
        .insert(communitySettings)
        .values({
          id: "default",
          initialized: true,
          adminDid: did,
          communityName: communityName ?? DEFAULT_COMMUNITY_NAME,
        })
        .onConflictDoUpdate({
          target: communitySettings.id,
          set: {
            initialized: true,
            adminDid: did,
            communityName: communityName
              ? communityName
              : sql`${communitySettings.communityName}`,
            updatedAt: new Date(),
          },
          where: eq(communitySettings.initialized, false),
        })
        .returning({
          communityName: communitySettings.communityName,
        });

      const row = rows[0];
      if (!row) {
        logger.warn(
          { did },
          "Setup initialize attempted on already-initialized community",
        );
        return { alreadyInitialized: true };
      }

      const finalName = row.communityName;
      logger.info({ did, communityName: finalName }, "Community initialized");

      return {
        initialized: true,
        adminDid: did,
        communityName: finalName,
      };
    } catch (err: unknown) {
      logger.error({ err, did }, "Failed to initialize community");
      throw err;
    }
  }

  return { getStatus, initialize };
}
