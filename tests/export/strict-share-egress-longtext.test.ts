import { describe, expect, it } from "vitest";
import { inspectStrictSerializedFiles, StrictShareBlockedError } from "@/lib/export/strict-chatgpt-share";
import type { ChatGptExportFile } from "@/lib/export/chatgpt-pack";

// Fabricated names for local-only output verification.
const madeUpPlace = "架空花霞町";
function testFile(content: string): ChatGptExportFile {
  return { name: "synthetic.txt", type: "text/plain", content };
}

describe("strict synthetic serialized output regression", () => {
  it("blocks a known fictional place appearing late in a long message", () => {
    expect(() => inspectStrictSerializedFiles(
      [testFile("無害な文章".repeat(300) + madeUpPlace)], [madeUpPlace],
    )).toThrow(StrictShareBlockedError);
  });
  it("passes a short fabricated pseudonym-only text", () => {
    expect(() => inspectStrictSerializedFiles(
      [testFile("PERSON_A は LOCATION_1 へ行った")], [madeUpPlace],
    )).not.toThrow();
  });
});
