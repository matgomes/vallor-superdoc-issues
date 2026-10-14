# SD-08: timestamps

Video: `SD-08.mp4` (15 s). Times are in the delivered video (pauses while the operator was planning the next action have been shortened).

- **00:00.0** recording started
- **00:02.3** Select Intro through Closing  _(expected: Selection includes deleted paragraph)_
  - result: Full range selected; count 1
- **00:05.4** Press Cmd+B on full range  _(expected: No bold or new tracked change)_
  - result: No bold; count stays 1; no error
- **00:08.4** Double-click Intro control word  _(expected: Only Intro selected)_
  - result: Intro selected
- **00:11.3** Press Cmd+B on Intro  _(expected: Intro bold; Format Font Bold card; count 2)_
  - result: Intro bold; Format Font Bold card; tracked changes 2; no error
- **00:14.5** recording stopped
