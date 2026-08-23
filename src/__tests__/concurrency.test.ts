import { describe, expect, it, vi } from "vitest";

import { mapWithConcurrencyGroups } from "../lib/utils/concurrency";

describe("mapWithConcurrencyGroups", () => {
  it("serializes one group in input order while unrelated work continues", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started: string[] = [];

    const resultPromise = mapWithConcurrencyGroups(
      ["write", "share", "independent"],
      3,
      (item) => (item === "independent" ? undefined : "workspace"),
      async (item) => {
        started.push(item);
        if (item === "write") await firstGate;
        return item.toUpperCase();
      },
    );

    await vi.waitFor(() => {
      expect(started).toEqual(expect.arrayContaining(["write", "independent"]));
    });
    expect(started).not.toContain("share");

    releaseFirst();

    await expect(resultPromise).resolves.toEqual([
      "WRITE",
      "SHARE",
      "INDEPENDENT",
    ]);
    expect(started.filter((item) => item !== "independent")).toEqual([
      "write",
      "share",
    ]);
  });

  it("releases a group after a mapper failure", async () => {
    const attempted: string[] = [];

    await expect(
      mapWithConcurrencyGroups(
        ["first", "second"],
        2,
        () => "workspace",
        async (item) => {
          attempted.push(item);
          if (item === "first") throw new Error("failed");
          return item;
        },
      ),
    ).rejects.toThrow("failed");

    await vi.waitFor(() => expect(attempted).toEqual(["first", "second"]));
  });
});
