import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Gives a QA chat a large history, so the entry and paging behaviour can be
 * reproduced at the size a real conversation reaches.
 *
 * Written through the ordinary REST path as the QA user, so row-level security
 * applies exactly as it does for the app. Nothing here is real content.
 */

const COUNT = Number(process.argv[2] ?? 1200);

function readEnvFile(file) {
  return Object.fromEntries(
    fs
      .readFileSync(file, "utf8")
      .replace(/^\uFEFF/, "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      }),
  );
}

const qa = readEnvFile(path.join(os.homedir(), ".kub-messenger-qa.env"));
const infra = readEnvFile("D:/CodexProjects/LetsCube-Chat/.local/secrets/letscube-infra.env");
const url = infra.VITE_SUPABASE_URL ?? infra.SUPABASE_URL;
const anon = infra.VITE_SUPABASE_ANON_KEY ?? infra.SUPABASE_ANON_KEY ?? infra.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !anon) {
  console.error("public Supabase configuration not found in the infra env file");
  process.exit(1);
}

const supabase = createClient(url, anon, { auth: { persistSession: false } });
const signIn = await supabase.auth.signInWithPassword({
  email: qa.KUB_QA_OWNER_EMAIL,
  password: qa.KUB_QA_OWNER_PASSWORD,
});
if (signIn.error) {
  console.error("sign-in failed:", signIn.error.message);
  process.exit(1);
}
const userId = signIn.data.user.id;
console.log("signed in as the QA owner");

// Pick the chat that already has the most history, so the seed extends a real
// conversation rather than creating a stray one.
const chats = await supabase.from("chat_members").select("chat_id").eq("user_id", userId);
if (chats.error) {
  console.error("could not list chats:", chats.error.message);
  process.exit(1);
}
console.log(`member of ${chats.data.length} chat(s)`);

let target = null;
for (const row of chats.data) {
  const count = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("chat_id", row.chat_id);
  const total = count.count ?? 0;
  console.log(`  chat ${row.chat_id.slice(0, 8)}: ${total} message(s)`);
  if (!target || total > target.total) target = { chatId: row.chat_id, total };
}
if (!target) {
  console.error("no chat to seed");
  process.exit(1);
}
console.log(`seeding chat ${target.chatId.slice(0, 8)} (${target.total} existing)`);

const started = Date.now();
const batchSize = 100;
let written = 0;
for (let index = 0; index < COUNT; index += batchSize) {
  const rows = [];
  for (let offset = 0; offset < Math.min(batchSize, COUNT - index); offset += 1) {
    const number = index + offset + 1;
    rows.push({
      chat_id: target.chatId,
      user_id: userId,
      content:
        number % 7 === 0
          ? `QA-HISTORY ${String(number).padStart(4, "0")} — длинное сообщение, которое переносится на несколько строк, чтобы высота пузырей отличалась и прокрутка встречала разные размеры по пути.`
          : `QA-HISTORY ${String(number).padStart(4, "0")}`,
      type: "text",
      client_message_id: crypto.randomUUID(),
      client_sent_at: new Date().toISOString(),
    });
  }
  const insert = await supabase.from("messages").insert(rows);
  if (insert.error) {
    console.error(`batch at ${index} failed:`, insert.error.message);
    break;
  }
  written += rows.length;
  if (written % 400 === 0) console.log(`  ${written}/${COUNT}`);
}

console.log(`wrote ${written} messages in ${Math.round((Date.now() - started) / 1000)}s`);
const final = await supabase
  .from("messages")
  .select("id", { count: "exact", head: true })
  .eq("chat_id", target.chatId);
console.log(`chat now holds ${final.count ?? "?"} messages`);
