function asDate(timestamp) {
  const date = timestamp instanceof Date ? new Date(timestamp.getTime()) : new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("timestamp is not a valid date");
  }
  return date;
}

export function dayKey(timestamp) {
  return asDate(timestamp).toISOString().slice(0, 10);
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
  const { dailyCapUsd, allowedPrefixes, store } = options;
  if (typeof dailyCapUsd !== "number" || !Number.isFinite(dailyCapUsd) || dailyCapUsd < 0) {
    throw new TypeError("dailyCapUsd must be a finite number >= 0");
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
  return { dailyCapUsd, allowedPrefixes, store };
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
  const already = config.store.get(key) ?? 0;
  if (typeof already !== "number" || !Number.isFinite(already)) {
    throw new TypeError(`store entry ${key} is not a number`);
  }
  const next = already + row.cost;
  if (next > config.dailyCapUsd) {
    return {
      decision: "deny",
      reason: `daily cap ${config.dailyCapUsd} USD would be exceeded for ${row.user} (spent ${already}, this call ${row.cost})`,
    };
  }
  config.store.set(key, next);
  return {
    decision: "allow",
    reason: "within daily cap",
  };
}
