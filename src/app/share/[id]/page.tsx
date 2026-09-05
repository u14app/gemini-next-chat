import type { Metadata } from "next";
import SharedConversationPage from "@/components/sharing/SharedConversationPage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Shared conversation",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function SharePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SharedConversationPage shareId={id} />;
}
