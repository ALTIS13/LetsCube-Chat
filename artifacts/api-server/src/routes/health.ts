import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import {
  getRegistrationCleanupWorkerStatus,
  registrationCleanupHealthPayload,
} from "../workers/registrationCleanupWorker";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/healthz/registration-cleanup", (_req, res) => {
  res.json(registrationCleanupHealthPayload(getRegistrationCleanupWorkerStatus()));
});

export default router;
