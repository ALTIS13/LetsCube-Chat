export type TopicNotificationMode = "inherit" | "enabled" | "disabled";

/** An override can change only parent mute, not any independent restriction. */
export function resolveTopicAlert(
  mode: unknown,
  parentMuted: unknown,
  restrictionsAllowed: unknown,
): boolean {
  if (restrictionsAllowed !== true) return false;
  if (mode === "disabled") return false;
  if (mode === "enabled") return true;
  return mode === "inherit" && parentMuted === false;
}

export interface TopicNotificationScope {
  readonly userId: string;
  readonly accountEpoch: number;
  readonly chatId: string;
  readonly topicId: string | null;
}

export interface TopicNotificationTopic {
  readonly id: string;
  readonly chat_id: string;
  readonly is_general: boolean;
  readonly archived: boolean;
}

export interface TopicNotificationTopicSnapshot {
  readonly userId: string;
  readonly accountEpoch: number;
  readonly chatId: string;
  readonly topics: readonly TopicNotificationTopic[];
}

/** Display identity only; a cached topic snapshot never authorizes an alert. */
export function canonicalTopicNotificationScope(
  scope: TopicNotificationScope,
  snapshot: TopicNotificationTopicSnapshot | null,
): string | null {
  if (!scope.userId || !scope.chatId || !Number.isSafeInteger(scope.accountEpoch) || scope.accountEpoch < 0) return null;
  if (!snapshot ||
    snapshot.userId !== scope.userId ||
    snapshot.accountEpoch !== scope.accountEpoch ||
    snapshot.chatId !== scope.chatId || !Array.isArray(snapshot.topics)) return null;
  if (scope.topicId === null) {
    return snapshot.topics.some(t => t.chat_id === scope.chatId && t.is_general === true && t.archived !== false)
      ? null : "general";
  }
  if (!scope.topicId) return null;
  const topic = snapshot.topics.find(topic =>
    topic.id === scope.topicId && topic.chat_id === scope.chatId && topic.archived === false &&
    typeof topic.is_general === "boolean",
  );
  return topic ? (topic.is_general ? "general" : topic.id) : null;
}
