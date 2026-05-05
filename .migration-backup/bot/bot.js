import TelegramBot from "node-telegram-bot-api";
import { spawn } from "child_process";
import { createReadStream, existsSync } from "fs";
import { readFile } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, ".env") });

// ─── Config ────────────────────────────────────────────────────────────────

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_IDS = (process.env.ALLOWED_USER_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);
const WORK_DIR = process.env.WORK_DIR ?? process.cwd();
const CLAUDE_BIN = process.env.CLAUDE_CLI_PATH ?? "claude";

if (!TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN is not set in .env");
  process.exit(1);
}

// ─── Bot init ───────────────────────────────────────────────────────────────

const bot = new TelegramBot(TOKEN, { polling: true });

console.log("🤖 NeoGram Claude Bot started");
console.log(`📁 Work dir: ${WORK_DIR}`);
console.log(`👥 Allowed users: ${ALLOWED_IDS.length ? ALLOWED_IDS.join(", ") : "ALL (⚠️ set ALLOWED_USER_IDS!)"}`);

// Active tasks: chatId → { process, messageId }
const activeTasks = new Map();

// ─── Auth guard ─────────────────────────────────────────────────────────────

function isAllowed(userId) {
  if (ALLOWED_IDS.length === 0) return true; // allow all if not configured
  return ALLOWED_IDS.includes(userId);
}

function authCheck(msg) {
  if (!isAllowed(msg.from.id)) {
    bot.sendMessage(msg.chat.id, "⛔ Access denied. Your ID: `" + msg.from.id + "`", { parse_mode: "Markdown" });
    return false;
  }
  return true;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const CHUNK_INTERVAL = 1500; // ms between message edits (avoid rate limits)

async function sendThinking(chatId) {
  const msg = await bot.sendMessage(chatId, "⏳ _Thinking..._", { parse_mode: "Markdown" });
  return msg.message_id;
}

async function editSafe(chatId, msgId, text) {
  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: msgId,
      parse_mode: "Markdown",
    });
  } catch (e) {
    // Ignore "message is not modified" errors
    if (!e.message?.includes("not modified")) {
      console.error("Edit error:", e.message);
    }
  }
}

// Split long messages into chunks ≤ 4096 chars
function splitMessage(text, maxLen = 4000) {
  const chunks = [];
  while (text.length > 0) {
    chunks.push(text.slice(0, maxLen));
    text = text.slice(maxLen);
  }
  return chunks;
}

