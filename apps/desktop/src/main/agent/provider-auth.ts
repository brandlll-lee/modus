import type { AuthPrompt, AuthType } from "@earendil-works/pi-ai";
import type { ProviderAuthOperationState } from "../../shared/contracts";
import { getModusDeviceId } from "./agent-paths";
import { configureProvider, getModelRuntime } from "./model-service";

type AuthOperation = {
  controller: AbortController;
  respond?: ((value: string | undefined) => void) | undefined;
  state: ProviderAuthOperationState;
};

const operations = new Map<string, AuthOperation>();

function getOperation(id: string): AuthOperation {
  const operation = operations.get(id);
  if (!operation) throw new Error("Provider sign-in is no longer active.");
  return operation;
}

function update(operation: AuthOperation, state: Partial<ProviderAuthOperationState>): void {
  operation.state = { ...operation.state, ...state };
}

function prompt(operation: AuthOperation, input: AuthPrompt): Promise<string> {
  const signal = input.signal
    ? AbortSignal.any([operation.controller.signal, input.signal])
    : operation.controller.signal;
  signal.throwIfAborted();
  update(operation, {
    status:
      input.type === "select" ? "select" : input.type === "manual_code" ? "manual-code" : "prompt",
    message: input.message,
    options: input.type === "select" ? [...input.options] : undefined,
    placeholder: "placeholder" in input ? input.placeholder : undefined,
    secret: input.type === "secret",
    allowEmpty: input.type === "text",
    url: undefined,
    userCode: undefined,
  });
  return new Promise((resolve, reject) => {
    const abort = () => {
      operation.respond = undefined;
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    operation.respond = (value) => {
      signal.removeEventListener("abort", abort);
      operation.respond = undefined;
      if (value === undefined) {
        operation.controller.abort();
        reject(operation.controller.signal.reason);
      } else {
        resolve(value);
      }
    };
  });
}

export async function startProviderAuth(
  provider: string,
  openExternal: (url: string) => Promise<void>,
  method: AuthType = "oauth",
): Promise<ProviderAuthOperationState> {
  const runtime = await getModelRuntime();
  const id = provider.trim();
  const auth = runtime.getProvider(id)?.auth;
  if (!(method === "oauth" ? auth?.oauth : auth?.apiKey?.login)) {
    throw new Error(`No native ${method} sign-in is available for ${provider}.`);
  }
  if (
    [...operations.values()].some(
      (operation) =>
        operation.state.provider === id &&
        !["complete", "error", "cancelled"].includes(operation.state.status),
    )
  ) {
    throw new Error(`A sign-in is already in progress for ${id}.`);
  }
  const operation: AuthOperation = {
    controller: new AbortController(),
    state: {
      id: crypto.randomUUID(),
      provider: id,
      status: "pending",
      message: "Preparing sign-in…",
    },
  };
  operations.set(operation.state.id, operation);
  void runtime
    .login(
      id,
      method,
      {
        signal: operation.controller.signal,
        prompt: (input) => prompt(operation, input),
        notify: (event) => {
          if (operation.controller.signal.aborted) return;
          if (event.type === "auth_url" || event.type === "device_code") {
            const url = event.type === "auth_url" ? event.url : event.verificationUri;
            update(
              operation,
              event.type === "auth_url"
                ? {
                    status: "browser",
                    url,
                    instructions: event.instructions,
                    message: "Continue sign-in in your browser.",
                  }
                : {
                    status: "device-code",
                    url,
                    userCode: event.userCode,
                    message: "Enter this code in your browser.",
                  },
            );
            void openExternal(url).catch(() =>
              update(operation, { message: "Open the sign-in link to continue." }),
            );
          } else {
            update(operation, {
              message: event.message,
              ...(event.type === "info" && event.links?.[0] ? { url: event.links[0].url } : {}),
            });
          }
        },
      },
      { getDeviceId: getModusDeviceId },
    )
    .then(async () => {
      if (operation.controller.signal.aborted) return;
      await configureProvider({ provider: id });
      update(operation, { status: "complete", message: "Connected." });
    })
    .catch((error: unknown) => {
      update(
        operation,
        operation.controller.signal.aborted
          ? { status: "cancelled", message: "Sign-in cancelled." }
          : { status: "error", message: error instanceof Error ? error.message : String(error) },
      );
    });
  return { ...operation.state };
}

export function getProviderAuthState(id: string): ProviderAuthOperationState {
  const operation = getOperation(id);
  if (["complete", "error", "cancelled"].includes(operation.state.status)) operations.delete(id);
  return { ...operation.state };
}

export function respondProviderAuth(id: string, value: string | undefined): void {
  const operation = getOperation(id);
  const respond = operation.respond;
  if (!respond) throw new Error("Provider sign-in is not waiting for input.");
  update(operation, { status: "pending", message: "Continuing sign-in…", options: undefined });
  respond(value);
}

export function cancelProviderAuth(id: string): void {
  const operation = getOperation(id);
  operation.controller.abort();
  operations.delete(id);
}
