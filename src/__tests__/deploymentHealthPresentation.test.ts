import { describe, expect, it } from "vitest";
import {
  serviceHealthStateToDisplay,
  strongestDeploymentHealthState,
} from "../lib/services/healthPresentation";

describe("deployment health presentation", () => {
  it("shows degraded availability as a warning", () => {
    expect(serviceHealthStateToDisplay("degraded")).toBe("warning");
  });
  it("presents local-only services as information", () => {
    expect(serviceHealthStateToDisplay("local_only")).toBe("info");
    expect(
      strongestDeploymentHealthState([
        serviceHealthStateToDisplay("local_only")!,
        serviceHealthStateToDisplay("available")!,
      ]),
    ).toBe("info");
  });

  it("keeps failures stronger than informational states", () => {
    expect(
      strongestDeploymentHealthState([
        serviceHealthStateToDisplay("local_only")!,
        serviceHealthStateToDisplay("policy_blocked")!,
      ]),
    ).toBe("blocked");
  });
});
