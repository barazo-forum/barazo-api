import { describe, it, expect } from "vitest";
import { getTableName, getTableColumns } from "drizzle-orm";
import { communitySettings } from "../../../../src/db/schema/community-settings.js";

describe("communitySettings schema", () => {
  const columns = getTableColumns(communitySettings);

  it("has the correct table name", () => {
    expect(getTableName(communitySettings)).toBe("community_settings");
  });

  it("uses id as primary key", () => {
    expect(columns.id.primary).toBe(true);
  });

  it("has all required columns", () => {
    const columnNames = Object.keys(columns);

    const expected = [
      "id",
      "initialized",
      "communityDid",
      "adminDid",
      "communityName",
      "maturityRating",
      "reactionSet",
      "createdAt",
      "updatedAt",
    ];

    for (const col of expected) {
      expect(columnNames).toContain(col);
    }
  });

  it("has default value for id", () => {
    expect(columns.id.hasDefault).toBe(true);
  });

  it("has default value for initialized (false)", () => {
    expect(columns.initialized.hasDefault).toBe(true);
  });

  it("has nullable communityDid", () => {
    expect(columns.communityDid.notNull).toBe(false);
  });

  it("has nullable adminDid", () => {
    expect(columns.adminDid.notNull).toBe(false);
  });

  it("has default value for communityName", () => {
    expect(columns.communityName.hasDefault).toBe(true);
  });

  it("has default values for timestamps", () => {
    expect(columns.createdAt.hasDefault).toBe(true);
    expect(columns.updatedAt.hasDefault).toBe(true);
  });

  it("has non-nullable required columns", () => {
    expect(columns.id.notNull).toBe(true);
    expect(columns.initialized.notNull).toBe(true);
    expect(columns.communityName.notNull).toBe(true);
    expect(columns.maturityRating.notNull).toBe(true);
    expect(columns.reactionSet.notNull).toBe(true);
    expect(columns.createdAt.notNull).toBe(true);
    expect(columns.updatedAt.notNull).toBe(true);
  });

  it("has default value for maturityRating", () => {
    expect(columns.maturityRating.hasDefault).toBe(true);
  });

  it("has default value for reactionSet", () => {
    expect(columns.reactionSet.hasDefault).toBe(true);
  });
});
