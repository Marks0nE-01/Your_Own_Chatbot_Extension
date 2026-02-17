const messagesEl = document.getElementById("messages");
const promptEl = document.getElementById("prompt");
const sendBtnEl = document.getElementById("sendBtn");
const providerLabelEl = document.getElementById("providerLabel");
const connectionLabelEl = document.getElementById("connectionLabel");
const openSettingsBtnEl = document.getElementById("openSettingsBtn");

let settings = {
  provider: "openai",
  apiKey: ""
};

function appendMessage(text, type) {
  const el = document.createElement("div");
  el.className = `msg ${type}`;
  el.textContent = text;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setSendingState(isSending) {
  sendBtnEl.disabled = isSending;
  sendBtnEl.textContent = isSending ? "Sending..." : "Send";
}

function setConnectionStatus(state, label) {
  connectionLabelEl.className = `connection ${state}`;
  connectionLabelEl.textContent = `Connection: ${label}`;
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

async function callProviderDirect(prompt) {
  if (settings.provider === "gemini") {
    const modelName = await resolveGeminiModel(settings.apiKey);
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${encodeURIComponent(settings.apiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || `Gemini request failed (${response.status})`);
    }
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI request failed (${response.status})`);
  }
  return data?.choices?.[0]?.message?.content || "";
}

async function checkConnection() {
  if (!settings.apiKey) {
    setConnectionStatus("disconnected", "not connected");
    return;
  }

  setConnectionStatus("checking", "checking...");

  try {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "AI_PING",
        provider: settings.provider,
        apiKey: settings.apiKey
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Ping failed");
      }
    } catch (error) {
      const message = error?.message || "";
      if (!message.includes("Receiving end does not exist")) {
        throw error;
      }
      await callProviderDirect("ping");
    }

    setConnectionStatus("connected", "connected");
  } catch (error) {
    setConnectionStatus("disconnected", "not connected");
    appendMessage(`Connection check failed: ${error?.message || "Unknown error"}`, "error");
  }
}

async function loadSettings() {
  settings = await chrome.storage.sync.get({
    provider: "openai",
    apiKey: ""
  });

  providerLabelEl.textContent = `Provider: ${settings.provider}`;

  if (!settings.apiKey) {
    appendMessage("No API key found. Open Settings and save your key.", "error");
  } else {
    appendMessage("Hi, I am your AI agent. How can I help you today?", "ai");
  }

  await checkConnection();
}

async function sendPrompt() {
  const prompt = promptEl.value.trim();

  if (!prompt) {
    return;
  }

  if (!settings.apiKey) {
    appendMessage("Cannot send: API key is missing. Open Settings.", "error");
    return;
  }

  appendMessage(prompt, "user");
  promptEl.value = "";
  setSendingState(true);

  try {
    let text = "";
    try {
      const response = await chrome.runtime.sendMessage({
        type: "AI_CHAT",
        provider: settings.provider,
        apiKey: settings.apiKey,
        prompt
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Request failed");
      }
      text = response.text;
    } catch (error) {
      const message = error?.message || "";
      if (!message.includes("Receiving end does not exist")) {
        throw error;
      }
      text = await callProviderDirect(prompt);
    }

    if (!text) {
      throw new Error("Empty response from provider.");
    }
    appendMessage(text, "ai");
  } catch (error) {
    appendMessage(`Error: ${error.message || "Unknown error"}`, "error");
  } finally {
    setSendingState(false);
    promptEl.focus();
  }
}

sendBtnEl.addEventListener("click", sendPrompt);
promptEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendPrompt();
  }
});

openSettingsBtnEl.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") {
    return;
  }

  if (changes.provider) {
    settings.provider = changes.provider.newValue;
  }

  if (changes.apiKey) {
    settings.apiKey = changes.apiKey.newValue;
  }

  providerLabelEl.textContent = `Provider: ${settings.provider}`;
  checkConnection();
});

loadSettings();
