# SoundTouchJS

`soundtouch-processor.js` is the self-contained processor from `@soundtouchjs/audio-worklet` **2.1.1**, by Steve “Cutter” Blades, licensed under MPL-2.0. License reference: [LICENSE](LICENSE).

Upstream source: https://github.com/cutterbl/SoundTouchJS/tree/master/packages/audio-worklet

Downloaded from the npm registry. Archive integrity:

`sha512-itxSW62gbtDKoFo6eEr4PXzVz3oF+wCVREupFi5JiUR31tWWwCizr+2XezYD1SnkrSDfdmZvvviTtoyejYeD0Q==`

VoxStage's modifications add a 120 ms output reserve to prevent render-block gaps, silent input to drain buffered endings, cumulative missing-frame latency in metrics, and an explicit stop message to release processors after pause/seek. The SoundTouch pitch/stretch algorithms are unchanged. The modified source is distributed here.
