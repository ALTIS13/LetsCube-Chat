const POLL_SECONDS = 60;
const MAX_SAMPLE_AGE_SECONDS = 120;

export function createUptimeCanary() {
  return { phase: "WATCHING", lastSlot: null, pendingAt: null, incidentOpenedAt: null };
}

function validObservation(sample, now) {
  if (sample === null || typeof sample !== "object" || Array.isArray(sample) ||
    Object.keys(sample).length !== 2 || !Object.hasOwn(sample, "observedAt") ||
    !Object.hasOwn(sample, "outcome")) return false;
  const { observedAt, outcome } = sample;
  return Number.isSafeInteger(now) && Number.isSafeInteger(observedAt) &&
    observedAt >= 0 && observedAt <= now && now - observedAt <= MAX_SAMPLE_AGE_SECONDS &&
    (outcome === "PASS" || outcome === "FAIL" || outcome === "UNKNOWN");
}

function notice(kind, incidentOpenedAt) {
  return { monitor: "uptime-canary", kind, incidentOpenedAt };
}

// Accept only a decoded metadata projection and a state from this reducer.
export function observeUptimeCanary(state, sample, now) {
  if (state.phase === "RETIRED" || !validObservation(sample, now)) {
    return { state, notice: null };
  }
  const { observedAt, outcome } = sample;
  const slot = Math.floor(observedAt / POLL_SECONDS);
  if (state.lastSlot !== null && slot <= state.lastSlot) return { state, notice: null };

  const open = state.phase === "OPEN";
  const vote = outcome === (open ? "PASS" : "FAIL");
  const confirmed = vote && state.pendingAt !== null && slot === state.lastSlot + 1 &&
    now - state.pendingAt <= MAX_SAMPLE_AGE_SECONDS;
  if (!confirmed) {
    return {
      state: { ...state, lastSlot: slot, pendingAt: vote ? observedAt : null },
      notice: null,
    };
  }
  return {
    state: {
      phase: open ? "WATCHING" : "OPEN",
      lastSlot: slot,
      pendingAt: null,
      incidentOpenedAt: open ? null : observedAt,
    },
    notice: open ? notice("RECOVERED", state.incidentOpenedAt) : notice("OPENED", observedAt),
  };
}

export function retireUptimeCanary(state) {
  if (state.phase === "RETIRED") return { state, notice: null };
  return {
    state: { ...createUptimeCanary(), phase: "RETIRED" },
    notice: state.phase === "OPEN" ? notice("RETIRED", state.incidentOpenedAt) : null,
  };
}
