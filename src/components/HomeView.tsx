"use client";

import dynamic from "next/dynamic";
import { useLayoutEffect, useState } from "react";
import { ChatGptExportLauncher } from "@/components/ChatGptExportLauncher";
import { StrictSharePreviewLauncher } from "@/components/StrictSharePreviewLauncher";
import { useChat } from "@/components/ChatProvider";
import { ImportReview, type PendingImport } from "@/components/ImportReview";
import { Landing } from "@/components/Landing";
import { MessageExplorerLauncher } from "@/components/MessageExplorerLauncher";
import { PrivacyReviewLauncher } from "@/components/PrivacyReviewLauncher";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

const Dashboard = dynamic(
  () => import("@/components/Dashboard").then((mod) => mod.Dashboard),
  { ssr: false },
);

export function HomeView() {
  const { addImportedChat } = useChat();
  const [view, setView] = useState<"landing" | "review" | "dashboard">("landing");
  const [pending, setPending] = useState<PendingImport | null>(null);

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  function showLanding() {
    setPending(null);
    setView("landing");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      {process.env.NEXT_PUBLIC_PREVIEW_ONLY === "true" ? (
        <div role="alert" className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-center text-sm leading-6 text-amber-950">
          <strong>公開テスト版 / Synthetic-data preview.</strong>{" "}
          実際の私的なトーク履歴はまだ読み込まないでください。架空データ専用の検証環境です。
          Privacy protection and unbiased analysis have not been independently validated.
        </div>
      ) : null}
      <SiteHeader
        view={view === "review" ? "landing" : view}
        onShowLanding={showLanding}
        onShowDashboard={() => {
          setPending(null);
          setView("dashboard");
        }}
      />
      {view === "landing" ? (
        <Landing
          onPreviewDashboard={() => setView("dashboard")}
          onParsed={(next) => {
            setPending(next);
            setView("review");
          }}
        />
      ) : view === "review" && pending ? (
        <ImportReview
          pending={pending}
          onConfirm={() => {
            addImportedChat(pending.parsed, pending.fileName, pending.platform);
            setPending(null);
            setView("dashboard");
          }}
          onCancel={showLanding}
        />
      ) : (
        <>
          <Dashboard />
          <ChatGptExportLauncher />
          <StrictSharePreviewLauncher />
          <PrivacyReviewLauncher />
          <MessageExplorerLauncher />
        </>
      )}
      <SiteFooter />
    </div>
  );
}
