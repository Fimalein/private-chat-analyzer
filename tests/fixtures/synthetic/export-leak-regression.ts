// SYNTHETIC_FIXTURE: every identity and identifier in this file is fabricated.
import type { ChatMessage } from "@/lib/chat-types";
import type { EntityMapping } from "@/lib/privacy";

export const SYNTHETIC_EXPORT_SENSITIVE = {
  person: "架空姓テスト子",
  phone: "090-0000-0000",
  email: "privacy-regression@example.test",
  postalCode: "000-0000",
  address: "神奈川県架空市テスト町0-0-0",
  school: "架空学園大学",
  company: "テスト電機株式会社",
  secret: "TESTTOKEN000000000000",
} as const;

export const SYNTHETIC_EXPORT_RAW_VALUES = Object.values(
  SYNTHETIC_EXPORT_SENSITIVE,
);

export const SYNTHETIC_EXPORT_MESSAGES: ChatMessage[] = [
  {
    id: "synthetic-raw-1",
    timestamp: Date.UTC(2026, 0, 1, 0, 0),
    senderId: SYNTHETIC_EXPORT_SENSITIVE.person,
    senderName: SYNTHETIC_EXPORT_SENSITIVE.person,
    content: [
      `氏名 ${SYNTHETIC_EXPORT_SENSITIVE.person}`,
      `電話 ${SYNTHETIC_EXPORT_SENSITIVE.phone}`,
      `メール ${SYNTHETIC_EXPORT_SENSITIVE.email}`,
      `住所 〒${SYNTHETIC_EXPORT_SENSITIVE.postalCode} ${SYNTHETIC_EXPORT_SENSITIVE.address}`,
    ].join(" / "),
    platform: "line",
    type: "text",
  },
  {
    id: "synthetic-raw-2",
    timestamp: Date.UTC(2026, 0, 1, 0, 5),
    senderId: SYNTHETIC_EXPORT_SENSITIVE.person,
    senderName: SYNTHETIC_EXPORT_SENSITIVE.person,
    content: [
      `学校 ${SYNTHETIC_EXPORT_SENSITIVE.school}`,
      `会社 ${SYNTHETIC_EXPORT_SENSITIVE.company}`,
      `token=${SYNTHETIC_EXPORT_SENSITIVE.secret}`,
    ].join(" / "),
    platform: "line",
    type: "text",
  },
];

export const SYNTHETIC_EXPORT_MAPPINGS: EntityMapping[] = [
  {
    source: SYNTHETIC_EXPORT_SENSITIVE.person,
    replacement: "PERSON_A",
    kind: "person",
  },
  {
    source: SYNTHETIC_EXPORT_SENSITIVE.phone,
    replacement: "PHONE_1",
    kind: "secret",
  },
  {
    source: SYNTHETIC_EXPORT_SENSITIVE.email,
    replacement: "EMAIL_1",
    kind: "secret",
  },
  {
    source: SYNTHETIC_EXPORT_SENSITIVE.postalCode,
    replacement: "POSTAL_1",
    kind: "location",
  },
  {
    source: SYNTHETIC_EXPORT_SENSITIVE.address,
    replacement: "LOCATION_1",
    kind: "location",
  },
  {
    source: SYNTHETIC_EXPORT_SENSITIVE.school,
    replacement: "SCHOOL_1",
    kind: "school",
  },
  {
    source: SYNTHETIC_EXPORT_SENSITIVE.company,
    replacement: "COMPANY_1",
    kind: "company",
  },
  {
    source: SYNTHETIC_EXPORT_SENSITIVE.secret,
    replacement: "REDACTED",
    kind: "secret",
  },
];
