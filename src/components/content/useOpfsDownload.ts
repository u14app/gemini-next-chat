"use client";

import { useCallback, useState } from "react";

import { resolveOPFSBlob } from "@/utils/opfs";

/**
 * Downloads an `opfs://` URL as a file. Bytes are read on demand so a file's
 * contents are never held in message state, and the object URL is revoked
 * immediately after the click.
 */
export function useOpfsDownload(url: string, fileName: string) {
  const [failed, setFailed] = useState(false);

  const download = useCallback(async () => {
    let objectUrl: string | undefined;
    try {
      setFailed(false);
      const blob = await resolveOPFSBlob(url);
      if (!blob) {
        setFailed(true);
        return;
      }

      objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      setFailed(true);
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }, [fileName, url]);

  return { download, failed, setFailed };
}
