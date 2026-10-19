"""Artwork providers shared by Windows and the Android Python bridge."""
import http.client
import json
import math
import re
import ssl
import threading
import time
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse, unquote, parse_qs
from urllib.request import Request, HTTPRedirectHandler, build_opener
from uuid import uuid4

USER_AGENT = 'VoxStage/1.2.0 (https://github.com/kaua0f0m/VoxStage)'
MBID = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'


class CoverSearchUnavailable(RuntimeError):
    def __init__(self, message, retry_after=15):
        super().__init__(message)
        self.retry_after = retry_after


def retry_after(headers):
    value = (headers or {}).get('Retry-After', '30')
    try:
        return max(30, int(value))
    except (TypeError, ValueError):
        try:
            return max(30, math.ceil(parsedate_to_datetime(value).timestamp() - time.time()))
        except (TypeError, ValueError, OverflowError):
            return 30


class ProviderState:
    def __init__(self):
        self.lock = threading.Lock()
        self.cache = {}
        self.next_request = 0
        self.blocked_until = 0


states = {name: ProviderState() for name in ('archive', 'itunes')}


def image_url(url):
    """Allow the CAA image archive and Apple's artwork CDN, always over TLS."""
    parsed = urlparse(str(url or ''))
    host = (parsed.hostname or '').lower()
    if parsed.scheme not in {'http', 'https'} or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError('Endereço de capa inválido.')
    path = unquote(parsed.path)
    apple = host.endswith('.mzstatic.com') or host.endswith('.itunes.apple.com')
    youtube = host in {'i.ytimg.com', 'img.youtube.com'} and re.fullmatch(r'/vi/[A-Za-z0-9_-]{11}/(?:maxresdefault|hqdefault|mqdefault)\.jpg',path)
    caa = host == 'coverartarchive.org' and re.fullmatch(rf'/(?:release|release-group)/{MBID}/(?:front(?:-\d+)?/?|\d+(?:-\d+)?\.(?:jpg|jpeg|png|webp))', path,re.I)
    archive = (host == 'archive.org' or host.endswith('.archive.org')) and re.fullmatch(
        rf'/(?:download|(?:\d+/)?items)/mbid-{MBID}/[^/]+\.(?:jpg|jpeg|png|webp|gif|avif)', path, re.I)
    if not (apple or caa or archive or youtube):
        raise ValueError('Endereço de capa inválido. Faça uma nova busca e tente novamente.')
    return parsed._replace(scheme='https', fragment='').geturl()


class ArtworkRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return super().redirect_request(request, fp, code, message, headers, image_url(new_url))


def network_open(request, timeout=8, image=False):
    import urllib.request
    import certifi
    # Android's embedded Python also uses the bundled CA store, never an empty
    # system certificate directory. The same verification runs on desktop.
    context = ssl.create_default_context(cafile=certifi.where())
    opener = build_opener(urllib.request.HTTPSHandler(context=context), *([ArtworkRedirect()] if image else []))
    return opener.open(request, timeout=timeout)


def _json(url, provider, deadline, missing_ok=False):
    state = states[provider]
    for attempt in range(2):
        remaining = deadline - time.monotonic()
        delay = max(0, state.next_request - time.monotonic())
        if remaining <= delay + .2:
            raise CoverSearchUnavailable('A busca de capas demorou demais. Tente novamente em alguns instantes.')
        time.sleep(delay)
        state.next_request = time.monotonic() + (1.1 if provider == 'archive' else 3.2)
        request = Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'application/json'})
        try:
            with network_open(request, timeout=min(8, deadline-time.monotonic())) as response:
                data = response.read(3*1024*1024+1)
                if len(data) > 3*1024*1024:
                    raise ValueError('Resposta grande demais.')
                payload = json.loads(data)
                if not isinstance(payload, dict):
                    raise ValueError('Resposta inválida.')
                return payload
        except HTTPError as error:
            if error.code == 404 and missing_ok:
                return None
            if error.code in {429, 503}:
                wait = retry_after(error.headers)
                raise CoverSearchUnavailable(f'O provedor de capas respondeu HTTP {error.code}. Aguarde {wait} segundos ou escolha outro provedor.', wait) from None
            if attempt == 0 and error.code in {502, 504}:
                continue
            raise CoverSearchUnavailable(f'Não consegui consultar o provedor de capas (HTTP {error.code}). Tente outro provedor ou aguarde alguns instantes.') from None
        except (URLError, TimeoutError, ConnectionError, http.client.HTTPException, ValueError):
            if attempt == 0:
                continue
            raise CoverSearchUnavailable('A conexão com o provedor de capas falhou. Tente outro provedor ou aguarde alguns instantes.') from None


