// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { getRegisteredShareImageSrc } from "@/lib/security/shareImageUrl";
import { useUIStore } from "@/store/core/uiStore";

const path = `/api/shares/${"A".repeat(43)}/assets/${"a".repeat(64)}?revision=1`;
afterEach(() => useUIStore.getState().closeImagePreview());

describe("registered shared image preview", () => {
  it("opens local-deployment images through the real preview normalizer", () => {
    const url = new URL(path, window.location.origin).toString();
    useUIStore
      .getState()
      .openImagePreview([{ url, alt: "Shared photo" }], 0, [url]);
    expect(useUIStore.getState().imagePreview).toMatchObject({
      isOpen: true,
      currentIndex: 0,
      images: [{ url, alt: "Shared photo" }],
    });
  });

  it("does not grant a general exemption for local endpoints or foreign images", () => {
    const origin = "http://localhost:3000";
    for (const url of [
      origin + "/api/private",
      "https://other.example" + path,
      origin + path + "&target=private",
      origin + path + "#fragment",
    ]) {
      expect(getRegisteredShareImageSrc(url, [url], origin)).toBeNull();
    }
    expect(getRegisteredShareImageSrc(origin + path, [], origin)).toBeNull();
    expect(
      getRegisteredShareImageSrc(origin + path, [origin + path], origin),
    ).toBe(origin + path);
  });
});
