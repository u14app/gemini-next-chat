import { describe, expect, it, vi } from "vitest";
import { createTaskPlanBinding } from "../services/api/chat/builtinTools/taskPlan";

describe("update_task_plan built-in", () => {
  it("emits a validated full plan snapshot", async () => {
    const taskPlan = vi.fn();
    const binding = createTaskPlanBinding();

    await expect(
      binding.execute(
        {
          steps: [
            { title: "Inspect", status: "completed" },
            { title: "Implement", status: "in_progress" },
          ],
          note: "Keep scope narrow",
        },
        {
          sessionId: "session-1",
          model: "openai:test-model",
          emit: { taskPlan },
        },
      ),
    ).resolves.toEqual({ ok: true });
    expect(taskPlan).toHaveBeenCalledWith({
      steps: [
        { title: "Inspect", status: "completed" },
        { title: "Implement", status: "in_progress" },
      ],
      note: "Keep scope narrow",
    });
  });

  it("does not replace the current plan with invalid input", async () => {
    const taskPlan = vi.fn();
    const binding = createTaskPlanBinding();

    await expect(
      binding.execute(
        { steps: [{ title: "", status: "pending" }] },
        {
          sessionId: "session-1",
          model: "openai:test-model",
          emit: { taskPlan },
        },
      ),
    ).resolves.toMatchObject({
      error: { code: "INVALID_TASK_PLAN" },
    });
    expect(taskPlan).not.toHaveBeenCalled();
  });
});
