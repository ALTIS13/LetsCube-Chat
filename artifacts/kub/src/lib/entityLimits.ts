export const CHAT_NAME_MAX_LENGTH = 64;
export const FOLDER_NAME_MAX_LENGTH = 64;
export const TOPIC_NAME_MAX_LENGTH = 64;

export function limitText(value: string, maxLength: number): string {
  return value.slice(0, maxLength);
}
