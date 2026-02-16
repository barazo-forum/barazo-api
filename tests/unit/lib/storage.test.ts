import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync } from "node:fs";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLocalStorage } from "../../../src/lib/storage.js";

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(),
  silent: vi.fn(),
  level: "debug",
} as never;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createLocalStorage", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir && existsSync(tmpDir)) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("stores a file and returns a valid URL", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "barazo-storage-"));
    const storage = createLocalStorage(
      tmpDir,
      "http://localhost:3000",
      mockLogger,
    );

    const data = Buffer.from("fake-image-data");
    const url = await storage.store(data, "image/webp", "avatars");

    expect(url).toMatch(
      /^http:\/\/localhost:3000\/uploads\/avatars\/avatars-[a-f0-9-]+\.webp$/,
    );

    // Verify the file was actually written
    const relativePath = url.split("/uploads/")[1];
    expect(relativePath).toBeDefined();
    const filepath = join(tmpDir, relativePath ?? "");
    const written = await readFile(filepath);
    expect(written.toString()).toBe("fake-image-data");
  });

  it("creates subdirectory if it does not exist", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "barazo-storage-"));
    const storage = createLocalStorage(
      tmpDir,
      "http://localhost:3000",
      mockLogger,
    );

    const data = Buffer.from("test");
    await storage.store(data, "image/png", "banners");

    expect(existsSync(join(tmpDir, "banners"))).toBe(true);
  });

  it("maps MIME types to correct extensions", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "barazo-storage-"));
    const storage = createLocalStorage(
      tmpDir,
      "http://localhost:3000",
      mockLogger,
    );

    const data = Buffer.from("test");

    const jpegUrl = await storage.store(data, "image/jpeg", "test");
    expect(jpegUrl).toMatch(/\.jpg$/);

    const pngUrl = await storage.store(data, "image/png", "test");
    expect(pngUrl).toMatch(/\.png$/);

    const gifUrl = await storage.store(data, "image/gif", "test");
    expect(gifUrl).toMatch(/\.gif$/);

    const unknownUrl = await storage.store(
      data,
      "application/octet-stream",
      "test",
    );
    expect(unknownUrl).toMatch(/\.bin$/);
  });

  it("deletes a stored file", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "barazo-storage-"));
    const storage = createLocalStorage(
      tmpDir,
      "http://localhost:3000",
      mockLogger,
    );

    const data = Buffer.from("to-be-deleted");
    const url = await storage.store(data, "image/webp", "avatars");

    // File exists before delete
    const relativePath = url.split("/uploads/")[1] ?? "";
    const filepath = join(tmpDir, relativePath);
    expect(existsSync(filepath)).toBe(true);

    await storage.delete(url);
    expect(existsSync(filepath)).toBe(false);
  });

  it("delete is best-effort (does not throw for missing files)", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "barazo-storage-"));
    const storage = createLocalStorage(
      tmpDir,
      "http://localhost:3000",
      mockLogger,
    );

    // Should not throw
    await storage.delete("http://localhost:3000/uploads/avatars/nonexistent.webp");
  });

  it("delete ignores URLs without /uploads/ path", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "barazo-storage-"));
    const storage = createLocalStorage(
      tmpDir,
      "http://localhost:3000",
      mockLogger,
    );

    // Should not throw and should not attempt file deletion
    await storage.delete("http://example.com/some-other-path.jpg");
  });
});
