import { expect, test } from "@playwright/test";
import { loadQaCredentials } from "./helpers/auth";

test.use({ screenshot: "off", trace: "off", video: "off" });

test("a chat member receives a signed media URL through the browser resolver", async ({ page }) => {
  test.skip(
    process.env.KUB_SIGNED_MEDIA_LIVE !== "1",
    "opt in with KUB_SIGNED_MEDIA_LIVE=1 against the LETSCUBE QA backend",
  );
  expect(process.env.KUB_QA_ALLOW_MUTATIONS).toBe("0");
  const credentials = loadQaCredentials("client");
  expect(credentials, "client QA credentials are required").not.toBeNull();

  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async ({ email, password }) => {
    const { createClient } = await import("/src/lib/supabase/client.ts");
    const media = await import("/src/lib/media/mediaUrl.ts");
    const api = createClient();
    if (media.mediaUrlMode() !== "signed") return { stage: "mode" };

    const login = await api.auth.signInWithPassword({ email, password });
    if (login.error || !login.data.user) return { stage: "login" };
    media.signedMediaUrls().setAccount(login.data.user.id);

    const messages = await api
      .from("messages")
      .select("chat_id,user_id,media_bucket,media_path")
      .eq("media_bucket", "media")
      .is("deleted_at", null)
      .not("media_path", "is", null)
      .neq("user_id", login.data.user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (messages.error) return { stage: "message_lookup" };

    for (const row of messages.data ?? []) {
      if (!row.media_path) continue;
      const membership = await api
        .from("chat_members")
        .select("user_id")
        .eq("chat_id", row.chat_id)
        .eq("user_id", login.data.user.id)
        .maybeSingle();
      if (membership.error || !membership.data) continue;

      const ref = { bucket: "media", path: row.media_path };
      const store = media.signedMediaUrls();
      const signedUrl = await new Promise<string | null>((resolve) => {
        let finished = false;
        let unsubscribe = () => {};
        const finish = (value: string | null) => {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          unsubscribe();
          resolve(value);
        };
        const timeout = setTimeout(() => finish(null), 10_000);
        unsubscribe = store.subscribe(() => {
          if (store.isSettled(ref)) finish(store.get(ref));
        });
        store.request(ref);
        if (store.isSettled(ref)) finish(store.get(ref));
      });
      if (!signedUrl) return { stage: "signing" };
      const url = new URL(signedUrl);
      if (
        url.origin !== "https://core.letscube.ru" ||
        !url.pathname.startsWith("/storage/v1/object/sign/media/")
      ) {
        return { stage: "signed_route" };
      }
      const response = await fetch(url, { method: "HEAD" });
      return { stage: "complete", status: response.status };
    }
    return { stage: "no_member_media" };
  }, credentials!);

  expect(result).toEqual({ stage: "complete", status: 200 });
});
