import { describe, it, expect } from "vitest";
import {
  trustSeedCreateSchema,
  trustSeedQuerySchema,
  clusterQuerySchema,
  clusterStatusUpdateSchema,
  pdsTrustUpdateSchema,
  pdsTrustQuerySchema,
  behavioralFlagUpdateSchema,
  behavioralFlagQuerySchema,
} from "../../../src/validation/sybil.js";

// ---------------------------------------------------------------------------
// trustSeedCreateSchema
// ---------------------------------------------------------------------------

describe("trustSeedCreateSchema", () => {
  it("accepts valid input with did only", () => {
    const result = trustSeedCreateSchema.safeParse({ did: "did:plc:abc123" });
    expect(result.success).toBe(true);
  });

  it("accepts valid input with all fields", () => {
    const result = trustSeedCreateSchema.safeParse({
      did: "did:plc:abc123",
      communityId: "community-1",
      reason: "Trusted member",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty did", () => {
    const result = trustSeedCreateSchema.safeParse({ did: "" });
    expect(result.success).toBe(false);
  });

  it("rejects reason exceeding 500 chars", () => {
    const result = trustSeedCreateSchema.safeParse({
      did: "did:plc:abc123",
      reason: "A".repeat(501),
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// trustSeedQuerySchema
// ---------------------------------------------------------------------------

describe("trustSeedQuerySchema", () => {
  it("accepts empty object (defaults apply)", () => {
    const result = trustSeedQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
    }
  });

  it("accepts valid cursor and limit", () => {
    const result = trustSeedQuerySchema.safeParse({
      cursor: "abc123",
      limit: "10",
    });
    expect(result.success).toBe(true);
  });

  it("rejects limit below 1", () => {
    const result = trustSeedQuerySchema.safeParse({ limit: "0" });
    expect(result.success).toBe(false);
  });

  it("rejects limit above 100", () => {
    const result = trustSeedQuerySchema.safeParse({ limit: "101" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// clusterStatusUpdateSchema
// ---------------------------------------------------------------------------

describe("clusterStatusUpdateSchema", () => {
  it("accepts dismissed", () => {
    expect(clusterStatusUpdateSchema.safeParse({ status: "dismissed" }).success).toBe(true);
  });

  it("accepts monitoring", () => {
    expect(clusterStatusUpdateSchema.safeParse({ status: "monitoring" }).success).toBe(true);
  });

  it("accepts banned", () => {
    expect(clusterStatusUpdateSchema.safeParse({ status: "banned" }).success).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(clusterStatusUpdateSchema.safeParse({ status: "flagged" }).success).toBe(false);
    expect(clusterStatusUpdateSchema.safeParse({ status: "invalid" }).success).toBe(false);
  });

  it("rejects empty object", () => {
    expect(clusterStatusUpdateSchema.safeParse({}).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// clusterQuerySchema
// ---------------------------------------------------------------------------

describe("clusterQuerySchema", () => {
  it("accepts empty object (defaults apply)", () => {
    const result = clusterQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
    }
  });

  it("accepts valid status filter", () => {
    const result = clusterQuerySchema.safeParse({ status: "flagged" });
    expect(result.success).toBe(true);
  });

  it("accepts valid sort option", () => {
    const result = clusterQuerySchema.safeParse({ sort: "member_count" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = clusterQuerySchema.safeParse({ status: "invalid" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pdsTrustUpdateSchema
// ---------------------------------------------------------------------------

describe("pdsTrustUpdateSchema", () => {
  it("accepts valid hostname and trust factor", () => {
    const result = pdsTrustUpdateSchema.safeParse({
      pdsHost: "bsky.social",
      trustFactor: 1.0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts zero trust factor", () => {
    const result = pdsTrustUpdateSchema.safeParse({
      pdsHost: "example.com",
      trustFactor: 0.0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects trust factor above 1.0", () => {
    const result = pdsTrustUpdateSchema.safeParse({
      pdsHost: "example.com",
      trustFactor: 1.1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative trust factor", () => {
    const result = pdsTrustUpdateSchema.safeParse({
      pdsHost: "example.com",
      trustFactor: -0.1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid hostname", () => {
    const result = pdsTrustUpdateSchema.safeParse({
      pdsHost: "not a hostname!",
      trustFactor: 0.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects single-label hostname", () => {
    const result = pdsTrustUpdateSchema.safeParse({
      pdsHost: "localhost",
      trustFactor: 0.5,
    });
    expect(result.success).toBe(false);
  });

  it("accepts subdomain hostnames", () => {
    const result = pdsTrustUpdateSchema.safeParse({
      pdsHost: "pds.my-server.example.com",
      trustFactor: 0.8,
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pdsTrustQuerySchema
// ---------------------------------------------------------------------------

describe("pdsTrustQuerySchema", () => {
  it("accepts empty object (defaults apply)", () => {
    const result = pdsTrustQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
    }
  });
});

// ---------------------------------------------------------------------------
// behavioralFlagUpdateSchema
// ---------------------------------------------------------------------------

describe("behavioralFlagUpdateSchema", () => {
  it("accepts dismissed", () => {
    expect(behavioralFlagUpdateSchema.safeParse({ status: "dismissed" }).success).toBe(true);
  });

  it("accepts action_taken", () => {
    expect(behavioralFlagUpdateSchema.safeParse({ status: "action_taken" }).success).toBe(true);
  });

  it("rejects pending (cannot set back to pending)", () => {
    expect(behavioralFlagUpdateSchema.safeParse({ status: "pending" }).success).toBe(false);
  });

  it("rejects invalid status", () => {
    expect(behavioralFlagUpdateSchema.safeParse({ status: "invalid" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// behavioralFlagQuerySchema
// ---------------------------------------------------------------------------

describe("behavioralFlagQuerySchema", () => {
  it("accepts empty object (defaults apply)", () => {
    const result = behavioralFlagQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
    }
  });

  it("accepts valid flag type filter", () => {
    const result = behavioralFlagQuerySchema.safeParse({ flagType: "burst_voting" });
    expect(result.success).toBe(true);
  });

  it("accepts valid status filter", () => {
    const result = behavioralFlagQuerySchema.safeParse({ status: "pending" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid flag type", () => {
    const result = behavioralFlagQuerySchema.safeParse({ flagType: "invalid" });
    expect(result.success).toBe(false);
  });
});
