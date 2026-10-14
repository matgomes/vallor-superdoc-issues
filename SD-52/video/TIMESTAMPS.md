# SD-52: timestamps

Video: `SD-52.mp4` (22 s). Times are in the delivered video (pauses while the operator was planning the next action have been shortened).

- **00:00.0** recording started
- **00:02.3** Show early comment at top for two seconds  _(expected: Comment card and HUD comments 1)_
  - result: Early comment visible; count 1
- **00:03.5** Steadily wheel-scroll to near document end for about 13 seconds  _(expected: Comment card stays available while its anchor is off screen)_
  - result: At bottom page 220; sidebar empty; HUD comments remains 1 (the document still holds the comment)
- **00:17.4** Wheel-scroll back to top  _(expected: Early comment card returns)_
  - result: Early comment card returned at top; HUD comments 1
- **00:22.1** recording stopped
