"""Portable library round trips with isolated files, no external services."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from uuid import uuid4
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import library_archive as archive


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="archive-test-", dir=ROOT / "native-app/test-results")
        self.root = Path(self.temp.name)
        self.media = self.root / "music"
        self.media.mkdir()
        self.names = [str(uuid4()) + suffix for suffix in [".wav", ".wav", ".png"]]
        for name, content in zip(self.names, [b"audio-one", b"audio-two", b"image-png"]):
            (self.media / name).write_bytes(content)
        self.song = {"id": str(uuid4()), "title": "Faixa com três vozes", "artist": "Artista", "inst": self.names[0],
                     "lead": self.names[1], "cover": self.names[2], "background": self.names[2], "favorite": True,
                     "lyricVoices": {"version": 1, "lead": [{"id": "line1", "text": "Uma frase", "time": 1000,
                         "end": 2000, "words": [{"word": "Uma", "index": 0, "start": 1, "end": 1.5}]}],
                         "parallel": [{"id": "line2", "text": "Outra", "time": 3000, "end": 4000, "words": [], "breakBefore": True}],
                         "backing": []}, "manualVocalSilences": [{"startMs": 4000, "endMs": 6000}],
                     "profanityCues": [{"lineIndex": 0, "wordIndex": 0, "startMs": 1000, "endMs": 1500}]}
        self.other = {"id": str(uuid4()), "title": "Outra música", "source": self.names[0]}
        self.write_library([self.song, self.other])

    def tearDown(self):
        self.temp.cleanup()

    def write_library(self, rows):
        (self.root / "library.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")

    def exported(self, **kwargs):
        result = archive.export_library(self.root, **kwargs)
        return result, archive.package_path(self.root, result["id"])

    def rewrite_zip(self, path, mutate):
        with zipfile.ZipFile(path) as source:
            files = {name: source.read(name) for name in source.namelist()}
        mutate(files)
        with zipfile.ZipFile(path, "w") as output:
            for name, content in files.items():
                output.writestr(name, content)

    def test_full_round_trip_preserves_all_voices_and_deduplicates_files(self):
        result, path = self.exported()
        self.assertEqual((result["songs"], result["files"]), (2, 3))
        target = self.root / "restored"
        (target / ".archives").mkdir(parents=True)
        shutil.copyfile(path, archive.package_path(target, result["id"]))
        restored = archive.import_package(target, result["id"])
        self.assertEqual(restored["added"], 2)
        songs = archive.read_library(target)
        first = songs[0]
        self.assertEqual(first["lyricVoices"], self.song["lyricVoices"])
        self.assertEqual(first["manualVocalSilences"], self.song["manualVocalSilences"])
        self.assertEqual(first["profanityCues"], self.song["profanityCues"])
        self.assertEqual(first["inst"], songs[1]["source"])
        self.assertEqual(first["cover"], first["background"])
        for key in archive.MEDIA_FIELDS:
            if self.song.get(key):
                self.assertNotEqual(first[key], self.song[key])
                self.assertEqual((target / "music" / first[key]).read_bytes(), (self.media / self.song[key]).read_bytes())

    def test_preferences_exclude_api_keys_pairings_and_microphone_ids(self):
        settings = {"voxstage-language": "pt-BR", "voxstage-pc-sync-link": "PRIVATE-PAIRING",
                    "voxstage-processing-settings": json.dumps({"voice2Color": "#45b5ff", "apiToken": "PRIVATE-TOKEN"}),
                    "voxstage-score-settings": json.dumps({"device": "PRIVATE-MIC", "noiseDb": -55}),
                    "voxstage-score-history": "[]"}
        _, path = self.exported(settings=settings)
        with zipfile.ZipFile(path) as package:
            raw = package.read("manifest.json").decode()
        self.assertNotIn("PRIVATE-", raw)
        self.assertEqual(json.loads(json.loads(raw)["preferences"]["voxstage-score-settings"]), {"noiseDb": -55})
        single, path = self.exported(song_id=self.song["id"], settings=settings)
        self.assertEqual(single["songs"], 1)
        self.assertEqual(archive.read_manifest(path)["preferences"], {})

    def test_skip_existing_never_changes_metadata_or_duplicates_media(self):
        result, _ = self.exported()
        before = archive.read_library(self.root)
        summary = archive.inspect_package(self.root, result["id"])
        self.assertEqual((summary["new"], summary["existing"]), (0, 2))
        imported = archive.import_package(self.root, result["id"])
        self.assertEqual((imported["added"], imported["updated"], imported["skipped"]), (0, 0, 2))
        self.assertEqual(archive.read_library(self.root), before)
        self.assertEqual(set(path.name for path in self.media.iterdir()), set(self.names))

    def test_update_changes_only_selected_song_and_keeps_other_songs(self):
        result, _ = self.exported(song_id=self.song["id"])
        self.write_library([{**self.song, "title": "Alteração local"}, self.other])
        imported = archive.import_package(self.root, result["id"], replace_existing=True)
        self.assertEqual(imported["updated"], 1)
        rows = archive.read_library(self.root)
        self.assertEqual(next(row for row in rows if row["id"] == self.other["id"]), self.other)
        self.assertEqual(next(row for row in rows if row["id"] == self.song["id"])["title"], self.song["title"])

    def test_corrupt_media_rolls_back_all_files_and_library(self):
        result, path = self.exported()
        self.rewrite_zip(path, lambda files: files.__setitem__("media/" + self.names[1], b"corrupted"))
        before = (self.root / "library.json").read_bytes()
        with self.assertRaisesRegex(ValueError, "corrompido"):
            archive.import_package(self.root, result["id"], replace_existing=True)
        self.assertEqual((self.root / "library.json").read_bytes(), before)
        self.assertEqual(set(path.name for path in self.media.iterdir()), set(self.names))

    def test_failure_committing_library_rolls_back_new_media(self):
        result, _ = self.exported()
        before = (self.root / "library.json").read_bytes()
        with patch.object(archive.os, "replace", side_effect=OSError("disk failure")):
            with self.assertRaises(OSError):
                archive.import_package(self.root, result["id"], replace_existing=True)
        self.assertEqual((self.root / "library.json").read_bytes(), before)
        self.assertEqual(set(path.name for path in self.media.iterdir()), set(self.names))

    def test_inspection_and_missing_files_do_not_change_library(self):
        result, path = self.exported()
        before = (self.root / "library.json").read_bytes()
        archive.inspect_package(self.root, result["id"])
        self.assertEqual((self.root / "library.json").read_bytes(), before)
        self.rewrite_zip(path, lambda files: files.pop("media/" + self.names[0]))
        with self.assertRaises(ValueError):
            archive.inspect_package(self.root, result["id"])
        self.assertEqual((self.root / "library.json").read_bytes(), before)

    def test_rejects_path_traversal_unrecognized_entries_and_invalid_names(self):
        for name in ["../escape.wav", "/absolute.wav", "media/nested.wav", {"invalid": True}]:
            result, path = self.exported()
            def corrupt(files):
                manifest = json.loads(files["manifest.json"])
                manifest["files"][0]["name"] = name
                files["manifest.json"] = json.dumps(manifest).encode()
            self.rewrite_zip(path, corrupt)
            with self.assertRaises(ValueError):
                archive.inspect_package(self.root, result["id"])
        result, path = self.exported()
        self.rewrite_zip(path, lambda files: files.__setitem__("../escape.txt", b"x"))
        with self.assertRaises(ValueError):
            archive.import_package(self.root, result["id"], True)
        self.assertFalse((self.root / "escape.txt").exists())

    def test_export_missing_media_fails_without_leaving_a_partial_package(self):
        (self.media / self.names[0]).unlink()
        with self.assertRaisesRegex(ValueError, "Arquivo não encontrado"):
            self.exported()
        self.assertEqual(list((self.root / ".archives").glob("*.zip")), [])

    def test_android_bridge_uses_the_same_format(self):
        request = {"dataDir": str(self.root), "songId": self.song["id"]}
        result = json.loads(archive.bridge_json("export", json.dumps(request)))
        self.assertNotIn("error", result)
        name = str(uuid4()) + ".zip"
        shutil.copyfile(archive.package_path(self.root, result["id"]), self.media / name)
        inspected = json.loads(archive.bridge_json("inspect", json.dumps({"dataDir": str(self.root), "name": name})))
        self.assertEqual(inspected["songs"], 1)
        self.assertFalse((self.media / name).exists())
        imported = json.loads(archive.bridge_json("import", json.dumps({"dataDir": str(self.root), "id": inspected["id"], "replaceExisting": True})))
        self.assertEqual(imported["updated"], 1)

    def test_http_export_download_inspect_import_and_lan_rejection(self):
        with patch.dict(os.environ, {"VOXSTAGE_DATA_DIR": str(self.root)}):
            spec = importlib.util.spec_from_file_location("archive_test_server", ROOT / "server.py")
            server = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(server)
        host = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        thread = threading.Thread(target=host.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{host.server_port}"
        def post(path, data):
            with urlopen(Request(base + path, data=json.dumps(data).encode(), headers={"Content-Type": "application/json"})) as response:
                return json.load(response)
        try:
            result = post("/api/archives/export", {"songId": self.song["id"]})
            with urlopen(base + result["downloadUrl"]) as response:
                raw = response.read()
                self.assertEqual(response.headers["Content-Type"], "application/zip")
            with urlopen(Request(base + "/api/archives/inspect", data=raw, headers={"Content-Type": "application/zip"})) as response:
                inspected = json.load(response)
            imported = post("/api/archives/import", {"id": inspected["id"], "replaceExisting": True})
            self.assertEqual(imported["updated"], 1)
            with patch.object(server.Handler, "_is_loopback", return_value=False):
                with self.assertRaises(HTTPError) as caught:
                    post("/api/archives/export", {})
                self.assertEqual(caught.exception.code, 403)
            with self.assertRaises(HTTPError) as caught:
                urlopen(Request(base + "/api/archives/inspect", data=b"not a zip", headers={"Content-Type": "application/zip"}))
            self.assertEqual(caught.exception.code, 400)
        finally:
            host.shutdown()
            host.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
