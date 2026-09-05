"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

// Keep the CRDT runtime out of the server/Worker graph. The scheduler and
// Automerge are browser-only and are loaded after hydration.
const SyncLifecycle = dynamic(() => import("./SyncLifecycle"), {
  ssr: false,
});

export default function SyncLifecycleLoader() {
  const pathname = usePathname();
  if (pathname?.startsWith("/share/")) return null;
  return <SyncLifecycle />;
}
