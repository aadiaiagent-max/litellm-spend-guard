import assert from "node:assert/strict";
import test from "node:test";
import { dayKey, guard } from "../src/spend-guard.mjs";

function options(overrides = {}) {
  return {
    dailyCapUsd: 1,
    allowedPrefixes: ["openai/", "anthropic/"],
    store: new Map(),
    ...overrides,
  };
}

test("allows a call under the cap and records it", () => {
  const opts = options();
  const result = guard(
    { user: "ada", model: "openai/gpt-4o-mini", cost: 0.4, timestamp: "2026-10-03T15:00:00Z" },
    opts,
  );
  assert.equal(result.decision, "allow");
  assert.equal(opts.store.get("ada|2026-10-03"), 0.4);
});

test("denies a model outside the prefix allowlist and does not record spend", () => {
  const opts = options();
  const result = guard(
    { user: "ada", model: "groq/llama-3.1-8b-instant", cost: 0.01, timestamp: "2026-10-03T15:00:00Z" },
    opts,
  );
  assert.equal(result.decision, "deny");
  assert.match(result.reason, /allowlist/);
  assert.equal(opts.store.size, 0);
});

test("denies when this call would cross the daily cap", () => {
  const opts = options({ dailyCapUsd: 1 });
  const first = guard(
    { user: "ada", model: "openai/gpt-4o-mini", cost: 0.8, timestamp: "2026-10-03T01:00:00Z" },
    opts,
  );
  const second = guard(
    { user: "ada", model: "anthropic/claude-3-5-haiku-latest", cost: 0.3, timestamp: "2026-10-03T23:00:00Z" },
    opts,
  );
  assert.equal(first.decision, "allow");
  assert.equal(second.decision, "deny");
  assert.match(second.reason, /daily cap/);
  assert.equal(opts.store.get("ada|2026-10-03"), 0.8);
});

test("a new UTC day starts a fresh total", () => {
  const opts = options({ dailyCapUsd: 0.5 });
  guard(
    { user: "ada", model: "openai/gpt-4o-mini", cost: 0.5, timestamp: "2026-10-03T23:59:59Z" },
    opts,
  );
  const nextDay = guard(
    { user: "ada", model: "openai/gpt-4o-mini", cost: 0.5, timestamp: "2026-10-04T00:00:00Z" },
    opts,
  );
  assert.equal(nextDay.decision, "allow");
  assert.equal(dayKey("2026-10-03T23:59:59Z"), "2026-10-03");
  assert.equal(dayKey("2026-10-04T00:00:00Z"), "2026-10-04");
});

test("users do not share a cap", () => {
  const opts = options({ dailyCapUsd: 0.2 });
  guard(
    { user: "ada", model: "openai/gpt-4o-mini", cost: 0.2, timestamp: "2026-10-03T12:00:00Z" },
    opts,
  );
  const other = guard(
    { user: "grace", model: "openai/gpt-4o-mini", cost: 0.2, timestamp: "2026-10-03T12:00:00Z" },
    opts,
  );
  assert.equal(other.decision, "allow");
});

test("exact cap is still allowed", () => {
  const opts = options({ dailyCapUsd: 0.25 });
  const result = guard(
    { user: "ada", model: "openai/gpt-4o-mini", cost: 0.25, timestamp: 1759507200000 },
    opts,
  );
  assert.equal(result.decision, "allow");
});

test("rejects a bad payload", () => {
  assert.throws(
    () =>
      guard(
        { user: "", model: "openai/gpt-4o-mini", cost: 0, timestamp: "2026-10-03T00:00:00Z" },
        options(),
      ),
    /user/,
  );
});