function escapeMarkdown(text) {
  // Escape special Markdown chars that break Telegram formatting
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

// ─── Claude Code runner ──────────────────────────────────────────────────────

function runClaudeCode(prompt, chatId, editMsgId) {
  return new Promise((resolve, reject) => {
    // Check if claude CLI exists
    const args = [
      "--print",
      "--output-format", "text",
      "--dangerously-skip-permissions",
    ];

    const proc = spawn(CLAUDE_BIN, args, {
      cwd: WORK_DIR,
      env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
    });

    // Pass prompt via stdin
    proc.stdin.write(prompt);
    proc.stdin.end();

    activeTasks.set(chatId, { proc, msgId: editMsgId });

    let output = "";
    let lastEdit = 0;

    const flushEdit = async () => {
      const now = Date.now();
      if (now - lastEdit > CHUNK_INTERVAL && output.length > 0) {
        lastEdit = now;
        const preview = output.slice(-3500);
        const dots = output.length > 3500 ? "…\n\n" : "";
        await editSafe(chatId, editMsgId, `⚡ _Running..._\n\n\`\`\`\n${dots}${preview}\n\`\`\``);
      }
    };

    proc.stdout.on("data", (data) => {
      output += data.toString();
      flushEdit();
    });

    proc.stderr.on("data", (data) => {
      // stderr is often progress/status from claude, show it too
      const txt = data.toString();
      if (!txt.includes("Loaded cached") && !txt.includes("cachetools")) {
        output += txt;
      }
    });

    proc.on("close", (code) => {
      activeTasks.delete(chatId);
      if (code === 0 || output.length > 0) {
        resolve(output || "(no output)");
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      activeTasks.delete(chatId);
      reject(err);
    });
  });
}

// ─── Commands ───────────────────────────────────────────────────────────────

bot.onText(/\/start/, (msg) => {
  if (!authCheck(msg)) return;

  bot.sendMessage(msg.chat.id, `
🤖 *NeoGram Claude Code Bot*

Управляй Claude Code прямо из Telegram\\!

*Как использовать:*
Просто напиши задачу на русском или английском — и Claude Code выполнит её в проекте\\.

*Команды:*
/status — статус и текущая директория
/stop — остановить текущую задачу
/ls — список файлов в проекте
/git — статус git
/help — эта справка

*Примеры задач:*
• \`Добавь кнопку в sidebar\`
• \`Исправь баг с scroll в MessageList\`
• \`Покажи структуру файлов\`
• \`Запусти сборку и проверь ошибки\`

📁 Рабочая папка: \`${WORK_DIR}\`
  `.trim(), { parse_mode: "MarkdownV2" });
});

bot.onText(/\/help/, (msg) => {
  bot.emit("message", { ...msg, text: "/start" });
});

bot.onText(/\/status/, async (msg) => {
  if (!authCheck(msg)) return;

  const hasActive = activeTasks.has(msg.chat.id);
  const status = hasActive ? "🟡 Running a task..." : "🟢 Idle, ready for tasks";

  // Quick git status
  const gitStatus = await new Promise((res) => {
    let out = "";
    const p = spawn("git", ["log", "--oneline", "-3"], { cwd: WORK_DIR });
    p.stdout.on("data", (d) => (out += d.toString()));
    p.on("close", () => res(out.trim() || "no commits"));
  });

  bot.sendMessage(msg.chat.id, `
*Status:* ${status}
*Work dir:* \`${WORK_DIR}\`
*Recent commits:*
\`\`\`
${gitStatus}
\`\`\`
  `.trim(), { parse_mode: "Markdown" });
});

bot.onText(/\/stop/, (msg) => {
  if (!authCheck(msg)) return;
  const task = activeTasks.get(msg.chat.id);
  if (task) {
    task.proc.kill("SIGTERM");
    activeTasks.delete(msg.chat.id);
    bot.sendMessage(msg.chat.id, "⏹ Task stopped.");
  } else {
    bot.sendMessage(msg.chat.id, "ℹ️ No active task.");
  }
});

bot.onText(/\/ls/, async (msg) => {
  if (!authCheck(msg)) return;
  const out = await new Promise((res) => {
    let o = "";
    const p = spawn("find", ["src", "-type", "f", "-name", "*.tsx", "-o", "-name", "*.ts"], {
      cwd: WORK_DIR,
    });
    p.stdout.on("data", (d) => (o += d));
    p.on("close", () => res(o.trim()));
  });
  const lines = out.split("\n").slice(0, 40).join("\n");
  bot.sendMessage(msg.chat.id, `📁 *Project files:*\n\`\`\`\n${lines}\n\`\`\``, { parse_mode: "Markdown" });
});

bot.onText(/\/git/, async (msg) => {
  if (!authCheck(msg)) return;
  const out = await new Promise((res) => {
    let o = "";
    const p = spawn("git", ["status", "--short"], { cwd: WORK_DIR });
    p.stdout.on("data", (d) => (o += d));
    p.on("close", () => res(o.trim() || "✅ Working tree clean"));
  });
  bot.sendMessage(msg.chat.id, `📊 *Git status:*\n\`\`\`\n${out}\n\`\`\``, { parse_mode: "Markdown" });
});

// ─── Main message handler ────────────────────────────────────────────────────

bot.on("message", async (msg) => {
  if (!msg.text) return;
  if (msg.text.startsWith("/")) return; // handled by onText
  if (!authCheck(msg)) return;

  const chatId = msg.chat.id;
  const prompt = msg.text;

  // Block if task already running
  if (activeTasks.has(chatId)) {
    bot.sendMessage(chatId, "⚠️ A task is already running. Use /stop to cancel it first.");
    return;
  }

  console.log(`📨 [${msg.from.username ?? msg.from.id}] ${prompt.slice(0, 80)}`);

  const thinkingMsgId = await sendThinking(chatId);

  try {
    const result = await runClaudeCode(prompt, chatId, thinkingMsgId);

    // Send final result (possibly in chunks)
    const chunks = splitMessage(result.trim());

    // Edit the thinking message with first chunk
    if (chunks.length > 0) {
      const first = chunks[0];
      await editSafe(
        chatId,
        thinkingMsgId,
        `✅ *Done!*\n\n\`\`\`\n${first.slice(0, 3900)}\n\`\`\``
      );

      // Send additional chunks as new messages
      for (let i = 1; i < chunks.length; i++) {
        await bot.sendMessage(chatId, `\`\`\`\n${chunks[i]}\n\`\`\``, { parse_mode: "Markdown" });
      }
    } else {
      await editSafe(chatId, thinkingMsgId, "✅ Done! (no output)");
    }
  } catch (err) {
    const errMsg = err.message ?? String(err);
    console.error("Claude error:", errMsg);

    // Check if claude CLI is not found
    if (errMsg.includes("ENOENT") || errMsg.includes("not found")) {
      await editSafe(
        chatId,
        thinkingMsgId,
        `❌ *Claude CLI not found*\n\nMake sure \`claude\` is installed and in PATH.\nInstall: \`npm install -g @anthropic-ai/claude-code\`\n\nOr set \`CLAUDE_CLI_PATH\` in \`.env\``
      );
    } else {
      await editSafe(chatId, thinkingMsgId, `❌ *Error:*\n\`\`\`\n${errMsg.slice(0, 500)}\n\`\`\``);
    }
  }
});

// ─── Error handling ─────────────────────────────────────────────────────────

bot.on("polling_error", (err) => {
  console.error("Polling error:", err.message);
});

process.on("SIGINT", () => {
  console.log("\n👋 Bot stopping...");
  // Kill all active tasks
  for (const [, task] of activeTasks) task.proc.kill();
  bot.stopPolling();
  process.exit(0);
});

console.log("✅ Bot is running. Press Ctrl+C to stop.");
