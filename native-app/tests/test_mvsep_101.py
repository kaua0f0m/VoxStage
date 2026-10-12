"""MVSEP regression tests with isolated storage and fake service responses."""
import importlib.util
import io
import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
storage = tempfile.TemporaryDirectory(prefix="voxstage-test-", dir=ROOT / 'native-app/tests')
assert Path(storage.name).resolve().is_relative_to(ROOT / 'native-app/tests')
tempfile.tempdir = storage.name
os.environ["VOXSTAGE_DATA_DIR"] = storage.name
spec = importlib.util.spec_from_file_location("voxstage_server", ROOT / "server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

class Response(io.BytesIO):
    headers = {"Content-Length": "4"}

class MvsepTests(unittest.TestCase):
    def setUp(self):
        self.song_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        self.source = f"{self.song_id}.wav"
        self.song = {"id":self.song_id,"title":"Uma faixa","artist":"Artista","source":self.source,"separationStatus":"pending","favorite":True}
        server.LIBRARY.write_text(json.dumps([self.song]), encoding="utf-8")
        (server.MEDIA / self.source).write_bytes(b"wave")
        server.youtube_jobs.clear()

    def test_saved_source_upload_once_and_retry_status(self):
        server.youtube_jobs["job"] = {"stage":"starting"}
        calls = []
        def upload(path, fields, callback):
            calls.append(path)
            self.assertEqual(path, server.MEDIA / self.source)
            return {"hash":"existing-mvsep-job"}
        statuses = [URLError("network lost"), {"status":"done","data":{"files":[{"label":"Instrumental","url":"https://mvsep.com/instrumental.wav"},{"label":"Vocals","url":"https://mvsep.com/vocals.wav"}]}}]
        with patch.object(server,"get_mvsep_token",return_value="test-api-token"), patch.object(server,"mvsep_multipart_upload",side_effect=upload), patch.object(server,"mvsep_job_status",side_effect=statuses), patch.object(server,"mvsep_urlopen",side_effect=lambda *args,**kw:Response(b"stem")), patch.object(server.time,"sleep"):
            server.youtube_mvsep_worker("job","",12,{},self.song_id)
        self.assertEqual(len(calls),1)
        self.assertEqual(server.youtube_jobs["job"]["stage"],"done")
        self.assertEqual(len(server.youtube_jobs["job"]["files"]),2)
        self.assertTrue((server.MEDIA / self.source).is_file())
        self.assertEqual(json.loads(server.LIBRARY.read_text(encoding="utf-8"))[0],self.song)

    def test_error_does_not_expose_key(self):
        key="test-api-token-secret"
        error=URLError(f"error sending request (https://mvsep.com/api?api_token={key}&hash=123)")
        self.assertNotIn(key,server.safe_mvsep_error(error,key))
        self.assertNotIn(key,server.safe_mvsep_error(error))
        server.youtube_jobs["job"]={"stage":"starting"}
        with patch.object(server,"get_mvsep_token",return_value=key), patch.object(server,"mvsep_multipart_upload",side_effect=error):
            server.youtube_mvsep_worker("job","",12,{},self.song_id)
        self.assertEqual(server.youtube_jobs["job"]["stage"],"error")
        self.assertNotIn(key,server.youtube_jobs["job"]["message"])
        self.assertTrue((server.MEDIA / self.source).is_file())

    def test_remote_requests_queue_saved_and_transferred_songs(self):
        server.remote_commands.clear()
        server.remote_requests.clear()
        server.remote_transfers.clear()
        host = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        runner = threading.Thread(target=host.serve_forever, daemon=True)
        runner.start()
        base = f"http://127.0.0.1:{host.server_port}"
        def call(path, body, method="POST", **headers):
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
            request = Request(base + path, data=data, method=method, headers={
                "Content-Type":"application/json", "Authorization":f"Bearer {server.REMOTE_TOKEN}", **headers})
            with urlopen(request) as response:
                return json.load(response)
        try:
            saved = call("/api/remote/request", {"songId":self.song_id})
            self.assertEqual(saved["status"], "approved")
            self.assertEqual(server.remote_commands[-1]["action"], "queue")
            by_title = call("/api/remote/request", {"title":"UMA FAIXA", "artist":"Artista"})
            self.assertEqual(by_title["status"], "approved")
            self.assertEqual(by_title["songId"], self.song_id)
            unknown = call("/api/remote/request", {"title":"Ainda não existe"})
            self.assertEqual(unknown["status"], "pending")
            song_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
            name = song_id + ".wav"
            transferred = {"id":song_id,"title":"Do celular","source":name,"favorite":True}
            item = call("/api/remote/transfers", {"song":transferred})
            call(f"/api/remote/transfers/{item['id']}/media/{name}", b"wave", "PUT", **{"X-Offset":"0", "X-Total":"4"})
            result = call(f"/api/remote/transfers/{item['id']}/ready", {})
            self.assertEqual(result["status"], "approved")
            song = next(song for song in server.read_library() if song["id"] == song_id)
            self.assertTrue(song["favorite"])
            self.assertEqual((server.MEDIA / song["source"]).read_bytes(), b"wave")
            self.assertTrue(any(command["action"] == "library-changed" for command in server.remote_commands))
            queued = call("/api/remote/request", {"songId":song_id})
            self.assertEqual(queued["status"], "approved")
            self.assertEqual(server.remote_commands[-1]["songId"], song_id)
        finally:
            host.shutdown(); host.server_close(); runner.join()

    def test_saved_song_endpoint_validates_source_and_reuses_active_job(self):
        host=server.ThreadingHTTPServer(("127.0.0.1",0),server.Handler)
        runner=threading.Thread(target=host.serve_forever,daemon=True);runner.start()
        try:
            address=f"http://127.0.0.1:{host.server_port}/api/mvsep/separations"
            server.youtube_jobs["job-id"]={"songId":self.song_id,"stage":"processing"}
            with patch.object(server,"get_mvsep_token",return_value="test-token-12345"), patch.object(server,"validated_mvsep_options",return_value=({"id":12,"name":"Karaoke"},{})):
                request=Request(address,data=json.dumps({"songId":self.song_id}).encode(),headers={"Content-Type":"application/json"})
                with urlopen(request) as response:
                    result=json.load(response)
                    self.assertEqual(response.status,202)
                    self.assertEqual(result["id"],"job-id")
            self.assertEqual(len(server.youtube_jobs),1)
        finally:
            host.shutdown();host.server_close();runner.join()

if __name__ == "__main__":
    try: unittest.main()
    finally: storage.cleanup()
