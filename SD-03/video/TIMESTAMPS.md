# SD-03: timestamps

Video: `SD-03.mp4` (25 s). Times are in the delivered video (pauses while the operator was planning the next action have been shortened).

- **00:00.0** recording started
- **00:02.8** Click Accept all  _(expected: Refusal INVALID_INPUT; changes stay 3)_
  - result: success false; INVALID_INPUT; tracked changes 3; last error none
- **00:07.0** Hold refusal for three seconds  _(expected: Refusal text and unchanged document visible)_
  - result: Refusal held
- **00:07.8** Open Deleted paragraph break card  _(expected: Accept check visible)_
  - result: Paragraph-break card active
- **00:10.7** Accept paragraph-break deletion  _(expected: Tracked changes 3 to 1)_
  - result: Paragraph-break card removed; remaining text deletion card
- **00:14.7** Open remaining text deletion card  _(expected: Accept check visible)_
  - result: Remaining card active; tracked changes 1
- **00:17.7** Accept remaining deletion  _(expected: Clean document; tracked changes 0)_
  - result: Document clean; tracked changes 0; last error none
- **00:24.7** recording stopped
