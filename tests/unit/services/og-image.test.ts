import { describe, it, expect } from "vitest";
import {
  generateOgImage,
  generateOgSvg,
  wrapText,
  escapeXml,
} from "../../../src/services/og-image.js";

// ===========================================================================
// escapeXml
// ===========================================================================

describe("escapeXml", () => {
  it("escapes ampersands", () => {
    expect(escapeXml("A & B")).toBe("A &amp; B");
  });

  it("escapes angle brackets", () => {
    expect(escapeXml("<script>alert('xss')</script>")).toBe(
      "&lt;script&gt;alert(&apos;xss&apos;)&lt;/script&gt;",
    );
  });

  it("escapes quotes", () => {
    expect(escapeXml('He said "hello"')).toBe("He said &quot;hello&quot;");
  });

  it("returns empty string unchanged", () => {
    expect(escapeXml("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(escapeXml("Hello World")).toBe("Hello World");
  });
});

// ===========================================================================
// wrapText
// ===========================================================================

describe("wrapText", () => {
  it("returns single line when text fits", () => {
    const result = wrapText("Short title", 40, 3);
    expect(result).toEqual(["Short title"]);
  });

  it("wraps text at word boundaries", () => {
    const result = wrapText("This is a longer title that should wrap", 20, 3);
    expect(result.length).toBeGreaterThan(1);
    // Each line should be at most 20 characters (approximately)
    for (const line of result) {
      // Allow some overflow for long words
      expect(line.length).toBeLessThanOrEqual(25);
    }
  });

  it("limits to maxLines", () => {
    const longText = "word ".repeat(50).trim();
    const result = wrapText(longText, 20, 3);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("adds ellipsis when text is truncated", () => {
    const longText = "word ".repeat(50).trim();
    const result = wrapText(longText, 20, 2);
    const lastLine = result[result.length - 1];
    expect(lastLine).toContain("\u2026");
  });

  it("handles empty string", () => {
    const result = wrapText("", 40, 3);
    expect(result).toEqual([]);
  });

  it("handles single long word", () => {
    const result = wrapText("Supercalifragilisticexpialidocious", 10, 3);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// generateOgSvg
// ===========================================================================

describe("generateOgSvg", () => {
  it("returns valid SVG string with correct dimensions", () => {
    const svg = generateOgSvg({
      title: "My Topic",
      category: "general",
      communityName: "Test Community",
    });

    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="630"');
    expect(svg).toContain("xmlns=");
  });

  it("includes the topic title", () => {
    const svg = generateOgSvg({
      title: "My Amazing Topic",
      category: "general",
      communityName: "Test Community",
    });

    expect(svg).toContain("My Amazing Topic");
  });

  it("includes the category name", () => {
    const svg = generateOgSvg({
      title: "Topic",
      category: "announcements",
      communityName: "Test Community",
    });

    expect(svg).toContain("ANNOUNCEMENTS");
  });

  it("includes the community name", () => {
    const svg = generateOgSvg({
      title: "Topic",
      category: "general",
      communityName: "My Forum",
    });

    expect(svg).toContain("My Forum");
  });

  it("includes Barazo branding", () => {
    const svg = generateOgSvg({
      title: "Topic",
      category: "general",
      communityName: "Test Community",
    });

    expect(svg).toContain("barazo.forum");
  });

  it("escapes special characters in title", () => {
    const svg = generateOgSvg({
      title: "Using <script> & \"quotes\"",
      category: "general",
      communityName: "Test Community",
    });

    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("&amp;");
  });

  it("escapes special characters in category", () => {
    const svg = generateOgSvg({
      title: "Topic",
      category: "Q&A",
      communityName: "Test Community",
    });

    expect(svg).toContain("Q&amp;A");
  });

  it("wraps long titles across multiple lines", () => {
    const longTitle =
      "This is a very long topic title that should definitely wrap across multiple lines in the SVG";
    const svg = generateOgSvg({
      title: longTitle,
      category: "general",
      communityName: "Test Community",
    });

    // Multiple <text> elements for the title lines
    const titleTextMatches = svg.match(/<text[^>]*font-size="48"[^>]*>/g);
    expect(titleTextMatches).not.toBeNull();
    expect(titleTextMatches?.length).toBeGreaterThan(1);
  });
});

// ===========================================================================
// generateOgImage
// ===========================================================================

describe("generateOgImage", () => {
  it("returns a PNG buffer", async () => {
    const buffer = await generateOgImage({
      title: "Test Topic",
      category: "general",
      communityName: "Test Community",
    });

    expect(buffer).toBeInstanceOf(Buffer);
    // PNG magic bytes: 0x89 0x50 0x4E 0x47
    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50); // P
    expect(buffer[2]).toBe(0x4e); // N
    expect(buffer[3]).toBe(0x47); // G
  });

  it("produces an image under 1MB (Bluesky blob limit)", async () => {
    const buffer = await generateOgImage({
      title: "A topic with a reasonably long title for testing size",
      category: "discussions",
      communityName: "A Community With a Long Name",
    });

    expect(buffer.length).toBeLessThan(1_000_000);
  });
});
