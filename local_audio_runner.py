"""Small isolated entry point for VoxStage's optional local audio separator."""

from __future__ import annotations

import logging
import sys
import traceback
from pathlib import Path


MODEL_FILENAME = "UVR-MDX-NET-Inst_HQ_3.onnx"


def main() -> int:
    if len(sys.argv) != 5:
        print("VOXSTAGE:ERROR Uso interno inválido do separador local.", flush=True)
        return 2

    input_path, output_dir, model_dir = map(Path, sys.argv[1:4])
    backend = sys.argv[4]
    if backend not in {"cpu", "directml"}:
        print("VOXSTAGE:ERROR Mecanismo local inválido.", flush=True)
        return 2

    try:
        from audio_separator.separator import Separator

        output_dir.mkdir(parents=True, exist_ok=True)
        model_dir.mkdir(parents=True, exist_ok=True)
        print("VOXSTAGE:MODEL Carregando o modelo MDX de duas faixas…", flush=True)
        separator = Separator(
            log_level=logging.INFO,
            model_file_dir=str(model_dir),
            output_dir=str(output_dir),
            output_format="WAV",
            use_directml=backend == "directml",
            mdx_params={"hop_length": 1024, "segment_size": 256, "overlap": 0.25, "batch_size": 1, "enable_denoise": False},
        )
        separator.load_model(model_filename=MODEL_FILENAME)
        print("VOXSTAGE:SEPARATE Separando vocal e instrumental…", flush=True)
        outputs = separator.separate(
            str(input_path),
            {"Vocals": "voxstage-vocals", "Instrumental": "voxstage-instrumental"},
        )
        output_paths = {Path(name).name.casefold() for name in outputs}
        expected = {"voxstage-vocals.wav", "voxstage-instrumental.wav"}
        if not expected.issubset(output_paths):
            raise RuntimeError("O modelo não gerou os arquivos de vocal e instrumental esperados.")
        return 0
    except Exception as error:
        print(f"VOXSTAGE:ERROR {str(error)[:220] or error.__class__.__name__}", flush=True)
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
