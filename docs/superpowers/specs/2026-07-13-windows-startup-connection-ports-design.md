# Windows Startup Connection Ports Design

## Problem

The startup rail is positioned with container percentages rather than device bounds. Its right edge therefore enters the solid server chassis, and independent layout calculation during the local-to-production handoff can produce a visible horizontal shift.

## Approved Design

- Keep the computer, center seal, and server in fixed grid columns for every startup stage.
- Add a visible network port to the right edge of the computer and the left edge of the server.
- Bound the left and right rail halves to those ports instead of endpoint-center percentages.
- Animate only the inner rail fill with `transform: scaleX(...)`; do not animate grid, width, margins, inset, or device transforms.
- Use identical markup geometry and CSS constants in the local startup page and injected production overlay.

## Acceptance

- Neither rail intersects the computer or server chassis.
- The rail meets each device only at its connection port.
- Computer, server, seal, and ports keep identical bounding boxes before and after the connected state.
- The two progress halves still converge on the center seal.
- Reduced-motion behavior and the existing startup timing remain unchanged.
