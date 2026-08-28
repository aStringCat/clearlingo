(() => {
  const BLOCK_SELECTOR = "p, li, blockquote, figcaption, h1, h2, h3, h4, h5, h6, td, th, dd, dt";
  const EXCLUDED_SELECTOR = [
    "nav", "header", "footer", "aside", "form", "dialog",
    "pre", "code", "kbd", "samp", "script", "style", "noscript",
    "textarea", "input", "select", "button", "[contenteditable]",
    "[aria-hidden='true']", ".clearlingo-managed", ".clearlingo-ui"
  ].join(",");
  const BATCH_SIZE = 8;
  const state = {
    active: false,
    busy: false,
    settings: null,
    observer: null,
    translated: new Set(),
    queue: new Set(),
    queueTimer: null,
    sourceLanguage: "en",
    localTranslator: null
  };

  function normalizeText(text) {
    return text.replace(/\s+/gu, " ").trim();
  }

  function normalizeLanguageTag(tag, { forLocalApi = false } = {}) {
    const normalized = String(tag || "").trim().replaceAll("_", "-");
    if (!normalized) return "";
    const lower = normalized.toLowerCase();
    if (lower.startsWith("zh")) {
      const traditional = /(?:hant|tw|hk|mo)/iu.test(normalized);
      return forLocalApi ? (traditional ? "zh-Hant" : "zh") : (traditional ? "zh-TW" : "zh-CN");
    }
    return lower.split("-")[0];
  }

  function inferLanguage(text) {
    if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) return "ja";
    if (/\p{Script=Hangul}/u.test(text)) return "ko";
    if (/\p{Script=Han}/u.test(text)) return "zh-CN";
    if (/\p{Script=Arabic}/u.test(text)) return "ar";
    if (/\p{Script=Cyrillic}/u.test(text)) return "ru";
    return "en";
  }

  async function detectSourceLanguage(sample) {
    const declared = normalizeLanguageTag(document.documentElement.lang);
    if (declared) return declared;

    if ("LanguageDetector" in globalThis) {
      try {
        const availability = await LanguageDetector.availability();
        if (availability !== "unavailable") {
          const detector = await LanguageDetector.create();
          const [result] = await detector.detect(sample);
          detector.destroy();
          const detected = normalizeLanguageTag(result?.detectedLanguage);
          if (detected) return detected;
        }
      } catch {
        // Script-based detection below is immediate and network-free.
      }
    }

    return inferLanguage(sample);
  }

  async function prepareLocalTranslator(sourceLanguage, targetLanguage) {
    if (!("Translator" in globalThis)) return null;
    const source = normalizeLanguageTag(sourceLanguage, { forLocalApi: true });
    const target = normalizeLanguageTag(targetLanguage, { forLocalApi: true });
    if (!source || !target || source === target) return null;

    try {
      const availability = await Translator.availability({ sourceLanguage: source, targetLanguage: target });
      if (availability === "unavailable") return null;
      if (availability === "downloadable") showToast("正在准备浏览器本地语言包…");
      return await Translator.create({ sourceLanguage: source, targetLanguage: target });
    } catch {
      return null;
    }
  }

  function isTranslatable(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.closest(EXCLUDED_SELECTOR)) return false;
    if (element.querySelector(BLOCK_SELECTOR)) return false;
    if (!element.getClientRects().length) return false;

    const text = normalizeText(element.textContent ?? "");
    if (text.length < 2 || text.length > 12000) return false;
    if (!/\p{L}{2}/u.test(text)) return false;
    if (/^(?:https?:\/\/|www\.)\S+$/iu.test(text)) return false;
    return true;
  }

  function collect(root = document.body) {
    if (!root) return [];
    const elements = [];
    if (root.matches?.(BLOCK_SELECTOR) && isTranslatable(root)) elements.push(root);
    for (const element of root.querySelectorAll?.(BLOCK_SELECTOR) ?? []) {
      if (isTranslatable(element)) elements.push(element);
    }
    return elements;
  }

  function createToast() {
    let host = document.querySelector(".clearlingo-ui");
    if (host) return host;
    host = document.createElement("div");
    host.className = "clearlingo-ui";
    host.setAttribute("aria-live", "polite");
    document.documentElement.append(host);
    return host;
  }

  function showToast(message, tone = "default") {
    const toast = createToast();
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.classList.add("clearlingo-ui-visible");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("clearlingo-ui-visible"), 2400);
  }

  function renderTranslation(element, translatedText) {
    if (!element.isConnected || state.translated.has(element)) return;

    const original = document.createElement("span");
    original.className = "clearlingo-original";
    while (element.firstChild) original.append(element.firstChild);

    const translation = document.createElement("span");
    translation.className = "clearlingo-translation";
    translation.lang = state.settings.targetLanguage;
    translation.dir = "auto";
    translation.textContent = translatedText;

    element.classList.add("clearlingo-managed");
    element.dataset.clearlingoDisplay = state.settings.displayMode;
    element.append(original, translation);
    state.translated.add(element);
  }

  async function translateElements(elements, { quiet = false } = {}) {
    const pending = elements.filter((element) => !state.translated.has(element));
    if (!pending.length) return;

    for (let start = 0; start < pending.length && state.active; start += BATCH_SIZE) {
      const batch = pending.slice(start, start + BATCH_SIZE);
      const texts = batch.map((element) => normalizeText(element.textContent ?? ""));
      let translations;

      if (state.localTranslator) {
        try {
          translations = await Promise.all(texts.map((text) => state.localTranslator.translate(text)));
        } catch {
          state.localTranslator.destroy?.();
          state.localTranslator = null;
          if (!quiet) showToast("本地翻译不可用，已切换在线服务");
        }
      }

      if (!translations) {
        const response = await chrome.runtime.sendMessage({
          type: "CLEARLINGO_TRANSLATE_TEXTS",
          texts,
          sourceLanguage: state.sourceLanguage,
          targetLanguage: state.settings.targetLanguage
        });
        if (!response?.ok) throw new Error(response?.error || "翻译失败");
        translations = response.translations;
      }

      batch.forEach((element, index) => renderTranslation(element, translations[index]));
      if (!quiet) showToast(`正在翻译 ${Math.min(start + batch.length, pending.length)} / ${pending.length}`);
    }
  }

  function observePage() {
    state.observer?.disconnect();
    state.observer = new MutationObserver((mutations) => {
      if (!state.active) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement) || node.closest(".clearlingo-managed, .clearlingo-ui")) continue;
          collect(node).forEach((element) => state.queue.add(element));
        }
      }

      if (!state.queue.size || state.queueTimer) return;
      state.queueTimer = setTimeout(async () => {
        const queued = [...state.queue];
        state.queue.clear();
        state.queueTimer = null;
        try {
          await translateElements(queued, { quiet: true });
        } catch (error) {
          showToast(error.message, "error");
        }
      }, 500);
    });
    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  async function start(settings) {
    if (state.busy) return;
    state.busy = true;
    state.active = true;
    state.settings = settings;
    document.documentElement.classList.add("clearlingo-active");

    try {
      const elements = collect();
      if (!elements.length) {
        showToast("没有找到可翻译的正文", "error");
        state.active = false;
        document.documentElement.classList.remove("clearlingo-active");
        return;
      }
      const sample = elements.slice(0, 8).map((element) => normalizeText(element.textContent ?? "")).join(" ").slice(0, 4000);
      state.sourceLanguage = await detectSourceLanguage(sample);
      state.localTranslator = await prepareLocalTranslator(state.sourceLanguage, settings.targetLanguage);
      await translateElements(elements);
      if (state.active) {
        observePage();
        showToast(`已翻译 ${state.translated.size} 个段落`, "success");
      }
    } catch (error) {
      showToast(error.message, "error");
      restore({ silent: true });
      throw error;
    } finally {
      state.busy = false;
    }
  }

  function restore({ silent = false } = {}) {
    state.active = false;
    state.observer?.disconnect();
    state.observer = null;
    clearTimeout(state.queueTimer);
    state.queue.clear();
    state.queueTimer = null;
    state.localTranslator?.destroy?.();
    state.localTranslator = null;

    for (const element of state.translated) {
      if (!element.isConnected) continue;
      const original = element.querySelector(":scope > .clearlingo-original");
      const translation = element.querySelector(":scope > .clearlingo-translation");
      if (original) {
        while (original.firstChild) element.insertBefore(original.firstChild, original);
        original.remove();
      }
      translation?.remove();
      element.classList.remove("clearlingo-managed");
      delete element.dataset.clearlingoDisplay;
    }

    state.translated.clear();
    document.documentElement.classList.remove("clearlingo-active");
    if (!silent) showToast("已还原原网页", "success");
  }

  async function getSettings() {
    return chrome.storage.sync.get({ targetLanguage: "zh-CN", displayMode: "bilingual" });
  }

  async function toggle(settings) {
    if (state.active) restore();
    else await start(settings ?? await getSettings());
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "CLEARLINGO_GET_STATE") {
      sendResponse({ active: state.active, busy: state.busy, count: state.translated.size });
      return false;
    }
    if (message?.type === "CLEARLINGO_RESTORE") {
      restore();
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "CLEARLINGO_TRANSLATE_PAGE" || message?.type === "CLEARLINGO_TOGGLE") {
      toggle(message.settings)
        .then(() => sendResponse({ ok: true, active: state.active, count: state.translated.size }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    return false;
  });
})();
