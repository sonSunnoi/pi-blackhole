import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { autoCompactThreshold, sessionContextWindow } from "./model-budget.js";
import type { Runtime } from "./runtime.js";

/** Pull on every check: model switches and config reloads cannot leave a stale override. */
export function resolveCompactThreshold(
  runtime: Runtime,
  model: ExtensionContext["model"],
): number {
  return runtime.compactThresholdOverride?.(model) ?? autoCompactThreshold(runtime.config, model);
}

export function registerThresholdOverride(pi: ExtensionAPI, runtime: Runtime): void {
  runtime.compactThresholdOverride = (model) => {
    if (!model) return undefined;
    let tokens: unknown;
    pi.events.emit("blackhole:threshold-query:v1", {
      provider: model.provider,
      modelId: model.id,
      resolve: (value: unknown) => {
        tokens = value;
      },
    });
    return typeof tokens === "number" &&
      Number.isSafeInteger(tokens) &&
      tokens > 0 &&
      tokens < sessionContextWindow(model, runtime.config)
      ? tokens
      : undefined;
  };
  const remove = pi.events.on("blackhole:threshold:v1", (data) => {
    const request = data as
      | { resolve?: (action: (ctx: ExtensionContext) => unknown) => void }
      | undefined;
    request?.resolve?.((ctx) => {
      runtime.ensureConfig(ctx.cwd);
      return {
        contextWindow: sessionContextWindow(ctx.model, runtime.config),
        defaultTokens: autoCompactThreshold(runtime.config, ctx.model),
        effectiveTokens: resolveCompactThreshold(runtime, ctx.model),
        automatic:
          runtime.config.compaction === "auto" && runtime.config.compactionEngine !== "pi-default",
      };
    });
  });
  pi.on("session_shutdown", () => {
    remove();
    runtime.compactThresholdOverride = undefined;
  });
}
