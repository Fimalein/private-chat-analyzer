export type ImportPlatform = "line" | "meta" | "telegram";

export const IMPORT_PLATFORM_LABELS: Record<ImportPlatform, string> = {
  line: "LINE",
  meta: "Meta",
  telegram: "Telegram",
};

export type MessageType =
  | "text"
  | "sticker"
  | "image"
  | "video"
  | "call"
  | "system";

export type ChatMessage = {
  id: string;
  timestamp: number;
  senderId: string;
  senderName: string;
  content: string;
  platform: ImportPlatform;
  type: MessageType;
  callDurationMs?: number;
  /** 1-based source line in the imported file, when the parser can provide it. */
  sourceLine?: number;
  /** 1-based final source line for multiline messages. */
  sourceEndLine?: number;
};

export type ParsedChat = {
  messages: ChatMessage[];
  usernameA: string;
  usernameB: string;
};
