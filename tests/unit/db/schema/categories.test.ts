import { describe, it, expect } from "vitest";
import { getTableName, getTableColumns } from "drizzle-orm";
import { categories } from "../../../../src/db/schema/categories.js";

describe("categories schema", () => {
  const columns = getTableColumns(categories);

  it("has the correct table name", () => {
    expect(getTableName(categories)).toBe("categories");
  });

  it("uses id as primary key", () => {
    expect(columns.id.primary).toBe(true);
  });

  it("has all required columns", () => {
    const columnNames = Object.keys(columns);

    const expected = [
      "id",
      "slug",
      "name",
      "description",
      "parentId",
      "sortOrder",
      "communityDid",
      "maturityRating",
      "createdAt",
      "updatedAt",
    ];

    for (const col of expected) {
      expect(columnNames).toContain(col);
    }
  });

  it("has non-nullable required columns", () => {
    expect(columns.id.notNull).toBe(true);
    expect(columns.slug.notNull).toBe(true);
    expect(columns.name.notNull).toBe(true);
    expect(columns.communityDid.notNull).toBe(true);
    expect(columns.maturityRating.notNull).toBe(true);
    expect(columns.createdAt.notNull).toBe(true);
    expect(columns.updatedAt.notNull).toBe(true);
  });

  it("has nullable optional columns", () => {
    expect(columns.description.notNull).toBe(false);
    expect(columns.parentId.notNull).toBe(false);
  });

  it("has default value for sortOrder", () => {
    expect(columns.sortOrder.hasDefault).toBe(true);
  });

  it("has default value for maturityRating", () => {
    expect(columns.maturityRating.hasDefault).toBe(true);
  });

  it("has default values for timestamps", () => {
    expect(columns.createdAt.hasDefault).toBe(true);
    expect(columns.updatedAt.hasDefault).toBe(true);
  });
});
