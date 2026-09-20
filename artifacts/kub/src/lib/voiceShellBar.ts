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
 * bar is exempt, and every other location gets the shell's.
 *
 * ## The exempt set is «wherever `MainLayout` renders», not a list of paths
 *
 * It was the single path `/`, held in a `VOICE_BAR_SELF_MOUNTED` array, and
 * that was right for exactly as long as the messenger answered at one location.
 * Queue item 35 gave a conversation an address, so `MainLayout` now renders at
 * `/chat/<id>` and `/chat/<id>/m/<id>` as well — and for one revision this rule
 * still said «one path», which drew the shell's band over a messenger that
 * already had one. The duplicate the head above refuses, reintroduced by a
 * change somewhere else entirely.
 *
 * The lesson is why this now **asks** `lib/chatRoute.ts` instead of keeping a
 * copy: a list of paths in a second file is a fact about the router that the
 * router does not know it owns, and it goes stale silently the next time the
 * route table moves. There is one answer to «is this the messenger» and it
 * lives where the address rule lives.
 *
 * `chatRoute` imports nothing either, so `node --test` still loads this module
 * directly — the same reason `lib/voiceCallBar.ts` states at its own head. The
 * import is relative for that reason: `@/` is Vite's alias and Node does not
 * resolve it.
 */

// The extension is required: Node's ESM resolver does not guess one, and this
// module is loaded straight from disk by `node --test`. `lib/voiceChannel.ts`
// imports `./voiceElsewhere.ts` the same way and for the same reason.
import { isMessengerRoute } from "./chatRoute.ts";

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
 * authenticated route but the messenger, and the messenger is the chat list
 * and every conversation address. Never a prefix test: `isMessengerRoute` is
 * strict, so `/chatz<uuid>` and `/chat/not-a-uuid` render `NotFound`, mount no
 * bar of their own, and get the shell's.
 */
export function voiceShellBarNeeded(location: string): boolean {
  return !isMessengerRoute(voiceShellBarPath(location));
}