def _itunes(query, artist, deadline):
    payload = _json('https://itunes.apple.com/search?'+urlencode({'term':' '.join(filter(None,(query,artist))), 'entity':'song','limit':16,'country':'br'}), 'itunes', deadline)
    tracks = payload.get('results')
    if not isinstance(tracks, list):
        raise CoverSearchUnavailable('Resposta inválida do catálogo de capas.')
    results, seen = [], set()
    for track in tracks:
        if not isinstance(track, dict):
            continue
        album = str(track.get('collectionName') or '').strip()
        art = str(track.get('artworkUrl100') or '')
        album_id = str(track.get('collectionId') or track.get('trackId') or art)
        if not album or not art or album_id in seen:
            continue
        try:
            preview = image_url(art)
            large = image_url(re.sub(r'/\d+x\d+(?:bb|-\d+)?(?=\.[a-zA-Z]+$)', '/1200x1200bb', art))
        except ValueError:
            continue
        seen.add(album_id)
        results.append(dict(id=album_id, title=album, artist=track.get('artistName') or 'Artista desconhecido', track=track.get('trackName') or '',
                            date=str(track.get('releaseDate') or '')[:10], previewUrl=preview, imageUrl=large, provider='iTunes'))
        if len(results) == 8:
            break
    return results


def _literal(value):
    return '"'+re.sub(r'([\\"+\-!(){}\[\]^~*?:/|&])', r'\\\1', value)+'"'


def _linked_image(query):
    parsed = urlparse(query)
    host = (parsed.hostname or '').lower()
    if parsed.scheme in {'http','https'} and not parsed.username and not parsed.password:
        video_id = ''
        if host == 'youtu.be':
            video_id = parsed.path.lstrip('/').split('/')[0]
        elif host in {'youtube.com','www.youtube.com','music.youtube.com','m.youtube.com'}:
            video_id = parse_qs(parsed.query).get('v',[''])[0]
            if not video_id and parsed.path.startswith(('/shorts/','/embed/','/live/')):
                video_id = parsed.path.split('/')[2]
        if re.fullmatch(r'[A-Za-z0-9_-]{11}',video_id):
            return [dict(id='youtube-'+video_id,title='Miniatura do YouTube',artist='',track='',provider='YouTube',
                         previewUrl=f'https://i.ytimg.com/vi/{video_id}/hqdefault.jpg',imageUrl=f'https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg')]
    raise ValueError('Cole um link de vídeo do YouTube para usar a miniatura.')


def _artist_credit(item):
    return ''.join(str(credit.get('name') or credit.get('artist',{}).get('name') or '')+str(credit.get('joinphrase') or '')
                   for credit in item.get('artist-credit',[]) if isinstance(credit,dict))


def _archive(query, artist, deadline):
    candidates, seen = [], set()
    # Recordings resolve song titles to their albums. Release-group search also
    # supports searching directly for an album or an artist's discography.
    for entity, field in (('recording','recording'), ('release-group','releasegroup')):
        expression = f'{field}:{_literal(query)}'
        if artist:
            expression += f' AND artist:{_literal(artist)}'
        else:
            expression = f'({expression} OR artist:{_literal(query)})'
        try:
            payload = _json('https://musicbrainz.org/ws/2/'+entity+'/?'+urlencode({'query':expression,'fmt':'json','limit':6}), 'archive', deadline)
        except CoverSearchUnavailable:
            if candidates:
                break
            raise
        items = payload.get('recordings' if entity == 'recording' else 'release-groups')
        if not isinstance(items, list):
            raise CoverSearchUnavailable('Resposta inválida do MusicBrainz. Tente novamente em alguns instantes.')
        for item in items:
            if not isinstance(item,dict):
                continue
            releases = item.get('releases',[]) if entity == 'recording' else [item]
            for release in releases:
                group = release.get('release-group',{}) if entity == 'recording' else release
                group_id = group.get('id','')
                release_id = release.get('id','') if entity == 'recording' else next((r.get('id','') for r in release.get('releases',[]) if isinstance(r,dict)), '')
                candidate_id = group_id or release_id
                direct = entity == 'release-group' and item.get('title','').casefold() == query.casefold()
                if candidate_id in seen:
                    if direct:
                        next(candidate for candidate in candidates if candidate['id']==candidate_id)['direct']=True
                    continue
                if not re.fullmatch(MBID,candidate_id):
                    continue
                seen.add(candidate_id)
                candidates.append(dict(id=candidate_id, group=bool(group_id), release=release_id,
                                       title=group.get('title') or release.get('title') or item.get('title') or query,
                                       artist=_artist_credit(release) or _artist_credit(item) or artist,
                                       track=item.get('title','') if entity == 'recording' else '',
                                       date=release.get('date') or group.get('first-release-date') or '',
                                       releaseType=group.get('primary-type') or '',direct=direct,
                                       rank=(item.get('title','').casefold() != query.casefold(),
                                             release.get('status') in {'Bootleg','Promotion'},
                                             bool(set(group.get('secondary-types',[])) & {'Compilation','Live'}),
                                             group.get('primary-type') != 'Album')))
    candidates.sort(key=lambda item:item['rank'])
    # Keep the direct single/album match near the first related album, so the
    # bounded request budget does not spend all its time on less relevant names.
    direct = next((item for item in candidates if item['direct']),None)
    if direct and candidates.index(direct)>1:
        candidates.remove(direct);candidates.insert(1,direct)
    results = []
    for candidate in candidates[:10]:
        if time.monotonic() >= deadline-1:
            if not results:
                raise CoverSearchUnavailable('A busca de capas demorou demais. Tente novamente ou escolha outro provedor.')
            break
        kind = 'release-group' if candidate['group'] else 'release'
        try:
            data = _json(f'https://coverartarchive.org/{kind}/{candidate["id"]}', 'archive', deadline, missing_ok=True)
            if (not data or not any(image.get('front') for image in data.get('images',[]) if isinstance(image,dict))) and candidate['group'] and re.fullmatch(MBID,candidate['release']):
                data = _json(f'https://coverartarchive.org/release/{candidate["release"]}', 'archive', deadline, missing_ok=True)
        except CoverSearchUnavailable:
            if results:
                break
            raise
        if not data:
            continue
        front = next((image for image in data.get('images',[]) if isinstance(image,dict) and image.get('front')), None)
        if not front:
            continue
        thumbs = front.get('thumbnails') or {}
        try:
            full = image_url(thumbs.get('1200') or front.get('image'))
            preview = image_url(thumbs.get('500') or thumbs.get('250') or thumbs.get('small') or full)
        except ValueError:
            continue
        results.append({**{key:candidate[key] for key in ('id','title','artist','track','date','releaseType')},
                        'provider':'Cover Art Archive', 'previewUrl':preview,'imageUrl':full})
        if len(results) == 8:
            break
    return results


