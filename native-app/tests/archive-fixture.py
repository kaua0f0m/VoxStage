"""Isolated local backend for archive browser tests; never uses the user's data."""
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
with tempfile.TemporaryDirectory(prefix="archive-ui-", dir=ROOT / "native-app/test-results") as temporary:
    root = Path(temporary)
    os.environ["VOXSTAGE_DATA_DIR"] = str(root)
    import server
    server.Handler.log_message = lambda *args: None
    media = root / "music"
    name = str(uuid4()) + ".wav"
    (media / name).write_bytes(b"silent-test-fixture")
    song = {"id": str(uuid4()), "title": "Backup de teste", "artist": "Artista", "source": name,
            "plainLyrics": "Uma frase", "lyricVoices": {"version": 1, "lead": [
                {"id": "v1", "text": "Uma frase", "time": 1000, "end": 2000,
                 "words": [{"index": 0, "word": "Uma", "start": 1, "end": 1.5}]}], "parallel": [], "backing": []}}
    (root / "library.json").write_text(json.dumps([song]), encoding="utf-8")
    host = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    thread = threading.Thread(target=host.serve_forever, daemon=True)
    thread.start()
    print(json.dumps({"origin": f"http://127.0.0.1:{host.server_port}", "dataDir": str(root), "song": song}), flush=True)
    try:
        sys.stdin.read()
    finally:
        host.shutdown()
        host.server_close()
        thread.join()
