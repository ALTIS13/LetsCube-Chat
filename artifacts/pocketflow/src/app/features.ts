import { createGroupFeature } from "#pf/app/group";
import { createInboxFeature } from "#pf/app/inbox";
import { createRemindersFeature } from "#pf/app/reminders";
import { createSelftestFeature } from "#pf/app/selftest";
import { createSettingsFeature } from "#pf/app/settings";
import { createWatcherFeature } from "#pf/app/watcher";
import { webhooksFeature } from "#pf/app/webhooks";
import type { Feature } from "#pf/app/router";

/**
 * The feature list, in the order the router asks them.
 *
 * Order is behaviour, not taste. `onMessage` is offered to each feature in
 * turn and the first one to claim the message wins, so any feature that is
 * *waiting for an answer* — «пришлите дату», «как назвать webhook» — has to sit
 * above the inbox. Otherwise somebody's reply to a question gets classified as
 * a note and saved.
 *
 * The inbox is therefore last among the message handlers, deliberately: it is
 * the fallback that gives every message some sensible response.
 */
export function createFeatures(): Feature[] {
  return [
    // Above the inbox, because both of these can be waiting for an answer —
    // «пришлите дату», «как назвать наблюдателя» — and a reply to a question
    // must not be classified as a note and saved.
    createRemindersFeature(),
    createWatcherFeature(),
    webhooksFeature(),
    createSettingsFeature(),
    createGroupFeature(),
    createSelftestFeature(),
    createInboxFeature(),
  ];
}
