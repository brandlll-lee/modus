import type { AuthInteraction, AuthPrompt } from "@earendil-works/pi-ai";
import { beforeEach, expect, it, vi } from "vitest";
import {
  cancelProviderAuth,
  getProviderAuthState,
  respondProviderAuth,
  startProviderAuth,
} from "./provider-auth";

const mocks = vi.hoisted(() => ({ login: vi.fn(), configure: vi.fn(async () => ({})) }));
vi.mock("./agent-paths", () => ({ getModusDeviceId: () => "device" }));
vi.mock("./model-service", () => ({
  configureProvider: mocks.configure,
  getModelRuntime: async () => ({
    getProvider: () => ({ auth: { oauth: {}, apiKey: { login: true } } }),
    login: mocks.login,
  }),
}));
beforeEach(() => {
  mocks.login.mockReset();
  mocks.configure.mockClear();
});

it("adapts selection, secret and optional text prompts without retaining responses", async () => {
  const responses: string[] = [];
  mocks.login.mockImplementation(
    async (_provider: string, _method: string, ui: AuthInteraction) => {
      responses.push(
        await ui.prompt({
          type: "select",
          message: "Region",
          options: [{ id: "r", label: "Region" }],
        }),
      );
      responses.push(await ui.prompt({ type: "secret", message: "Key" }));
      responses.push(await ui.prompt({ type: "text", message: "Optional value" }));
    },
  );
  const operation = await startProviderAuth("fixture", vi.fn(), "api_key");
  expect(operation.status).toBe("select");
  respondProviderAuth(operation.id, "r");
  await vi.waitFor(() => expect(getProviderAuthState(operation.id).secret).toBe(true));
  respondProviderAuth(operation.id, "test-secret");
  await vi.waitFor(() => expect(getProviderAuthState(operation.id).allowEmpty).toBe(true));
  respondProviderAuth(operation.id, "");
  await vi.waitFor(() => expect(mocks.configure).toHaveBeenCalledWith({ provider: "fixture" }));
  expect(responses).toEqual(["r", "test-secret", ""]);
  expect(JSON.stringify(getProviderAuthState(operation.id))).not.toContain("test-secret");
});

it("cancels a pending native prompt and rejects concurrent sign-ins", async () => {
  mocks.login.mockImplementation(
    async (_provider: string, _method: string, ui: AuthInteraction) => {
      await ui.prompt({ type: "manual_code", message: "Code" } as AuthPrompt);
    },
  );
  const operation = await startProviderAuth("fixture", vi.fn());
  await expect(startProviderAuth("fixture", vi.fn())).rejects.toThrow(/already in progress/);
  cancelProviderAuth(operation.id);
  await new Promise((resolve) => setImmediate(resolve));
  expect(() => getProviderAuthState(operation.id)).toThrow("no longer active");
  expect(mocks.configure).not.toHaveBeenCalled();
});
