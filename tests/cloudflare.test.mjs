import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
let runtime, db;
const options = {
  modules: true,
  scriptPath: ".cloudflare-build/worker.js",
  compatibilityDate: "2026-01-01",
  compatibilityFlags: ["nodejs_compat"],
};
before(async () => {
  runtime = new Miniflare(
    convertV4MiniflareOptions({ ...options, d1Databases: ["DB"] }),
  );
  db = await runtime.getD1Database("DB");
  const sql = await readFile("migrations/0001_initial.sql", "utf8");
  for (const statement of sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean))
    await db.prepare(statement).run();
});
after(async () => await runtime?.dispose());
async function call(path, body, cookie, extra = {}) {
  return runtime.dispatchFetch("https://touchgpt.example/api/" + path, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      "CF-Connecting-IP": "192.0.2.1",
      ...extra,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
const makeRecord = (id = "record-1") => ({
  id,
  label: "Cotton",
  type: "texture",
  mode: "relative",
  demo: false,
  createdAt: new Date().toISOString(),
  features: { value: 1656 },
  baseline: { label: "Skin", features: { value: 1200 } },
  percent: 38,
  imu: { samples: 0 },
});
test("actual Workers runtime and D1 support auth, isolation, logout and deletion", async () => {
  const health = await (await call("health")).json();
  assert.equal(health.storage, "d1");
  assert.equal(health.cloudReady, true);
  assert.equal((await call("records")).status, 401);
  const response = await call("register", {
    email: "one@example.com",
    password: "testing-password-12345",
  });
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = response.headers.get("Set-Cookie").split(";")[0];
  assert.match(response.headers.get("Set-Cookie"), /Secure/);
  assert.match(response.headers.get("Set-Cookie"), /HttpOnly/);
  assert.equal(
    (await (await call("session", null, cookie)).json()).user.email,
    "one@example.com",
  );
  const record = makeRecord();
  assert.equal((await call("records", { record }, cookie)).status, 200);
  assert.equal(
    (await (await call("records", null, cookie)).json()).records[0].label,
    "Cotton",
  );
  const second = await call("register", {
    email: "two@example.com",
    password: "testing-password-12345",
  });
  assert.equal(second.status, 200);
  const other = second.headers.get("Set-Cookie").split(";")[0];
  assert.equal(
    (await (await call("records", null, other)).json()).records.length,
    0,
  );
  await call("records/delete", { id: record.id }, other);
  assert.equal(
    (await (await call("records", null, cookie)).json()).records.length,
    1,
  );
  assert.equal(
    (await call("records", { record: { ...record, percent: 101 } }, cookie))
      .status,
    400,
  );
  assert.equal(
    (await call("recognize", { image: "unused" }, cookie)).status,
    503,
  );
  await call("logout", {}, cookie);
  assert.equal((await call("records", null, cookie)).status, 401);
  assert.equal(
    (
      await call("login", {
        email: "one@example.com",
        password: "wrong-password-12345",
      })
    ).status,
    401,
  );
  const login = await call("login", {
    email: "one@example.com",
    password: "testing-password-12345",
  });
  assert.equal(login.status, 200);
  const again = login.headers.get("Set-Cookie").split(";")[0];
  await call("records/delete", { id: record.id }, again);
  assert.equal(
    (await (await call("records", null, again)).json()).records.length,
    0,
  );
  // Seed more than one page directly to verify bounded cloud reads.
  const user = (await login.json()).user;
  for (let i = 0; i < 11; i++) {
    const r = makeRecord("page-" + i);
    await db
      .prepare("INSERT INTO records VALUES(?,?,?,?)")
      .bind(r.id, user.id, JSON.stringify(r), r.createdAt)
      .run();
  }
  const page1 = await (await call("records", null, again)).json();
  assert.equal(page1.records.length, 10);
  assert.equal(page1.nextOffset, 10);
  const page2 = await (await call("records?offset=10", null, again)).json();
  assert.equal(page2.records.length, 1);
  assert.equal(page2.nextOffset, null);
  assert.equal(
    new Set([...page1.records, ...page2.records].map((r) => r.id)).size,
    11,
  );
});
test("Workers rejects cross-origin writes and rate limits across requests", async () => {
  assert.equal(
    (await call("register", {}, null, { Origin: "https://untrusted.example" }))
      .status,
    403,
  );
  for (let i = 0; i < 30; i++)
    assert.equal(
      (await call("session", null, null, { "CF-Connecting-IP": "192.0.2.99" }))
        .status,
      200,
    );
  assert.equal(
    (await call("session", null, null, { "CF-Connecting-IP": "192.0.2.99" }))
      .status,
    429,
  );
});
test("deploying without a D1 binding returns explicit setup status, not SPA HTML", async () => {
  const bare = new Miniflare(convertV4MiniflareOptions(options));
  try {
    const response = await bare.dispatchFetch(
      "https://touchgpt.example/api/records",
    );
    assert.equal(response.status, 503);
    assert.match(response.headers.get("Content-Type"), /application\/json/);
    assert.match((await response.json()).error, /Cloudflare D1/);
    const health = await (
      await bare.dispatchFetch("https://touchgpt.example/api/health")
    ).json();
    assert.equal(health.cloudReady, false);
  } finally {
    await bare.dispose();
  }
});
