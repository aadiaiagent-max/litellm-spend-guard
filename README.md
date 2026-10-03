# litellm-spend-guard

In-process check for a spend callback payload: `{ user, model, cost, timestamp }`. It applies a per-user daily USD cap and an allowlist of model name prefixes, then returns allow or deny with a reason.

This does not import LiteLLM and it does not talk to a proxy. You call it from whatever callback you already have. The custom callback hook is documented at https://docs.litellm.ai/docs/observability/custom_callback — on a success log the useful fields are the model and `response_cost`. Map those yourself.

```js
import { guard } from "./src/spend-guard.mjs";

const store = new Map();
const opts = { dailyCapUsd: 5, allowedPrefixes: ["openai/", "anthropic/"], store };

// inside your own callback; kwargs is whatever the proxy handed you
const event = {
  user: kwargs.user || "unknown",
  model: kwargs.model,
  cost: kwargs.response_cost ?? 0,
  timestamp: new Date().toISOString(),
};
const result = guard(event, opts);
// deny leaves the store unchanged; allow already added this cost
if (result.decision === "deny") console.log(result.reason);
```

Days are UTC (`YYYY-MM-DD` from the timestamp). Pass `weeklyCapUsd` to also cap Monday-to-Monday UTC spend; `windowStart(timestamp, "week")` is the reset instant. Leave `weeklyCapUsd` off and only the daily cap runs. A call that would push the stored total over `dailyCapUsd` is denied and not recorded. Hitting the cap exactly is allowed. Prefix match is `startsWith`.

```bash
node --test
```

The `store` is a `Map` you own. Keys look like `ada|2026-10-03`. A new day is just a new key; this module does not delete old ones.
