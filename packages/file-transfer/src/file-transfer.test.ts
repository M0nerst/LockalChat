import { describe, expect, it } from "vitest";
import { sha256HexOfBlob, sha256HexOfFile } from "./hash-stream.js";

describe("File transfer hashing", () => {
  it("hashes blob in one shot", async () => {
    const blob = new Blob(["abc"]);
    const hash = await sha256HexOfBlob(blob);
    expect(hash).toHaveLength(64);
  });

  it("hashes large file by chunks without loading all at once", async () => {
    const size = 256 * 1024;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i % 251;
    const blob = new Blob([bytes]);
    const a = await sha256HexOfFile(blob, 64 * 1024);
    const b = await sha256HexOfBlob(blob);
    expect(a).toBe(b);
  });
});
