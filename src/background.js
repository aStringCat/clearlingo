import { createMyMemoryTranslator } from "./translator.js";

const translate = createMyMemoryTranslator();
const cache = new Map();
const CACHE_LIMIT = 500;
const CONCURRENCY = 4;

function cacheKey(text, sourceLanguage, targetLanguage) {
  return `${sourceLanguage}\u0000${targetLanguage}\u0000${text}`;
}

async function translateCached(text, sourceLanguage, targetLanguage) {
  const key = cacheKey(text, sourceLanguage, targetLanguage);
  if (cache.has(key)) return cache.get(key);

  const pending = translate(text, sourceLanguage, targetLanguage).catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, pending);

  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return pending;
}

async function mapConcurrent(items, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run));
  return results;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "CLEARLINGO_TRANSLATE_TEXTS") return false;

  mapConcurrent(message.texts, (text) => translateCached(text, message.sourceLanguage, message.targetLanguage))
    .then((translations) => sendResponse({ ok: true, translations }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-translation") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "CLEARLINGO_TOGGLE" });
  } catch {
    // Browser-internal pages intentionally reject content scripts.
  }
});
