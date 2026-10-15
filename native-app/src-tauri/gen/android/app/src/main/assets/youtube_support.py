"""Shared YouTube request policy for desktop and Android. No account data stored."""
import copy
import math
import re
import threading
import time


def is_youtube_block(error):
    message = str(error).lower()
    return any(text in message for text in (
        'not a bot', "confirm you're", 'confirm you’re', 'robô', 'bloqueou temporariamente',
        'too many requests', 'http error 429', 'status code 429'))


class YoutubeAccess:
    def __init__(self):
        self.lock = threading.Lock()
        self.cache = {}
        self.next_request = 0
        self.blocked_until = 0

    def run(self, key, callback, ttl=0):
        # A download and a metadata request must not compete for the same session.
        with self.lock:
            now = time.monotonic()
            cached = self.cache.get(key) if ttl else None
            if cached and now < cached[0]:
                return copy.deepcopy(cached[1])
            if now < self.blocked_until:
                remaining = max(1, math.ceil(self.blocked_until - now))
                raise ValueError(f'O YouTube bloqueou temporariamente as consultas. Aguarde {remaining} segundos antes de tentar novamente; se continuar, tente outra rede ou importe o áudio e use Separar com MVSEP.')
            time.sleep(max(0, self.next_request - now))
            try:
                result = callback()
            except Exception as error:
                if is_youtube_block(error):
                    self.blocked_until = time.monotonic() + 60
                raise
            finally:
                self.next_request = time.monotonic() + 2
            if ttl:
                self.cache[key] = (time.monotonic() + ttl, copy.deepcopy(result))
                if len(self.cache) > 128:
                    del self.cache[next(iter(self.cache))]
            return result


youtube_access = YoutubeAccess()


def youtube_request_options():
    # Slow down individual extractor requests and space actual media downloads.
    return dict(sleep_interval_requests=1, sleep_interval=5, max_sleep_interval=5,
                extractor_retries=1)


def youtube_catalog_fields(renderer):
    """Retain Music's artist/album without opening every search result."""
    artists, album, duration = [], '', None
    for column in renderer.get('flexColumns') or []:
        runs = column.get('musicResponsiveListItemFlexColumnRenderer', {}).get('text', {}).get('runs', [])
        for run in runs:
            text = (run.get('text') or '').strip()
            browse = run.get('navigationEndpoint', {}).get('browseEndpoint', {})
            page = browse.get('browseEndpointContextSupportedConfigs', {}).get('browseEndpointContextMusicConfig', {}).get('pageType', '')
            if page in {'MUSIC_PAGE_TYPE_ARTIST', 'MUSIC_PAGE_TYPE_USER_CHANNEL'} and text and text not in artists:
                artists.append(text)
            elif page == 'MUSIC_PAGE_TYPE_ALBUM':
                album = text
            elif not browse and re.fullmatch(r'\d{1,3}:\d{2}(?::\d{2})?', text):
                duration = 0
                for component in text.split(':'):
                    duration = duration * 60 + int(component)
    images = renderer.get('thumbnail', {}).get('musicThumbnailRenderer', {}).get('thumbnail', {}).get('thumbnails', [])
    return dict(artist=', '.join(artists), album=album, duration=duration, thumbnails=images)


def preserve_youtube_catalog_metadata(downloader):
    try:
        from yt_dlp.extractor.youtube import YoutubeMusicSearchURLIE as BaseSearch
    except ImportError:
        return
    if not hasattr(BaseSearch, '_music_reponsive_list_entry'):
        return

    class YoutubeMusicSearchURLIE(BaseSearch):
        def _music_reponsive_list_entry(self, renderer):
            entry = super()._music_reponsive_list_entry(renderer)
            if entry and renderer.get('playlistItemData', {}).get('videoId'):
                entry.update({key: value for key, value in youtube_catalog_fields(renderer).items() if value})
            return entry

    downloader.add_info_extractor(YoutubeMusicSearchURLIE(downloader))
