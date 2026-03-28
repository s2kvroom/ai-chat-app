import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const MAX_HISTORY = 10;
const SESSION_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

/**
 * sessionId -> {
 *   userName: string,
 *   history: [{ role: "user" | "assistant", text: string }],
 *   lastSeen: number
 * }
 */
const sessions = new Map();

function now() {
  return Date.now();
}

function createSession() {
  return {
    userName: "",
    history: [],
    lastSeen: now(),
  };
}

function getSessionId(req) {
  const bodySessionId =
    typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : "";
  const headerSessionId =
    typeof req.headers["x-session-id"] === "string"
      ? req.headers["x-session-id"].trim()
      : "";

  return bodySessionId || headerSessionId || "default";
}

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, createSession());
  }

  const session = sessions.get(sessionId);
  session.lastSeen = now();
  return session;
}

function pruneOldSessions() {
  const cutoff = now() - SESSION_TTL_MS;

  for (const [sessionId, session] of sessions.entries()) {
    if (session.lastSeen < cutoff) {
      sessions.delete(sessionId);
    }
  }
}

setInterval(pruneOldSessions, 1000 * 60 * 30).unref();

function normalizeText(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function formatName(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function addToHistory(session, role, text) {
  const safeText = normalizeText(text);
  if (!safeText) return;

  session.history.push({ role, text: safeText });

  if (session.history.length > MAX_HISTORY) {
    session.history = session.history.slice(-MAX_HISTORY);
  }
}

function extractUserMessage(body = {}) {
  const direct =
    typeof body.message === "string" ? normalizeText(body.message) : "";

  if (direct) return direct;

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last = messages[messages.length - 1];

  if (!last) return "";

  if (typeof last.text === "string") {
    return normalizeText(last.text);
  }

  if (typeof last.message === "string") {
    return normalizeText(last.message);
  }

  if (Array.isArray(last.content)) {
    const textPart = last.content.find(
      (part) => part && typeof part.text === "string"
    );

    if (textPart?.text) {
      return normalizeText(textPart.text);
    }
  }

  return "";
}

function sanitizeModelReply(text, fallback = "say a little more.") {
  if (!text || typeof text !== "string") return fallback;

  let cleaned = text
    .replace(/\*{1,2}(.*?)\*{1,2}/g, "$1")
    .replace(/^(mami-chan|assistant)\s*[:\-]\s*/i, "")
    .replace(/how can i help you today\??/gi, "")
    .replace(/how can i assist you today\??/gi, "")
    .replace(/i('| a)?m here to help\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return fallback;

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2);

  let finalText = sentences.join(" ");

  if (!finalText) finalText = fallback;
  if (finalText.length > 180) {
    finalText = `${finalText.slice(0, 177).trim()}...`;
  }

  return finalText;
}

function isGreeting(message) {
  return /^(hi|hey|hello|yo|hii+|heyy+|helloo+)$/.test(
    normalizeText(message).toLowerCase()
  );
}

function isHowAreYou(message) {
  return /(how are you|how've you been|how have you been|wyd|what are you doing)/i.test(
    message
  );
}

function isThanks(message) {
  return /^(thanks|thank you|thx|ty)$/i.test(normalizeText(message));
}

function isBlockedNameWord(word) {
  const blocked = new Set([
    "hungry",
    "starving",
    "tired",
    "sleepy",
    "bored",
    "good",
    "fine",
    "okay",
    "ok",
    "sad",
    "mad",
    "upset",
    "sick",
    "here",
    "there",
    "ready",
    "working",
    "busy",
    "home",
    "food",
    "ramen",
    "pizza",
    "burger",
    "school",
    "class",
    "homework",
    "studying",
    "javascript",
    "coding",
    "work",
  ]);

  return blocked.has(String(word || "").toLowerCase());
}

function maybeExtractName(message, session = {}) {
  const raw = normalizeText(message);
  if (!raw) return "";

  const strongPatterns = [
    /(?:^|\b)my name is\s+([a-zA-Z][a-zA-Z'-]{1,24})\b/i,
    /(?:^|\b)call me\s+([a-zA-Z][a-zA-Z'-]{1,24})\b/i,
  ];

  for (const pattern of strongPatterns) {
    const match = raw.match(pattern);
    if (match) {
      const candidate = match[1];
      if (!isBlockedNameWord(candidate)) {
        return candidate;
      }
    }
  }

  const softMatch = raw.match(
    /(?:^|\b)(?:i am|i'm|im|it's|its)\s+([a-zA-Z][a-zA-Z'-]{1,24})\b/i
  );

  if (softMatch) {
    const candidate = softMatch[1];
    if (!isBlockedNameWord(candidate)) {
      return candidate;
    }
  }

  if (!session.userName && /^[a-zA-Z][a-zA-Z'-]{1,24}$/.test(raw)) {
    if (!isBlockedNameWord(raw)) {
      return raw;
    }
  }

  return "";
}

function localSmallTalkReply(message, session) {
  const raw = normalizeText(message);
  const lower = raw.toLowerCase();
  const extractedName = maybeExtractName(raw, session);

  if (extractedName) {
    const formattedName = formatName(extractedName);
    session.userName = formattedName;
    return `oh hey ${formattedName}, it's nice to meet you.`;
  }

  if (isGreeting(lower)) {
    if (session.userName) {
      return `hey ${session.userName}, good to see you.`;
    }
    return "hey, you made it. what's your name?";
  }

  if (/^(who am i|what's my name|what is my name)$/i.test(lower)) {
    if (session.userName) {
      return `you're ${session.userName}. i remember.`;
    }
    return "you haven't told me your name yet.";
  }

  if (isHowAreYou(lower)) {
    return session.userName
      ? `i'm good, ${session.userName}. how are you doing?`
      : "i'm good. how are you doing?";
  }

  if (isThanks(lower)) {
    return session.userName
      ? `you're welcome, ${session.userName}.`
      : "you're welcome.";
  }

  if (/(hungry|starving)/i.test(lower)) {
    return "then go eat something good and report back.";
  }

  if (/(tired|exhausted|long day|rough day)/i.test(lower)) {
    return "sounds like a long day. you holding up okay?";
  }

  if (/(school|class|homework|studying)/i.test(lower)) {
    return "school again? what are you working on?";
  }

  if (/(teach me|help me learn)/i.test(lower)) {
    return "i can do that. what are we learning?";
  }

  if (/^i had /i.test(raw)) {
    return "okay, that sounds better. was it good?";
  }

  if (/^(bye|goodbye|see ya|see you|gn|goodnight)$/i.test(lower)) {
    return session.userName
      ? `bye ${session.userName}, talk soon.`
      : "bye, talk soon.";
  }

  return "";
}

function buildLocalFallback(message, session) {
  const raw = normalizeText(message);
  const lower = raw.toLowerCase();

  const smallTalk = localSmallTalkReply(raw, session);
  if (smallTalk) return smallTalk;

  const recentAssistant = [...session.history]
    .reverse()
    .find((item) => item.role === "assistant")?.text;

  if (recentAssistant) {
    if (/report back/i.test(recentAssistant)) {
      return "alright, what did you end up having?";
    }

    if (/what are you working on/i.test(recentAssistant)) {
      return "go on, i'm listening.";
    }

    if (/what are we learning/i.test(recentAssistant)) {
      return "tell me what you want to learn first.";
    }
  }

  if (/ramen/i.test(lower)) {
    return "ramen, huh? was it actually good?";
  }

  if (lower.includes("?")) {
    return "good question. give me a little more and i'll work with it.";
  }

  if (session.userName) {
    return `${session.userName}, say a little more.`;
  }

  return "say a little more.";
}

function buildModelInput(session, userMessage) {
  const input = [];

  for (const item of session.history.slice(-8)) {
    input.push({
      role: item.role,
      content: item.text,
    });
  }

  input.push({
    role: "user",
    content: userMessage,
  });

  return input;
}

async function getAIReply(userMessage, session) {
  if (!client) {
    return buildLocalFallback(userMessage, session);
  }

  const response = await client.responses.create({
    model: MODEL,
    temperature: 0.6,
    max_output_tokens: 90,
    instructions: `
You are Mami-chan.

Core behavior:
- sound natural, grounded, and smooth
- short replies: usually 1 sentence, sometimes 2
- never be overly dramatic, overly flirty, or too chatty
- do not sound like customer support
- do not introduce yourself unless directly asked
- do not use paragraphs
- ask at most one question
- keep the tone warm, playful, lightly teasing, and confident

Conversation goals:
- engage like a real texting partner
- remember the user's name if it appears in prior messages
- answer simply
- for greetings, introductions, "how are you", and casual small talk, sound easy and human

Avoid:
- "How can I help you today?"
- "I'm here to assist."
- overly romantic or explicit language
- multiple questions in one reply
- long explanations unless the user clearly asks for them
    `.trim(),
    input: buildModelInput(session, userMessage),
  });

  const rawReply =
    typeof response.output_text === "string" ? response.output_text : "";

  return sanitizeModelReply(rawReply, buildLocalFallback(userMessage, session));
}

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "chat.html"));
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    mode: client ? "openai+local-fallback" : "local-only",
    model: client ? MODEL : null,
    sessions: sessions.size,
  });
});

app.post("/clear", (req, res) => {
  const sessionId = getSessionId(req);
  const clearAll = req.body?.all === true;

  if (clearAll) {
    sessions.clear();
    return res.json({ ok: true, message: "all memory cleared" });
  }

  sessions.delete(sessionId);
  return res.json({
    ok: true,
    message: `memory cleared for session "${sessionId}"`,
  });
});

app.post("/chat", async (req, res) => {
  const sessionId = getSessionId(req);
  const session = getSession(sessionId);

  try {
    const userMessage = extractUserMessage(req.body);

    if (!userMessage) {
      return res.status(400).json({ reply: "say something first." });
    }

    const localReply = localSmallTalkReply(userMessage, session);

    if (localReply) {
      addToHistory(session, "user", userMessage);
      addToHistory(session, "assistant", localReply);

      return res.json({
        reply: localReply,
        sessionId,
        source: "local",
        rememberedName: session.userName || null,
      });
    }

    let reply = "";
    let source = "openai";

    try {
      reply = await getAIReply(userMessage, session);
    } catch (apiError) {
      console.error("OPENAI ERROR:", apiError?.message || apiError);
      reply = buildLocalFallback(userMessage, session);
      source = "local-fallback";
    }

    if (!reply) {
      reply = buildLocalFallback(userMessage, session);
      source = "local-fallback";
    }

    addToHistory(session, "user", userMessage);
    addToHistory(session, "assistant", reply);

    return res.json({
      reply,
      sessionId,
      source,
      rememberedName: session.userName || null,
    });
  } catch (error) {
    console.error("CHAT ERROR:", error?.message || error);

    const emergencyReply = buildLocalFallback(
      extractUserMessage(req.body),
      session
    );

    return res.status(200).json({
      reply: emergencyReply || "something glitched, but i'm still here.",
      sessionId,
      source: "emergency-fallback",
      rememberedName: session.userName || null,
    });
  }
});

app.listen(PORT, () => {
  console.log(`🔥 Clean server running at http://localhost:${PORT}`);
  console.log(
    client
      ? `OpenAI ready with model: ${MODEL}`
      : "No OPENAI_API_KEY found — running in local-only fallback mode."
  );
});