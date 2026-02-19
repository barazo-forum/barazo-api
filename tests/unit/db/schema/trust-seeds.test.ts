import { describe, it, expect } from "vitest";
import { trustSeeds } from "../../../../src/db/schema/trust-seeds.js";
import { getTableName, getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

describe("trust-seeds schema", () => {
  it("should have the correct table name", () => {
    expect(getTableName(trustSeeds)).toBe("trust_seeds");
  });

  it("should have all required columns", () => {
    const columns = getTableColumns(trustSeeds);
    const columnNames = Object.keys(columns);

    expect(columnNames).toContain("id");
    expect(columnNames).toContain("did");
    expect(columnNames).toContain("communityId");
    expect(columnNames).toContain("addedBy");
    expect(columnNames).toContain("reason");
    expect(columnNames).toContain("createdAt");
  });

  it("should have id as primary key (serial)", () => {
    const columns = getTableColumns(trustSeeds);
    expect(columns.id.primary).toBe(true);
  });

  it("should mark required columns as not null", () => {
    const columns = getTableColumns(trustSeeds);
    expect(columns.did.notNull).toBe(true);
    expect(columns.addedBy.notNull).toBe(true);
    expect(columns.createdAt.notNull).toBe(true);
  });

  it("should use non-null communityId with empty string sentinel for global seeds", () => {
    const columns = getTableColumns(trustSeeds);
    expect(columns.communityId.notNull).toBe(true);
  });

  it("should allow nullable reason", () => {
    const columns = getTableColumns(trustSeeds);
    expect(columns.reason.notNull).toBe(false);
  });

  it("should have a unique index on (did, communityId)", () => {
    const config = getTableConfig(trustSeeds);
    const uniqueIdx = config.indexes.find(
      (idx) => idx.config.name === "trust_seeds_did_community_idx",
    );
    expect(uniqueIdx).toBeDefined();
    expect(uniqueIdx?.config.unique).toBe(true);
  });
});
