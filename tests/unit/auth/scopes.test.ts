import { describe, it, expect } from "vitest";
import {
  BARAZO_BASE_SCOPES,
  CROSSPOST_ADDITIONAL_SCOPES,
  BARAZO_CROSSPOST_SCOPES,
  FALLBACK_SCOPE,
  hasCrossPostScopes,
  isFallbackScope,
} from "../../../src/auth/scopes.js";

describe("scope constants", () => {
  it("BARAZO_BASE_SCOPES includes all forum collections", () => {
    expect(BARAZO_BASE_SCOPES).toContain("repo:forum.barazo.topic.post");
    expect(BARAZO_BASE_SCOPES).toContain("repo:forum.barazo.topic.reply");
    expect(BARAZO_BASE_SCOPES).toContain("repo:forum.barazo.interaction.reaction");
    expect(BARAZO_BASE_SCOPES.startsWith("atproto ")).toBe(true);
  });

  it("BARAZO_BASE_SCOPES does not include cross-post collections", () => {
    expect(BARAZO_BASE_SCOPES).not.toContain("app.bsky.feed.post");
    expect(BARAZO_BASE_SCOPES).not.toContain("fyi.frontpage.post");
  });

  it("CROSSPOST_ADDITIONAL_SCOPES includes Bluesky and Frontpage", () => {
    expect(CROSSPOST_ADDITIONAL_SCOPES).toContain("repo:app.bsky.feed.post?action=create");
    expect(CROSSPOST_ADDITIONAL_SCOPES).toContain("repo:fyi.frontpage.post?action=create");
    expect(CROSSPOST_ADDITIONAL_SCOPES).toContain("blob:image/*");
  });

  it("BARAZO_CROSSPOST_SCOPES combines base and cross-post scopes", () => {
    expect(BARAZO_CROSSPOST_SCOPES).toContain(BARAZO_BASE_SCOPES);
    expect(BARAZO_CROSSPOST_SCOPES).toContain(CROSSPOST_ADDITIONAL_SCOPES);
  });

  it("FALLBACK_SCOPE is the legacy generic scope", () => {
    expect(FALLBACK_SCOPE).toBe("atproto transition:generic");
  });
});

describe("hasCrossPostScopes", () => {
  it("returns true for full cross-post scopes", () => {
    expect(hasCrossPostScopes(BARAZO_CROSSPOST_SCOPES)).toBe(true);
  });

  it("returns true for fallback scope (transition:generic)", () => {
    expect(hasCrossPostScopes(FALLBACK_SCOPE)).toBe(true);
  });

  it("returns false for base scopes only", () => {
    expect(hasCrossPostScopes(BARAZO_BASE_SCOPES)).toBe(false);
  });

  it("returns false when only Bluesky scope is present", () => {
    const partial = `${BARAZO_BASE_SCOPES} repo:app.bsky.feed.post?action=create`;
    expect(hasCrossPostScopes(partial)).toBe(false);
  });

  it("returns false when only Frontpage scope is present", () => {
    const partial = `${BARAZO_BASE_SCOPES} repo:fyi.frontpage.post?action=create`;
    expect(hasCrossPostScopes(partial)).toBe(false);
  });

  it("returns true when both cross-post scopes are present without action qualifier", () => {
    const scope = "atproto repo:app.bsky.feed.post repo:fyi.frontpage.post";
    expect(hasCrossPostScopes(scope)).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(hasCrossPostScopes("")).toBe(false);
  });
});

describe("isFallbackScope", () => {
  it("returns true for transition:generic", () => {
    expect(isFallbackScope(FALLBACK_SCOPE)).toBe(true);
  });

  it("returns true when transition:generic is part of larger scope", () => {
    expect(isFallbackScope("atproto transition:generic repo:extra")).toBe(true);
  });

  it("returns false for granular scopes", () => {
    expect(isFallbackScope(BARAZO_BASE_SCOPES)).toBe(false);
  });

  it("returns false for cross-post scopes", () => {
    expect(isFallbackScope(BARAZO_CROSSPOST_SCOPES)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isFallbackScope("")).toBe(false);
  });
});
