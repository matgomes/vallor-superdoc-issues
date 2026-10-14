# SD-09: timestamps

Video: `SD-09.mp4` (17 s). Times are in the delivered video (pauses while the operator was planning the next action have been shortened).

- **00:00.0** recording started
- **00:02.3** Drag from 900 per month through Net 45  _(expected: Cross-cell selection)_
  - result: Cross-cell range selected
- **00:05.4** Press Backspace  _(expected: Edit rejected with count 0)_
- **00:06.8** Pause two seconds  _(expected: Rejection overlay appears)_
  - result: No deletion; tracked changes 0; edit-rejected
- **00:08.3** Select only Net 45  _(expected: Single-cell selection)_
  - result: Net 45 selected
- **00:10.8** Press Backspace on single-cell selection  _(expected: Red deletion and tracked changes 1)_
  - result: Net 45 red strike-through; tracked changes 1
- **00:15.7** recording stopped
