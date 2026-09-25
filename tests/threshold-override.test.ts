import { describe, expect, it } from "vitest";
import {
  createEventBus,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { Runtime } from "../src/om/runtime.js";
import {
  registerThresholdOverride,
  resolveCompactThreshold,
} from "../src/om/threshold-override.js";

describe("runtime threshold override", () => {
  const model: Model<"anthropic-messages"> = {
    id: "test",
    name: "test",
    provider: "anthropic",
    api: "anthropic-messages",
    baseUrl: "https://example.test",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 8192,
  };
  function setup(value: unknown) {
    const events = createEventBus();
    const runtime = new Runtime();
    runtime.config.compactAfterTokens = 81_000;
    runtime.configLoaded = true;
    let shutdown: (() => void) | undefined;
    const pi = {
      events,
      on: (_event: string, handler: () => void) => {
        shutdown = handler;
      },
    } as Pick<ExtensionAPI, "events" | "on">;
    registerThresholdOverride(pi as ExtensionAPI, runtime);
    events.on("blackhole:threshold-query:v1", (data) => {
      const request = data as { provider: string; modelId: string; resolve: (v: unknown) => void };
      if (request.provider === model.provider && request.modelId === model.id)
        request.resolve(value);
    });
    return { runtime, events, shutdown: () => shutdown?.() };
  }
  it("uses custom threshold instead of configured threshold", () => {
    const { runtime } = setup(128_000);
    expect(resolveCompactThreshold(runtime, model)).toBe(128_000);
  });
  it.each([undefined, null, 0, -1, 1.5, NaN, Infinity, "128000", model.contextWindow])(
    "rejects invalid value %s",
    (value) => {
      expect(resolveCompactThreshold(setup(value).runtime, model)).toBe(81_000);
    },
  );
  it("isolates providers", () => {
    expect(resolveCompactThreshold(setup(128_000).runtime, { ...model, provider: "other" })).toBe(
      81_000,
    );
  });
  it("isolates model IDs", () => {
    expect(resolveCompactThreshold(setup(128_000).runtime, { ...model, id: "other" })).toBe(81_000);
  });
  it("removal restores latest config without mutating it", () => {
    const { runtime, shutdown } = setup(128_000);
    expect(runtime.config.compactAfterTokens).toBe(81_000);
    shutdown();
    runtime.config.compactAfterTokens = 90_000;
    expect(resolveCompactThreshold(runtime, model)).toBe(90_000);
  });
  it("capability reports effective and default thresholds", () => {
    const { runtime, events } = setup(128_000);
    runtime.config.compaction = "auto";
    runtime.config.compactionEngine = "blackhole";
    let result: unknown;
    events.emit("blackhole:threshold:v1", {
      resolve: (action: (ctx: ExtensionContext) => unknown) => {
        result = action({ model, cwd: "/tmp" } as ExtensionContext);
      },
    });
    expect(result).toEqual({
      contextWindow: model.contextWindow,
      defaultTokens: 81_000,
      effectiveTokens: 128_000,
      automatic: true,
    });
  });
});
