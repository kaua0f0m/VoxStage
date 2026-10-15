import importlib.util, json, tempfile, unittest, sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from youtube_support import YoutubeAccess
path = Path(__file__).resolve().parents[1] / 'src-tauri/gen/android/app/src/main/assets/voxstage_youtube.py'
spec = importlib.util.spec_from_file_location('voxstage_youtube', path)
youtube = importlib.util.module_from_spec(spec)
spec.loader.exec_module(youtube)
temporary_root = Path(__file__).resolve().parents[1] / 'test-results'
temporary_root.mkdir(exist_ok=True)

class AndroidYoutube(unittest.TestCase):
    def setUp(self):
        youtube.youtube_access = YoutubeAccess()
        self.sleep_patch = patch('youtube_support.time.sleep')
        self.sleep_patch.start()

    def tearDown(self):
        youtube._runtime = None
        self.sleep_patch.stop()

    def test_runtime_and_solver_configuration(self):
        with tempfile.TemporaryDirectory(dir=temporary_root) as temp:
            runtime = Path(temp) / 'libvoxstage_qjs.so'; runtime.touch()
            youtube.configure_runtime(str(runtime))
            self.assertEqual(youtube._options()['js_runtimes']['quickjs']['path'], str(runtime))
        with self.assertRaises(ValueError):youtube.configure_runtime('/missing/qjs')

    def test_metadata_uses_current_default_clients_and_cache(self):
        calls=[]
        class Extractor:
            def __init__(self, options):calls.append(options)
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def extract_info(self,*args,**kwargs):
                return {'title':'Track','artist':'Artist'}
        with patch.object(youtube,'YoutubeDL',Extractor):
            self.assertEqual(json.loads(youtube.metadata_json('https://www.youtube.com/watch?v=abcdefghijk'))['artist'],'Artist')
            youtube.metadata_json('https://www.youtube.com/watch?v=abcdefghijk')
        self.assertEqual(len(calls),1)
        self.assertNotIn('extractor_args',calls[0])

    def test_bot_failure_cleans_partial_files_and_stops_immediate_retry(self):
        calls=[]
        class Extractor:
            def __init__(self, options):self.options=options;calls.append(options)
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def extract_info(self,*args,**kwargs):
                target=Path(self.options['outtmpl'].replace('%(ext)s','m4a'))
                target.with_suffix('.part').write_bytes(b'incomplete')
                raise ValueError("Sign in to confirm you're not a bot")
        with tempfile.TemporaryDirectory(dir=temporary_root) as temp, patch.object(youtube,'YoutubeDL',Extractor):
            for _ in range(2):
                with self.assertRaisesRegex(ValueError,'MVSEP'):
                    youtube.download_json('https://youtu.be/abcdefghijk',temp)
            self.assertFalse(list(Path(temp).glob('.ytdlp-*')))
            self.assertEqual(list(Path(temp).iterdir()),[])
        self.assertEqual(len(calls),1)

    def test_network_block_message_and_restricted_video(self):
        for failure, count in [("Sign in to confirm you're not a bot",1),('This video is private',1)]:
            youtube.youtube_access = YoutubeAccess()
            with patch.object(youtube,'YoutubeDL') as factory:
                factory.return_value.__enter__.return_value.extract_info.side_effect=ValueError(failure)
                with self.assertRaises(ValueError) as error:youtube.metadata_json('https://youtu.be/abcdefghijk')
                self.assertEqual(factory.call_count,count)
                if 'not a bot' in failure:self.assertIn('MVSEP',str(error.exception))
                else:self.assertIn('private',str(error.exception))

    def test_download_success_and_catalog_metadata(self):
        class Extractor:
            def __init__(self, options):self.options=options
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def extract_info(self,*args,**kwargs):
                target=Path(self.options['outtmpl'].replace('%(ext)s','m4a'))
                target.write_bytes(b'complete')
                return {'requested_downloads':[{'filepath':str(target)}],'acodec':'aac','title':'Track'}
        with tempfile.TemporaryDirectory(dir=temporary_root) as temp, patch.object(youtube,'YoutubeDL',Extractor):
            result=json.loads(youtube.download_json('https://youtu.be/abcdefghijk',temp))
            self.assertEqual((Path(temp)/result['filename']).read_bytes(),b'complete')
            self.assertFalse(list(Path(temp).glob('.ytdlp-*')))

if __name__=='__main__':unittest.main()
