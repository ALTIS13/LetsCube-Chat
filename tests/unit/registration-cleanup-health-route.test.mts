import assert from "node:assert/strict";
import test from "node:test";

const healthModule = await import(
  "../../artifacts/api-server/src/routes/registrationCleanupHealthRoute.ts"
).catch(() => ({}));

type ResponseDouble = {
  statusCode: number;
  body: unknown;
  status(code: number): ResponseDouble;
  json(payload: unknown): ResponseDouble;
  end(): ResponseDouble;
};

function responseDouble(): ResponseDouble {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

function handler() {
  const candidate = (
    healthModule as unknown as Record<string, unknown>
  ).createRegistrationCleanupHealthHandler;
  assert.equal(typeof candidate, "function");
  const createHandler = candidate as (dependencies: {
    getStatus(): unknown;
    project(status: unknown): unknown;
  }) => (
    request: { socket: { remoteAddress?: string }; headers: Record<string, string> },
    response: ResponseDouble,
  ) => void;
  return createHandler({
    getStatus: () => ({ configured: true }),
    project: (status) => status,
  });
}

test("registration cleanup health route permits loopback socket variants", () => {
  for (const remoteAddress of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    const response = responseDouble();

    handler()({ socket: { remoteAddress }, headers: {} }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(typeof response.body, "object");
  }
});

test("registration cleanup health route rejects non-loopback sockets despite proxy headers", () => {
  const response = responseDouble();

  handler()(
    {
      socket: { remoteAddress: "203.0.113.9" },
      headers: { "x-forwarded-for": "127.0.0.1" },
    },
    response,
  );

  assert.equal(response.statusCode, 404);
  assert.equal(response.body, undefined);
});
