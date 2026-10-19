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
import cover_art as covers
itunes_search=lambda query:covers.search_covers(query,'itunes')
TRACK={'collectionName':'Legião Urbana','artworkUrl100':'https://is1-ssl.mzstatic.com/image/100x100bb.jpg','collectionId':1,'artistName':'Legião Urbana','trackName':'Será'}
def response(data=None):return io.BytesIO(json.dumps({'results':[TRACK]} if data is None else data).encode())

class CoverTests(unittest.TestCase):
    def setUp(self):

        for state in covers.states.values():state.cache.clear();state.next_request=0;state.blocked_until=0
        self.sleep=patch.object(server.time,'sleep');self.sleep.start()
    def tearDown(self):self.sleep.stop()

    def test_lost_connection_recovers_once_and_catalog_is_cached(self):
        with patch.object(covers,'network_open',side_effect=[URLError('connection reset'),response()]) as upstream:
            result=itunes_search('Será Legião Urbana')
            self.assertEqual(result[0]['artist'],'Legião Urbana')
            self.assertIn('/1200x1200bb.jpg',result[0]['imageUrl'])
            result[0]['title']='edited'
            self.assertEqual(itunes_search('SERÁ  LEGIÃO URBANA')[0]['title'],'Legião Urbana')
            self.assertEqual(upstream.call_count,2)

    def test_same_search_in_parallel_reaches_provider_once(self):
        entered=threading.Event();finish=threading.Event();results=[]
        def fetch(*args,**kwargs):entered.set();self.assertTrue(finish.wait(3));return response()
        with patch.object(covers,'network_open',side_effect=fetch) as upstream:
            threads=[threading.Thread(target=lambda:results.append(itunes_search('Será'))) for _ in range(3)]
            threads[0].start();self.assertTrue(entered.wait(3))
            for thread in threads[1:]:thread.start()
            finish.set()
            for thread in threads:thread.join(3);self.assertFalse(thread.is_alive())
            self.assertEqual(upstream.call_count,1);self.assertEqual(len(results),3)

    def test_503_and_429_honor_wait_and_recover_afterwards(self):
        for status in (503,429):
            self.setUpState()
            error=HTTPError('https://itunes.apple.com/search',status,'unavailable',{'Retry-After':'45'},None)
            with patch.object(server.time,'monotonic',return_value=100),patch.object(covers,'network_open',side_effect=error) as upstream:
                with self.assertRaises(server.CoverSearchUnavailable) as caught:itunes_search('Será')
                self.assertEqual(caught.exception.retry_after,45)
                with self.assertRaises(server.CoverSearchUnavailable) as caught:itunes_search('Another song')
                self.assertEqual(caught.exception.retry_after,45)
                self.assertEqual(upstream.call_count,1)
            with patch.object(server.time,'monotonic',return_value=146),patch.object(covers,'network_open',return_value=response()) as upstream:
                self.assertEqual(len(itunes_search('Será')),1);self.assertEqual(upstream.call_count,1)

    def setUpState(self):

        for state in covers.states.values():state.cache.clear();state.next_request=0;state.blocked_until=0

    def test_permanent_connection_failure_is_bounded_not_cached_as_empty(self):
        with patch.object(covers,'network_open',side_effect=URLError('reset')) as upstream:
            with self.assertRaisesRegex(server.CoverSearchUnavailable,'conexão'):itunes_search('Será')
            self.assertEqual(upstream.call_count,2)
            with self.assertRaises(server.CoverSearchUnavailable):itunes_search('Será')
            self.assertEqual(upstream.call_count,2)
        self.assertFalse(covers.states['itunes'].cache)

    def test_invalid_response_recovers_and_empty_results_expire(self):
        with patch.object(covers,'network_open',side_effect=[io.BytesIO(b'not json'),response()]) as upstream:
            self.assertEqual(len(itunes_search('Será')),1);self.assertEqual(upstream.call_count,2)
        covers.states['itunes'].next_request=0
        with patch.object(server.time,'monotonic',return_value=100),patch.object(covers,'network_open',return_value=response({'results':[]})) as upstream:
            self.assertEqual(itunes_search('empty'),[]);self.assertEqual(itunes_search('empty'),[])
            self.assertEqual(upstream.call_count,1)
        with patch.object(server.time,'monotonic',return_value=161),patch.object(covers,'network_open',return_value=response()) as upstream:
            self.assertEqual(len(itunes_search('empty')),1);self.assertEqual(upstream.call_count,1)

    def test_retry_after_date_and_cached_result_during_service_outage(self):
        with patch.object(server.time,'time',return_value=0):
            self.assertEqual(covers.retry_after({'Retry-After':'Thu, 01 Jan 1970 00:03:00 GMT'}),180)
        self.assertEqual(covers.retry_after({'Retry-After':'invalid'}),30)
        with patch.object(covers,'network_open',return_value=response()):itunes_search('saved')
        covers.states['itunes'].blocked_until=server.time.monotonic()+30
        with patch.object(covers,'network_open') as upstream:
            self.assertEqual(len(itunes_search('saved')),1);upstream.assert_not_called()

    def test_http_route_returns_structured_wait_and_remains_available(self):
        host=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        runner=threading.Thread(target=host.serve_forever,daemon=True);runner.start()
        try:
            error=HTTPError('https://itunes.apple.com/search',503,'unavailable',{'Retry-After':'45'},None)
            with patch.object(covers,'network_open',side_effect=error) as upstream:
                for _ in range(2):
                    request=Request(f'http://127.0.0.1:{host.server_port}/api/covers/search',data=b'{"query":"Sera","provider":"itunes"}',headers={'Content-Type':'application/json'})
                    with self.assertRaises(HTTPError) as caught:urlopen(request)
                    self.assertEqual(caught.exception.code,503)
                    payload=json.load(caught.exception)
                    self.assertEqual(payload['retryAfter'],45);self.assertIn('45 segundos',payload['error'])
                self.assertEqual(upstream.call_count,1)
            with urlopen(f'http://127.0.0.1:{host.server_port}/api/build-mode') as healthy:
                self.assertEqual(healthy.status,200)
        finally:host.shutdown();host.server_close();runner.join()

    def test_archive_recording_resolves_album_and_ignores_back_and_unsafe_urls(self):
        group='36f3aed5-43b5-49a8-b38a-7b8cabf55816'
        release='0381ad30-8ea7-469c-8918-d76111d716db'
        art=f'http://coverartarchive.org/release/{release}/35999592399-1200.jpg'
        payloads=[{'recordings':[{'title':'Será','artist-credit':[{'name':'Legião Urbana'}],
                  'releases':[{'id':release,'title':'Legião Urbana','release-group':{'id':group,'title':'Legião Urbana','primary-type':'Album'}}]}]}, {'release-groups':[]},
                  {'images':[{'front':False,'image':'https://127.0.0.1/private.jpg'},{'front':True,'image':art,'thumbnails':{'500':art,'1200':art}}]}]
        with patch.object(covers,'network_open',side_effect=[response(p) for p in payloads]) as upstream:
            results=covers.search_covers('Será','archive','Legião Urbana')
            self.assertEqual(upstream.call_count,3)
            self.assertEqual(results[0]['title'],'Legião Urbana')
            self.assertEqual(results[0]['provider'],'Cover Art Archive')
            self.assertEqual(results[0]['imageUrl'],art.replace('http:','https:'))
            self.assertIn('artist%3A',upstream.call_args_list[0].args[0].full_url)
            self.assertEqual(covers.search_covers('Será','archive','Legião Urbana'),results)
            self.assertEqual(upstream.call_count,3)

    def test_archive_missing_art_is_skipped_not_a_provider_error(self):
        group='36f3aed5-43b5-49a8-b38a-7b8cabf55816'
        missing=HTTPError('https://coverartarchive.org/',404,'missing',{},None)
        with patch.object(covers,'network_open',side_effect=[response({'recordings':[]}),response({'release-groups':[{'id':group,'title':'Album'}]}),missing]):
            self.assertEqual(covers.search_covers('Album','archive'),[])
        self.assertEqual(covers.states['archive'].blocked_until,0)

    def test_one_provider_outage_does_not_block_other_provider_or_youtube(self):
        error=HTTPError('https://itunes.apple.com/search',503,'unavailable',{'Retry-After':'45'},None)
        with patch.object(covers,'network_open',side_effect=error):
            with self.assertRaises(covers.CoverSearchUnavailable):itunes_search('test')
        with patch.object(covers,'network_open',side_effect=[response({'recordings':[]}),response({'release-groups':[]})]) as upstream:
            self.assertEqual(covers.search_covers('test','archive'),[])
            before=upstream.call_count
            result=json.loads(covers.search_json('https://youtu.be/2CnxonDrhdE','{"provider":"youtube"}'))
            self.assertEqual(result['results'][0]['provider'],'YouTube')
            self.assertEqual(upstream.call_count,before)

    def test_youtube_urls_and_rejection_of_generic_image_links(self):
        for url in ['https://youtu.be/2CnxonDrhdE?si=1','https://music.youtube.com/watch?v=2CnxonDrhdE','https://www.youtube.com/shorts/2CnxonDrhdE']:
            result=covers.search_covers(url,'youtube')[0]
            self.assertEqual(result['imageUrl'],'https://i.ytimg.com/vi/2CnxonDrhdE/maxresdefault.jpg')
        for url in ['https://images.genius.com/test.jpg','https://youtube.com.evil.test/watch?v=2CnxonDrhdE','https://youtube.com/watch?v=bad','file:///test.jpg']:
            with self.assertRaises(ValueError):covers.search_covers(url,'youtube')

    def test_image_hosts_and_redirects_are_validated_before_download(self):
        for url in ['https://127.0.0.1/private.jpg','https://coverartarchive.org.evil.test/front.jpg','https://archive.org/download/unrelated/file.jpg','https://user:pass@i.ytimg.com/vi/2CnxonDrhdE/hqdefault.jpg']:
            with self.assertRaises(ValueError):covers.image_url(url)
        request=Request('https://i.ytimg.com/vi/2CnxonDrhdE/hqdefault.jpg')
        with self.assertRaises(ValueError):covers.ArtworkRedirect().redirect_request(request,None,302,'Found',{},'http://127.0.0.1/secret')

    def test_youtube_missing_maxres_downloads_hq_image_locally(self):
        from email.message import Message
        class Image(io.BytesIO):
            headers=Message();headers['Content-Type']='image/jpeg'
            def geturl(self):return 'https://i.ytimg.com/vi/2CnxonDrhdE/hqdefault.jpg'
        missing=HTTPError('https://i.ytimg.com/vi/2CnxonDrhdE/maxresdefault.jpg',404,'missing',{},None)
        with patch.object(covers,'network_open',side_effect=[missing,Image(b'jpeg-test')]) as upstream:
            name=covers.download_cover('https://i.ytimg.com/vi/2CnxonDrhdE/maxresdefault.jpg',storage.name)
            self.assertEqual((Path(storage.name)/name).read_bytes(),b'jpeg-test')
            self.assertTrue(upstream.call_args.args[0].full_url.endswith('/hqdefault.jpg'))

    def test_wire_api_preserves_structured_provider_wait(self):
        covers.states['archive'].blocked_until=server.time.monotonic()+45
        result=json.loads(covers.search_json('Album','{"provider":"archive"}'))
        self.assertEqual(result['status'],503)
        self.assertGreaterEqual(result['retryAfter'],44)

    def test_single_and_album_remain_available_even_with_the_same_image(self):
        album='d99d8cb2-5ea8-4fcd-8aad-669c8a6b80bd';single='2223eef5-8dbe-4d5d-af3e-21ab082694a3'
        release='79a8e9c1-03cd-47ed-adba-ce27f15af58d'
        recording={'title':'No Eulogies','artist-credit':[{'name':'Jamie Paige'}],'releases':[
            {'id':release,'title':'Content Companion','release-group':{'id':album,'title':'Content Companion','primary-type':'Album'}},
            {'id':'8b687375-945b-4730-a7d1-5027b73063f7','title':'No Eulogies','release-group':{'id':single,'title':'No Eulogies','primary-type':'Single'}}]}
        art={'images':[{'front':True,'image':f'https://coverartarchive.org/release/{release}/45765967309.jpg'}]}
        payloads=[{'recordings':[recording]},{'release-groups':[{'id':single,'title':'No Eulogies','primary-type':'Single'}]},art,art]
        with patch.object(covers,'network_open',side_effect=[response(p) for p in payloads]):
            results=covers.search_covers('No Eulogies','archive')
        self.assertEqual({r['releaseType'] for r in results},{'Album','Single'})
        self.assertEqual(len(results),2)

if __name__=='__main__':
    try:unittest.main()
    finally:storage.cleanup()
