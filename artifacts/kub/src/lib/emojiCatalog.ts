export interface EmojiCategory {
  id: string;
  label: string;
  emojis: readonly string[];
}

export const FOLDER_EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  {
    id: "general",
    label: "Основные",
    emojis: ["👤", "💬", "❤️", "⭐", "📌", "🔔", "✅", "🔥", "🏠", "📦", "🎯", "✨"],
  },
  {
    id: "work",
    label: "Работа",
    emojis: ["💼", "📢", "📊", "📅", "📝", "📎", "🧾", "🛠️", "💡", "🤝", "📚", "🏆"],
  },
  {
    id: "personal",
    label: "Личное",
    emojis: ["👨‍👩‍👧‍👦", "🎓", "🛒", "💳", "🩺", "🧘", "✈️", "🚗", "☕", "🍽️", "🐾", "🌿"],
  },
  {
    id: "leisure",
    label: "Отдых",
    emojis: ["🎮", "🎵", "🎬", "📷", "⚽", "🏀", "🎨", "🎉", "🍿", "🏖️", "🚀", "🌙"],
  },
] as const;

export const MESSAGE_EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  {
    id: "faces",
    label: "Лица",
    emojis: ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "🙂", "🙃", "😉", "😍", "🥰", "😎", "🤔"],
  },
  {
    id: "gestures",
    label: "Жесты",
    emojis: ["👍", "👎", "👌", "✌️", "🤞", "🤟", "🤘", "👋", "🤝", "👏", "🙌", "🫶", "🙏", "💪", "👀", "☝️"],
  },
  {
    id: "events",
    label: "События",
    emojis: ["🎉", "🎊", "🎂", "🎁", "🎈", "✨", "🔥", "💯", "⭐", "🌟", "🚀", "🏆", "⚽", "🎮", "🎵", "🎬"],
  },
  {
    id: "objects",
    label: "Предметы",
    emojis: ["📷", "📱", "💻", "⌚", "🎧", "📚", "📝", "📌", "📎", "📅", "📦", "💡", "🔑", "☕", "🍿", "🚗"],
  },
  {
    id: "symbols",
    label: "Символы",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "✅", "❌", "⚠️", "❓", "❗", "♻️", "➕"],
  },
] as const;
