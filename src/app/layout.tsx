import { Providers } from "@/components/Providers";
import type { Metadata, Viewport } from "next";
import { Noto_Sans_JP, Nunito, Zen_Maru_Gothic } from "next/font/google";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  display: "swap",
});

const notoSans = Noto_Sans_JP({
  variable: "--font-noto",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  preload: false,
});

const titleFont = Zen_Maru_Gothic({
  variable: "--font-title",
  subsets: ["latin"],
  weight: ["500", "700"],
  display: "swap",
  preload: false,
});

const siteUrl =
  process.env.GITHUB_PAGES === "true"
    ? "https://fimalein.github.io/private-chat-analyzer/"
    : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "ChatStory",
  description: "トーク履歴を端末内で分析・可視化するChatStory。個人情報を含む履歴を共有する前に、必ず内容を確認してください。",
  openGraph: {
    type: "website",
    locale: "ja_JP",
    siteName: "ChatStory",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7f2fc",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ja"
      className={`${nunito.variable} ${notoSans.variable} ${titleFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Providers initialLocale="ja">{children}</Providers>
      </body>
    </html>
  );
}
