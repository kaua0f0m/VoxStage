import importlib.util, json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / 'src-tauri/gen/android/app/src/main/assets/voxstage_youtube.py'
spec = importlib.util.spec_from_file_location('voxstage_youtube', path)
youtube = importlib.util.module_from_spec(spec)
spec.loader.exec_module(youtube)
temporary_root = Path(__file__).resolve().parents[1] / 'test-results'
temporary_root.mkdir(exist_ok=True)

class AndroidYoutube(unittest.TestCase):
    def tearDown(self):
        youtube._runtime = None

    def test_runtime_and_solver_configuration(self):
        with tempfile.TemporaryDirectory(dir=temporary_root) as temp:
            runtime = Path(temp) / 'libvoxstage_qjs.so'; runtime.touch()
            youtube.configure_runtime(str(runtime))
            self.assertEqual(youtube._options()['js_runtimes']['quickjs']['path'], str(runtime))
        with self.assertRaises(ValueError):youtube.configure_runtime('/missing/qjs')

    def test_metadata_bot_fallback_then_success(self):
        calls=[]
        class Extractor:
            def __init__(self, options):calls.append(options)
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def extract_info(self,*args,**kwargs):
                if len(calls)<3:raise ValueError("Sign in to confirm you're not a bot")
                return {'title':'Track','artist':'Artist'}
        with patch.object(youtube,'YoutubeDL',Extractor):
            self.assertEqual(json.loads(youtube.metadata_json('https://www.youtube.com/watch?v=abcdefghijk'))['artist'],'Artist')
        self.assertEqual(len(calls),3)
        self.assertEqual(calls[1]['extractor_args']['youtube']['player_client'],['android_vr'])
        self.assertEqual(calls[2]['extractor_args']['youtube']['player_client'],['tv_downgraded'])

    def test_download_retries_do_not_reuse_partial_files(self):
        calls=[]
        class Extractor:
            def __init__(self, options):self.options=options;calls.append(options)
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def extract_info(self,*args,**kwargs):
                target=Path(self.options['outtmpl'].replace('%(ext)s','m4a'))
                if len(calls)==1:
                    target.with_suffix('.part').write_bytes(b'incomplete')
                    raise ValueError("Sign in to confirm you're not a bot")
                target.write_bytes(b'complete')
                return {'requested_downloads':[{'filepath':str(target)}],'acodec':'aac','title':'Track'}
        with tempfile.TemporaryDirectory(dir=temporary_root) as temp, patch.object(youtube,'YoutubeDL',Extractor):
            result=json.loads(youtube.download_json('https://youtu.be/abcdefghijk',temp))
            self.assertEqual((Path(temp)/result['filename']).read_bytes(),b'complete')
            self.assertFalse(list(Path(temp).glob('.ytdlp-*')))

    def test_network_block_message_and_restricted_video(self):
        for failure, count in [("Sign in to confirm you're not a bot",3),('This video is private',1)]:
            with patch.object(youtube,'YoutubeDL') as factory:
                factory.return_value.__enter__.return_value.extract_info.side_effect=ValueError(failure)
                with self.assertRaises(ValueError) as error:youtube.metadata_json('https://youtu.be/abcdefghijk')
                self.assertEqual(factory.call_count,count)
                if count==3:self.assertIn('MVSEP',str(error.exception))
                else:self.assertIn('private',str(error.exception))

if __name__=='__main__':unittest.main()
