import { describe, expect, it } from "vitest";
import { compatible, upperTokenBudget, usageFrom } from "../src/functions/foundryGateway.js";

describe("Foundry gateway metering", () => {
  it("normalizes Chat Completions and Responses usage exactly", () => {
    expect(usageFrom({ usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 } })).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      details: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
    });
    expect(usageFrom({ usage: { input_tokens: 75, output_tokens: 25, total_tokens: 100 } }).totalTokens).toBe(100);
  });

  it("requires bounded text generation but supports bounded embeddings", () => {
    expect(() => upperTokenBudget({ model: "gpt", input: "hello" }, "responses")).toThrow(/max_/);
    expect(upperTokenBudget({ model: "gpt", input: "hello", max_output_tokens: 50 }, "responses")).toBeGreaterThan(50);
    expect(upperTokenBudget({ model: "embedding", input: "hello" }, "embeddings")).toBeGreaterThan(0);
  });

  it("only allows quota units that can be measured for the operation", () => {
    expect(compatible("tokens", "chat/completions")).toBe(true);
    expect(compatible("tokens", "images/generations")).toBe(false);
    expect(compatible("images", "images/generations")).toBe(true);
    expect(compatible("requests", "responses")).toBe(true);
    expect(compatible("minutes", "responses")).toBe(false);
  });
});
