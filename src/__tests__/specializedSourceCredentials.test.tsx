// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResearchSourceCredentials } from "@/components/plugin/ResearchSourceCredentials";
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
afterEach(cleanup);
describe("EPO credential configuration", () => {
  it("labels two fields, submits one secret pair, and clears plaintext after saving", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ResearchSourceCredentials
        hasSecret={false}
        onSave={onSave}
        onClear={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("clientId"), {
      target: { value: "client" },
    });
    fireEvent.change(screen.getByLabelText("clientSecret"), {
      target: { value: "secret" },
    });
    expect(screen.getByLabelText("clientSecret").getAttribute("type")).toBe(
      "password",
    );
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        JSON.stringify({ clientId: "client", clientSecret: "secret" }),
      ),
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("clientSecret") as HTMLInputElement).value,
      ).toBe(""),
    );
  });
  it("keeps save errors contextual and allows clearing existing credentials", async () => {
    const onClear = vi.fn();
    render(
      <ResearchSourceCredentials
        hasSecret
        onSave={vi.fn().mockRejectedValue(new Error("storage"))}
        onClear={onClear}
      />,
    );
    fireEvent.change(screen.getByLabelText("clientId"), {
      target: { value: "client" },
    });
    fireEvent.change(screen.getByLabelText("clientSecret"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "saveFailed",
    );
    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
