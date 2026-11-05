# Task8: mobile search geometry and scroll anchor

2026-11-06 MSK, LETSCUBE stream 8. Product source was measured in an installed,
network-disabled temporary WebView app on physical Realme RMX3830 / API35.
The helper used the real sidebar/header/list and 32 fictional rows, at 360 CSS
px, dark theme, with no Auth or network. DOM scroll/focus controls are not a
claim about trusted gestures, device IME, or the installed Stable UI.

| Measurement | Existing Stable50 source | Patched source |
| --- | ---: | ---: |
| Search row height, open/closed | 44 / 0 px | 44 / 0 px |
| Largest observed height and list-top step, each direction | 44 px | 14 px |
| Intermediate height frames, each direction | 0 | 5 |
| Scroll after collapse/expansion, from 160 px requested | 116 / 160 px | 116 / 160 px |
| List mounted / device helper removed | retained / yes | retained / yes |

Previously only opacity transitioned; the max-height changed in one frame.
Mobile now animates max-height along with opacity using the existing motion
token, clips the moving field with space for its focus outline, and leaves
desktop opacity-only. A first browser candidate exposed accumulated fractional
scroll drift. The resize observer now rounds the two positions before taking
their difference, so the steps sum to the same final displacement. User scroll
ownership, clipped near-top compensation, keyboard focus and reduce-motion
behavior are preserved. A frame gap remained on the device; these two short
samples have different observation windows and do not prove improved FPS.

The new actual-browser test was RED on snap, then RED on anchor drift after the
geometry-only patch, then GREEN. 45 focus/continuity checks passed. At 1440 and
390 in both themes and 100/125% text, the visible opener, field and focus outline
were checked with fictional screenshots. No production data, debug settings or
app updates were used in the device measurement.
