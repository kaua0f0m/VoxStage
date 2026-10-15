"""Request pressure, caching, cooldown and concurrency regressions."""
import sys, threading, unittest
from pathlib import Path
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from youtube_support import YoutubeAccess


class YoutubePolicyTests(unittest.TestCase):
    def test_cache_is_bounded_copied_and_expires(self):
        access=YoutubeAccess(); callback=Mock(return_value={'entries':[{'title':'Track'}]})
        with patch('youtube_support.time.monotonic',return_value=100), patch('youtube_support.time.sleep'):
            access.run('search',callback,300)['entries'][0]['title']='edited'
            self.assertEqual(access.run('search',callback,300)['entries'][0]['title'],'Track')
            self.assertEqual(callback.call_count,1)
            for i in range(130):access.run(str(i),callback,300)
            self.assertEqual(len(access.cache),128)
        with patch('youtube_support.time.monotonic',return_value=500), patch('youtube_support.time.sleep'):
            before=callback.call_count;access.run('129',callback,300)
            self.assertEqual(callback.call_count,before+1)

    def test_bot_and_rate_limit_stop_search_metadata_and_download_then_expire(self):
        for message in ("Sign in to confirm you're not a bot",'HTTP Error 429: Too Many Requests'):
            access=YoutubeAccess(); blocked=Mock(side_effect=ValueError(message)); retry=Mock(return_value='ok')
            with patch('youtube_support.time.monotonic',return_value=100), patch('youtube_support.time.sleep'):
                access.run('cached',retry,300)
                with self.assertRaises(ValueError):access.run('metadata',blocked)
                for key in ('search','other-video',None):
                    with self.assertRaisesRegex(ValueError,'60 segundos'):access.run(key,retry)
                self.assertEqual(access.run('cached',retry,300),'ok')
                self.assertEqual(retry.call_count,1)
            with patch('youtube_support.time.monotonic',return_value=161), patch('youtube_support.time.sleep'):
                self.assertEqual(access.run(None,retry),'ok')

    def test_other_errors_do_not_block_and_requests_are_spaced(self):
        access=YoutubeAccess()
        with patch('youtube_support.time.monotonic',return_value=100), patch('youtube_support.time.sleep') as sleep:
            with self.assertRaises(ValueError):access.run(None,Mock(side_effect=ValueError('This video is private')))
            self.assertEqual(access.run(None,lambda:'ok'),'ok')
            sleep.assert_called_with(2)

    def test_concurrent_same_search_is_extracted_once(self):
        access=YoutubeAccess(); entered=threading.Event(); finish=threading.Event(); results=[]
        def extract():entered.set();self.assertTrue(finish.wait(3));return {'title':'Track'}
        callback=Mock(side_effect=extract)
        with patch('youtube_support.time.sleep'):
            threads=[threading.Thread(target=lambda:results.append(access.run('same',callback,300))) for _ in range(2)]
            threads[0].start();self.assertTrue(entered.wait(3));threads[1].start();finish.set()
            for thread in threads:thread.join(3);self.assertFalse(thread.is_alive())
        self.assertEqual(callback.call_count,1);self.assertEqual(len(results),2)

if __name__=='__main__':unittest.main()
