function asDate(timestamp) {
  const date = timestamp instanceof Date ? new Date(timestamp.getTime()) : new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("timestamp is not a valid date");
  }
  return date;
}

export function windowStart(timestamp, window) {
  const date = asDate(timestamp);
  if (window !== "day" && window !== "week") {
    throw new TypeError('window must be "day" or "week"');
  }
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (window === "week") {
    const sinceMonday = (date.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - sinceMonday);
  }
  return start;
}

export function dayKey(timestamp) {
  return windowStart(timestamp, "day").toISOString().slice(0, 10);
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function readConfig(options) {
  if (options === null || typeof options !== "object") {
    throw new TypeError("options are required");
  }
  const { dailyCapUsd, weeklyCapUsd, allowedPrefixes, store } = options;
  if (typeof dailyCapUsd !== "number" || !Number.isFinite(dailyCapUsd) || dailyCapUsd < 0) {
    throw new TypeError("dailyCapUsd must be a finite number >= 0");
  }
  if (weeklyCapUsd !== undefined) {
    if (typeof weeklyCapUsd !== "number" || !Number.isFinite(weeklyCapUsd) || weeklyCapUsd < 0) {
      throw new TypeError("weeklyCapUsd must be a finite number >= 0");
    }
  }
  if (!Array.isArray(allowedPrefixes) || allowedPrefixes.length === 0) {
    throw new TypeError("allowedPrefixes must be a non-empty list");
  }
  for (const prefix of allowedPrefixes) {
    if (typeof prefix !== "string" || prefix.length === 0) {
      throw new TypeError("allowedPrefixes entries must be non-empty strings");
    }
  }
  if (!(store instanceof Map)) {
    throw new TypeError("store must be a Map");
  }
  return { dailyCapUsd, weeklyCapUsd, allowedPrefixes, store };
}

function readEvent(event) {
  if (event === null || typeof event !== "object") {
    throw new TypeError("event must be an object");
  }
  const user = requireNonEmptyString(event.user, "user");
  const model = requireNonEmptyString(event.model, "model");
  if (typeof event.cost !== "number" || !Number.isFinite(event.cost) || event.cost < 0) {
    throw new TypeError("cost must be a finite number >= 0");
  }
  const timestamp = asDate(event.timestamp);
  return { user, model, cost: event.cost, timestamp };
}

function modelAllowed(model, prefixes) {
  return prefixes.some((prefix) => model.startsWith(prefix));
}

function readTotal(store, key) {
  const already = store.get(key) ?? 0;
  if (typeof already !== "number" || !Number.isFinite(already)) {
    throw new TypeError(`store entry ${key} is not a number`);
  }
  return already;
}

export function guard(event, options) {
  const config = readConfig(options);
  const row = readEvent(event);
  if (!modelAllowed(row.model, config.allowedPrefixes)) {
    return {
      decision: "deny",
      reason: `model ${row.model} is not on the allowlist`,
    };
  }
  const key = `${row.user}|${dayKey(row.timestamp)}`;
  const already = readTotal(config.store, key);
  const next = already + row.cost;
  if (next > config.dailyCapUsd) {
    return {
      decision: "deny",
      reason: `daily cap ${config.dailyCapUsd} USD would be exceeded for ${row.user} (spent ${already}, this call ${row.cost})`,
    };
  }
  let weekKey = null;
  let spentWeek = 0;
  if (config.weeklyCapUsd !== undefined) {
    weekKey = `${row.user}|week|${windowStart(row.timestamp, "week").toISOString()}`;
    spentWeek = readTotal(config.store, weekKey);
    if (spentWeek + row.cost > config.weeklyCapUsd) {
      return {
        decision: "deny",
        reason: `weekly cap ${config.weeklyCapUsd} USD would be exceeded for ${row.user} (spent ${spentWeek}, this call ${row.cost})`,
      };
    }
  }
  config.store.set(key, next);
  if (weekKey) config.store.set(weekKey, spentWeek + row.cost);
  return {
    decision: "allow",
    reason: "within daily cap",
  };
}
