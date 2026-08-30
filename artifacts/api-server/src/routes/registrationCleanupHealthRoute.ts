type CleanupHealthRequest = {
  socket: { remoteAddress?: string };
};

type CleanupHealthResponse = {
  status(code: number): { end(): unknown };
  json(payload: unknown): unknown;
};

type CleanupHealthDependencies = {
  getStatus(): unknown;
  project(status: unknown): unknown;
};

export function isLoopbackSocketRemoteAddress(
  remoteAddress: string | undefined,
): boolean {
  return (
    remoteAddress === "127.0.0.1" ||
    remoteAddress === "::1" ||
    remoteAddress === "::ffff:127.0.0.1"
  );
}

export function createRegistrationCleanupHealthHandler(
  dependencies: CleanupHealthDependencies,
): (request: CleanupHealthRequest, response: CleanupHealthResponse) => void {
  return (request, response) => {
    if (!isLoopbackSocketRemoteAddress(request.socket.remoteAddress)) {
      response.status(404).end();
      return;
    }

    response.json(dependencies.project(dependencies.getStatus()));
  };
}
