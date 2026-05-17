export type SearchEntityFilter = "all" | "user" | "chat" | "message" | "task" | "location" | "command" | "media";
export type SearchHasFilter = "file" | "link" | "image" | "video" | "audio";

export interface ParsedSearchFilters {
  type: SearchEntityFilter;
  from: string | null;
  in: string | null;
  has: SearchHasFilter[];
  before: string | null;
  after: string | null;
}

export interface ParsedSearchChip {
  id: string;
  key: keyof ParsedSearchFilters;
  value: string;
  label: string;
  start: number;
  end: number;
}

export interface ParsedSearchQuery {
  raw: string;
  query: string;
  filters: ParsedSearchFilters;
  chips: ParsedSearchChip[];
  hasAdvancedFilters: boolean;
}

const FILTER_TOKEN_RE = /(?:^|\s)(type|from|in|has|before|after):(?:"([^"]*)"|'([^']*)'|(\S+))/gi;
const ENTITY_ALIASES: Record<string, SearchEntityFilter | SearchHasFilter> = {
  all: "all",
  user: "user",
  users: "user",
  people: "user",
  chat: "chat",
  chats: "chat",
  message: "message",
  messages: "message",
  task: "task",
  tasks: "task",
  location: "location",
  locations: "location",
  command: "command",
  commands: "command",
  media: "media",
  file: "file",
  link: "link",
  image: "image",
  photo: "image",
  video: "video",
  audio: "audio",
  voice: "audio",
};
const HAS_VALUES = new Set<SearchHasFilter>(["file", "link", "image", "video", "audio"]);

export function parseAdvancedSearchQuery(rawQuery: string, selectedType: SearchEntityFilter = "all"): ParsedSearchQuery {
  const filters: ParsedSearchFilters = {
    type: selectedType,
    from: null,
    in: null,
    has: [],
    before: null,
    after: null,
  };
  const chips: ParsedSearchChip[] = [];
  const removals: Array<[number, number]> = [];

  for (const match of rawQuery.matchAll(FILTER_TOKEN_RE)) {
    const key = match[1].toLowerCase() as ParsedSearchChip["key"];
    const rawValue = (match[2] ?? match[3] ?? match[4] ?? "").trim();
    const tokenStart = match.index ?? 0;
    const leadingWhitespace = match[0].match(/^\s+/)?.[0].length ?? 0;
    const start = tokenStart + leadingWhitespace;
    const end = tokenStart + match[0].length;
    if (!rawValue) continue;

    if (key === "type") {
      const normalized = normalizeEntityFilter(rawValue);
      if (!normalized) continue;
      if (isHasFilter(normalized)) {
        filters.type = "message";
        addHasFilter(filters, normalized);
        chips.push(makeChip("has", normalized, start, end));
      } else {
        filters.type = normalized;
        chips.push(makeChip("type", normalized, start, end));
      }
      removals.push([start, end]);
      continue;
    }

    if (key === "has") {
      const values = rawValue.split(",").map((value) => normalizeEntityFilter(value)).filter(isHasFilter);
      if (values.length === 0) continue;
      for (const value of values) addHasFilter(filters, value);
      chips.push(makeChip("has", values.join(","), start, end));
      removals.push([start, end]);
      continue;
    }

    if (key === "before" || key === "after") {
      const normalizedDate = normalizeDate(rawValue);
      if (!normalizedDate) continue;
      filters[key] = normalizedDate;
      chips.push(makeChip(key, normalizedDate, start, end));
      removals.push([start, end]);
      continue;
    }

    if (key === "from" || key === "in") {
      filters[key] = rawValue.replace(/^@+/, "").trim();
      chips.push(makeChip(key, filters[key]!, start, end));
      removals.push([start, end]);
    }
  }

  const query = removeRanges(rawQuery, removals).trim().replace(/\s+/g, " ");
  return {
    raw: rawQuery,
    query,
    filters,
    chips,
    hasAdvancedFilters: chips.some((chip) => chip.key !== "type" || chip.value === "media"),
  };
}

export function removeSearchChip(rawQuery: string, chip: ParsedSearchChip): string {
  return `${rawQuery.slice(0, chip.start)} ${rawQuery.slice(chip.end)}`.trim().replace(/\s+/g, " ");
}

