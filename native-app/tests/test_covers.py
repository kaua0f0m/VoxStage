"""Artwork search recovery with isolated storage and no external requests."""
import importlib.util, io, json, os, sys, tempfile, threading, unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
storage=tempfile.TemporaryDirectory(prefix='voxstage-test-covers-',dir=ROOT/'native-app/tests')
os.environ['VOXSTAGE_DATA_DIR']=storage.name
spec=importlib.util.spec_from_file_location('cover_server',ROOT/'server.py')
server=importlib.util.module_from_spec(spec);spec.loader.exec_module(server)
TRACK={'collectionName':'Legião Urbana','artworkUrl100':'https://is1-ssl.mzstatic.com/image/100x100bb.jpg','collectionId':1,'artistName':'Legião Urbana','trackName':'Será'}
def response(data=None):return io.BytesIO(json.dumps({'results':[TRACK]} if data is None else data).encode())

class CoverTests(unittest.TestCase):
    def setUp(self):
        server.cover_search_cache.clear();server.cover_search_next_request=0;server.cover_search_blocked_until=0
        self.sleep=patch.object(server.time,'sleep');self.sleep.start()
    def tearDown(self):self.sleep.stop()

    def test_lost_connection_recovers_once_and_catalog_is_cached(self):
        with patch.object(server,'urlopen',side_effect=[URLError('connection reset'),response()]) as upstream:
            result=server.search_covers('Será Legião Urbana')
            self.assertEqual(result[0]['artist'],'Legião Urbana')
            self.assertIn('/1200x1200bb.jpg',result[0]['imageUrl'])
            result[0]['title']='edited'
            self.assertEqual(server.search_covers('SERÁ  LEGIÃO URBANA')[0]['title'],'Legião Urbana')
            self.assertEqual(upstream.call_count,2)

    def test_same_search_in_parallel_reaches_provider_once(self):
        entered=threading.Event();finish=threading.Event();results=[]
        def fetch(*args,**kwargs):entered.set();self.assertTrue(finish.wait(3));return response()
        with patch.object(server,'urlopen',side_effect=fetch) as upstream:
            threads=[threading.Thread(target=lambda:results.append(server.search_covers('Será'))) for _ in range(3)]
            threads[0].start();self.assertTrue(entered.wait(3))
            for thread in threads[1:]:thread.start()
            finish.set()
            for thread in threads:thread.join(3);self.assertFalse(thread.is_alive())
            self.assertEqual(upstream.call_count,1);self.assertEqual(len(results),3)

    def test_503_and_429_honor_wait_and_recover_afterwards(self):
        for status in (503,429):
            self.setUpState()
            error=HTTPError('https://itunes.apple.com/search',status,'unavailable',{'Retry-After':'45'},None)
            with patch.object(server.time,'monotonic',return_value=100),patch.object(server,'urlopen',side_effect=error) as upstream:
                with self.assertRaises(server.CoverSearchUnavailable) as caught:server.search_covers('Será')
                self.assertEqual(caught.exception.retry_after,45)
                with self.assertRaises(server.CoverSearchUnavailable) as caught:server.search_covers('Another song')
                self.assertEqual(caught.exception.retry_after,45)
                self.assertEqual(upstream.call_count,1)
            with patch.object(server.time,'monotonic',return_value=146),patch.object(server,'urlopen',return_value=response()) as upstream:
                self.assertEqual(len(server.search_covers('Será')),1);self.assertEqual(upstream.call_count,1)

    def setUpState(self):
        server.cover_search_cache.clear();server.cover_search_next_request=0;server.cover_search_blocked_until=0

    def test_permanent_connection_failure_is_bounded_not_cached_as_empty(self):
        with patch.object(server,'urlopen',side_effect=URLError('reset')) as upstream:
            with self.assertRaisesRegex(server.CoverSearchUnavailable,'conexão'):server.search_covers('Será')
            self.assertEqual(upstream.call_count,2)
            with self.assertRaises(server.CoverSearchUnavailable):server.search_covers('Será')
            self.assertEqual(upstream.call_count,2)
        self.assertFalse(server.cover_search_cache)

    def test_invalid_response_recovers_and_empty_results_expire(self):
        with patch.object(server,'urlopen',side_effect=[io.BytesIO(b'not json'),response()]) as upstream:
            self.assertEqual(len(server.search_covers('Será')),1);self.assertEqual(upstream.call_count,2)
        with patch.object(server.time,'monotonic',return_value=100),patch.object(server,'urlopen',return_value=response({'results':[]})) as upstream:
            self.assertEqual(server.search_covers('empty'),[]);self.assertEqual(server.search_covers('empty'),[])
            self.assertEqual(upstream.call_count,1)
        with patch.object(server.time,'monotonic',return_value=161),patch.object(server,'urlopen',return_value=response()) as upstream:
            self.assertEqual(len(server.search_covers('empty')),1);self.assertEqual(upstream.call_count,1)

    def test_retry_after_date_and_cached_result_during_service_outage(self):
        with patch.object(server.time,'time',return_value=0):
            self.assertEqual(server.cover_retry_after({'Retry-After':'Thu, 01 Jan 1970 00:03:00 GMT'}),180)
        self.assertEqual(server.cover_retry_after({'Retry-After':'invalid'}),30)
        with patch.object(server,'urlopen',return_value=response()):server.search_covers('saved')
        server.cover_search_blocked_until=server.time.monotonic()+30
        with patch.object(server,'urlopen') as upstream:
            self.assertEqual(len(server.search_covers('saved')),1);upstream.assert_not_called()

    def test_http_route_returns_structured_wait_and_remains_available(self):
        host=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        runner=threading.Thread(target=host.serve_forever,daemon=True);runner.start()
        try:
            error=HTTPError('https://itunes.apple.com/search',503,'unavailable',{'Retry-After':'45'},None)
            with patch.object(server,'urlopen',side_effect=error) as upstream:
                for _ in range(2):
                    request=Request(f'http://127.0.0.1:{host.server_port}/api/covers/search',data=b'{"query":"Sera"}',headers={'Content-Type':'application/json'})
                    with self.assertRaises(HTTPError) as caught:urlopen(request)
                    self.assertEqual(caught.exception.code,503)
                    payload=json.load(caught.exception)
                    self.assertEqual(payload['retryAfter'],45);self.assertIn('45 segundos',payload['error'])
                self.assertEqual(upstream.call_count,1)
            with urlopen(f'http://127.0.0.1:{host.server_port}/api/build-mode') as healthy:
                self.assertEqual(healthy.status,200)
        finally:host.shutdown();host.server_close();runner.join()

if __name__=='__main__':
    try:unittest.main()
    finally:storage.cleanup()
