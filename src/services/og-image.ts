import sharp from "sharp";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const MAX_TITLE_LINES = 3;
const MAX_CHARS_PER_LINE = 38;

// ---------------------------------------------------------------------------
// Helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Escape special XML characters to prevent SVG injection.
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Word-wrap text into lines of at most `maxCharsPerLine` characters,
 * limited to `maxLines` total. If truncated, the last line ends with
 * an ellipsis character.
 */
export function wrapText(
  text: string,
  maxCharsPerLine: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) {
    return [];
  }

  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (lines.length >= maxLines) {
      break;
    }

    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (testLine.length > maxCharsPerLine && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  // Check if text was truncated
  const joinedLength = lines.join(" ").length;
  const fullLength = words.join(" ").length;
  if (fullLength > joinedLength && lines.length > 0) {
    const lastIdx = lines.length - 1;
    const lastLine = lines[lastIdx] ?? "";
    if (lastLine.length > maxCharsPerLine - 1) {
      lines[lastIdx] = lastLine.slice(0, maxCharsPerLine - 1) + "\u2026";
    } else {
      lines[lastIdx] = lastLine + "\u2026";
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// SVG generation
// ---------------------------------------------------------------------------

export interface OgImageParams {
  title: string;
  category: string;
  communityName: string;
}

/**
 * Generate an SVG string for a cross-post OG image.
 *
 * Layout (1200x630):
 * - Dark background (#1c1b22)
 * - Category badge (cyan pill)
 * - Community name (grey subheading)
 * - Topic title (white, word-wrapped, max 3 lines)
 * - Barazo branding footer
 */
export function generateOgSvg(params: OgImageParams): string {
  const titleLines = wrapText(params.title, MAX_CHARS_PER_LINE, MAX_TITLE_LINES);
  const categoryText = escapeXml(params.category.toUpperCase());
  const communityText = escapeXml(params.communityName);

  // Estimate category badge width (~11px per char + 32px padding)
  const categoryWidth = String(Math.max(categoryText.length * 11 + 32, 60));
  const categoryTextX = String(60 + 16);
  const categoryTextY = String(60 + 24);
  const footerY = String(OG_HEIGHT - 40);
  const brandingX = String(OG_WIDTH - 60);
  const width = String(OG_WIDTH);
  const height = String(OG_HEIGHT);

  const titleSvg = titleLines
    .map(
      (line, i) =>
        `<text x="60" y="${String(280 + i * 60)}" font-family="sans-serif" font-size="48" font-weight="bold" fill="white">${escapeXml(line)}</text>`,
    )
    .join("\n    ");

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="#1c1b22"/>

  <!-- Category badge -->
  <rect x="60" y="60" width="${categoryWidth}" height="36" rx="8" fill="#0ea5e9"/>
  <text x="${categoryTextX}" y="${categoryTextY}" font-family="sans-serif" font-size="16" font-weight="600" fill="white" dominant-baseline="central">${categoryText}</text>

  <!-- Community name -->
  <text x="60" y="150" font-family="sans-serif" font-size="24" fill="#9ca3af">${communityText}</text>

  <!-- Topic title -->
  ${titleSvg}

  <!-- Barazo branding -->
  <text x="60" y="${footerY}" font-family="sans-serif" font-size="18" fill="#6b7280">Powered by Barazo</text>
  <text x="${brandingX}" y="${footerY}" font-family="sans-serif" font-size="18" fill="#6b7280" text-anchor="end">barazo.forum</text>
</svg>`;
}

// ---------------------------------------------------------------------------
// PNG generation
// ---------------------------------------------------------------------------

/**
 * Generate a branded OG image as a PNG buffer.
 *
 * Produces a 1200x630 PNG suitable for use as the `thumb` in
 * Bluesky's `app.bsky.embed.external` records.
 */
export async function generateOgImage(params: OgImageParams): Promise<Buffer> {
  const svg = generateOgSvg(params);
  return sharp(Buffer.from(svg)).png().toBuffer();
}