export function searchFiltersToRpc(filters: ParsedSearchFilters): Record<string, unknown> {
  return {
    type: filters.type === "all" ? null : filters.type,
    from: filters.from,
    in: filters.in,
    has: filters.has,
    before: filters.before,
    after: filters.after,
  };
}

export function typeFilterToDataType(type: SearchEntityFilter): "user" | "chat" | "message" | "task" | "location" | "all" {
  if (type === "media") return "message";
  if (type === "command") return "all";
  return type;
}

export function hasFilterLabel(value: SearchHasFilter): string {
  switch (value) {
    case "image":
      return "Фото";
    case "video":
      return "Видео";
    case "audio":
      return "Аудио";
    case "file":
      return "Файл";
    case "link":
      return "Ссылка";
  }
}

export function mediaLabelForMessage(type: string | null | undefined, content?: string | null): string | null {
  if (type === "image") return "Фото";
  if (type === "video") return "Видео";
  if (type === "audio") return "Голосовое";
  if (type === "file") return "Файл";
  if (content && hasLink(content)) return "Ссылка";
  return null;
}

export function messageMatchesHasFilter(
  message: { type?: string | null; content?: string | null; media_url?: string | null; mime_type?: string | null },
  filters: readonly SearchHasFilter[],
): boolean {
  if (filters.length === 0) return true;
  return filters.some((filter) => {
    if (filter === "link") return hasLink(message.content ?? "");
    if (filter === "image") return message.type === "image" || message.mime_type?.startsWith("image/") === true;
    if (filter === "video") return message.type === "video" || message.mime_type?.startsWith("video/") === true;
    if (filter === "audio") return message.type === "audio" || message.mime_type?.startsWith("audio/") === true;
    if (filter === "file") return Boolean(message.media_url) && !["image", "video", "audio"].includes(message.type ?? "");
    return false;
  });
}

export function messageIsMediaSearchTarget(message: { type?: string | null; media_url?: string | null }): boolean {
  return ["image", "video", "audio", "file"].includes(message.type ?? "") || Boolean(message.media_url);
}

export function hasLink(value: string): boolean {
  return /\bhttps?:\/\/\S+/i.test(value) || /\bwww\.[^\s]+/i.test(value);
}

function normalizeEntityFilter(value: string): SearchEntityFilter | SearchHasFilter | null {
  return ENTITY_ALIASES[value.trim().toLowerCase()] ?? null;
}

function normalizeDate(value: string): string | null {
  const clean = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return null;
  const time = Date.parse(`${clean}T00:00:00Z`);
  return Number.isNaN(time) ? null : clean;
}

function isHasFilter(value: SearchEntityFilter | SearchHasFilter | null): value is SearchHasFilter {
  return Boolean(value && HAS_VALUES.has(value as SearchHasFilter));
}

function addHasFilter(filters: ParsedSearchFilters, value: SearchHasFilter) {
  if (!filters.has.includes(value)) filters.has.push(value);
}

function makeChip(key: ParsedSearchChip["key"], value: string, start: number, end: number): ParsedSearchChip {
  const labels: Record<string, string> = {
    "type:all": "Все",
    "type:user": "Люди",
    "type:chat": "Чаты",
    "type:message": "Сообщения",
    "type:task": "Задачи",
    "type:location": "Локации",
    "type:command": "Команды",
    "type:media": "Медиа",
  };
  const label =
    key === "type"
      ? labels[`type:${value}`] ?? value
      : key === "has"
        ? value.split(",").map((item) => hasFilterLabel(item as SearchHasFilter)).join(", ")
        : key === "from"
          ? `От: @${value.replace(/^@+/, "")}`
          : key === "in"
            ? `В: ${value}`
            : key === "before"
              ? `До ${formatDateLabel(value)}`
              : `После ${formatDateLabel(value)}`;
  return {
    id: `${key}:${value}:${start}`,
    key,
    value,
    label,
    start,
    end,
  };
}

function formatDateLabel(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function removeRanges(value: string, ranges: Array<[number, number]>): string {
  if (ranges.length === 0) return value;
  let result = "";
  let cursor = 0;
  for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
    result += value.slice(cursor, start);
    cursor = end;
  }
  result += value.slice(cursor);
  return result;
}
