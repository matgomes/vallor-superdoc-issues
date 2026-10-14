# SD-06: timestamps

Video: `SD-06.mp4` (19 s). Times are in the delivered video (pauses while the operator was planning the next action have been shortened).

- **00:00.0** recording started
- **00:02.3** Select Intro through Closing  _(expected: Multi-paragraph selection)_
  - result: Intro through Closing selected
- **00:05.4** Right-click deleted text within selection  _(expected: Accept and Reject menu)_
  - result: Accept change and Reject change menu visible
- **00:08.4** Click Accept change  _(expected: No change; count stays 1)_
  - result: Struck paragraph and card stay; tracked changes 1; no error
- **00:10.9** Select same Intro through Closing range again  _(expected: Same multi-paragraph selection)_
  - result: Same selection made
- **00:14.0** Right-click within selection again  _(expected: Reject change available)_
  - result: Reject change menu visible
- **00:16.6** Click Reject change  _(expected: No change; deletion stays)_
  - result: Reject did nothing; paragraph struck; card remains; tracked changes 1; no error
- **00:18.5** recording stopped
