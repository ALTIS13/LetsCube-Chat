import { expect, test } from "@playwright/test";
import { loadQaCredentials } from "./helpers/auth";

test.use({ screenshot: "off", trace: "off", video: "off" });

test("a chat member resolves signed originals and variants in the browser", async ({ page }) => {
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

    const resolveSigned = async (path: string) => {
      const ref = { bucket: "media", path };
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
      if (!signedUrl) return false;
      const url = new URL(signedUrl);
      if (
        url.origin !== "https://core.letscube.ru" ||
        !url.pathname.startsWith("/storage/v1/object/sign/media/")
      )
        return false;
      const response = await fetch(url, { method: "HEAD" });
      return response.status === 200;
    };

    const login = await api.auth.signInWithPassword({ email, password });
    if (login.error || !login.data.user) return { stage: "login" };
    media.signedMediaUrls().setAccount(login.data.user.id);

    const messages = await api
      .from("messages")
      .select("id,chat_id,user_id,media_bucket,media_path")
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

      if (!(await resolveSigned(row.media_path))) return { stage: "original" };
      const variants = await api
        .from("media_variants")
        .select("variant_path")
        .eq("chat_id", row.chat_id)
        .eq("message_id", row.id)
        .eq("variant_bucket", "media")
        .eq("status", "ready")
        .in("variant_kind", ["image_preview", "image_thumb"])
        .limit(20);
      if (variants.error || !variants.data?.length) return { stage: "variants_lookup" };
      for (const variant of variants.data) {
        if (!variant.variant_path || !(await resolveSigned(variant.variant_path))) {
          return { stage: "variant" };
        }
      }

      const avatars = await api
        .from("media_variants")
        .select("variant_path")
        .eq("variant_bucket", "media")
        .eq("status", "ready")
        .in("variant_kind", ["avatar_128", "avatar_256"])
        .in("profile_id", [login.data.user.id, row.user_id])
        .limit(20);
      if (avatars.error || !avatars.data?.length) return { stage: "avatars_lookup" };
      for (const avatar of avatars.data) {
        if (!avatar.variant_path || !(await resolveSigned(avatar.variant_path))) {
          return { stage: "avatar" };
        }
      }
      return { stage: "complete", variants: variants.data.length, avatars: avatars.data.length };
    }
    return { stage: "no_member_media" };
  }, credentials!);

  expect(result).toMatchObject({ stage: "complete" });
  if (result.stage === "complete") {
    expect(result.variants).toBeGreaterThan(0);
    expect(result.avatars).toBeGreaterThan(0);
  }
});
