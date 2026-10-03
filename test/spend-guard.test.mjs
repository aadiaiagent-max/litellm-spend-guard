import assert from "node:assert/strict";
import test from "node:test";
import { dayKey, guard, windowStart } from "../src/spend-guard.mjs";

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

test("windowStart uses UTC midnight and Monday weeks", () => {
  assert.equal(windowStart("2026-10-03T23:59:59Z", "day").toISOString(), "2026-10-03T00:00:00.000Z");
  // 2026-10-03 is a Saturday, so the week opened the previous Monday.
  assert.equal(windowStart("2026-10-03T15:00:00Z", "week").toISOString(), "2026-09-28T00:00:00.000Z");
  assert.equal(windowStart("2026-10-04T23:00:00Z", "week").toISOString(), "2026-09-28T00:00:00.000Z");
  assert.equal(windowStart("2026-10-05T00:00:00Z", "week").toISOString(), "2026-10-05T00:00:00.000Z");
});

test("weekly cap blocks across days in the same week and does not record the denied call", () => {
  const opts = options({ dailyCapUsd: 5, weeklyCapUsd: 1 });
  const first = guard(
    { user: "ada", model: "openai/gpt-4o-mini", cost: 0.6, timestamp: "2026-10-03T12:00:00Z" },
    opts,
  );
  const second = guard(
    { user: "ada", model: "openai/gpt-4o-mini", cost: 0.6, timestamp: "2026-10-04T12:00:00Z" },
    opts,
  );
  assert.equal(first.decision, "allow");
  assert.equal(second.decision, "deny");
  assert.match(second.reason, /weekly cap/);
  assert.equal(opts.store.get("ada|2026-10-04"), undefined);
  assert.equal(opts.store.get("ada|week|2026-09-28T00:00:00.000Z"), 0.6);
});

test("a new week clears the weekly total", () => {
  const opts = options({ dailyCapUsd: 5, weeklyCapUsd: 0.5 });
  guard(
    { user: "ada", model: "openai/gpt-4o-mini", cost: 0.5, timestamp: "2026-10-04T12:00:00Z" },
    opts,
  );
  const nextWeek = guard(
    { user: "ada", model: "openai/gpt-4o-mini", cost: 0.5, timestamp: "2026-10-05T00:00:00Z" },
    opts,
  );
  assert.equal(nextWeek.decision, "allow");
});
