/**
 * A new web build, offered where the Windows app keeps its update control
 * (tracker item 42).
 *
 * In a browser the offer is the pill in the notice band (`AppUpdateBanner`,
 * D-264): a tab has no window controls of ours to sit beside. The Windows app
 * draws its own caption, and Discord's desktop client puts its update arrow
 * there, beside minimise, maximise and close — the owner's screenshot of
 * 2026-09-20. So on the desktop `AppUpdateBanner` keeps deciding *when* a build
 * is offered, including the quiet restart and the hourly throttle, and only
 * hands the offer to the caption through this store instead of drawing it.
 */
export type WebUpdateOffer = {
  /** The waiting worker, if there is one, for `restartOntoWaitingBuild`. */
  registration: ServiceWorkerRegistration | null;
};

let offer: WebUpdateOffer | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function offerWebUpdate(registration: ServiceWorkerRegistration | null): void {
  if (offer && offer.registration === registration) return;
  offer = { registration };
  emit();
}

export function withdrawWebUpdate(): void {
  if (!offer) return;
  offer = null;
  emit();
}

export function subscribeWebUpdateOffer(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function currentWebUpdateOffer(): WebUpdateOffer | null {
  return offer;
}
