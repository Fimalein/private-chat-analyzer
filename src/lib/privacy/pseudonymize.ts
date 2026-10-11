import type { ChatMessage } from "@/lib/chat-types";
import { applyEntityMappings } from "@/lib/privacy/entity-map";
import type { EntityMapping } from "@/lib/privacy/types";

export function pseudonymizeMessage(
  message: ChatMessage,
  mappings: readonly EntityMapping[],
): ChatMessage {
  return {
    ...message,
    senderId: applyEntityMappings(message.senderId, mappings),
    senderName: applyEntityMappings(message.senderName, mappings),
    content: applyEntityMappings(message.content, mappings),
  };
}

export function pseudonymizeMessages(
  messages: readonly ChatMessage[],
  mappings: readonly EntityMapping[],
): ChatMessage[] {
  return messages.map((message) => pseudonymizeMessage(message, mappings));
}
