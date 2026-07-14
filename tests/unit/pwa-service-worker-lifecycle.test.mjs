import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const swUrl = new URL("../../artifacts/kub/public/sw.js", import.meta.url);
const swSource = await readFile(swUrl, "utf8");

function loadServiceWorker({ clients = [], notifications = [] } = {}) {
  const listeners = new Map();
  const shown = [];
  const context = {
    URL,
    Request,
    Date,
    Promise,
    caches: {},
    fetch() {},
    self: {
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      location: { origin: "https://app.letscube.ru" },
      registration: {
        async getNotifications() {
          return notifications;
        },
        async showNotification(title, options) {
          shown.push({ title, options });
        },
      },
      clients: {
        async matchAll() {
          return clients;
        },
      },
    },
  };

  vm.runInNewContext(swSource, context, { filename: "sw.js" });
  return { listeners, shown };
}

async function dispatchPush(worker) {
  const pending = [];
  const listener = worker.listeners.get("push");
  assert.equal(typeof listener, "function");
  listener({
    data: {
      json() {
        return {
          kind: "chat_message",
          chat_id: "chat-1",
          message_id: "message-1",
          title: "Новый ответ",
          body: "Текст сообщения",
        };
      },
    },
    waitUntil(promise) {
      pending.push(promise);
    },
  });
  await Promise.all(pending);
}

test("a system push replaces the old card with the same stable tag", async () => {
  let oldCardClosed = false;
  const worker = loadServiceWorker({
    notifications: [{ close() { oldCardClosed = true; } }],
  });

  await dispatchPush(worker);

  assert.equal(worker.shown.length, 1);
  assert.equal(oldCardClosed, true);
});

test("hidden PWA clients still receive the system push card", async () => {
  const worker = loadServiceWorker({
    clients: [{ visibilityState: "hidden", postMessage() {} }],
  });

  await dispatchPush(worker);

  assert.equal(worker.shown.length, 1);
  assert.equal(worker.shown[0].options.tag, "message:chat:chat-1");
});

test("Realtime message delivery does not create a second legacy Notification card", async () => {
  const source = await readFile(
    new URL("../../artifacts/kub/src/hooks/useMessages.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /\bnew\s+Notification\s*\(/);
});
