const DEFAULT_SETTINGS = { targetLanguage: "zh-CN", displayMode: "bilingual" };
const toggleButton = document.querySelector("#toggle");
const toggleLabel = document.querySelector("#toggle-label");
const targetLanguage = document.querySelector("#target-language");
const status = document.querySelector("#status");
const modeButtons = [...document.querySelectorAll("[data-mode]")];
let pageState = { active: false, busy: false, count: 0, error: "" };

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToPage(message) {
  const tab = await activeTab();
  if (!tab?.id) throw new Error("找不到当前标签页");
  return chrome.tabs.sendMessage(tab.id, message);
}

function renderState() {
  status.textContent = pageState.error ? "此页面不可用" : pageState.active ? `已翻译 ${pageState.count}` : "就绪";
  status.dataset.active = pageState.active;
  toggleLabel.textContent = pageState.error || (pageState.active ? "还原当前网页" : "翻译当前网页");
  toggleButton.disabled = pageState.busy || Boolean(pageState.error);
}

function renderMode(selectedMode) {
  for (const button of modeButtons) {
    button.setAttribute("aria-checked", String(button.dataset.mode === selectedMode));
  }
}

async function saveSettings() {
  const displayMode = modeButtons.find((button) => button.getAttribute("aria-checked") === "true").dataset.mode;
  const settings = { targetLanguage: targetLanguage.value, displayMode };
  await chrome.storage.sync.set(settings);
  return settings;
}

toggleButton.addEventListener("click", async () => {
  pageState.busy = true;
  renderState();
  try {
    if (pageState.active) {
      await sendToPage({ type: "CLEARLINGO_RESTORE" });
      pageState = { active: false, busy: false, count: 0, error: "" };
    } else {
      const settings = await saveSettings();
      const response = await sendToPage({ type: "CLEARLINGO_TRANSLATE_PAGE", settings });
      if (!response?.ok) throw new Error(response?.error || "翻译失败");
      pageState = { active: response.active, busy: false, count: response.count, error: "" };
    }
  } catch (error) {
    pageState = { ...pageState, busy: false, error: error.message };
  }
  renderState();
});

targetLanguage.addEventListener("change", saveSettings);

for (const button of modeButtons) {
  button.addEventListener("click", async () => {
    renderMode(button.dataset.mode);
    await saveSettings();
  });
}

async function init() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  targetLanguage.value = settings.targetLanguage;
  renderMode(settings.displayMode);

  try {
    pageState = await sendToPage({ type: "CLEARLINGO_GET_STATE" });
  } catch {
    pageState = { active: false, busy: false, count: 0, error: "浏览器限制访问此页面" };
  }
  renderState();
}

init();
