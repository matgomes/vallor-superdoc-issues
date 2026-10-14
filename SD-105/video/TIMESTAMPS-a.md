# SD-105 (a): timestamps

Video: `SD-105-a.mp4` (55 s). Document with 1,629 tracked insertions (158 changes in the sidebar). SuperDoc 2.23.0, Chrome, MacBook M4. Idle pauses between actions are shortened; the scrolls are uncut.

The overlay in the top-right corner shows the last frame time, the worst frame in the last 2 s, and the number of frames over 500 ms ("stalls"). The "Scroll to end" / "Scroll to top" buttons scroll the whole document in 60 steps as fast as the page can draw, then print how long it took.

- **00:01.6** Click **Scroll to end**
  - result: the page stutters and freezes; it takes **12.2 s**, stalls 0 → 7, single frames over 1 s
- **00:21.8** Scroll up one screen with the mouse wheel to the schedule table at the end (green = tracked insertions)
- **00:27.3** Click inside the tracked placeholder "{{Subprocessor Responsibility Allocation}}"
  - result: the caret lands in the redline; no extra freeze on this click
- **00:30.4** Click **Scroll to top**
  - result: **14.5 s**, stalls 7 → 14
- **00:54.9** end
