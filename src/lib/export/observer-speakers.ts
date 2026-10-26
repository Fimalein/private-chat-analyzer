import type { ChatMessage } from "@/lib/chat-types";

/**
 * Blind *export speaker metadata* to the local uploader's role. Never infer
 * which participant is operating the browser or which side is the user.
 *
 * Explicitly configured PERSON_A, PERSON_B ... placeholders are preserved
 * where unique, because the message body may already refer to them. This
 * avoids breaking their conversational referents. Other labels, including
 * SELF / ME / YOU / original participant names, become role-neutral aliases.
 *
 * Imported text can still contain identifying clues: this is not full
 * anonymization and must be followed by an actual content review.
 */
export function neutralizeExportSpeakers(
  messages: readonly ChatMessage[],
): ChatMessage[] {
  const eligible = (name: string) => /^PERSON_[A-Z](?:[0-9]+)?$/.test(name);
  const byKey = new Map<string, string>();
  const reserved = new Set<string>();
  const counts = new Map<string, number>();

  // Pseudonyms explicitly present in the mapped sender metadata are stable
  // and should not be silently reassigned to a different person.
  for (const message of messages) {
    const key = message.senderId.trim() || message.senderName.trim();
    const display = message.senderName.trim();
    if (eligible(display)) {
      const oldKey = [...byKey.entries()].find(([, value]) => value === display)?.[0];
      if (oldKey === undefined || oldKey === key) {
        byKey.set(key, display);
        reserved.add(display);
      }
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const outputMap = new Map<string, string>();
  const used = new Set<string>();
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let number = 0;
  function unusedAlias(): string {
    while (true) {
      const suffix = number < alphabet.length
        ? alphabet[number]
        : String(number + 1);
      const value = `PERSON_${suffix}`;
      number += 1;
      if (!reserved.has(value) && !used.has(value)) return value;
    }
  }

  // Labels are based only on sender metadata and chronological appearance.
  // No current-user flag, UI orientation, "myself", or participant roles.
  return messages.map(message => {
    const key = message.senderId.trim() || message.senderName.trim();
    let alias = outputMap.get(key);
    if (!alias) {
      const mapped = byKey.get(key);
      alias = mapped && !used.has(mapped) ? mapped : unusedAlias();
      used.add(alias);
      outputMap.set(key, alias);
    }
    return { ...message, senderId: alias, senderName: alias };
  });
}
