// --- INITIALIZATION ---
const chatBox = document.getElementById("chatBox");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearBtn");

let isSending = false;
// Persistent sessionId so she remembers you across refreshes
let sessionId = localStorage.getItem("mami_session_id") || "user_" + Math.random().toString(36).substr(2, 9);
localStorage.setItem("mami_session_id", sessionId);

// --- UPGRADED UI HELPERS ---

// Simulates Mami-chan's typing speed
async function typeWriter(text, element) {
    let i = 0;
    const speed = 30; 
    return new Promise((resolve) => {
        function type() {
            if (i < text.length) {
                element.textContent += text.charAt(i);
                i++;
                setTimeout(type, speed);
                scrollToBottom();
            } else {
                resolve();
            }
        }
        type();
    });
}

function scrollToBottom() {
    chatBox.scrollTop = chatBox.scrollHeight;
}

function setInputState(disabled) {
    isSending = disabled;
    userInput.disabled = disabled;
    sendBtn.disabled = disabled;
    if (!disabled) userInput.focus();
}

async function appendMessage(text, role) {
    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${role === "user" ? "user-message" : "bot-message"}`;
    
    if (role === "user") {
        msgDiv.textContent = text;
        chatBox.appendChild(msgDiv);
        scrollToBottom();
    } else {
        msgDiv.textContent = ""; 
        chatBox.appendChild(msgDiv);
        await typeWriter(text, msgDiv);
    }
}

// --- CORE ACTION ---

async function sendMessage() {
    const message = userInput.value.trim();
    if (!message || isSending) return;

    appendMessage(message, "user");
    userInput.value = "";
    setInputState(true);

    // Mami-chan "thinking" messages
    const insults = [
        "mami-chan is judging your typing...",
        "mami-chan is rolling her eyes...",
        "mami-chan is thinking of a comeback...",
        "mami-chan is wondering why you're still here..."
    ];
    const randomInsult = insults[Math.floor(Math.random() * insults.length)];

    const typingIndicator = document.createElement("div");
    typingIndicator.className = "message bot-message typing-indicator";
    typingIndicator.textContent = randomInsult;
    chatBox.appendChild(typingIndicator);
    scrollToBottom();

    try {
        const response = await fetch("/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message, sessionId })
        });

        const data = await response.json();
        typingIndicator.remove();

        if (data.reply) {
            await appendMessage(data.reply, "assistant");
        }
        
        // If the server updated your name, we could log it here
        if (data.userName && data.userName !== "stranger") {
            console.log("Mami-chan knows you are:", data.userName);
        }

    } catch (error) {
        if (typingIndicator) typingIndicator.remove();
        appendMessage("my brain glitched. stop being so confusing.", "assistant");
    } finally {
        setInputState(false);
    }
}

// --- EVENT LISTENERS ---

sendBtn.addEventListener("click", sendMessage);

userInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendMessage();
});

clearBtn.addEventListener("click", async () => {
    if (confirm("Reset Mami-chan's memory? She might get mad...")) {
        await fetch("/clear", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId })
        });
        chatBox.innerHTML = "";
        appendMessage("...who are you again? don't talk to me.", "assistant");
    }
});