import { describe, it, expect } from "vitest";
import {
  userPreferences,
  userCommunityPreferences,
} from "../../../../src/db/schema/user-preferences.js";
import { getTableName, getTableColumns } from "drizzle-orm";

// ===========================================================================
// userPreferences schema
// ===========================================================================

describe("userPreferences schema", () => {
  it("should have the correct table name", () => {
    expect(getTableName(userPreferences)).toBe("user_preferences");
  });

  it("should have all required columns", () => {
    const columns = getTableColumns(userPreferences);
    const columnNames = Object.keys(columns);

    expect(columnNames).toContain("did");
    expect(columnNames).toContain("maturityLevel");
    expect(columnNames).toContain("declaredAge");
    expect(columnNames).toContain("mutedWords");
    expect(columnNames).toContain("blockedDids");
    expect(columnNames).toContain("mutedDids");
    expect(columnNames).toContain("crossPostBluesky");
    expect(columnNames).toContain("crossPostFrontpage");
    expect(columnNames).toContain("updatedAt");
  });

  it("should have did as primary key", () => {
    const columns = getTableColumns(userPreferences);
    expect(columns.did.primary).toBe(true);
  });

  it("should mark required columns as not null", () => {
    const columns = getTableColumns(userPreferences);
    expect(columns.did.notNull).toBe(true);
    expect(columns.maturityLevel.notNull).toBe(true);
    expect(columns.mutedWords.notNull).toBe(true);
    expect(columns.blockedDids.notNull).toBe(true);
    expect(columns.mutedDids.notNull).toBe(true);
    expect(columns.crossPostBluesky.notNull).toBe(true);
    expect(columns.crossPostFrontpage.notNull).toBe(true);
    expect(columns.updatedAt.notNull).toBe(true);
  });

  it("should allow declaredAge to be nullable", () => {
    const columns = getTableColumns(userPreferences);
    expect(columns.declaredAge.notNull).toBe(false);
  });

  it("should have exactly 9 columns", () => {
    const columns = getTableColumns(userPreferences);
    expect(Object.keys(columns)).toHaveLength(9);
  });

  it("should have default values for maturityLevel, mutedWords, blockedDids, mutedDids, crossPost*, updatedAt", () => {
    const columns = getTableColumns(userPreferences);
    expect(columns.maturityLevel.hasDefault).toBe(true);
    expect(columns.mutedWords.hasDefault).toBe(true);
    expect(columns.blockedDids.hasDefault).toBe(true);
    expect(columns.mutedDids.hasDefault).toBe(true);
    expect(columns.crossPostBluesky.hasDefault).toBe(true);
    expect(columns.crossPostFrontpage.hasDefault).toBe(true);
    expect(columns.updatedAt.hasDefault).toBe(true);
  });
});

// ===========================================================================
// userCommunityPreferences schema
// ===========================================================================

describe("userCommunityPreferences schema", () => {
  it("should have the correct table name", () => {
    expect(getTableName(userCommunityPreferences)).toBe(
      "user_community_preferences",
    );
  });

  it("should have all required columns", () => {
    const columns = getTableColumns(userCommunityPreferences);
    const columnNames = Object.keys(columns);

    expect(columnNames).toContain("did");
    expect(columnNames).toContain("communityDid");
    expect(columnNames).toContain("maturityOverride");
    expect(columnNames).toContain("mutedWords");
    expect(columnNames).toContain("blockedDids");
    expect(columnNames).toContain("mutedDids");
    expect(columnNames).toContain("notificationPrefs");
    expect(columnNames).toContain("updatedAt");
  });

  it("should have exactly 8 columns", () => {
    const columns = getTableColumns(userCommunityPreferences);
    expect(Object.keys(columns)).toHaveLength(8);
  });

  it("should mark did and communityDid as not null", () => {
    const columns = getTableColumns(userCommunityPreferences);
    expect(columns.did.notNull).toBe(true);
    expect(columns.communityDid.notNull).toBe(true);
  });

  it("should mark updatedAt as not null with default", () => {
    const columns = getTableColumns(userCommunityPreferences);
    expect(columns.updatedAt.notNull).toBe(true);
    expect(columns.updatedAt.hasDefault).toBe(true);
  });

  it("should allow optional columns to be nullable", () => {
    const columns = getTableColumns(userCommunityPreferences);
    expect(columns.maturityOverride.notNull).toBe(false);
    expect(columns.mutedWords.notNull).toBe(false);
    expect(columns.blockedDids.notNull).toBe(false);
    expect(columns.mutedDids.notNull).toBe(false);
    expect(columns.notificationPrefs.notNull).toBe(false);
  });
});