def search_covers(query, provider='archive', artist=''):
    query = str(query or '').strip()[:2048 if provider == 'youtube' else 180]
    artist = str(artist or '').strip()[:180]
    if len(query) < 2:
        raise ValueError('Digite pelo menos duas letras para buscar capas.')
    if provider == 'youtube':
        return _linked_image(query)
    if provider not in states:
        raise ValueError('Provedor de capas inválido.')
    state = states[provider]
    key = (' '.join(query.casefold().split()), ' '.join(artist.casefold().split()))
    with state.lock:
        now = time.monotonic()
        cached = state.cache.get(key)
        if cached and now < cached[0]:
            return [dict(item) for item in cached[1]]
        if now < state.blocked_until:
            wait = max(1,math.ceil(state.blocked_until-now))
            raise CoverSearchUnavailable(f'O provedor está temporariamente indisponível. Aguarde {wait} segundos ou escolha outro provedor.',wait)
        try:
            results = (_archive if provider == 'archive' else _itunes)(query,artist,now+22)
        except CoverSearchUnavailable as error:
            state.blocked_until = time.monotonic()+error.retry_after
            raise
        state.cache[key] = (time.monotonic()+(900 if results else 60),results)
        if len(state.cache)>128:
            del state.cache[next(iter(state.cache))]
        return [dict(item) for item in results]


def download_cover(url, directory):
    url = image_url(url)
    try:
        opened = network_open(Request(url,headers={'User-Agent':USER_AGENT}),timeout=30,image=True)
    except HTTPError as error:
        if error.code != 404 or not url.startswith('https://i.ytimg.com/vi/') or not url.endswith('/maxresdefault.jpg'):
            raise
        opened = network_open(Request(url.replace('/maxresdefault.jpg','/hqdefault.jpg'),headers={'User-Agent':USER_AGENT}),timeout=30,image=True)
    with opened as response:
        image_url(response.geturl())
        mime = response.headers.get_content_type()
        extensions = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/avif':'avif'}
        if mime not in extensions:
            raise ValueError('O resultado não é uma imagem suportada.')
        data = response.read(20*1024*1024+1)
    if not data or len(data)>20*1024*1024:
        raise ValueError('A imagem está vazia ou excede 20 MB.')
    directory = Path(directory);directory.mkdir(parents=True,exist_ok=True)
    name = f'{uuid4()}.{extensions[mime]}'
    (directory/name).write_bytes(data)
    return name


def search_json(query, settings='{}'):
    try:
        options = json.loads(settings)
        return json.dumps({'results':search_covers(query,options.get('provider','archive'),options.get('artist',''))},ensure_ascii=False)
    except CoverSearchUnavailable as error:
        return json.dumps({'error':str(error),'retryAfter':error.retry_after,'status':503},ensure_ascii=False)


def download_json(url,directory):
    return json.dumps({'name':download_cover(url,directory)})
