export const SUPPORT_CATEGORIES = [
  "account",
  "access",
  "technical",
  "messages",
  "media",
  "tasks",
  "privacy",
  "other",
] as const;

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  account: "Учётная запись",
  access: "Вход и доступ",
  technical: "Техническая проблема",
  messages: "Сообщения и чаты",
  media: "Фото, видео и файлы",
  tasks: "Задачи и роли",
  privacy: "Персональные данные",
  other: "Другое",
};

export type SupportTicketStatus =
  | "new"
  | "in_progress"
  | "waiting_user"
  | "waiting_support"
  | "escalated"
  | "resolved"
  | "closed"
  | "spam";

export interface SupportRequestInput {
  fullName: string;
  email: string;
  phone: string;
  category: string;
  subject: string;
  message: string;
  privacyAccepted: boolean;
  privacyVersion: string;
  captchaToken: string;
  website: string;
  formStartedAt: number;
}

export interface NormalizedSupportRequest {
  fullName: string;
  email: string;
  phone: string;
  category: SupportCategory;
  subject: string;
  message: string;
  privacyAccepted: true;
  privacyVersion: string;
  captchaToken: string;
  website: "";
  formStartedAt: number;
}

export interface GuestSupportSession {
  ticketId: string;
  secret: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  updatedAt: string;
}

export interface PublicSupportMessage {
  id: string;
  authorType: "guest" | "user" | "operator" | "system";
  body: string;
  createdAt: string;
}

export interface PublicSupportTicket {
  id: string;
  publicReference: string;
  category: SupportCategory;
  subject: string;
  status: SupportTicketStatus;
  createdAt: string;
  updatedAt: string;
  messages: PublicSupportMessage[];
}

export interface CreatedSupportTicket {
  ticket: PublicSupportTicket;
  session: GuestSupportSession;
}
