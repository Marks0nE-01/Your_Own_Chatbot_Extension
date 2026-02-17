const providerEl = document.getElementById("provider");
const apiKeyEl = document.getElementById("apiKey");
const saveBtnEl = document.getElementById("saveBtn");
const checkBtnEl = document.getElementById("checkBtn");
const statusEl = document.getElementById("status");
const connectionBadgeEl = document.getElementById("connectionBadge");

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = type;
}

function clearStatus() {
  statusEl.textContent = "";
  statusEl.className = "";
}

function setConnectionBadge(state, message) {
  connectionBadgeEl.className = `badge ${state}`;
  connectionBadgeEl.textContent = `Status: ${message}`;
}

async function resolveGeminiModel(apiKey) {
  const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const listResponse = await fetch(listUrl, { method: "GET" });
  const listData = await listResponse.json();

  if (!listResponse.ok) {
    throw new Error(listData?.error?.message || `Gemini list models failed (${listResponse.status})`);
  }

  const models = listData?.models || [];
  const candidates = models.filter((model) => {
    const name = model?.name || "";
    const methods = model?.supportedGenerationMethods || [];
    return name.includes("gemini") && name.includes("flash") && methods.includes("generateContent");
  });

  if (!candidates.length) {
    throw new Error("No Gemini Flash model with generateContent support was found.");
  }

  return candidates[0].name;
}

async function directPing(provider, apiKey) {
  if (provider === "gemini") {
    const modelName = await resolveGeminiModel(apiKey);
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "ping" }] }]
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || `Gemini ping failed (${response.status})`);
    }
    return;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI ping failed (${response.status})`);
  }
}

async function loadSettings() {
  const result = await chrome.storage.sync.get({
    provider: "openai",
    apiKey: ""
  });

  providerEl.value = result.provider;
  apiKeyEl.value = result.apiKey;

  if (!result.apiKey) {
    setConnectionBadge("disconnected", "Not connected");
  } else {
    await checkConnection();
  }
}

async function checkConnection() {
  const provider = providerEl.value;
  const apiKey = apiKeyEl.value.trim();

  if (!apiKey) {
    setConnectionBadge("disconnected", "Not connected");
    return;
  }

  checkBtnEl.disabled = true;
  setConnectionBadge("checking", "Checking...");

  try {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "AI_PING",
        provider,
        apiKey
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Connection check failed");
      }
    } catch (error) {
      const message = error?.message || "";
      if (!message.includes("Receiving end does not exist")) {
        throw error;
      }
      await directPing(provider, apiKey);
      showStatus("Background worker unavailable. Using direct API check.", "success");
    }

    setConnectionBadge("connected", "Connected");
  } catch (error) {
    const reason = error?.message || "Unknown connection error";
    setConnectionBadge("disconnected", "Not connected");
    showStatus(`Connection check failed: ${reason}`, "error");
  } finally {
    checkBtnEl.disabled = false;
  }
}

async function saveSettings() {
  const provider = providerEl.value;
  const apiKey = apiKeyEl.value.trim();

  if (!apiKey) {
    showStatus("Please enter an API key.", "error");
    return;
  }

  saveBtnEl.disabled = true;
  saveBtnEl.textContent = "Saving...";
  clearStatus();

  try {
    await chrome.storage.sync.set({ provider, apiKey });
    showStatus("Settings saved successfully.", "success");
    await checkConnection();
  } catch (error) {
    showStatus(`Failed to save: ${error.message || "Unknown error"}`, "error");
  } finally {
    saveBtnEl.disabled = false;
    saveBtnEl.textContent = "Save Settings";
  }
}

saveBtnEl.addEventListener("click", saveSettings);
checkBtnEl.addEventListener("click", checkConnection);
providerEl.addEventListener("change", () => {
  clearStatus();
  setConnectionBadge("disconnected", "Not connected");
});
apiKeyEl.addEventListener("input", () => {
  clearStatus();
  setConnectionBadge("disconnected", "Not connected");
});

loadSettings();
