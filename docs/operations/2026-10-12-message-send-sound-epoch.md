# Message-Sent Cue: Session Epoch

Owner: bounded source author and coordinator. Stage: SOURCE_ACCEPTED; independent
review `e1b0b458` accepts with no actionable findings; web integration pending.
Item83/D-343 remains partial for installed
speaker audibility; this repair concerns a reproduced asynchronous ownership race.

The outgoing cue checked user/chat/topic before and after AudioContext resume,
but not the account epoch. A same-user new session could restore the same IDs
while an old request awaited resume. stopAllCallSounds retires scheduled graphs,
not that unscheduled wait. The actual player then started two old-cue oscillators.

Only playMessageSentSoundFor now captures the epoch and requires it unchanged
in the existing allowed predicate, including after resume. Existing ACK trigger,
settings/DND, capture/visibility checks, tone/volume and100ms coalescing stay intact.
No new audio hook, retry, player, outbox or account transition code is introduced.

The focused test compiles actual useCallSound, callSoundPlayer and sound policy;
only external state and the existing DEV AudioContext port are controlled.
Original RED `fdd554`: two oscillator starts instead of literal zero after
same-user epoch replacement and actual stop-all. Final6/6 GREEN `2d3e82`, zero
skips: retired request, live cue, successor allowance, current DND/disabled
settings,99ms refusal/100ms admission and compiled epoch-guard omission.
Accepted historical sound suites are reused, not replayed.

Hook SHA: `fbfc4a344d728683faf54eb642c65c804702dee363be4502a97747a8f2a07b75`.
Test SHA: `ce0a208ae9353016b1f4a2ac78682a03817b84192fc200aa10ca4a774856bd7b`.
Player/policy remain byte-identical. Fictional scheduling does not prove real
speaker audibility, browser autoplay, native sound or a production Auth transition.
