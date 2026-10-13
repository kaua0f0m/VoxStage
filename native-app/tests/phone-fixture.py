"""Real local HTTP relay with caller-owned temporary test data."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import server

class QuietHandler(server.Handler):
    def log_message(self, *args):
        pass

server.REMOTE_TOKEN = 'rc-test-peer-token-12345678901234567890'
host = server.ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
print(host.server_port, flush=True)
host.serve_forever()
