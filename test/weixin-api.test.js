const test = require("node:test");
const assert = require("node:assert/strict");

const { getUpdates } = require("../src/adapters/channel/weixin/api");

// getUpdates must swallow long-poll timeout aborts. apiPost wraps fetch rejections as
// `new Error("... request failed for <url>", { cause })`, so the AbortError lives on .cause.
// The pre-fix catch only inspected the wrapper and re-threw, causing "[cyberboss] poll failed".
function withFetchStub(fetchImpl, fn) {
  const original = global.fetch;
  global.fetch = fetchImpl;
  try {
    return fn();
  } finally {
    global.fetch = original;
  }
}

test("getUpdates swallows an AbortError wrapped by apiPost", async () => {
  const originalBuf = "buf-abc";
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    const abortError = new DOMException("This operation was aborted", "AbortError");
    throw abortError;
  };

  const result = await withFetchStub(fetchImpl, () =>
    getUpdates({ baseUrl: "https://example.test", token: "t", getUpdatesBuf: originalBuf, timeoutMs: 1_000 })
  );

  assert.equal(calls, 1);
  assert.deepEqual(result, { ret: 0, msgs: [], get_updates_buf: originalBuf });
});

test("getUpdates re-throws non-abort errors even when wrapped", async () => {
  const fetchImpl = async () => {
    throw new TypeError("network down");
  };

  await assert.rejects(
    withFetchStub(fetchImpl, () =>
      getUpdates({ baseUrl: "https://example.test", token: "t", getUpdatesBuf: "buf", timeoutMs: 1_000 })
    ),
    (error) => {
      assert.match(error.message, /getUpdates request failed for/);
      assert.equal(error.cause?.message, "network down");
      return true;
    }
  );
});

test("getUpdates returns parsed body on success", async () => {
  const payload = { ret: 0, msgs: [{ from_user_id: "u1" }], get_updates_buf: "new-buf" };
  const fetchImpl = async () =>
    new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });

  const result = await withFetchStub(fetchImpl, () =>
    getUpdates({ baseUrl: "https://example.test", token: "t", getUpdatesBuf: "old", timeoutMs: 1_000 })
  );

  assert.deepEqual(result, payload);
});
