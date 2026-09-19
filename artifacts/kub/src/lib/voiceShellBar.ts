/**
 * Whether the shell has to carry the call bar itself, at this location.
 *
 * ## The defect this exists for
 *
 * `VoiceCallBar` was built so a running call is reachable from anywhere in the
 * application, and within the messenger it is: `Sidebar` docks it at the foot
 * of the chat list on a computer, `MainLayout` draws it as a band across the
 * top of a phone. Both of those mounts are inside `MainLayout`, and
 * `MainLayout` is mounted at exactly one route — `<Route path="/">`.
 *
 * So «anywhere» meant «anywhere in the messenger». Measured on 2026-09-19 by
 * reading the route table in `App.tsx`: `/tasks`, `/bots`, `/admin`,
 * `/admin/:rest*` and the not-found route render their own full-height pages
 * and mount no bar at all. A call survives the navigation — `useVoiceCall`
 * holds it as module state — so the microphone stays open with nothing on
 * screen saying so, which is the exact state `lib/voiceCallBar.ts` was written
 * to prevent, one level up.
 *
 * It is worst on a phone, where «Задачи» is a tab of `BottomNav`: one tap
 * during a call and the call leaves the screen.
 *
 * ## Why a rule rather than «always mount it»
 *
 * The shell cannot simply draw a bar of its own on every route, because on `/`
 * there is already one — two, in fact, of which CSS shows one — and a third
 * band above the panes would be the duplicate this product refuses, drawn at
 * the same moment as the other two.
 *
 * Nor is the answer to move the bar out of `MainLayout` and let the shell own
 * it everywhere. The column's foot is Discord's position and it costs the
 * conversation nothing; a band above the panes would push the whole messenger
 * down to say what the column already says in place.
 *
 * So the rule is narrow and stated once: a location whose own layout mounts the
 * bar is exempt, and every other location gets the shell's. Adding a future
 * page that docks a bar of its own is one entry in `VOICE_BAR_SELF_MOUNTED`.
 *
 * This module imports nothing, so `node --test` can load it — the same reason
 * `lib/voiceCallBar.ts` states at its own head.
 */

/**
 * Locations whose own layout already mounts `VoiceCallBar`.
 *
 * Exactly one today: `/` is `MainLayout`, which mounts it twice — the column's
 * foot through `Sidebar` and the phone's top band — with CSS choosing between
 * them. Matched whole, never by prefix: `/tasks` is not a sub-page of the
 * messenger, it is a different route with a layout of its own, and a prefix
 * test against `/` matches every path there is.
 */
export const VOICE_BAR_SELF_MOUNTED: readonly string[] = ["/"];

/**
 * The path part of a location, as the exempt list spells paths.
 *
 * wouter hands `useLocation` a path with no search and no hash, so both of
 * these are defensive rather than observed — but a bar that disappeared
 * because somebody linked to `/?task=1` would be a defect found by a person
 * rather than by this file, and the cost of not having to think about it again
 * is three lines.
 *
 * An empty location is `/`: that is what a router answers before it has
 * resolved, and treating it as «some other page» would flash a band above the
 * messenger on the first frame of every load during a call.
 */
export function voiceShellBarPath(location: string): string {
  let path = location;
  const hash = path.indexOf("#");
  if (hash !== -1) path = path.slice(0, hash);
  const query = path.indexOf("?");
  if (query !== -1) path = path.slice(0, query);
  return path === "" ? "/" : path;
}

/**
 * Whether the application shell must draw the call bar at this location.
 *
 * True everywhere the page does not draw one for itself — which is every
 * authenticated route but the messenger.
 */
export function voiceShellBarNeeded(location: string): boolean {
  return !VOICE_BAR_SELF_MOUNTED.includes(voiceShellBarPath(location));
}
