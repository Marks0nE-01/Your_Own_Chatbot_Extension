const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

function getModelScore(modelName) {
  const name = modelName.toLowerCase();
  let score = 0;

  if (name.includes("flash")) score += 1000;
  if (name.includes("lite")) score -= 50;
  if (name.includes("exp")) score -= 100;

  const versionMatch = name.match(/gemini-(\d+)(?:\.(\d+))?/);
  if (versionMatch) {
    const major = Number(versionMatch[1] || 0);
    const minor = Number(versionMatch[2] || 0);
    score += major * 100 + minor * 10;
  }

  return score;
}

async function resolveGeminiModel(apiKey) {
  const url = `${GEMINI_API_BASE}/models?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, { method: "GET" });
  const data = await response.json();

  if (!response.ok) {
    const message = data?.error?.message || `Gemini list models failed (${response.status})`;
    throw new Error(message);
  }

  const models = data?.models || [];
  const candidates = models.filter((model) => {
    const name = model?.name || "";
    const methods = model?.supportedGenerationMethods || [];
    return name.includes("gemini") && name.includes("flash") && methods.includes("generateContent");
  });

  if (!candidates.length) {
    throw new Error("No Gemini Flash model with generateContent support was found for this API key.");
  }

  candidates.sort((a, b) => getModelScore(b.name) - getModelScore(a.name));
  return candidates[0].name;
}

async function callOpenAI(apiKey, prompt) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    })
  });

  const data = await response.json();

  if (!response.ok) {
    const message = data?.error?.message || `OpenAI request failed (${response.status})`;
    throw new Error(message);
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("OpenAI returned an empty response.");
  }

  return text;
}

async function pingOpenAI(apiKey) {
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

  if (!response.ok) {
    let message = `OpenAI connection failed (${response.status})`;
    try {
      const data = await response.json();
      message = data?.error?.message || message;
    } catch (_error) {
      // Ignore JSON parsing errors and use fallback message.
    }
    throw new Error(message);
  }
}

async function callGemini(apiKey, prompt) {
  const modelName = await resolveGeminiModel(apiKey);
  const url = `${GEMINI_API_BASE}/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ]
    })
  });

  const data = await response.json();

  if (!response.ok) {
    const message = data?.error?.message || `Gemini request failed (${response.status})`;
    throw new Error(message);
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  return text;
}

async function pingGemini(apiKey) {
  const modelName = await resolveGeminiModel(apiKey);
  const url = `${GEMINI_API_BASE}/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: "ping" }]
        }
      ]
    })
  });

  if (!response.ok) {
    let message = `Gemini connection failed (${response.status})`;
    try {
      const data = await response.json();
      message = data?.error?.message || message;
    } catch (_error) {
      // Ignore JSON parsing errors and use fallback message.
    }
    throw new Error(message);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type;
  if (type !== "AI_CHAT" && type !== "AI_PING") {
    return;
  }

  (async () => {
    try {
      const { provider, apiKey } = message;

      if (!apiKey) {
        throw new Error("API key is missing.");
      }

      if (type === "AI_PING") {
        if (provider === "gemini") {
          await pingGemini(apiKey);
        } else {
          await pingOpenAI(apiKey);
        }

        sendResponse({ ok: true });
        return;
      }

      const { prompt } = message;
      if (!prompt?.trim()) {
        throw new Error("Prompt is empty.");
      }

      let text;
      if (provider === "gemini") {
        text = await callGemini(apiKey, prompt);
      } else {
        text = await callOpenAI(apiKey, prompt);
      }

      sendResponse({ ok: true, text });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error?.message || "Unknown error"
      });
    }
  })();

  return true;
});
