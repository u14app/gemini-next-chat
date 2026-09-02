// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelProvider } from "@/types";
import ProviderSettings from "@/components/settings/ProviderSettings";

const mocks = vi.hoisted(() => ({
  coreState: {
    _hasHydrated: true,
    providers: [] as ModelProvider[],
    addProvider: vi.fn(),
    updateProvider: vi.fn(),
    deleteProvider: vi.fn(),
  },
  modelDisplayNames: {} as Record<string, string>,
  signedApiFetch: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("@/store/core/settingsStore", async () => {
  const { normalizeProviderBaseUrl } = await import("@/lib/security/urlPolicy");
  return {
    formatModelName: (model: string) => mocks.modelDisplayNames[model] || model,
    getEffectiveBaseUrl: normalizeProviderBaseUrl,
    useSettingsStore: () => ({
      modelMetadata: {},
      customModelMetadata: {},
    }),
  };
});

vi.mock("@/store/core/coreSettingsStore", () => ({
  useCoreSettingsStore: () => mocks.coreState,
}));

vi.mock("@/lib/api/client", () => ({
  getResponseErrorMessage: vi.fn(),
  readJsonResponseOrThrow: vi.fn(),
  signedApiFetch: mocks.signedApiFetch,
}));

vi.mock("@/lib/byok/client", () => ({
  buildProviderRuntimeConfig: vi.fn(
    async (provider: ModelProvider) => provider,
  ),
  fetchWithByokRetry: vi.fn(
    async (request: () => Promise<Response>) => await request(),
  ),
}));

vi.mock("@/lib/security/localSecrets", () => ({
  encryptLocalSecret: vi.fn(async () => ({
    version: 1,
    algorithm: "AES-GCM",
    iv: "iv",
    ciphertext: "ciphertext",
  })),
  LOCAL_SECRET_CONTEXTS: {
    providerApiKey: (providerId: string) => `provider:${providerId}`,
  },
}));

function provider(
  id: string,
  overrides: Partial<ModelProvider> = {},
): ModelProvider {
  return {
    id,
    name: id,
    type: "OpenAI Compatible",
    baseUrl: `https://${id.toLowerCase()}.example`,
    apiKey: "",
    enabled: true,
    models: [],
    modelsList: [],
    ...overrides,
  };
}

beforeEach(() => {
  mocks.coreState.providers = [];
  mocks.coreState.addProvider.mockReset();
  mocks.coreState.updateProvider.mockReset();
  mocks.coreState.deleteProvider.mockReset();
  mocks.signedApiFetch.mockReset();
  mocks.modelDisplayNames = {};
});

afterEach(cleanup);

describe("ProviderSettings", () => {
  it("does not carry an unsaved API key draft to another provider", async () => {
    mocks.coreState.providers = [
      provider("DEFAULT", {
        name: "Server default",
        baseUrl: "default",
        isServerDefault: true,
      }),
      provider("CUSTOM", { name: "Custom" }),
    ];

    render(<ProviderSettings />);

    const defaultKeyInput = await screen.findByLabelText("apiKey");
    fireEvent.change(defaultKeyInput, { target: { value: "default-key" } });
    fireEvent.click(screen.getByRole("button", { name: /Custom/ }));

    const customKeyInput = await screen.findByLabelText("apiKey");
    expect((customKeyInput as HTMLInputElement).value).toBe("");
    expect(
      (
        screen.getByRole("button", {
          name: "saveSecret",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "saveSecret" }));
    expect(mocks.coreState.updateProvider).not.toHaveBeenCalled();
  });

  it("preserves the current URL draft and model request on unrelated provider updates", async () => {
    mocks.coreState.providers = [
      provider("FIRST"),
      provider("SECOND", { name: "Second" }),
    ];
    let requestSignal: AbortSignal | undefined;
    mocks.signedApiFetch.mockImplementation(
      (_url: string, init?: RequestInit) => {
        requestSignal = init?.signal || undefined;
        return new Promise<Response>(() => undefined);
      },
    );

    const view = render(<ProviderSettings />);
    const baseUrlInput = await screen.findByLabelText("apiBaseUrl");
    fireEvent.change(baseUrlInput, {
      target: { value: "https://draft.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: /fetchModelsAria/ }));

    await vi.waitFor(() => expect(mocks.signedApiFetch).toHaveBeenCalledOnce());
    expect(requestSignal?.aborted).toBe(false);

    mocks.coreState.providers = [
      mocks.coreState.providers[0],
      { ...mocks.coreState.providers[1], name: "Second renamed" },
    ];
    await act(async () => {
      view.rerender(<ProviderSettings />);
    });

    expect(
      (screen.getByLabelText("apiBaseUrl") as HTMLInputElement).value,
    ).toBe("https://draft.example");
    expect(requestSignal?.aborted).toBe(false);
  });

  it("does not throw while rendering a persisted invalid base URL", () => {
    mocks.coreState.providers = [provider("INVALID", { baseUrl: "https://" })];

    expect(() => render(<ProviderSettings />)).not.toThrow();
    expect(screen.queryByText(/^preview/)).toBeNull();
  });

  it("filters models by normalized ids and display names", async () => {
    mocks.modelDisplayNames = {
      "model-id": "Friendly Label",
      "other-model": "Another Model",
    };
    mocks.coreState.providers = [
      provider("FILTER", {
        modelsList: ["model-id", "other-model"],
      }),
    ];

    render(<ProviderSettings />);

    const search = await screen.findByRole("searchbox", {
      name: "modelSearchLabel",
    });
    fireEvent.change(search, { target: { value: "  fRiEnDlY   " } });

    expect(screen.getByText("Friendly Label")).toBeTruthy();
    expect(screen.queryByText("Another Model")).toBeNull();
    expect(mocks.signedApiFetch).not.toHaveBeenCalled();

    fireEvent.change(search, { target: { value: "  OTHER-MODEL " } });

    expect(screen.getByText("Another Model")).toBeTruthy();
    expect(screen.queryByText("Friendly Label")).toBeNull();
  });

  it("matches compatibility-normalized model text", async () => {
    mocks.modelDisplayNames = {
      "gpt-4o": "GPT-4o",
    };
    mocks.coreState.providers = [
      provider("FILTER", {
        modelsList: ["gpt-4o", "claude-3"],
      }),
    ];

    render(<ProviderSettings />);

    const search = await screen.findByRole("searchbox", {
      name: "modelSearchLabel",
    });
    fireEvent.change(search, { target: { value: " ＧＰＴ " } });

    expect(screen.getByText("GPT-4o")).toBeTruthy();
    expect(screen.queryByText("claude-3")).toBeNull();
  });

  it("distinguishes an empty model list from a search with no matches", async () => {
    mocks.coreState.providers = [
      provider("FILTER", {
        modelsList: ["model-id"],
      }),
    ];

    render(<ProviderSettings />);

    const search = await screen.findByRole("searchbox", {
      name: "modelSearchLabel",
    });
    fireEvent.change(search, { target: { value: "missing" } });

    expect(screen.getByText("noMatchingModels")).toBeTruthy();
    expect(screen.queryByText("noModels")).toBeNull();
  });

  it("clears the model search with the clear action or Escape", async () => {
    mocks.coreState.providers = [
      provider("FILTER", {
        modelsList: ["model-id", "other-model"],
      }),
    ];

    render(<ProviderSettings />);

    const search = await screen.findByRole("searchbox", {
      name: "modelSearchLabel",
    });
    fireEvent.change(search, { target: { value: "model-id" } });

    const clearButton = screen.getByRole("button", {
      name: "clearModelSearch",
    });
    fireEvent.click(clearButton);
    expect((search as HTMLInputElement).value).toBe("");
    expect(screen.getByText("other-model")).toBeTruthy();

    fireEvent.change(search, { target: { value: "other-model" } });
    fireEvent.keyDown(search, { key: "Escape" });
    expect((search as HTMLInputElement).value).toBe("");
    expect(screen.getByText("model-id")).toBeTruthy();
  });

  it("resets the search query when switching providers", async () => {
    mocks.coreState.providers = [
      provider("FIRST", { modelsList: ["first-model"] }),
      provider("SECOND", { modelsList: ["second-model"] }),
    ];

    render(<ProviderSettings />);

    const search = await screen.findByRole("searchbox", {
      name: "modelSearchLabel",
    });
    fireEvent.change(search, { target: { value: "first" } });
    expect((search as HTMLInputElement).value).toBe("first");

    fireEvent.click(screen.getByRole("button", { name: /SECOND/ }));

    await vi.waitFor(() => {
      expect(
        (
          screen.getByRole("searchbox", {
            name: "modelSearchLabel",
          }) as HTMLInputElement
        ).value,
      ).toBe("");
    });
    expect(screen.getByText("second-model")).toBeTruthy();
  });

  it("keeps the query when the current provider model list refreshes", async () => {
    mocks.coreState.providers = [
      provider("FILTER", { modelsList: ["first-model"] }),
    ];

    const view = render(<ProviderSettings />);

    const search = await screen.findByRole("searchbox", {
      name: "modelSearchLabel",
    });
    fireEvent.change(search, { target: { value: "refreshed" } });

    mocks.coreState.providers = [
      provider("FILTER", { modelsList: ["refreshed-model"] }),
    ];
    await act(async () => {
      view.rerender(<ProviderSettings />);
    });

    expect(
      (
        screen.getByRole("searchbox", {
          name: "modelSearchLabel",
        }) as HTMLInputElement
      ).value,
    ).toBe("refreshed");
    expect(screen.getByText("refreshed-model")).toBeTruthy();
  });

  it("keeps selection state and edit actions keyed by the raw model id", async () => {
    mocks.modelDisplayNames = {
      "model-id": "Friendly Label",
    };
    mocks.coreState.providers = [
      provider("FILTER", {
        modelsList: ["model-id", "other-model"],
        models: ["model-id"],
      }),
    ];

    render(<ProviderSettings />);

    const search = await screen.findByRole("searchbox", {
      name: "modelSearchLabel",
    });
    fireEvent.change(search, { target: { value: "friendly" } });

    const checkbox = screen.getByRole("checkbox", {
      name: "Friendly Label",
    });
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    expect((checkbox as HTMLInputElement).value).toBe("model-id");

    fireEvent.click(checkbox);
    expect(mocks.coreState.updateProvider).toHaveBeenCalledWith("FILTER", {
      models: [],
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: 'editMetadataAria:{"name":"Friendly Label"}',
      }),
    );
    expect((screen.getByLabelText("modelId") as HTMLInputElement).value).toBe(
      "model-id",
    );
  });

  it("shows the no-model state without rendering a search for an empty list", async () => {
    mocks.coreState.providers = [provider("EMPTY")];

    render(<ProviderSettings />);

    expect(await screen.findByText("noModels")).toBeTruthy();
    expect(
      screen.queryByRole("searchbox", { name: "modelSearchLabel" }),
    ).toBeNull();
  });
});
