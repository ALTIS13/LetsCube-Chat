import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("operator API keeps support data scoped and uses atomic workflow RPCs", async () => {
  const api = await source("artifacts/kub/src/lib/support/operatorApi.ts");

  assert.match(api, /support_tickets/);
  assert.match(api, /support_ticket_messages/);
  assert.match(api, /support_ticket_events/);
  assert.match(api, /support_ticket_contacts/);
  assert.match(api, /support_operator_preferences/);
  assert.match(api, /getSupportOperatorPreferences/);
  assert.match(api, /updateSupportOperatorPreferences/);
  assert.match(api, /support_operator_directory/);
  assert.match(api, /support_settings_update_v2/);
  assert.doesNotMatch(api, /\.select\(\s*["'`]\*["'`]\s*\)/);
  assert.doesNotMatch(api, /service_role|SUPABASE_SERVICE_ROLE/i);

  for (const rpc of [
    "support_ticket_claim",
    "support_ticket_transfer",
    "support_ticket_return_to_pool",
    "support_ticket_escalate",
    "support_ticket_mark_waiting",
    "support_ticket_resolve",
    "support_ticket_close",
    "support_ticket_reopen",
    "support_ticket_lookup_customer",
    "support_settings_update",
    "support_operator_message_create",
  ]) {
    assert.match(api, new RegExp(rpc));
  }

  assert.match(api, /support_ticket_already_claimed_or_unavailable/);
  assert.match(api, /Обращение уже принял другой оператор/);
  assert.match(api, /Не удалось выполнить действие/);
});

test("admin support route and permission labels are explicit", async () => {
  const [layout, rolePermissions, roleHook] = await Promise.all([
    source("artifacts/kub/src/pages/admin/AdminLayout.tsx"),
    source("artifacts/kub/src/lib/rolePermissions.ts"),
    source("artifacts/kub/src/pages/admin/AdminLayout.tsx"),
  ]);

  assert.match(layout, /\/admin\/support/);
  assert.match(layout, /support\.view/);
  assert.match(layout, /SupportTab/);
  assert.match(roleHook, /support\.view/);

  assert.match(rolePermissions, /support:\s*["']Поддержка["']/);
  for (const permission of [
    "support.view",
    "support.claim",
    "support.reply",
    "support.transfer",
    "support.escalate",
    "support.lookup_customer",
    "support.manage",
    "support.settings",
  ]) {
    assert.match(rolePermissions, new RegExp(permission.replace(".", "\\.")));
  }
});

test("operator workspace exposes bounded Russian queue, conversation and audit surfaces", async () => {
  const [tab, queue, conversation, details] = await Promise.all([
    source("artifacts/kub/src/pages/admin/SupportTab.tsx"),
    source("artifacts/kub/src/pages/admin/support/SupportQueue.tsx"),
    source("artifacts/kub/src/pages/admin/support/SupportConversation.tsx"),
    source("artifacts/kub/src/pages/admin/support/SupportTicketDetails.tsx"),
  ]);
  const combined = [tab, queue, conversation, details].join("\n");

  for (const label of [
    "Общий пул",
    "Мои",
    "Срочные",
    "Ожидают",
    "Решённые",
    "Спам",
    "Принять",
    "Передать",
    "Вернуть в пул",
    "Передать старшему",
    "Настройки",
    "История действий",
    "Мои уведомления",
    "Новые обращения",
    "Ответы клиентов",
    "Передачи",
    "Эскалации",
  ]) {
    assert.match(combined, new RegExp(label));
  }

  for (const permission of [
    "support.claim",
    "support.reply",
    "support.transfer",
    "support.escalate",
    "support.settings",
  ]) {
    assert.match(combined, new RegExp(permission.replace(".", "\\.")));
  }

  assert.match(combined, /data-testid=["']support-operator-workspace["']/);
  assert.match(combined, /data-testid=["']support-ticket-scroll["']/);
  assert.match(combined, /overflow-(?:x|y|auto|hidden)/);
  assert.match(combined, /Контакт скрыт до принятия/);
  assert.match(combined, /Поиск клиента фиксируется в журнале/);
  assert.doesNotMatch(combined, /PGRST|DOMException|JSON\.stringify|stack trace/i);
});
