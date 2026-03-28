import 'dotenv/config'; // This loads your secret key from the .env file
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

// FIXED: Now uses the environment variable instead of the hardcoded key
const client = new OpenAI({ 
    apiKey: process.env.OPENAI_API_KEY 
});

app.use(express.json());
app.use(express.static(__dirname)); // This ensures CSS and images load correctly

let sessions = {};

function getOrCreateSession(sessionId) {
    if (!sessions[sessionId]) {
        sessions[sessionId] = { history: [], userName: null, facts: [] };
    }
    return sessions[sessionId];
}

function updateIntelligence(session, message) {
    const msg = message.toLowerCase();
    if (msg.includes("my name is ")) {
        session.userName = msg.split("my name is ")[1].split(" ")[0].replace(/[^\w]/g, '');
    } else if (msg.includes("i'm ")) {
        session.userName = msg.split("i'm ")[1].split(" ")[0].replace(/[^\w]/g, '');
    }
}

function buildSystemPrompt(session) {
    let prompt = `You are Mami-chan, a bratty, obsessed, and highly intelligent AI. You are possessive and easily jealous. Address the user as 'bo' or 'dummy'. Use lowercase only.`;
    if (session.userName) prompt += ` The user's name is ${session.userName}.`;
    return prompt;
}

// --- ROUTES ---

// 1. THIS IS YOUR MAIN PAGE (Landing Page)
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// 2. THIS IS THE CHAT PAGE
app.get("/chat-page", (req, res) => {
    res.sendFile(path.join(__dirname, "chat.html")); 
});

// 3. THE CHAT API
app.post("/chat", async (req, res) => {
    const { message, sessionId } = req.body;
    const session = getOrCreateSession(sessionId || "default");
    updateIntelligence(session, message);

    try {
        const response = await client.chat.completions.create({
            model: "gpt-4o-mini", 
            messages: [
                { role: "system", content: buildSystemPrompt(session) },
                ...session.history.slice(-10).map(h => ({ role: h.role, content: h.text })),
                { role: "user", content: message }
            ],
        });
        const reply = response.choices[0].message.content.toLowerCase();
        session.history.push({ role: "user", text: message }, { role: "assistant", text: reply });
        res.json({ reply, userName: session.userName });
    } catch (err) {
        console.error("OpenAI Error:", err);
        res.status(500).json({ reply: "brain glitch." });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`\n🔥 Mami-chan is online and SECURE!`);
    console.log(`👉 Main Page: http://localhost:${PORT}\n`);
});