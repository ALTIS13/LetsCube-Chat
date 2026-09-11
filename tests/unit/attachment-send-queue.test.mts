import assert from "node:assert/strict";
import test from "node:test";

import {
  ATTACHMENT_UPLOAD_CONCURRENCY,
  nextClientSentAt,
  runOrderedSend,
  type OrderedSendSteps,
} from "../../artifacts/kub/src/lib/attachmentSendQueue.ts";

/**
 * D-113 and D-114: one failed attachment stranded every attachment after it,
 * and a photo waited for a whole video to upload. Uploads now run three at a
 * time and messages still go in the order the files were picked. The browser
 * half is `tests/e2e/media-send-path.spec.ts`.
 */

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/** Lets every continuation that can run, run. */
async function flush() {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function harness(names: readonly string[], concurrency = ATTACHMENT_UPLOAD_CONCURRENCY) {
  const log: string[] = [];
  const uploads = new Map(names.map((name) => [name, deferred<string>()]));
  const inserts = new Map(names.map((name) => [name, deferred<boolean>()]));
  const removed = new Set<string>();
  let active = true;
  let running = 0;
  let peak = 0;

  const steps: OrderedSendSteps<string, string> = {
    concurrency,
    isActive: () => active,
    isWanted: (name) => !removed.has(name),
    upload: async (name) => {
      running += 1;
      peak = Math.max(peak, running);
      log.push(`upload:${name}`);
      try {
        return await (uploads.get(name) ?? deferred<string>()).promise;
      } finally {
        running -= 1;
      }
    },
    onUploaded: (name) => log.push(`uploaded:${name}`),
    onUploadFailed: (name) => log.push(`failed:${name}`),
    insert: async (name, uploaded) => {
      log.push(`insert:${name}:${uploaded}`);
      return (inserts.get(name) ?? deferred<boolean>()).promise;
    },
  };

  return {
    log,
    steps,
    removed,
    upload: (name: string) => uploads.get(name) ?? deferred<string>(),
    insert: (name: string) => inserts.get(name) ?? deferred<boolean>(),
    inserted: () => log.filter((entry) => entry.startsWith("insert:")),
    abandon: () => {
      active = false;
    },
    peak: () => peak,
  };
}

test("three uploads run at once, started in the order picked, and the fourth starts when one is done", async () => {
  const names = ["a", "b", "c", "d", "e"];
  const h = harness(names);
  const run = runOrderedSend(names, h.steps);
  await flush();

  assert.equal(ATTACHMENT_UPLOAD_CONCURRENCY, 3);
  assert.deepEqual(h.log, ["upload:a", "upload:b", "upload:c"]);

  h.upload("c").resolve("c.webp");
  await flush();
  assert.deepEqual(h.log, ["upload:a", "upload:b", "upload:c", "uploaded:c", "upload:d"]);
  assert.deepEqual(h.inserted(), [], "c is up, but a and b are not in yet");

  for (const name of ["a", "b", "d", "e"]) h.upload(name).resolve(`${name}.webp`);
  await flush();
  assert.deepEqual(h.inserted(), ["insert:a:a.webp"], "one insert at a time");

  for (const name of names) {
    h.insert(name).resolve(true);
    await flush();
  }
  assert.deepEqual(await run, { outcomes: ["sent", "sent", "sent", "sent", "sent"], completed: true });
  assert.deepEqual(h.inserted(), ["insert:a:a.webp", "insert:b:b.webp", "insert:c:c.webp", "insert:d:d.webp", "insert:e:e.webp"]);
  assert.equal(h.peak(), 3);
});

test("a photo picked after a video uploads beside it, and is inserted after it", async () => {
  const h = harness(["video", "photo"]);
  const run = runOrderedSend(["video", "photo"], h.steps);
  await flush();

  h.upload("photo").resolve("photo.webp");
  await flush();
  assert.deepEqual(h.log, ["upload:video", "upload:photo", "uploaded:photo"]);
  assert.deepEqual(h.inserted(), [], "the conversation keeps the pick order");

  h.upload("video").resolve("video.mov");
  await flush();
  assert.deepEqual(h.inserted(), ["insert:video:video.mov"]);

  h.insert("video").resolve(true);
  await flush();
  assert.deepEqual(h.inserted(), ["insert:video:video.mov", "insert:photo:photo.webp"], "and it follows the video at once");
  h.insert("photo").resolve(true);
  assert.deepEqual((await run).outcomes, ["sent", "sent"]);
});

test("a refused upload is that attachment's alone, and it is reported as soon as it happens", async () => {
  const h = harness(["a", "b", "c"]);
  const run = runOrderedSend(["a", "b", "c"], h.steps);
  await flush();

  h.upload("b").reject(Object.assign(new Error("refused"), { status: 413 }));
  await flush();
  assert.ok(h.log.includes("failed:b"), "the tile learns before anything is inserted");
  assert.deepEqual(h.inserted(), []);

  h.upload("a").resolve("a.webp");
  h.upload("c").resolve("c.webp");
  await flush();
  h.insert("a").resolve(true);
  await flush();
  assert.deepEqual(h.inserted(), ["insert:a:a.webp", "insert:c:c.webp"], "b is passed over, and c is not held back");

  h.insert("c").resolve(true);
  assert.deepEqual(await run, { outcomes: ["sent", "upload_failed", "sent"], completed: true });
});

test("an insert that fails or throws does not stop the attachments after it", async () => {
  const h = harness(["a", "b", "c"]);
  const run = runOrderedSend(["a", "b", "c"], h.steps);
  for (const name of ["a", "b", "c"]) h.upload(name).resolve(`${name}.webp`);
  await flush();

  h.insert("a").resolve(false);
  await flush();
  h.insert("b").reject(new Error("insert threw"));
  await flush();
  h.insert("c").resolve(true);

  assert.deepEqual(await run, { outcomes: ["insert_failed", "insert_failed", "sent"], completed: true });
  assert.deepEqual(h.inserted(), ["insert:a:a.webp", "insert:b:b.webp", "insert:c:c.webp"]);
});

test("an attachment taken out of the send is skipped, whether it was waiting or already up", async () => {
  const h = harness(["a", "b", "c"], 1);
  const run = runOrderedSend(["a", "b", "c"], h.steps);
  await flush();

  // b is still waiting for a slot; c will be up before it is taken out.
  h.removed.add("b");
  h.upload("a").resolve("a.webp");
  await flush();
  h.upload("c").resolve("c.webp");
  await flush();
  assert.ok(!h.log.includes("upload:b"), "a removed attachment never uploads");
  h.removed.add("c");

  h.insert("a").resolve(true);
  assert.deepEqual(await run, { outcomes: ["sent", "skipped", "skipped"], completed: true });
  assert.deepEqual(h.inserted(), ["insert:a:a.webp"]);
  assert.equal(h.peak(), 1);
});

test("a send abandoned by a change of conversation starts nothing and inserts nothing more", async () => {
  const h = harness(["a", "b"], 1);
  const run = runOrderedSend(["a", "b"], h.steps);
  await flush();

  h.abandon();
  h.upload("a").resolve("a.webp");
  const result = await run;

  assert.deepEqual(result, { outcomes: ["skipped", "skipped"], completed: false });
  assert.deepEqual(h.log, ["upload:a"], "no callback, no second upload, no insert");
});

test("a callback that throws does not stall the send", async () => {
  const h = harness(["a"]);
  const steps: OrderedSendSteps<string, string> = {
    ...h.steps,
    onUploaded: () => {
      throw new Error("the tile could not be updated");
    },
  };
  const run = runOrderedSend(["a"], steps);
  h.upload("a").resolve("a.webp");
  await flush();
  h.insert("a").resolve(true);
  assert.deepEqual((await run).outcomes, ["sent"]);
});

test("a concurrency below one still sends, one at a time", async () => {
  const h = harness(["a", "b"], 0);
  const run = runOrderedSend(["a", "b"], h.steps);
  await flush();
  assert.deepEqual(h.log, ["upload:a"]);
  h.upload("a").resolve("a.webp");
  h.upload("b").resolve("b.webp");
  await flush();
  h.insert("a").resolve(true);
  await flush();
  h.insert("b").resolve(true);
  assert.deepEqual((await run).outcomes, ["sent", "sent"]);
  assert.equal(h.peak(), 1);
  assert.deepEqual(await runOrderedSend([], h.steps), { outcomes: [], completed: true });
});

test("client_sent_at rises through a send, even within one millisecond or with a clock that stepped back", () => {
  const start = Date.parse("2026-09-11T12:00:00.000Z");
  const first = nextClientSentAt(null, start);
  assert.equal(first, "2026-09-11T12:00:00.000Z");
  const second = nextClientSentAt(first, start);
  assert.equal(second, "2026-09-11T12:00:00.001Z");
  const third = nextClientSentAt(second, start + 5_000);
  assert.equal(third, "2026-09-11T12:00:05.000Z");
  assert.equal(nextClientSentAt(third, start), "2026-09-11T12:00:05.001Z");
  assert.equal(nextClientSentAt("not a time", start), first);
});
