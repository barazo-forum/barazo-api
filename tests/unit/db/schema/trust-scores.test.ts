import { describe, it, expect } from "vitest";
import { trustScores } from "../../../../src/db/schema/trust-scores.js";
import { getTableName, getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

describe("trust-scores schema", () => {
  it("should have the correct table name", () => {
    expect(getTableName(trustScores)).toBe("trust_scores");
  });

  it("should have all required columns", () => {
    const columns = getTableColumns(trustScores);
    const columnNames = Object.keys(columns);

    expect(columnNames).toContain("did");
    expect(columnNames).toContain("communityId");
    expect(columnNames).toContain("score");
    expect(columnNames).toContain("computedAt");
  });

  it("should mark did and score as not null", () => {
    const columns = getTableColumns(trustScores);
    expect(columns.did.notNull).toBe(true);
    expect(columns.score.notNull).toBe(true);
    expect(columns.computedAt.notNull).toBe(true);
  });

  it("should use non-null communityId with empty string sentinel for global scores", () => {
    const columns = getTableColumns(trustScores);
    expect(columns.communityId.notNull).toBe(true);
  });

  it("should have composite primary key on (did, communityId)", () => {
    const config = getTableConfig(trustScores);
    expect(config.primaryKeys.length).toBeGreaterThanOrEqual(1);
    const pk = config.primaryKeys[0];
    expect(pk).toBeDefined();
    if (pk) expect(pk.columns.length).toBe(2);
  });

  it("should have index on (did, communityId)", () => {
    const config = getTableConfig(trustScores);
    const idx = config.indexes.find(
      (i) => i.config.name === "trust_scores_did_community_idx",
    );
    expect(idx).toBeDefined();
  });
});
