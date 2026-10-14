# SD-47: timestamps

Video: `SD-47.mp4` (9 s). Times are in the delivered video (pauses while the operator was planning the next action have been shortened).

- **00:00.0** recording started
- **00:02.3** Click nested tracked insertion inside commented range  _(expected: Comment card activates instead of tracked-change card)_
  - result: Nested comment card expanded and active; tracked-change card inactive
- **00:05.2** Click standalone tracked insertion outside comment  _(expected: Tracked-change card activates normally)_
  - result: Standalone tracked-change Added card expanded normally
- **00:09.2** recording stopped
