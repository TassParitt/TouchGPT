import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
let server, dir;
const base = "http://127.0.0.1:3137/api/";
async function call(route, body, cookie) {
  return fetch(base + route, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "touchgpt-test-"));
  server = spawn(process.execPath, ["server/index.js"], {
    env: { ...process.env, PORT: "3137", DATA_DIR: dir, OPENAI_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    server.stdout.once("data", resolve);
    server.once("error", reject);
    server.once("exit", () => reject(new Error("Server exited early")));
  });
});
after(async () => {
  server?.kill();
  await new Promise((r) => server.once("exit", r));
  await rm(dir, { recursive: true, force: true });
});
test("authenticated records persist, stay private, and can be deleted", async () => {
  assert.equal((await call("records")).status, 401);
  const registration = await call("register", {
    email: "one@example.com",
    password: "test-password-12345",
  });
  assert.equal(registration.status, 200);
  const cookie = registration.headers.get("set-cookie").split(";")[0];
  assert.match(registration.headers.get("set-cookie"), /HttpOnly/);
  const record = {
    id: "test-record",
    label: "Cotton",
    type: "texture",
    mode: "relative",
    demo: false,
    createdAt: new Date().toISOString(),
    features: { value: 1656 },
    baseline: { label: "Skin", features: { value: 1200 } },
    percent: 38,
    imu: { samples: 0 },
  };
  assert.equal((await call("records", { record }, cookie)).status, 200);
  assert.equal(
    (await (await call("records", null, cookie)).json()).records[0].label,
    "Cotton",
  );
  const second = await call("register", {
    email: "two@example.com",
    password: "test-password-67890",
  });
  const cookie2 = second.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (await (await call("records", null, cookie2)).json()).records.length,
    0,
  );
  await call("records/delete", { id: record.id }, cookie2);
  assert.equal(
    (await (await call("records", null, cookie)).json()).records.length,
    1,
  );
  assert.equal(
    (
      await call(
        "records",
        { record: { ...record, percent: Infinity } },
        cookie,
      )
    ).status,
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
        password: "incorrect-password",
      })
    ).status,
    401,
  );
  const login = await call("login", {
    email: "one@example.com",
    password: "test-password-12345",
  });
  const again = login.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (await (await call("records", null, again)).json()).records.length,
    1,
  );
  await call("records/delete", { id: record.id }, again);
  assert.equal(
    (await (await call("records", null, again)).json()).records.length,
    0,
  );
});
test("cross-origin writes and malformed payloads are rejected", async () => {
  const response = await fetch(base + "register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://evil.example",
    },
    body: "{}",
  });
  assert.equal(response.status, 403);
  assert.equal(
    (await call("register", { email: "bad", password: "short" })).status,
    400,
  );
});
