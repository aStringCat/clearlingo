import test from "node:test";
import assert from "node:assert/strict";
import { createMyMemoryTranslator, splitText } from "../src/translator.js";

test("splitText preserves all content and respects the limit", () => {
  const source = `${"A".repeat(18)}. ${"B".repeat(18)}. ${"C".repeat(18)}.`;
  const chunks = splitText(source, 24);
  assert.equal(chunks.join(""), source);
  assert.ok(chunks.every((chunk) => new TextEncoder().encode(chunk).length <= 24));
});

test("translator reads a MyMemory response", async () => {
  const requested = [];
  const fakeFetch = async (url) => {
    requested.push(url);
    return {
      ok: true,
      async json() {
        return { responseStatus: 200, responseData: { translatedText: "你好世界" } };
      }
    };
  };
  const translate = createMyMemoryTranslator(fakeFetch);
  assert.equal(await translate("hello world", "en", "zh-CN"), "你好世界");
  assert.equal(requested[0].searchParams.get("langpair"), "en|zh-CN");
  assert.equal(requested[0].searchParams.get("q"), "hello world");
});

test("translator reports empty responses", async () => {
  const translate = createMyMemoryTranslator(async () => ({
    ok: true,
    json: async () => ({ responseStatus: 200, responseData: {} })
  }));
  await assert.rejects(() => translate("hello", "en", "zh-CN"), /未返回有效内容/);
});

test("splitText counts UTF-8 bytes without breaking characters", () => {
  const source = "你好，世界。再见，世界。";
  const chunks = splitText(source, 15);
  assert.equal(chunks.join(""), source);
  assert.ok(chunks.every((chunk) => new TextEncoder().encode(chunk).length <= 15));
});
