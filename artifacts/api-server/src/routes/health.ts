import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import {
  getRegistrationCleanupWorkerStatus,
  registrationCleanupHealthPayload,
} from "../workers/registrationCleanupWorker";
import { createRegistrationCleanupHealthHandler } from "./registrationCleanupHealthRoute";

const router: IRouter = Router();
const registrationCleanupHealthHandler = createRegistrationCleanupHealthHandler({
  getStatus: getRegistrationCleanupWorkerStatus,
  project: registrationCleanupHealthPayload,
});

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/healthz/registration-cleanup", registrationCleanupHealthHandler);

export default router;
