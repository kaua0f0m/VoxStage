# Third-party notices

## Nunito

The VoxStage wordmark uses Nunito, bundled locally under the SIL Open Font License
1.1. Font and license: `fonts/Nunito-Variable.ttf`, `fonts/OFL-Nunito.txt`.
Source: https://github.com/google/fonts/tree/main/ofl/nunito

## Windows portable runtime

The Windows portable release bundles CPython 3.13 (its `LICENSE.txt` is included),
yt-dlp and its installed dependencies (their distribution notices are retained),
Node.js (`licenses/Node.txt`) and FFmpeg (`licenses/FFmpeg.txt`).
FFmpeg is the imageio-ffmpeg v7.1 Windows binary already used by the project.
Its upstream build and source references are available from
[imageio-ffmpeg](https://github.com/imageio/imageio-ffmpeg) and
[FFmpeg](https://ffmpeg.org/download.html).

## SoundTouchJS

Real-time tempo and pitch use the AudioWorklet processor from [`@soundtouchjs/audio-worklet` 2.1.1](https://github.com/cutterbl/SoundTouchJS), copyright Steve “Cutter” Blades, distributed under MPL-2.0. The modified source, license and archive integrity are included in `audio/vendor`. VoxStage adds output buffering, tail drainage, delay metrics and processor shutdown; the pitch/stretch algorithms are unchanged.

## Audio Separator

Optional local separation is powered by [`python-audio-separator`](https://github.com/nomadkaraoke/python-audio-separator), distributed under the MIT License. Its project documentation requests that applications integrating UVR models credit UVR and its developers.

## UVR model

VoxStage downloads `UVR-MDX-NET-Inst_HQ_3.onnx` on demand from the model source used by Audio Separator. The model is not bundled with VoxStage. Review the upstream model and project terms before redistributing model files or publishing a packaged release.

## Android yt-dlp integration

The Android app uses [`yt-dlp-android`](https://github.com/ffmpegkit-maintained/yt-dlp-android), distributed under the MIT License. Its Android archive bundles CPython and yt-dlp; their respective licenses and notices are included by the upstream package. YouTube extraction behavior depends on upstream yt-dlp and may change as YouTube changes its service.
