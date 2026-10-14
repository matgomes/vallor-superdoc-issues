# SD-105 (a): timestamps

Video: `SD-105-a.mp4` (28 s). Same document with 1,629 tracked insertions (158 grouped changes in the sidebar). The overlay in the top-right corner shows the last frame time, the worst frame in the last 2 s, and the number of frames over 500 ms ("stalls").

- **00:00.0** Document loaded at the top, sidebar showing tracked-change cards, stalls 0
- **00:01.5** Steady mouse-wheel scrolling starts (44 wheel events in total)  _(expected: smooth scrolling)_
  - result: the page stutters and freezes repeatedly; worst frame reaches about 1.5 s
- **00:05.6** stalls 1
- **00:10.6** stalls 3
- **00:15.5** stalls 5
- **00:19.5** End of document reached after 18.1 s of scrolling; stalls 6
- **00:27.6** end
