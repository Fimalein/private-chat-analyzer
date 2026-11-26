import { describe, expect, it } from "vitest";
import { inspectStrictSerializedFiles, StrictShareBlockedError } from "@/lib/export/strict-chatgpt-share";
import type { ChatGptExportFile } from "@/lib/export/chatgpt-pack";

// Independently fabricated test words. No imported conversations.
const privateWord = "架空花霞町";
const file = (content: string, type: ChatGptExportFile["type"] = "text/plain"): ChatGptExportFile =>
  ({ name: "synthetic", type, content });
const blocked = (content: string, type?: ChatGptExportFile["type"]) =>
  expect(() => inspectStrictSerializedFiles([file(content, type)], [privateWord]))
    .toThrow(StrictShareBlockedError);

describe("encoded-output privacy regression (fabricated)", () => {
  it("blocks URL percent encoding", () => blocked(encodeURIComponent(privateWord)));
  it("blocks nested percent encoding", () => blocked(encodeURIComponent(encodeURIComponent(privateWord))));
  it("blocks numeric HTML entities", () => blocked(Array.from(privateWord).map((c) =>
    "&#" + c.codePointAt(0) + ";").join("")));
  it("blocks JavaScript Unicode escapes inside plain text", () => blocked(Array.from(privateWord).map((c) =>
    "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")).join("")));
  it("blocks escaped JSON inside a JSON string", () => blocked(JSON.stringify({
    nested: JSON.stringify({ details: privateWord }),
  }), "application/json"));
  it("blocks percent-encoded HTML character references", () => blocked(encodeURIComponent(
    Array.from(privateWord).map((c) => "&#" + c.codePointAt(0) + ";").join(""),
  )));
  it("blocks nested JSON text with escaped Unicode source characters", () => {
    const escaped = Array.from(privateWord).map((c) =>
      "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")).join("");
    blocked(JSON.stringify({ nested: JSON.stringify({ label: escaped }) }), "application/json");
  });
  it("blocks UTF-8 base64 of known names", () => {
    const bytes = new TextEncoder().encode(privateWord);
    const base64 = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
    blocked(base64);
  });
  it("passes clearly nonsensitive encoded data", () =>
    expect(() => inspectStrictSerializedFiles([file("DAY_0001 PERSON_A")], [privateWord])).not.toThrow());
});
