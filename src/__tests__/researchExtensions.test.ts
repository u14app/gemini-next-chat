import { afterEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  createResearchExtensionRepository,
  type ResearchExtensionRepository,
} from "@/services/research/extensionRepository";

const repositories: ResearchExtensionRepository[] = [];
afterEach(() =>
  repositories.splice(0).forEach((repository) => repository.close()),
);

describe("Research extension IndexedDB storage", () => {
  it("serializes simultaneous read-modify-write operations across repository instances", async () => {
    const indexedDb = new IDBFactory();
    const left = createResearchExtensionRepository({ indexedDb });
    const right = createResearchExtensionRepository({ indexedDb });
    repositories.push(left, right);
    await left.put(
      "steering",
      "run",
      { sequence: 0, commands: [] as number[] },
      { taskId: "task", sessionId: "session" },
    );
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 ? left : right).update<{
          sequence: number;
          commands: number[];
        }>("steering", "run", (current) => ({
          sequence: current!.sequence + 1,
          commands: [...current!.commands, current!.sequence + 1],
        })),
      ),
    );
    expect(await left.get("steering", "run")).toEqual({
      sequence: 12,
      commands: Array.from({ length: 12 }, (_, index) => index + 1),
    });
    expect(
      await right.list("steering", { taskId: "task", sessionId: "session" }),
    ).toHaveLength(1);
    expect(await right.list("steering", { taskId: "other" })).toEqual([]);
  });

  it("aborts invalid updates without losing the previous value", async () => {
    const repository = createResearchExtensionRepository({
      indexedDb: new IDBFactory(),
    });
    repositories.push(repository);
    await repository.put("template", "template", { title: "Saved" });
    await expect(
      repository.update("template", "template", () => {
        throw new Error("invalid revision");
      }),
    ).rejects.toThrow("invalid revision");
    expect(await repository.get("template", "template")).toEqual({
      title: "Saved",
    });
    expect(repository.getStatus().durable).toBe(true);
  });

  it("does not silently claim a durable write when IndexedDB is absent", async () => {
    const repository = createResearchExtensionRepository({ indexedDb: null });
    expect(await repository.list("template")).toEqual([]);
    await expect(
      repository.put("template", "template", { title: "Unsaved" }),
    ).rejects.toThrow("unavailable");
    expect(repository.getStatus().durable).toBe(false);
  });

  it("removes only the deleted task's extension records and retains the template library", async () => {
    const repository = createResearchExtensionRepository({
      indexedDb: new IDBFactory(),
    });
    repositories.push(repository);
    await repository.put("template", "preset", { title: "Reusable" });
    await repository.put("evidence_thread", "thread-1", {}, { taskId: "one" });
    await repository.put("evidence_thread", "thread-2", {}, { taskId: "two" });
    await repository.put(
      "task_template",
      "one",
      { template: null },
      { taskId: "one" },
    );
    await repository.removeTask("one");
    expect(await repository.get("evidence_thread", "thread-1")).toBeNull();
    expect(await repository.get("task_template", "one")).toBeNull();
    expect(await repository.get("evidence_thread", "thread-2")).toEqual({});
    expect(await repository.get("template", "preset")).toEqual({
      title: "Reusable",
    });
  });
});
