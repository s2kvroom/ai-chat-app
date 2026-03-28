const chatBox = document.getElementById("chatBox");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearBtn");

const STORAGE_KEY = "mami_chan_memory_v3";
const SESSION_KEY = "mami_chan_session_id";

let conversationMemory = loadConversation();
let sessionId = loadOrCreateSessionId();
let isSending = false;

function loadOrCreateSessionId() {
  try {
    const saved = localStorage.getItem(SESSION_KEY);

    if (saved && typeof saved === "string" && saved.trim()) {
      return saved;
    }

    const newId =
      "session_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 10);

    localStorage.setItem(SESSION_KEY, newId);
    return newId;
  } catch (error) {
    console.error("Failed to load/create session ID:", error);
    return "default";
  }
}

function loadConversation() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Failed to load conversation:", error);
    return [];
  }
}

function saveConversation() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversationMemory));
  } catch (error) {
    console.error("Failed to save conversation:", error);
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function createMessageElement(text, className) {
  const message = document.createElement("div");
  message.classList.add("message", className);
  message.innerHTML = escapeHtml(text);
  return message;
}

function scrollToBottom() {
  chatBox.scrollTop = chatBox.scrollHeight;
}

function getWelcomeMessage() {
  return "hey, you made it. what's your name?";
}

function renderConversation() {
  chatBox.innerHTML = "";

  if (conversationMemory.length === 0) {
    chatBox.appendChild(
      createMessageElement(getWelcomeMessage(), "bot-message")
    );
    scrollToBottom();
    return;
  }

  for (const item of conversationMemory) {
    const className = item.role === "user" ? "user-message" : "bot-message";
    chatBox.appendChild(createMessageElement(item.text, className));
  }

  scrollToBottom();
}

function addMessage(role, text) {
  const normalizedRole = role === "user" ? "user" : "assistant";
  const safeText = String(text || "").trim();

  if (!safeText) return;

  conversationMemory.push({
    role: normalizedRole,
    text: safeText,
  });

  saveConversation();

  const className = normalizedRole === "user" ? "user-message" : "bot-message";
  chatBox.appendChild(createMessageElement(safeText, className));
  scrollToBottom();
}

function showTypingIndicator() {
  removeTypingIndicator();

  const typingEl = document.createElement("div");
  typingEl.classList.add("message", "bot-message", "typing");
  typingEl.id = "typingIndicator";
  typingEl.textContent = "Mami-chan is typing...";
  chatBox.appendChild(typingEl);
  scrollToBottom();
}

function removeTypingIndicator() {
  const typingEl = document.getElementById("typingIndicator");
  if (typingEl) typingEl.remove();
}

function setInputState(disabled) {
  userInput.disabled = disabled;
  sendBtn.disabled = disabled;
}

async function getBotReply(text) {
  const payload = {
    message: text,
    sessionId,
    messages: conversationMemory,
  };

  const res = await fetch("/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-session-id": sessionId,
    },
    body: JSON.stringify(payload),
  });

  let rawText = "";
  let data = {};

  try {
    rawText = await res.text();
    data = rawText ? JSON.parse(rawText) : {};
  } catch (error) {
    console.error("Failed to parse /chat response:", error, rawText);
    data = {};
  }

  if (data?.sessionId && typeof data.sessionId === "string") {
    sessionId = data.sessionId;

    try {
      localStorage.setItem(SESSION_KEY, sessionId);
    } catch (error) {
      console.error("Failed to save session ID:", error);
    }
  }

  if (!res.ok) {
    const message = data?.reply || data?.message || `Server error ${res.status}`;
    throw new Error(message);
  }

  return data?.reply || "say that again.";
}

async function sendMessage() {
  if (isSending) return;

  const text = userInput.value.trim();
  if (!text) return;

  isSending = true;
  setInputState(true);

  addMessage("user", text);
  userInput.value = "";
  showTypingIndicator();

  try {
    const reply = await getBotReply(text);
    removeTypingIndicator();
    addMessage("assistant", reply);
  } catch (error) {
    console.error("sendMessage error:", error);
    removeTypingIndicator();
    addMessage("assistant", "something glitched, but i'm still here.");
  } finally {
    isSending = false;
    setInputState(false);
    userInput.focus();
  }
}

async function clearConversation() {
  removeTypingIndicator();

  try {
    await fetch("/clear", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-session-id": sessionId,
      },
      body: JSON.stringify({ sessionId }),
    });
  } catch (error) {
    console.error("Failed to clear server memory:", error);
  }

  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch (error) {
    console.error("Failed to clear local storage:", error);
  }

  conversationMemory = [];
  sessionId = loadOrCreateSessionId();

  chatBox.innerHTML = "";
  renderConversation();
  userInput.value = "";
  userInput.focus();
}

sendBtn.addEventListener("click", sendMessage);

userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

clearBtn.addEventListener("click", clearConversation);

renderConversation();