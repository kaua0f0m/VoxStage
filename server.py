from __future__ import annotations

import json
import http.client
import base64
import ctypes
import importlib.util
import ipaddress
import secrets
import socket
import hmac
from ctypes import wintypes
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlencode, unquote, urlparse
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener, urlopen
from uuid import uuid4

ROOT = Path(os.environ.get("VOXSTAGE_APP_ROOT") or Path(__file__).resolve().parent).expanduser().resolve()
DATA_ROOT = Path(os.environ.get("VOXSTAGE_DATA_DIR") or ROOT).expanduser().resolve()
MEDIA = DATA_ROOT / "music"
LIBRARY = DATA_ROOT / "library.json"
LIBRARY_LOCK = threading.RLock()
MVSEP_CONFIG = DATA_ROOT / "mvsep-config.json"
DATA_ROOT.mkdir(parents=True, exist_ok=True)
MEDIA.mkdir(exist_ok=True)
SAFE_NAME = re.compile(r"^[a-f0-9-]{36}\.[a-z0-9]{1,8}$", re.I)
YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "music.youtube.com", "m.youtube.com", "youtu.be"}
_alignment_runtime = None
youtube_jobs = {}
youtube_jobs_lock = threading.Lock()
video_download_jobs = {}
video_download_jobs_lock = threading.Lock()
local_separation_jobs = {}
local_separation_jobs_lock = threading.Lock()
setup_jobs = {}
setup_jobs_lock = threading.Lock()
REMOTE_TOKEN = secrets.token_urlsafe(24)
remote_requests = {}
remote_requests_lock = threading.Lock()
remote_commands = []
remote_commands_lock = threading.Lock()
remote_state = {"songId": None, "title": "", "artist": "", "playing": False, "time": 0, "duration": 0}
remote_state_lock = threading.Lock()
from phone_microphone import PhoneMicrophone
remote_microphone = PhoneMicrophone()
remote_transfers = {}
remote_transfers_lock = threading.Lock()
REMOTE_MEDIA_FIELDS = ("source", "inst", "lead", "back", "cover", "background", "backgroundVideo")
REMOTE_SONG_FIELDS = {
    "id", "title", "artist", "created", "favorite", "hidden", "separationStatus", "separationEngine", *REMOTE_MEDIA_FIELDS,
    "syncedLyrics", "plainLyrics", "lyricTrack", "lyricArtist", "lyricProvider", "wordTimings",
    "parallelWordTimings", "parallelLineStarts", "wordByWordEnabled", "vocalSilenceEnds",
    "manualVocalSilences", "lyricLineEnds", "backingSyncedLyrics", "backingPlainLyrics",
    "backingWordTimings", "backingLineEnds", "backingWordByWordEnabled", "backingLyricAdjustments",
    "backingLyricProvider", "profanityWords", "profanityMarks", "profanityCues", "lyricAdjustments",
}
REMOTE_INCOMING = DATA_ROOT / ".remote-incoming"
REMOTE_INCOMING.mkdir(exist_ok=True)


def get_lan_ipv4():
    """Find the local Wi-Fi/Ethernet address used to reach other devices."""
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("192.0.2.1", 80))
        address = probe.getsockname()[0]
        if not address.startswith("127."):
            return address
    except OSError:
        pass
    finally:
        probe.close()
    try:
        addresses = socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)
        for address in addresses:
            ip = address[4][0]
            if not ip.startswith("127."):
                return ip
    except OSError:
        pass
    return ""
def search_covers(query):
    query = str(query or "").strip()[:180]
    if len(query) < 2:
        raise ValueError("Digite pelo menos duas letras para buscar capas.")
    # A busca de faixas traz o nome do álbum junto do resultado, resolvendo
    # músicas como "The Emptiness Machine" para o álbum "From Zero".
    url = "https://itunes.apple.com/search?" + urlencode({"term": query, "entity": "song", "limit": 16, "country": "br"})
    request = Request(url, headers={"User-Agent": "VoxStage/0.1 (local music library)", "Accept": "application/json"})
    with urlopen(request, timeout=12) as response:
        tracks = json.loads(response.read(3 * 1024 * 1024)).get("results", [])
    results = []
    seen = set()
    for track in tracks:
        album = (track.get("collectionName") or "").strip()
        artwork = track.get("artworkUrl100") or ""
        album_id = track.get("collectionId")
        if not album or not artwork or album_id in seen:
            continue
        seen.add(album_id)
        large = re.sub(r"/\d+x\d+(?:bb|-\d+)?(?=\.[a-zA-Z]+$)", "/1200x1200bb", artwork)
        if large == artwork and "/100x100" in artwork:
            large = artwork.replace("100x100", "1200x1200", 1)
        results.append({"id": str(album_id or track.get("trackId", "")), "title": album, "artist": track.get("artistName", "Artista desconhecido"), "track": track.get("trackName", ""), "date": (track.get("releaseDate") or "")[:10], "previewUrl": artwork.replace("http://", "https://", 1), "imageUrl": large.replace("http://", "https://", 1)})
        if len(results) >= 8:
            break
    return results


def download_cover(url):
    parsed = urlparse(str(url or ""))
    host = (parsed.hostname or "").lower()
    trusted_host = host.endswith(".mzstatic.com") or host.endswith(".itunes.apple.com")
    if parsed.scheme != "https" or not trusted_host:
        raise ValueError("Endereço de capa inválido. Faça uma nova busca e tente novamente.")
    request = Request(url, headers={"User-Agent": "VoxStage/0.1 (local music library)"})
    with urlopen(request, timeout=30) as response:
        final_host = (urlparse(response.geturl()).hostname or "").lower()
        if not (final_host.endswith(".mzstatic.com") or final_host.endswith(".itunes.apple.com")):
            raise ValueError("O endereço de imagem retornado não é confiável.")
        content_type = response.headers.get_content_type()
        if not content_type.startswith("image/"):
            raise ValueError("O resultado não é uma imagem.")
        data = response.read(20 * 1024 * 1024 + 1)
    if not data or len(data) > 20 * 1024 * 1024:
        raise ValueError("A imagem está vazia ou excede 20 MB.")
    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif"}.get(content_type, "jpg")
    name = f"{uuid4()}.{ext}"
    (MEDIA / name).write_bytes(data)
    return name


def protect_local_secret(secret):
    if os.name != "nt":
        raise RuntimeError("O armazenamento protegido da chave está disponível nesta versão para Windows.")

    class DataBlob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]

    raw = secret.encode("utf-8")
    source = ctypes.create_string_buffer(raw)
    source_blob = DataBlob(len(raw), ctypes.cast(source, ctypes.POINTER(ctypes.c_byte)))
    protected_blob = DataBlob()
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    protect = crypt32.CryptProtectData
    protect.argtypes = [ctypes.POINTER(DataBlob), wintypes.LPCWSTR, ctypes.POINTER(DataBlob), ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(DataBlob)]
    protect.restype = wintypes.BOOL
    if not protect(ctypes.byref(source_blob), "VoxStage MVSep API token", None, None, None, 1, ctypes.byref(protected_blob)):
        raise OSError(ctypes.get_last_error(), "Não consegui proteger a chave MVSep no Windows.")
    try:
        return base64.b64encode(ctypes.string_at(protected_blob.pbData, protected_blob.cbData)).decode("ascii")
    finally:
        ctypes.windll.kernel32.LocalFree(protected_blob.pbData)


def unprotect_local_secret(encoded):
    if os.name != "nt":
        return ""

    class DataBlob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]

    raw = base64.b64decode(encoded)
    source = ctypes.create_string_buffer(raw)
    source_blob = DataBlob(len(raw), ctypes.cast(source, ctypes.POINTER(ctypes.c_byte)))
    clear_blob = DataBlob()
    description = wintypes.LPWSTR()
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    unprotect = crypt32.CryptUnprotectData
    unprotect.argtypes = [ctypes.POINTER(DataBlob), ctypes.POINTER(wintypes.LPWSTR), ctypes.POINTER(DataBlob), ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(DataBlob)]
    unprotect.restype = wintypes.BOOL
    if not unprotect(ctypes.byref(source_blob), ctypes.byref(description), None, None, None, 1, ctypes.byref(clear_blob)):
        return ""
    try:
        return ctypes.string_at(clear_blob.pbData, clear_blob.cbData).decode("utf-8")
    finally:
        ctypes.windll.kernel32.LocalFree(clear_blob.pbData)


def get_mvsep_token():
    token = os.environ.get("MVSEP_API_TOKEN", "").strip()
    if token:
        return token
    try:
        return unprotect_local_secret(json.loads(MVSEP_CONFIG.read_text(encoding="utf-8")).get("protected_token", "")).strip()
    except (FileNotFoundError, json.JSONDecodeError, AttributeError, ValueError, OSError):
        return ""


def mvsep_urlopen(url, timeout=45):
    """Use MVSep directly; stale system proxy variables can point to a dead proxy."""
    return build_opener(ProxyHandler({})).open(url, timeout=timeout)


_mvsep_models_cache = {"expires": 0, "models": []}
_mvsep_models_lock = threading.Lock()


def mvsep_models(force_refresh=False):
    """Fetch public MVSep single-upload vocal separation models and their options."""
    with _mvsep_models_lock:
        if not force_refresh and _mvsep_models_cache["expires"] > time.time():
            return _mvsep_models_cache["models"]
        request = Request(
            "https://www.mvsep.com/api/app/algorithms?scopes=single_upload",
            headers={"User-Agent": "VoxStage/0.1", "Accept": "application/json"},
        )
        with mvsep_urlopen(request, timeout=20) as response:
            payload = json.loads(response.read(5 * 1024 * 1024))
        entries = payload if isinstance(payload, list) else payload.get("data", [])
        if not isinstance(entries, list):
            raise RuntimeError("A MVSep retornou um catálogo de modelos inválido.")
        models = []
        for entry in entries:
            if not isinstance(entry, dict) or entry.get("audio_widget", "single_upload") != "single_upload":
                continue
            try:
                orientation = int(entry.get("orientation", 0))
                model_id = int(entry.get("render_id"))
            except (TypeError, ValueError):
                continue
            if orientation > 1:  # Exclude premium-only models.
                continue
            name = str(entry.get("name") or "").strip()
            lowered = name.casefold()
            # Keep models that produce the vocal/instrumental stems VoxStage can use.
            if not any(term in lowered for term in ("vocal", "lead/back", "lead and backing")):
                continue
            if not any(term in lowered for term in ("instrumental", "instrum", "music", "lead/back", "lead and backing")):
                continue
            raw_fields = entry.get("algorithm_fields", [])
            if isinstance(raw_fields, str):
                try:
                    raw_fields = json.loads(raw_fields)
                except json.JSONDecodeError:
                    raw_fields = []
            fields = []
            for field in raw_fields if isinstance(raw_fields, list) else []:
                if not isinstance(field, dict):
                    continue
                field_name = str(field.get("name") or "")
                if field_name not in {"add_opt1", "add_opt2", "add_opt3"}:
                    continue
                options = field.get("options", {})
                if isinstance(options, str):
                    try:
                        options = json.loads(options)
                    except json.JSONDecodeError:
                        options = {}
                if isinstance(options, list):
                    options = {str(option.get("key", index)): option.get("value", option.get("text", "")) for index, option in enumerate(options) if isinstance(option, dict)}
                if not isinstance(options, dict):
                    options = {}
                options = {str(key): str(value) for key, value in options.items()}
                default = str(field.get("default_key") if field.get("default_key") is not None else next(iter(options), ""))
                if model_id == 12 and field_name == "add_opt1" and "1" in options:
                    default = "1"  # Preserve VoxStage's existing karaoke extraction mode.
                if options:
                    if default not in options:
                        default = next(iter(options))
                    fields.append({"name": field_name, "label": str(field.get("text") or field.get("label") or field_name), "options": options, "default": default})
            models.append({"id": model_id, "name": name, "orientation": orientation, "fields": fields})
        models.sort(key=lambda model: (model["orientation"], model["name"].casefold(), model["id"]))
        if not models:
            raise RuntimeError("A MVSep não disponibilizou modelos compatíveis para separar vocais e instrumental.")
        _mvsep_models_cache.update({"expires": time.time() + 3600, "models": models})
        return models


def validated_mvsep_options(model_id, submitted):
    model = next((item for item in mvsep_models() if item["id"] == int(model_id)), None)
    if not model:
        raise ValueError("Selecione um modelo MVSep disponível nas configurações.")
    submitted = submitted if isinstance(submitted, dict) else {}
    options = {}
    for field in model["fields"]:
        value = str(submitted.get(field["name"], field["default"]))
        if value not in field["options"]:
            raise ValueError("Uma das opções do modelo MVSep não é válida.")
        options[field["name"]] = value
    return model, options


def valid_youtube_url(value):
    parsed = urlparse(value.strip())
    host = (parsed.hostname or "").lower()
    return parsed.scheme in {"http", "https"} and host in YOUTUBE_HOSTS and (host == "youtu.be" or parsed.path.startswith(("/watch", "/shorts/", "/live/", "/embed/")))


def youtube_js_runtime_options():
    runtimes = {runtime: {} for runtime in ("deno", "node", "bun") if shutil.which(runtime)}
    return {"js_runtimes": runtimes} if runtimes else {}


def youtube_error_message(error):
    detail = str(error).lower()
    if "not a bot" in detail or "confirm you're" in detail or "confirm you’re" in detail:
        return "O YouTube bloqueou temporariamente as consultas e pediu confirmação de que você não é um bot. Aguarde alguns minutos e tente novamente."
    if "429" in detail or "too many requests" in detail:
        return "O YouTube limitou as solicitações por enquanto. Aguarde alguns minutos e tente novamente."
    if "private video" in detail or "sign in" in detail or "members-only" in detail:
        return "Este vídeo exige acesso ou login no YouTube e não pode ser importado agora."
    if "video unavailable" in detail or "not available" in detail:
        return "O YouTube não disponibilizou esta faixa para importação agora. Tente novamente mais tarde ou escolha outro resultado."
    return "Não consegui consultar ou baixar esta faixa no YouTube. Confira sua conexão e tente novamente."


def youtube_catalog_fields(renderer):
    """Keep the metadata already present in Music search, without opening videos."""
    artists, album, duration = [], "", None
    for column in renderer.get("flexColumns") or []:
        runs = column.get("musicResponsiveListItemFlexColumnRenderer", {}).get("text", {}).get("runs", [])
        for run in runs:
            text = (run.get("text") or "").strip()
            browse = run.get("navigationEndpoint", {}).get("browseEndpoint", {})
            page = browse.get("browseEndpointContextSupportedConfigs", {}).get("browseEndpointContextMusicConfig", {}).get("pageType", "")
            if page in {"MUSIC_PAGE_TYPE_ARTIST", "MUSIC_PAGE_TYPE_USER_CHANNEL"} and text and text not in artists:
                artists.append(text)
            elif page == "MUSIC_PAGE_TYPE_ALBUM":
                album = text
            elif not browse and re.fullmatch(r"\d{1,3}:\d{2}(?::\d{2})?", text):
                duration = 0
                for component in text.split(":"):
                    duration = duration * 60 + int(component)
    images = renderer.get("thumbnail", {}).get("musicThumbnailRenderer", {}).get("thumbnail", {}).get("thumbnails", [])
    return {"artist": ", ".join(artists), "album": album, "duration": duration, "thumbnails": images}


def preserve_youtube_catalog_metadata(downloader):
    # yt-dlp's Music search adapter currently retains only title/id. Override
    # this adapter per downloader; leave video extraction and other searches alone.
    try:
        from yt_dlp.extractor.youtube import YoutubeMusicSearchURLIE as BaseSearch
    except ImportError:
        return
    if not hasattr(BaseSearch, "_music_reponsive_list_entry"):
        return

    class YoutubeMusicSearchURLIE(BaseSearch):
        def _music_reponsive_list_entry(self, renderer):
            entry = super()._music_reponsive_list_entry(renderer)
            if entry and renderer.get("playlistItemData", {}).get("videoId"):
                entry.update({key: value for key, value in youtube_catalog_fields(renderer).items() if value})
            return entry

    downloader.add_info_extractor(YoutubeMusicSearchURLIE(downloader))


def youtube_search(query, include_youtube=False):
    try:
        import yt_dlp
    except ImportError as error:
        raise RuntimeError("O yt-dlp ainda não está instalado. Instale as dependências listadas em requirements-youtube.txt.") from error
    query = (query or "").strip()
    if not query:
        raise ValueError("Cole um link do YouTube ou digite o nome da música.")
    options = {"quiet": True, "no_warnings": True, "extract_flat": "in_playlist", "noplaylist": True, "playlistend": 5, "skip_download": True, "proxy": "", **youtube_js_runtime_options()}
    if valid_youtube_url(query):
        targets = [(query, "youtube")]
    else:
        # Keep YouTube Music catalog tracks first; optionally append standard video results.
        targets = [(f"https://music.youtube.com/search?q={quote(query)}#songs", "music")]
        targets.append((f"ytsearch5:{query}", "youtube"))
    entries = []
    with yt_dlp.YoutubeDL(options) as downloader:
        preserve_youtube_catalog_metadata(downloader)
        seen_ids = set()
        for target, source in targets:
            try:
                result = downloader.extract_info(target, download=False)
            except Exception:
                # Preserve YouTube Music results if the optional standard
                # YouTube search endpoint fails.
                if source == targets[-1][1] and not entries:
                    raise
                continue
            found = result.get("entries") if isinstance(result, dict) else None
            if found is None:
                found = [result]
            for item in found:
                if not item or not item.get("id") or item["id"] in seen_ids:
                    continue
                seen_ids.add(item["id"])
                entries.append((item, source))
            if source == "music" and entries and not include_youtube:
                break

    results = []
    for item, source in entries:
        thumbnails = item.get("thumbnails") or []
        thumbnail = item.get("thumbnail") or ""
        if thumbnails:
            best = max(thumbnails, key=lambda image: (image.get("width") or 0) * (image.get("height") or 0))
            thumbnail = best.get("url") or thumbnail
        video_id = item.get("id")
        result_url = item.get("webpage_url") or item.get("original_url")
        if not result_url and video_id:
            result_url = f"https://music.youtube.com/watch?v={video_id}" if source == "music" else f"https://www.youtube.com/watch?v={video_id}"
        if thumbnail.startswith("//"):
            thumbnail = "https:" + thumbnail
        results.append({"title": item.get("title") or "Faixa do YouTube", "artist": item.get("artist") or item.get("creator") or item.get("channel") or item.get("uploader") or "", "album": item.get("album") or "", "source": "YouTube Music" if source == "music" else "YouTube", "url": result_url, "duration": item.get("duration"), "thumbnail": thumbnail or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg", "thumbnailFallback": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"})
    return results


def youtube_video_metadata(video_url):
    """Resolve full YouTube Music metadata without downloading the media."""
    try:
        import yt_dlp
    except ImportError as error:
        raise RuntimeError("O yt-dlp ainda não está instalado.") from error
    if not valid_youtube_url(video_url):
        raise ValueError("O link do vídeo não é válido.")
    options = {"quiet": True, "no_warnings": True, "skip_download": True, "proxy": "", **youtube_js_runtime_options()}
    with yt_dlp.YoutubeDL(options) as downloader:
        info = downloader.extract_info(video_url, download=False)
    return {
        "title": info.get("track") or info.get("title") or "Faixa do YouTube",
        "artist": info.get("artist") or info.get("creator") or info.get("channel") or info.get("uploader") or "",
        "album": info.get("album") or "",
        "albumArtist": info.get("album_artist") or "",
        "duration": info.get("duration"),
        "releaseYear": info.get("release_year") or "",
    }


def mvsep_multipart_upload(file_path, fields, progress_callback=None):
    boundary = "----VoxStage" + uuid4().hex
    chunks = []
    for key, value in fields.items():
        chunks.append((f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n").encode())
    filename = file_path.name
    mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    file_header = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"audiofile\"; filename=\"{filename}\"\r\nContent-Type: {mime}\r\n\r\n").encode()
    end = f"\r\n--{boundary}--\r\n".encode()
    body_length = sum(map(len, chunks)) + len(file_header) + file_path.stat().st_size + len(end)
    connection = http.client.HTTPSConnection("www.mvsep.com", timeout=90)
    try:
        connection.putrequest("POST", "/api/separation/create")
        connection.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
        connection.putheader("Content-Length", str(body_length))
        connection.endheaders()
        for chunk in chunks:
            connection.send(chunk)
        connection.send(file_header)
        sent = 0
        file_size = file_path.stat().st_size
        with file_path.open("rb") as source:
            while block := source.read(1024 * 1024):
                connection.send(block)
                sent += len(block)
                if progress_callback:
                    progress_callback(sent / max(1, file_size))
        connection.send(end)
        response = connection.getresponse()
        data = json.loads(response.read().decode("utf-8"))
        if response.status >= 400 or not data.get("success"):
            detail = data.get("data", {}).get("message") or f"resposta HTTP {response.status}"
            raise RuntimeError(f"MVSep recusou o envio: {detail}")
        return data.get("data", {})
    finally:
        connection.close()


def mvsep_job_status(job_hash, token):
    query = urlencode({"hash": job_hash, "api_token": token})
    with mvsep_urlopen(f"https://www.mvsep.com/api/separation/get?{query}", timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def safe_mvsep_error(error, token=""):
    message = str(error)
    if token:
        message = message.replace(token, "[chave oculta]")
    message = re.sub(r"(?i)(api_token[=\s:]+)[^&\s)]+", r"\1[chave oculta]", message)
    return message[:260]


def _timestamp_seconds(value):
    if isinstance(value, (int, float)):
        return max(0.0, float(value))
    match = re.fullmatch(r"(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})", str(value or "").strip())
    if not match:
        return None
    hours, minutes, seconds, fraction = match.groups()
    return int(hours or 0) * 3600 + int(minutes) * 60 + int(seconds) + int((fraction or "0").ljust(3, "0")[:3]) / 1000


def _split_long_lyric_phrase(phrase):
    """Split an overlong ASR block into two readable lyric lines."""
    phrase = re.sub(r"\s+", " ", str(phrase or "")).strip()
    words = list(re.finditer(r"\S+", phrase))
    if len(words) < 12 and len(phrase) < 90:
        return [(phrase, 0.0), ("", 0.0)]
    midpoint = len(words) / 2
    punctuation = []
    for match in re.finditer(r"[,;:—–]", phrase):
        left_count = len(re.findall(r"\S+", phrase[:match.end()]))
        if 0.30 <= left_count / len(words) <= 0.70:
            punctuation.append((abs(left_count - midpoint), match.end(), left_count))
    if punctuation:
        _, split_at, left_count = min(punctuation)
    else:
        split_candidates = []
        for match in re.finditer(r"\s+", phrase):
            left_count = len(re.findall(r"\S+", phrase[:match.start()]))
            if 0.30 <= left_count / len(words) <= 0.70:
                split_candidates.append((abs(left_count - midpoint), match.start(), left_count))
        if not split_candidates:
            return [(phrase, 0.0), ("", 0.0)]
        _, split_at, left_count = min(split_candidates)
    left, right = phrase[:split_at].strip(), phrase[split_at:].strip()
    if not left or not right:
        return [(phrase, 0.0), ("", 0.0)]
    return [(left, 0.0), (right, left_count / len(words))]


def _mvsep_file_entries(files):
    if isinstance(files, dict):
        entries = [{"label": key, **(value if isinstance(value, dict) else {"url": value})} for key, value in files.items()]
    elif isinstance(files, list):
        entries = files
    else:
        entries = []
    outputs = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        label = str(entry.get("name") or entry.get("stem") or entry.get("type") or entry.get("title") or entry.get("filename") or entry.get("label") or "Stem")
        link = next((entry.get(key) for key in ("url", "link", "download_url", "file_url", "filelink", "download") if isinstance(entry.get(key), str) and entry[key].startswith("https://")), "")
        if not link:
            continue
        host = (urlparse(link).hostname or "").lower()
        if not (host == "mvsep.com" or host.endswith(".mvsep.com")):
            continue
        lowered = re.sub(r"[^a-z]", "", label.lower())
        if "vocalsfull" in lowered:
            role = "ignore"
        elif "instrumentalonly" in lowered or "instrumonly" in lowered:
            role = "inst"
        elif "vocalslead" in lowered or "lead" in lowered:
            role = "lead"
        elif "vocalsback" in lowered or "backing" in lowered or ("back" in lowered and "instrum" not in lowered):
            role = "back"
        elif lowered == "instrumental" or lowered in {"instrum", "music", "other"}:
            role = "inst"
        elif "vocal" in lowered and "back" not in lowered and "instrum" not in lowered:
            role = "lead"
        else:
            role = "ignore"
        outputs.append({"label": label, "url": link, "role": role})
    if any(entry["role"] == "inst" and "only" in re.sub(r"[^a-z]", "", entry["label"].lower()) for entry in outputs):
        for entry in outputs:
            if entry["role"] == "inst" and "only" not in re.sub(r"[^a-z]", "", entry["label"].lower()):
                entry["role"] = "ignore"
    return outputs


def youtube_mvsep_worker(job_id, video_url, model_id, model_options, source_song_id=None):
    with youtube_jobs_lock:
        youtube_jobs[job_id]["stage"] = "downloading"
        youtube_jobs[job_id].update({"message": "Baixando o áudio…", "progress": 1, "indeterminate": True})
    token = ""
    try:
        token = get_mvsep_token()
        if not token:
            raise RuntimeError("Configure sua chave da API MVSep nas configurações do VoxStage.")
        if source_song_id is None and not valid_youtube_url(video_url):
            raise ValueError("Use um link direto de vídeo do YouTube.")
        with tempfile.TemporaryDirectory(prefix="voxstage-mvsep-") as temp_dir:
            if source_song_id:
                song = next((item for item in read_library() if item.get("id") == source_song_id), None)
                if not song or not SAFE_NAME.fullmatch(song.get("source", "")):
                    raise ValueError("Não encontrei o arquivo da música completa.")
                audio_path = MEDIA / song["source"]
                if not audio_path.is_file():
                    raise ValueError("O arquivo de origem não está mais na pasta music.")
                info = {"title": song.get("title"), "artist": song.get("artist")}
            else:
                try:
                    import yt_dlp
                except ImportError as error:
                    raise RuntimeError("O yt-dlp ainda não está instalado. Instale as dependências listadas em requirements-youtube.txt.") from error
                def download_progress(status):
                    if status.get("status") != "downloading":
                        return
                    total = status.get("total_bytes") or status.get("total_bytes_estimate")
                    progress = status.get("downloaded_bytes", 0) / total if total else None
                    with youtube_jobs_lock:
                        if job_id in youtube_jobs:
                            youtube_jobs[job_id].update({"progress": min(18, 2 + int(16 * progress)) if progress is not None else 8, "indeterminate": progress is None, "message": "Baixando o áudio do YouTube…"})

                options = {"format": "bestaudio[ext=m4a]/bestaudio/best", "outtmpl": str(Path(temp_dir) / "source.%(ext)s"), "noplaylist": True, "quiet": True, "no_warnings": True, "max_filesize": 512 * 1024 * 1024, "progress_hooks": [download_progress], "proxy": "", **youtube_js_runtime_options()}
                with yt_dlp.YoutubeDL(options) as downloader:
                    info = downloader.extract_info(video_url, download=True)
                    audio_path = Path(downloader.prepare_filename(info))
                if not audio_path.is_file():
                    candidates = list(Path(temp_dir).glob("source.*"))
                    if not candidates:
                        raise RuntimeError("O yt-dlp não gerou um arquivo de áudio compatível.")
                    audio_path = candidates[0]
            with youtube_jobs_lock:
                youtube_jobs[job_id].update({"stage": "sending", "message": "Enviando o áudio para a MVSep…", "progress": 20, "indeterminate": False, "title": info.get("title") or "Música do YouTube", "artist": info.get("artist") or info.get("channel") or info.get("uploader") or ""})

            def upload_progress(fraction):
                with youtube_jobs_lock:
                    if job_id in youtube_jobs:
                        youtube_jobs[job_id].update({"progress": 20 + int(10 * fraction), "indeterminate": False})

            fields = {"api_token": token, "sep_type": str(model_id), "output_format": "0", **model_options}
            created = mvsep_multipart_upload(audio_path, fields, upload_progress)
            job_hash = created.get("hash")
            if not job_hash:
                raise RuntimeError("A MVSep não retornou o identificador do processamento.")
            with youtube_jobs_lock:
                youtube_jobs[job_id].update({"stage": "processing", "message": "Na fila da MVSep…", "progress": 30, "indeterminate": True, "mvsepHash": job_hash})
            deadline = time.monotonic() + 60 * 60
            while time.monotonic() < deadline:
                try:
                    result = mvsep_job_status(job_hash, token)
                except (URLError, TimeoutError, ConnectionError, http.client.HTTPException, json.JSONDecodeError) as error:
                    if isinstance(error, HTTPError) and error.code < 500 and error.code != 429:
                        raise RuntimeError(f"MVSep recusou a consulta (HTTP {error.code}). Confira sua chave.") from None
                    with youtube_jobs_lock:
                        youtube_jobs[job_id].update({"stage": "reconnecting", "message": "Conexão interrompida. Tentando consultar novamente, sem reenviar a música…", "indeterminate": True})
                    time.sleep(5)
                    continue
                status = result.get("status")
                data = result.get("data", {})
                if status == "failed":
                    raise RuntimeError(f"MVSep informou falha: {data.get('message') or 'não foi possível separar esta faixa.'}")
                if status == "not_found":
                    raise RuntimeError("A MVSep não encontrou este processamento. Tente novamente.")
                if status == "done":
                    entries = _mvsep_file_entries(result.get("data", {}).get("files"))
                    if not entries:
                        raise RuntimeError("A separação terminou, mas não encontrei os links dos stems na resposta da MVSep.")
                    ready = []
                    for index, entry in enumerate(entries):
                        with youtube_jobs_lock:
                            youtube_jobs[job_id].update({"stage": "receiving", "message": f"Recebendo arquivos da MVSep… ({index + 1} de {len(entries)})", "progress": 90 + int(9 * index / len(entries)), "indeterminate": True})
                        ext = (Path(urlparse(entry["url"]).path).suffix or ".mp3").lower().lstrip(".")
                        ext = re.sub(r"[^a-z0-9]", "", ext)[:8] or "mp3"
                        name = f"{uuid4()}.{ext}"
                        request = Request(entry["url"], headers={"User-Agent": "VoxStage/0.1"})
                        with mvsep_urlopen(request, timeout=120) as response, (MEDIA / name).open("wb") as destination:
                            content_length = int(response.headers.get("Content-Length") or 0)
                            received = 0
                            while block := response.read(1024 * 1024):
                                destination.write(block)
                                received += len(block)
                                fraction = received / content_length if content_length else None
                                with youtube_jobs_lock:
                                    if job_id in youtube_jobs:
                                        if fraction is not None:
                                            progress = 90 + int(9 * (index + min(1, fraction)) / len(entries))
                                            youtube_jobs[job_id].update({"progress": progress, "indeterminate": False})
                                        else:
                                            youtube_jobs[job_id]["indeterminate"] = True
                        ready.append({"name": name, "label": entry["label"], "role": entry["role"]})
                    with youtube_jobs_lock:
                        youtube_jobs[job_id].update({"stage": "done", "message": "Arquivos recebidos! Revise os papéis antes de salvar.", "progress": 100, "indeterminate": False, "files": ready})
                    return
                with youtube_jobs_lock:
                    job = youtube_jobs[job_id]
                    if status in {"waiting", "distributing"}:
                        queue_count = data.get("queue_count")
                        order = data.get("current_order")
                        if status == "waiting" and order:
                            message = f"Aguardando na fila da MVSep · posição {order}"
                        elif status == "waiting" and queue_count is not None:
                            message = f"Aguardando na fila da MVSep · {queue_count} faixa(s) antes"
                        elif status == "distributing":
                            finished, total = data.get("finished_chunks"), data.get("all_chunks")
                            message = f"Separando faixa em partes… {finished} de {total}" if total else "Preparando a faixa para separação…"
                        else:
                            message = "Aguardando na fila da MVSep…"
                        progress = 30 + int(55 * finished / total) if status == "distributing" and total and finished is not None else 30
                        job.update({"stage": status, "message": message, "progress": progress, "indeterminate": not (status == "distributing" and total and finished is not None)})
                    elif status == "merging":
                        job.update({"stage": status, "message": "Unindo as partes da faixa…", "progress": 88, "indeterminate": True})
                    else:
                        job.update({"stage": "processing", "message": "Separando vocal principal, backing vocals e instrumental…", "progress": 60, "indeterminate": True})
                time.sleep(5)
            raise RuntimeError("O processamento demorou demais. Confira o status da faixa no site da MVSep.")
    except Exception as error:
        detail = str(error).lower()
        if "javascript" in detail or "deno" in detail or "ejs" in detail:
            message = "O yt-dlp precisa de um runtime JavaScript. Instale o Deno e tente novamente."
        elif "private video" in detail or "sign in" in detail or "members-only" in detail or "not a bot" in detail:
            message = youtube_error_message(error)
        elif "unsupported url" in detail or "not a valid url" in detail:
            message = "Não consegui reconhecer esse link do YouTube. Confira o endereço e tente novamente."
        elif "429" in detail or "too many requests" in detail:
            message = "O YouTube limitou as solicitações por enquanto. Aguarde um pouco e tente novamente."
        elif "mvsep" in detail or youtube_jobs.get(job_id, {}).get("stage") in {"sending", "processing", "receiving", "waiting", "distributing", "merging"}:
            message = f"Falha na MVSep: {safe_mvsep_error(error, token)}"
        else:
            message = "Não foi possível concluir o download ou a separação. Confira a conexão, a chave MVSep e tente novamente."
        with youtube_jobs_lock:
            if job_id in youtube_jobs:
                youtube_jobs[job_id].update({"stage": "error", "message": message, "progress": youtube_jobs[job_id].get("progress", 0), "indeterminate": False})


def youtube_video_download_worker(job_id, video_url):
    with video_download_jobs_lock:
        video_download_jobs[job_id].update({"stage": "downloading", "message": "Baixando o vídeo…", "progress": 1, "indeterminate": True})
    file_id = str(uuid4())
    try:
        if not valid_youtube_url(video_url):
            raise ValueError("Cole um link direto de vídeo do YouTube.")
        try:
            import yt_dlp
        except ImportError as error:
            raise RuntimeError("O yt-dlp ainda não está instalado. Instale as dependências listadas em requirements-youtube.txt.") from error

        def download_progress(status):
            if status.get("status") == "finished":
                stage = "finalizing"
                message = "Finalizando o arquivo…"
                progress = 98
                indeterminate = True
            elif status.get("status") == "downloading":
                total = status.get("total_bytes") or status.get("total_bytes_estimate")
                fraction = status.get("downloaded_bytes", 0) / total if total else None
                stage = "downloading"
                progress = min(97, max(1, int(fraction * 97))) if fraction is not None else 12
                message = f"Baixando o vídeo… {progress}%" if fraction is not None else "Baixando o vídeo…"
                indeterminate = fraction is None
            else:
                return
            with video_download_jobs_lock:
                if job_id in video_download_jobs:
                    video_download_jobs[job_id].update({"stage": stage, "message": message, "progress": progress, "indeterminate": indeterminate})

        options = {
            # Prefer a combined stream. If YouTube only exposes separate DASH
            # tracks, download its video-only stream; the VoxStage background
            # is intentionally muted and this avoids an FFmpeg dependency.
            # Keep the temporary download beside its final destination; Windows
            # can deny cleanup of system-temp directories while yt-dlp still has handles.
            "format": "best[height<=1080]/bestvideo[height<=1080]/bestvideo/best",
            "outtmpl": str(MEDIA / f".{file_id}.%(ext)s"),
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "windowsfilenames": True,
            "max_filesize": 2 * 1024 * 1024 * 1024,
            "progress_hooks": [download_progress],
            "proxy": "",
            **youtube_js_runtime_options(),
        }
        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info(video_url, download=True)
            downloaded_path = Path(downloader.prepare_filename(info))
        if not downloaded_path.is_file():
            candidates = [path for path in MEDIA.glob(f".{file_id}.*") if path.is_file() and not path.name.endswith((".part", ".ytdl"))]
            if not candidates:
                raise RuntimeError("O yt-dlp não gerou um arquivo de vídeo compatível.")
            downloaded_path = candidates[0]

        extension = re.sub(r"[^a-z0-9]", "", downloaded_path.suffix.lower().lstrip("."))[:8] or "mp4"
        name = f"{file_id}.{extension}"
        destination = MEDIA / name
        downloaded_path.replace(destination)
        for temporary_file in MEDIA.glob(f".{file_id}.*"):
            try:
                temporary_file.unlink()
            except OSError:
                pass
        with video_download_jobs_lock:
            video_download_jobs[job_id].update({
                "stage": "done", "message": "Vídeo salvo na pasta music.", "progress": 100,
                "indeterminate": False, "title": info.get("title") or "Vídeo do YouTube",
                "name": name, "extension": extension, "size": destination.stat().st_size,
                "hasAudio": info.get("acodec") not in (None, "none"),
            })
    except Exception as error:
        for partial_file in MEDIA.glob(f".{file_id}.*"):
            try:
                if partial_file.is_file():
                    partial_file.unlink()
                elif partial_file.is_dir():
                    shutil.rmtree(partial_file)
            except OSError:
                pass
        detail = str(error).lower()
        if "javascript" in detail or "deno" in detail or "ejs" in detail:
            message = "O yt-dlp precisa de um runtime JavaScript. Instale o Deno e tente novamente."
        elif "private video" in detail or "sign in" in detail or "members-only" in detail:
            message = "Este vídeo exige acesso ou login no YouTube e não pode ser baixado agora."
        elif "max-filesize" in detail or "file is larger" in detail:
            message = "Este vídeo ultrapassa o limite local de 2 GB."
        elif "429" in detail or "too many requests" in detail:
            message = "O YouTube limitou as solicitações por enquanto. Aguarde um pouco e tente novamente."
        else:
            message = f"Não foi possível baixar o vídeo: {str(error)[:240]}"
        with video_download_jobs_lock:
            if job_id in video_download_jobs:
                video_download_jobs[job_id].update({"stage": "error", "message": message, "indeterminate": False})


def align_song_words(song_id, synced_lyrics, language="pt", execution="auto"):
    """Align a known, line-timed lyric against its local lead-vocal stem."""
    global _alignment_runtime
    try:
        import torch
        import torchaudio
        import uroman
    except ImportError as error:
        raise RuntimeError("Alinhador ausente. Instale com: pip install -r requirements-align.txt") from error

    song = next((item for item in read_library() if item.get("id") == song_id), None)
    if not song:
        raise ValueError("Música não encontrada na biblioteca local.")
    lead_name = song.get("lead")
    if not lead_name or not SAFE_NAME.fullmatch(lead_name):
        raise ValueError("Esta música não tem um arquivo de vocal principal válido.")
    audio_path = MEDIA / lead_name
    if not audio_path.is_file():
        raise ValueError("Arquivo de vocal principal não encontrado.")

    lines = []
    for row in (synced_lyrics or "").splitlines():
        stamps = re.findall(r"\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]", row)
        text = re.sub(r"\[[^\]]+\]", "", row).strip()
        if not text or not stamps:
            continue
        for minute, second, fraction in stamps:
            fraction_ms = int((fraction or "0").ljust(3, "0")[:3])
            lines.append({"time": (int(minute) * 60 + int(second)) * 1000 + fraction_ms, "text": text})
    lines.sort(key=lambda item: item["time"])
    if not lines:
        raise ValueError("A letra precisa ter tempos por linha para alinhar as palavras.")

    if not re.fullmatch(r"[a-z]{2,3}", language):
        raise ValueError("Código de idioma inválido.")
    if execution not in {"auto", "cpu", "gpu"}:
        raise ValueError("Modo de execução inválido.")
    if execution == "gpu" and not torch.cuda.is_available():
        raise RuntimeError("GPU solicitada, mas o PyTorch instalado não oferece suporte CUDA para esta placa. Selecione CPU ou Auto.")
    device = torch.device("cuda" if execution == "gpu" or (execution == "auto" and torch.cuda.is_available()) else "cpu")
    cache_key = str(device)
    if not _alignment_runtime or _alignment_runtime[0] != cache_key:
        bundle = torchaudio.pipelines.MMS_FA
        model = bundle.get_model().to(device).eval()
        _alignment_runtime = (cache_key, bundle, model, bundle.get_tokenizer(), bundle.get_aligner())
    _, bundle, model, tokenizer, aligner = _alignment_runtime
    romanizer = uroman.Uroman()

    # MMS-FA usa tokens em alfabeto latino; uroman normaliza escritas diversas.
    def roman_tokens(text):
        roman = romanizer.romanize_string(text).lower().replace("’", "'")
        roman = re.sub(r"[^a-z' ]", " ", roman)
        return roman.split()

    display_words = []
    model_tokens = []
    token_owners = []
    for line_index, line in enumerate(lines):
        row = []
        for display_index, original in enumerate(line["text"].split()):
            normalized = roman_tokens(original)
            if not normalized:
                row.append({"word": original, "start": None, "end": None})
                continue
            row.append({"word": original, "start": None, "end": None})
            model_tokens.extend(normalized)
            token_owners.extend([(line_index, len(row) - 1)] * len(normalized))
        display_words.append(row)
    if not model_tokens:
        raise ValueError("Não consegui normalizar a escrita desta letra para o alinhador multilíngue.")

    waveform, sample_rate = torchaudio.load(str(audio_path))
    if waveform.size(0) > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    if sample_rate != bundle.sample_rate:
        waveform = torchaudio.functional.resample(waveform, sample_rate, bundle.sample_rate)
    with torch.inference_mode():
        emission, _ = model(waveform.to(device))
        token_spans = aligner(emission[0], tokenizer(model_tokens))
    ratio = waveform.size(1) / emission.size(1) / bundle.sample_rate
    for owner, span in zip(token_owners, token_spans):
        if not span:
            continue
        line_index, word_index = owner
        word = display_words[line_index][word_index]
        start, end = span[0].start * ratio, span[-1].end * ratio
        word["start"] = start if word["start"] is None else min(word["start"], start)
        word["end"] = end if word["end"] is None else max(word["end"], end)

    aligned_lines = [{"lineIndex": index, "words": [word for word in words if word["start"] is not None]}
                     for index, words in enumerate(display_words)]
    if not any(item["words"] for item in aligned_lines):
        raise ValueError("O alinhador não encontrou palavras no vocal. Confira se a letra corresponde a esta gravação.")
    return {"language": "multilíngue MMS-FA", "device": str(device), "wordTimings": aligned_lines}


def read_library():
    try:
        data = json.loads(LIBRARY.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []


LOCAL_AUDIO_MODEL = "UVR-MDX-NET-Inst_HQ_3.onnx"


def local_audio_environment(backend):
    if backend not in {"cpu", "directml"}:
        raise ValueError("Escolha CPU ou GPU DirectML.")
    env_name = ".venv-local-audio-dml" if backend == "directml" else ".venv-local-audio-cpu"
    candidate = ROOT / env_name / "Scripts" / "python.exe"
    return candidate if candidate.is_file() else Path(sys.executable)


def local_audio_backend_status(backend):
    interpreter = local_audio_environment(backend)
    if not interpreter.is_file():
        return {"installed": False, "backend": backend}
    probe = "import importlib.util,json; import audio_separator; import onnxruntime as ort; import torch; print(json.dumps({'available': True, 'providers': ort.get_available_providers(), 'torch': torch.__version__}))"
    if backend == "directml":
        probe = "import importlib.util,json; import audio_separator; import onnxruntime as ort; import torch_directml; print(json.dumps({'available': torch_directml.is_available() and 'DmlExecutionProvider' in ort.get_available_providers(), 'providers': ort.get_available_providers()}))"
    try:
        result = subprocess.run([str(interpreter), "-c", probe], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=35,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if result.returncode != 0:
            return {"installed": False, "backend": backend, "detail": (result.stderr or "").strip()[-280:]}
        details = json.loads(result.stdout.strip().splitlines()[-1])
        return {"installed": bool(details.get("available", True)), "backend": backend, **details}
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        return {"installed": False, "backend": backend, "detail": str(error)[:180]}


def youtube_import_status():
    try:
        import yt_dlp
        return {"installed": True, "version": getattr(yt_dlp.version, "__version__", "instalado"),
                "denoAvailable": bool(shutil.which("deno"))}
    except ImportError:
        return {"installed": False, "denoAvailable": bool(shutil.which("deno"))}


def update_setup_job(job_id, **changes):
    with setup_jobs_lock:
        if job_id in setup_jobs:
            setup_jobs[job_id].update(changes)


def run_setup_command(job_id, command, label, progress, cwd=ROOT):
    update_setup_job(job_id, stage="installing", message=label, progress=progress)
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    process = subprocess.Popen(command, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               text=True, encoding="utf-8", errors="replace", bufsize=1,
                               creationflags=creationflags)
    tail = []
    assert process.stdout is not None
    for line in process.stdout:
        clean = line.strip()
        if not clean:
            continue
        tail.append(clean[-350:])
        tail = tail[-8:]
        update_setup_job(job_id, detail="\n".join(tail))
    return_code = process.wait()
    if return_code:
        detail = "\n".join(tail[-4:])
        raise RuntimeError(f"{label} (código {return_code}). {detail}"[:900])


def setup_install_worker(job_id, feature, backend=None):
    try:
        if feature == "local-audio":
            if backend not in {"cpu", "directml"}:
                raise ValueError("Escolha CPU ou GPU DirectML.")
            launcher = shutil.which("py") or str(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Python" / "Launcher" / "py.exe")
            if not Path(launcher).is_file():
                raise RuntimeError("O Python Launcher do Windows (py) não foi encontrado.")
            env_name = ".venv-local-audio-dml" if backend == "directml" else ".venv-local-audio-cpu"
            env_dir = ROOT / env_name
            python = env_dir / "Scripts" / "python.exe"
            if not python.is_file():
                run_setup_command(job_id, [launcher, "-3.12", "-m", "venv", str(env_dir)],
                                  "Criando ambiente isolado com Python 3.12…", 8)
            if not python.is_file():
                raise RuntimeError("O ambiente Python 3.12 não foi criado. Confira se Python 3.12 x64 está instalado.")
            requirements = ROOT / ("requirements-local-audio-dml.txt" if backend == "directml" else "requirements-local-audio-cpu.txt")
            run_setup_command(job_id, [str(python), "-m", "pip", "install", "--upgrade", "pip"],
                              "Atualizando o instalador de pacotes…", 20)
            run_setup_command(job_id, [str(python), "-m", "pip", "install", "-r", str(requirements)],
                              f"Instalando separação local para {backend.upper()}…", 32)
            status = local_audio_backend_status(backend)
            if not status.get("installed"):
                raise RuntimeError(status.get("detail") or "O ambiente foi instalado, mas o mecanismo não passou na verificação.")
        elif feature in {"lyrics-align", "youtube"}:
            requirements = ROOT / ("requirements-align.txt" if feature == "lyrics-align" else "requirements-youtube.txt")
            label = "Instalando o alinhador multilíngue de letras…" if feature == "lyrics-align" else "Instalando o importador do YouTube…"
            run_setup_command(job_id, [sys.executable, "-m", "pip", "install", "--upgrade", "pip"], label, 12)
            run_setup_command(job_id, [sys.executable, "-m", "pip", "install", "-r", str(requirements)], label, 30)
            if feature == "lyrics-align":
                probe = subprocess.run([sys.executable, "-c", "import torchaudio; assert hasattr(torchaudio.pipelines, 'MMS_FA')"],
                                       cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=45,
                                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                if probe.returncode:
                    raise RuntimeError((probe.stderr or "MMS-FA não foi encontrado no Torchaudio instalado.")[-700:])
            elif not youtube_import_status().get("installed"):
                raise RuntimeError("O pacote yt-dlp não foi encontrado após a instalação.")
        else:
            raise ValueError("Recurso de instalação desconhecido.")
        update_setup_job(job_id, stage="done", message="Instalação concluída.", progress=100)
    except Exception as error:
        traceback.print_exc()
        update_setup_job(job_id, stage="error", message=str(error)[:900], progress=0)


def update_local_separation_job(job_id, **changes):
    with local_separation_jobs_lock:
        if job_id in local_separation_jobs:
            local_separation_jobs[job_id].update(changes)


def local_audio_separation_worker(job_id, song_id, backend):
    source_path = None
    created_files = []
    try:
        library = read_library()
        song = next((item for item in library if item.get("id") == song_id), None)
        if not song or song.get("separationStatus") != "pending":
            raise ValueError("Esta música não está aguardando separação local.")
        source_name = song.get("source", "")
        if not SAFE_NAME.fullmatch(source_name):
            raise ValueError("Não encontrei o arquivo da música completa na pasta music.")
        source_path = MEDIA / source_name
        if not source_path.is_file():
            raise ValueError("O arquivo de origem não está mais na pasta music.")

        interpreter = local_audio_environment(backend)
        status = local_audio_backend_status(backend)
        if not status.get("installed"):
            dependency = "CPU" if backend == "cpu" else "GPU DirectML"
            raise RuntimeError(f"O mecanismo {dependency} não está instalado. Abra Configurações → Configurar recursos opcionais para instalá-lo.")

        free_bytes = shutil.disk_usage(ROOT).free
        if free_bytes < 2 * 1024**3:
            raise RuntimeError(f"Há apenas {free_bytes / 1024**3:.1f} GB livres no disco. Libere pelo menos 2 GB e tente novamente.")

        job_dir = Path(tempfile.mkdtemp(prefix=f"voxstage-local-{job_id[:8]}-", dir=str(ROOT)))
        output_dir = job_dir / "output"
        output_dir.mkdir()
        model_dir = ROOT / ".voxstage-models" / "audio-separator"
        model_dir.mkdir(parents=True, exist_ok=True)
        log_dir = ROOT / ".voxstage-models" / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = log_dir / f"separation-{job_id}.log"
        runner = ROOT / "local_audio_runner.py"
        command = [str(interpreter), str(runner), str(source_path), str(output_dir), str(model_dir), backend]
        log_path.write_text("VoxStage · separação local\n", encoding="utf-8")
        update_local_separation_job(job_id, logPath=str(log_path.relative_to(ROOT)))
        update_local_separation_job(job_id, stage="processing", message="Baixando o modelo ou preparando o áudio; na primeira execução pode demorar…", progress=4, indeterminate=True)
        child_env = os.environ.copy()
        ffmpeg_probe = subprocess.run(
            [str(interpreter), "-c", "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"],
            cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=25,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if ffmpeg_probe.returncode:
            raise RuntimeError("FFmpeg não está disponível no ambiente de áudio. Reinstale a separação local pelo onboarding.")
        ffmpeg_path = Path(ffmpeg_probe.stdout.strip().splitlines()[-1])
        if not ffmpeg_path.is_file():
            raise RuntimeError("O executável FFmpeg do ambiente de áudio não foi encontrado.")
        # audio-separator invokes the literal command `ffmpeg`; imageio-ffmpeg's
        # bundled binary has a versioned filename, so expose it under the name
        # Windows PATH lookup expects. A hard link avoids duplicating the binary.
        ffmpeg_alias_dir = job_dir / "bin"
        ffmpeg_alias_dir.mkdir()
        ffmpeg_alias = ffmpeg_alias_dir / "ffmpeg.exe"
        try:
            os.link(ffmpeg_path, ffmpeg_alias)
        except OSError:
            shutil.copy2(ffmpeg_path, ffmpeg_alias)
        child_env["PATH"] = str(ffmpeg_alias_dir) + os.pathsep + child_env.get("PATH", "")
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        process = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   text=True, encoding="utf-8", errors="replace", bufsize=1,
                                   env=child_env, creationflags=creationflags)
        log_tail = []
        assert process.stdout is not None
        with log_path.open("a", encoding="utf-8", errors="replace") as log_file:
            for line in process.stdout:
                clean = line.strip()
                if not clean:
                    continue
                log_file.write(clean + "\n")
                log_file.flush()
                log_tail.append(clean[-400:])
                log_tail = log_tail[-12:]
                if "VOXSTAGE:MODEL" in clean:
                    update_local_separation_job(job_id, message="Preparando o modelo local…", progress=8, indeterminate=True)
                elif "VOXSTAGE:SEPARATE" in clean:
                    update_local_separation_job(job_id, message="Separando vocal e instrumental no computador…", progress=15, indeterminate=True)
        return_code = process.wait()
        if return_code != 0:
            reason = next((line.split("VOXSTAGE:ERROR", 1)[-1].strip() for line in reversed(log_tail) if "VOXSTAGE:ERROR" in line), "")
            if reason:
                raise RuntimeError(f"{reason} (log: {log_path.relative_to(ROOT)})")
            tail = " | ".join(log_tail[-4:])
            detail = f" Últimas mensagens: {tail}" if tail else " O processo fechou sem registrar mensagens."
            raise RuntimeError(f"O separador encerrou inesperadamente (código {return_code}). Consulte {log_path.relative_to(ROOT)}.{detail}")

        vocal_output = output_dir / "voxstage-vocals.wav"
        instrumental_output = output_dir / "voxstage-instrumental.wav"
        if not vocal_output.is_file() or not instrumental_output.is_file():
            raise RuntimeError("O modelo terminou sem gerar os dois stems esperados.")
        update_local_separation_job(job_id, stage="saving", message="Salvando os stems na biblioteca local…", progress=90, indeterminate=False)
        lead_name, inst_name = f"{uuid4()}.wav", f"{uuid4()}.wav"
        shutil.copy2(vocal_output, MEDIA / lead_name); created_files.append(MEDIA / lead_name)
        shutil.copy2(instrumental_output, MEDIA / inst_name); created_files.append(MEDIA / inst_name)
        latest = read_library()
        latest_song = next((item for item in latest if item.get("id") == song_id), None)
        if not latest_song:
            raise RuntimeError("A música foi removida enquanto a separação acontecia.")
        latest_song.update({"inst": inst_name, "lead": lead_name, "separationStatus": "complete", "separationEngine": f"local-{backend}"})
        temp = LIBRARY.with_suffix(".json.tmp")
        temp.write_text(json.dumps(latest, ensure_ascii=False, indent=2), encoding="utf-8")
        temp.replace(LIBRARY)
        update_local_separation_job(job_id, stage="done", message="Separação concluída · vocal combinado e instrumental salvos.", progress=100, indeterminate=False)
    except Exception as error:
        for file_path in created_files:
            try:
                file_path.unlink()
            except FileNotFoundError:
                pass
        traceback.print_exc()
        update_local_separation_job(job_id, stage="error", message=str(error)[:260], progress=0, indeterminate=False)
    finally:
        if "job_dir" in locals():
            shutil.rmtree(job_dir, ignore_errors=True)


def import_remote_transfer(item):
    """Persist a completed, paired-phone transfer directly into the host library."""
    with LIBRARY_LOCK:
        directory = REMOTE_INCOMING / item["id"]
        library = read_library()
        song = dict(item["song"])
        existing = next((entry for entry in library if entry.get("id") == song["id"]), None)
        if existing is not None:
            shutil.rmtree(directory, ignore_errors=True)
            return existing
        copied = []
        try:
            renamed = {}
            for name in item["files"]:
                new_name = f"{uuid4()}{Path(name).suffix.lower()}"
                shutil.copy2(directory / name, MEDIA / new_name)
                copied.append(MEDIA / new_name)
                renamed[name] = new_name
            for key in REMOTE_MEDIA_FIELDS:
                if song.get(key):
                    song[key] = renamed[song[key]]
            library.append(song)
            temp = LIBRARY.with_suffix(".json.tmp")
            temp.write_text(json.dumps(library, ensure_ascii=False, indent=2), encoding="utf-8")
            temp.replace(LIBRARY)
        except Exception:
            for file in copied:
                file.unlink(missing_ok=True)
            raise
        shutil.rmtree(directory, ignore_errors=True)
        with remote_commands_lock:
            remote_commands[:] = [command for command in remote_commands if command.get("action") != "library-changed"]
            remote_commands.append({"action": "library-changed"})
        return song

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _is_loopback(self):
        try:
            return ipaddress.ip_address(self.client_address[0]).is_loopback
        except (ValueError, IndexError):
            return False

    def _allow_network_route(self):
        path = urlparse(self.path).path
        if self._is_loopback():
            return True
        # The LAN listener exposes only the paired remote page and its API.
        return path in {"/remote", "/remote/"} or path.startswith("/api/remote/")

    def _require_remote_token(self):
        supplied = self.headers.get("Authorization", "")
        supplied = supplied.removeprefix("Bearer ") if supplied.startswith("Bearer ") else ""
        if not supplied or not hmac.compare_digest(supplied, REMOTE_TOKEN):
            self.send_json({"error": "Sessão remota inválida. Leia o QR do host novamente."}, 401)
            return False
        return True

    def _read_remote_json(self, max_bytes=16 * 1024):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > max_bytes:
            raise ValueError("Pedido vazio ou grande demais.")
        data = json.loads(self.rfile.read(length))
        if not isinstance(data, dict):
            raise ValueError("Formato de pedido inválido.")
        return data

    def send_json(self, data, status=200):
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if not self._allow_network_route():
            return self.send_error(403, "LAN access is limited to the paired remote control")
        if urlparse(self.path).path == "/api/build-mode":
            if not self._is_loopback():
                return self.send_error(403)
            return self.send_json({"debug": os.environ.get("VOXSTAGE_DEBUG_BUILD") == "1"})
        path = unquote(urlparse(self.path).path)
        if path in {"/remote", "/remote/"}:
            remote_page = (ROOT / "remote.html").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(remote_page)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return self.wfile.write(remote_page)
        if path == "/api/remote/host-info":
            if not self._is_loopback():
                return self.send_error(403)
            address = get_lan_ipv4()
            return self.send_json({"address": address, "token": REMOTE_TOKEN, "url": f"http://{address}:{self.server.server_port}/remote#{REMOTE_TOKEN}" if address else ""})
        if path == "/api/remote/library":
            if not self._require_remote_token():
                return
            transfer_fields = REMOTE_SONG_FIELDS
            return self.send_json([
                {key: value for key, value in song.items() if key in transfer_fields}
                for song in read_library() if not song.get("hidden", False)
            ])
        if path == "/api/remote/transfers":
            if not self._is_loopback():
                return self.send_error(403)
            with remote_transfers_lock:
                pending = [{"id": item["id"], "title": item["song"].get("title", ""),
                            "artist": item["song"].get("artist", ""), "status": item["status"],
                            "files": len(item["files"])}
                           for item in remote_transfers.values() if item["status"] == "pending"]
            return self.send_json(pending)
        transfer_status = re.fullmatch(r"/api/remote/transfers/([a-f0-9-]{36})", path, re.I)
        if transfer_status:
            if not self._require_remote_token():
                return
            with remote_transfers_lock:
                item = remote_transfers.get(transfer_status.group(1))
                result = {"id": item["id"], "status": item["status"], "error": item.get("error", "")} if item else None
            return self.send_json(result if result else {"error": "Transferência não encontrada."}, 200 if result else 404)
        remote_media_match = re.fullmatch(r"/api/remote/media/([a-f0-9-]{36}\.[a-z0-9]{1,8})", path, re.I)
        if remote_media_match:
            if not self._require_remote_token():
                return
            name = remote_media_match.group(1)
            file_path = MEDIA / name
            if not file_path.is_file():
                return self.send_error(404)
            size = file_path.stat().st_size
            requested = self.headers.get("Range", "")
            range_match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested)
            start, end = 0, size - 1
            partial = bool(range_match)
            if range_match:
                if range_match.group(1):
                    start = int(range_match.group(1))
                    end = int(range_match.group(2)) if range_match.group(2) else size - 1
                elif range_match.group(2):
                    start = max(0, size - int(range_match.group(2)))
                if start >= size or end < start:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.end_headers()
                    return
                end = min(end, size - 1)
            length = end - start + 1
            self.send_response(206 if partial else 200)
            self.send_header("Content-Type", mimetypes.guess_type(name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(length))
            self.send_header("Accept-Ranges", "bytes")
            if partial:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            with file_path.open("rb") as media_file:
                media_file.seek(start)
                remaining = length
                while remaining:
                    chunk = media_file.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
            return
        if path == "/api/remote/state":
            if not self._require_remote_token():
                return
            with remote_state_lock:
                return self.send_json(dict(remote_state))
        if path == "/api/remote/microphone":
            if not self._require_remote_token():
                return
            return self.send_json(remote_microphone.status())
        if path == "/api/remote/microphone/frames":
            if not self._is_loopback():
                return self.send_error(403)
            return self.send_json(remote_microphone.drain())
        remote_request_match = re.fullmatch(r"/api/remote/request/([a-f0-9-]{36})", path, re.I)
        if remote_request_match:
            if not self._require_remote_token():
                return
            with remote_requests_lock:
                item = remote_requests.get(remote_request_match.group(1))
                return self.send_json(dict(item) if item else {"error": "Pedido não encontrado."}, 200 if item else 404)
        if path == "/api/remote/requests":
            if not self._is_loopback():
                return self.send_error(403)
            with remote_requests_lock:
                requests = sorted(remote_requests.values(), key=lambda item: item.get("created", 0), reverse=True)
                return self.send_json([dict(item) for item in requests[:40]])
        if path == "/api/remote/commands":
            if not self._is_loopback():
                return self.send_error(403)
            with remote_commands_lock:
                commands = list(remote_commands)
                remote_commands.clear()
            return self.send_json({"commands": commands})
        if path == "/api/local-audio/status":
            backend = "directml" if urlparse(self.path).query == "backend=directml" else "cpu"
            return self.send_json(local_audio_backend_status(backend))
        if path == "/api/youtube/status":
            return self.send_json(youtube_import_status())
        setup_job_match = re.fullmatch(r"/api/setup/jobs/([a-f0-9-]{36})", path, re.I)
        if setup_job_match:
            with setup_jobs_lock:
                job = setup_jobs.get(setup_job_match.group(1))
                return self.send_json(dict(job) if job else {"stage": "missing", "message": "Instalação não encontrada."}, 200 if job else 404)
        if path == "/api/local/separations":
            with local_separation_jobs_lock:
                jobs = [dict(job) for job in local_separation_jobs.values() if job.get("stage") not in {"done", "error"}]
            return self.send_json({"jobs": jobs})
        local_job_match = re.fullmatch(r"/api/local/separations/([a-f0-9-]{36})", path, re.I)
        if local_job_match:
            with local_separation_jobs_lock:
                job = local_separation_jobs.get(local_job_match.group(1))
                return self.send_json(dict(job) if job else {"stage": "missing", "message": "Processamento não encontrado."}, 200 if job else 404)
        if path == "/api/align/status":
            try:
                import torch
                available = bool(torch.cuda.is_available())
                try:
                    import torchaudio
                    mms_fa_available = hasattr(torchaudio.pipelines, "MMS_FA")
                    torchaudio_version = str(torchaudio.__version__)
                except ImportError:
                    mms_fa_available = False
                    torchaudio_version = None
                return self.send_json({
                    "installed": True,
                    "torch": str(torch.__version__),
                    "available": available,
                    "mmsFaAvailable": mms_fa_available,
                    "torchaudio": torchaudio_version,
                    "device": torch.cuda.get_device_name(0) if available else None,
                    "backend": "ROCm" if getattr(torch.version, "hip", None) else "CUDA" if getattr(torch.version, "cuda", None) else "CPU",
                    "runtime": getattr(torch.version, "hip", None) or getattr(torch.version, "cuda", None),
                })
            except ImportError:
                return self.send_json({"installed": False, "available": False, "backend": "none"})
            except Exception as error:
                return self.send_json({"installed": True, "available": False, "backend": "unknown", "error": str(error)[:180]})
        if path == "/api/mvsep/config":
            return self.send_json({"configured": bool(get_mvsep_token())})
        if path == "/api/mvsep/models":
            try:
                return self.send_json({"models": mvsep_models()})
            except Exception as error:
                return self.send_json({"error": str(error)[:240]}, 503)
        video_download_match = re.fullmatch(r"/api/youtube/video-downloads/([a-f0-9-]{36})", path, re.I)
        if video_download_match:
            with video_download_jobs_lock:
                job = video_download_jobs.get(video_download_match.group(1))
                return self.send_json(dict(job) if job else {"stage": "missing", "message": "Este download não foi encontrado."}, 200 if job else 404)
        youtube_job_match = re.fullmatch(r"/api/youtube/separations/([a-f0-9-]{36})", path, re.I)
        if youtube_job_match:
            with youtube_jobs_lock:
                job = youtube_jobs.get(youtube_job_match.group(1))
                return self.send_json(dict(job) if job else {"stage": "missing", "message": "Processamento não encontrado."}, 200 if job else 404)
        if path == "/api/library":
            return self.send_json(read_library())
        if path.startswith("/music/"):
            name = path.removeprefix("/music/")
            if not SAFE_NAME.fullmatch(name):
                return self.send_error(404)
            file_path = MEDIA / name
            if not file_path.is_file():
                return self.send_error(404)
            size = file_path.stat().st_size
            requested = self.headers.get("Range", "")
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested)
            start, end = 0, size - 1
            partial = bool(match)
            if match:
                if match.group(1):
                    start = int(match.group(1))
                    end = int(match.group(2)) if match.group(2) else size - 1
                elif match.group(2):
                    start = max(0, size - int(match.group(2)))
                if start >= size or end < start:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.end_headers()
                    return
                end = min(end, size - 1)
            with file_path.open("rb") as media_file:
                media_file.seek(start)
                content = media_file.read(end - start + 1)
            self.send_response(206 if partial else 200)
            self.send_header("Content-Type", mimetypes.guess_type(name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Accept-Ranges", "bytes")
            if partial:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            return self.wfile.write(content)
        return super().do_GET()

    def do_PUT(self):
        if not self._allow_network_route():
            return self.send_error(403, "LAN access is limited to the paired remote control")
        path = unquote(urlparse(self.path).path)
        transfer_media = re.fullmatch(r"/api/remote/transfers/([a-f0-9-]{36})/media/([a-f0-9-]{36}\.[a-z0-9]{1,8})", path, re.I)
        if transfer_media:
            if not self._require_remote_token():
                return
            transfer_id, name = transfer_media.groups()
            try:
                length = int(self.headers.get("Content-Length", "0"))
                offset = int(self.headers.get("X-Offset", "-1"))
                total = int(self.headers.get("X-Total", "0"))
            except ValueError:
                return self.send_json({"error": "Tamanho de arquivo inválido."}, 400)
            if length <= 0 or length > 2 * 1024 * 1024 or total <= 0 or total > 2 * 1024 * 1024 * 1024 or offset < 0 or offset + length > total:
                return self.send_json({"error": "Trecho de arquivo inválido."}, 413)
            with remote_transfers_lock:
                item = remote_transfers.get(transfer_id)
                if not item or item["status"] != "uploading" or name not in item["files"]:
                    return self.send_json({"error": "Transferência indisponível."}, 409)
                directory = REMOTE_INCOMING / transfer_id
                destination = directory / name
                if (destination.stat().st_size if destination.exists() else 0) != offset:
                    return self.send_json({"error": "Trecho fora de ordem."}, 409)
                with destination.open("ab") as output:
                    remaining = length
                    while remaining:
                        data = self.rfile.read(min(256 * 1024, remaining))
                        if not data:
                            return self.send_json({"error": "Envio interrompido."}, 400)
                        output.write(data)
                        remaining -= len(data)
                item["sizes"][name] = total
            return self.send_json({"name": name, "received": offset + length})
        name = path.removeprefix("/api/files/")
        if not path.startswith("/api/files/") or not SAFE_NAME.fullmatch(name):
            return self.send_error(400, "Invalid file name")
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 2 * 1024 * 1024 * 1024:
            return self.send_error(413, "File is empty or exceeds 2 GB")
        with (MEDIA / name).open("wb") as destination:
            remaining = length
            while remaining:
                chunk = self.rfile.read(min(1024 * 1024, remaining))
                if not chunk:
                    return self.send_error(400, "Incomplete upload")
                destination.write(chunk)
                remaining -= len(chunk)
        self.send_json({"name": name}, 201)

    def do_POST(self):
        global REMOTE_TOKEN
        if not self._allow_network_route():
            return self.send_error(403, "LAN access is limited to the paired remote control")
        parsed_path = urlparse(self.path).path
        if parsed_path == "/api/about/open-link":
            if not self._is_loopback():
                return self.send_error(403)
            try:
                url = self._read_remote_json(1024).get("url")
                if url not in {"https://github.com/kaua0f0m", "https://www.youtube.com/@funkyblackcat"}:
                    raise ValueError("Link de atribuição inválido.")
                if sys.platform == "win32":
                    os.startfile(url)
                else:
                    import webbrowser
                    if not webbrowser.open_new_tab(url):
                        raise OSError("Nenhum navegador disponível.")
                return self.send_json({"opened": True})
            except (ValueError, TypeError, AttributeError, OSError) as error:
                return self.send_json({"error": str(error)}, 400)
        if parsed_path in ("/api/remote/microphone", "/api/remote/microphone/session"):
            if parsed_path.endswith('/session'):
                if not self._is_loopback():
                    return self.send_error(403)
            elif not self._require_remote_token():
                return
            try:
                body = self._read_remote_json()
                if not isinstance(body, dict):
                    raise ValueError("Pacote inválido.")
                result = remote_microphone.configure(body) if parsed_path.endswith('/session') else remote_microphone.receive(body)
                return self.send_json(result)
            except (ValueError, TypeError, AttributeError, json.JSONDecodeError) as error:
                return self.send_json({"error": str(error)}, 400)
        if parsed_path == "/api/remote/transfers":
            if not self._require_remote_token():
                return
            try:
                body = self._read_remote_json(1024 * 1024)
                raw_song = body.get("song")
                if not isinstance(raw_song, dict):
                    raise ValueError("Dados da música inválidos.")
                song = {key: value for key, value in raw_song.items() if key in REMOTE_SONG_FIELDS}
                if not isinstance(song.get("id"), str) or not re.fullmatch(r"[a-f0-9-]{36}", song["id"], re.I):
                    raise ValueError("Identificador da música inválido.")
                if not isinstance(song.get("title"), str) or not song["title"].strip():
                    raise ValueError("A música precisa de um título.")
                file_values = [song[key] for key in REMOTE_MEDIA_FIELDS if song.get(key)]
                if any(not isinstance(name, str) for name in file_values):
                    raise ValueError("Os arquivos da música são inválidos.")
                files = set(file_values)
                if not files or not (song.get("inst") or song.get("source")) or any(not isinstance(name, str) or not SAFE_NAME.fullmatch(name) for name in files):
                    raise ValueError("Os arquivos da música são inválidos.")
                if any(entry.get("id") == song["id"] for entry in read_library()):
                    return self.send_json({"error": "Esta música já existe no computador."}, 409)
                transfer_id = str(uuid4())
                (REMOTE_INCOMING / transfer_id).mkdir()
                with remote_transfers_lock:
                    remote_transfers[transfer_id] = {"id": transfer_id, "song": song, "files": files,
                                                     "sizes": {}, "status": "uploading", "created": time.time()}
                return self.send_json({"id": transfer_id, "files": len(files)}, 201)
            except (ValueError, json.JSONDecodeError, OSError) as error:
                return self.send_json({"error": str(error)}, 400)
        transfer_ready = re.fullmatch(r"/api/remote/transfers/([a-f0-9-]{36})/ready", parsed_path, re.I)
        if transfer_ready:
            if not self._require_remote_token():
                return
            with remote_transfers_lock:
                item = remote_transfers.get(transfer_ready.group(1))
                if not item or item["status"] != "uploading":
                    return self.send_json({"error": "Transferência indisponível."}, 409)
                directory = REMOTE_INCOMING / item["id"]
                missing = [name for name in item["files"] if not (directory / name).is_file() or
                           (directory / name).stat().st_size != item["sizes"].get(name)]
                if missing:
                    return self.send_json({"error": f"Arquivos incompletos: {', '.join(missing[:3])}"}, 409)
                item["status"] = "saving"
            try:
                song = import_remote_transfer(item)
            except OSError as error:
                with remote_transfers_lock:
                    item["status"] = "error"
                    item["error"] = f"Não consegui salvar a música: {error}"
                return self.send_json({"error": item["error"]}, 500)
            with remote_transfers_lock:
                item["song"] = song
                item["status"] = "approved"
            return self.send_json({"id": item["id"], "status": "approved", "songId": song["id"]})
        transfer_decision = re.fullmatch(r"/api/remote/transfers/([a-f0-9-]{36})/decision", parsed_path, re.I)
        if transfer_decision:
            if not self._is_loopback():
                return self.send_error(403)
            try:
                decision = self._read_remote_json().get("decision")
                if decision not in {"approve", "reject"}:
                    raise ValueError("Escolha aprovar ou recusar a transferência.")
                with remote_transfers_lock:
                    item = remote_transfers.get(transfer_decision.group(1))
                    if not item or item["status"] != "pending":
                        return self.send_json({"error": "Transferência já decidida ou inexistente."}, 409)
                    directory = REMOTE_INCOMING / item["id"]
                    if decision == "reject":
                        item["status"] = "rejected"
                        shutil.rmtree(directory, ignore_errors=True)
                        return self.send_json({"id": item["id"], "status": "rejected"})
                    song = import_remote_transfer(item)
                    item["status"] = "approved"
                    shutil.rmtree(directory, ignore_errors=True)
                return self.send_json({"id": item["id"], "status": "approved", "songId": song["id"]})
            except (ValueError, json.JSONDecodeError) as error:
                return self.send_json({"error": str(error)}, 400)
            except OSError as error:
                return self.send_json({"error": f"Não consegui salvar a música: {error}"}, 500)
        if parsed_path == "/api/remote/rotate":
            if not self._is_loopback():
                return self.send_error(403)
            REMOTE_TOKEN = secrets.token_urlsafe(24)
            remote_microphone.configure({"session": None})
            with remote_commands_lock:
                remote_commands.clear()
            return self.send_json({"rotated": True})
        if parsed_path == "/api/remote/control":
            if not self._require_remote_token():
                return
            try:
                body = self._read_remote_json()
                action = body.get("action")
                if action not in {"play", "pause", "next", "previous"}:
                    raise ValueError("Comando remoto inválido.")
                song_id = str(body.get("songId") or "")
                if action == "play" and song_id and not any(song.get("id") == song_id for song in read_library()):
                    raise ValueError("Essa música não está na biblioteca do host.")
                with remote_commands_lock:
                    if len(remote_commands) >= 50:
                        remote_commands.pop(0)
                    remote_commands.append({"action": action, "songId": song_id or None, "created": time.time()})
                return self.send_json({"queued": True}, 202)
            except (ValueError, json.JSONDecodeError) as error:
                return self.send_json({"error": str(error)}, 400)
        if parsed_path == "/api/remote/request":
            if not self._require_remote_token():
                return
            try:
                body = self._read_remote_json()
                song_id = str(body.get("songId") or "")
                library = read_library()
                song = next((item for item in library if item.get("id") == song_id), None) if song_id else None
                if song_id and not song:
                    raise ValueError("Essa música não está mais na biblioteca.")
                title = str(body.get("title") or (song or {}).get("title") or "").strip()[:140]
                artist = str(body.get("artist") or (song or {}).get("artist") or "").strip()[:120]
                if not title:
                    raise ValueError("Digite o nome da música que quer pedir.")
                if song is None and not song_id:
                    song = next((entry for entry in library if not entry.get("hidden")
                                 and str(entry.get("title") or "").strip().casefold() == title.casefold()
                                 and (not artist or str(entry.get("artist") or "").strip().casefold() == artist.casefold())), None)
                if song is None:
                    with remote_requests_lock:
                        if sum(item.get("status") == "pending" for item in remote_requests.values()) >= 40:
                            raise ValueError("O host está com muitos pedidos pendentes.")
                with remote_requests_lock:
                    request_id = str(uuid4())
                    item = {"id": request_id, "songId": song.get("id") if song else None, "title": title, "artist": artist, "status": "approved" if song else "pending", "created": time.time()}
                    remote_requests[request_id] = item
                if song:
                    with remote_commands_lock:
                        if len(remote_commands) >= 50:
                            remote_commands.pop(0)
                        remote_commands.append({"action": "queue", "songId": song["id"], "created": time.time()})
                return self.send_json(item, 201)
            except (ValueError, json.JSONDecodeError) as error:
                return self.send_json({"error": str(error)}, 400)
        if parsed_path == "/api/remote/state":
            if not self._is_loopback():
                return self.send_error(403)
            try:
                body = self._read_remote_json()
                with remote_state_lock:
                    remote_state.update({key: body[key] for key in ("songId", "title", "artist", "playing", "time", "duration") if key in body})
                return self.send_json({"updated": True})
            except (ValueError, json.JSONDecodeError) as error:
                return self.send_json({"error": str(error)}, 400)
        remote_decision_match = re.fullmatch(r"/api/remote/requests/([a-f0-9-]{36})/decision", parsed_path, re.I)
        if remote_decision_match:
            if not self._is_loopback():
                return self.send_error(403)
            request_id = remote_decision_match.group(1)
            try:
                body = self._read_remote_json()
                decision = body.get("decision")
                if decision not in {"approve", "reject"}:
                    raise ValueError("Escolha aprovar ou recusar o pedido.")
                with remote_requests_lock:
                    item = remote_requests.get(request_id)
                    if not item:
                        return self.send_json({"error": "Pedido não encontrado."}, 404)
                    if item["status"] != "pending":
                        return self.send_json({"error": "Este pedido já foi decidido."}, 409)
                    item["status"] = "approved" if decision == "approve" else "rejected"
                    item["decided"] = time.time()
                    result = dict(item)
                if decision == "approve" and result.get("songId"):
                    with remote_commands_lock:
                        remote_commands.append({"action": "play", "songId": result["songId"], "created": time.time()})
                return self.send_json(result)
            except (ValueError, json.JSONDecodeError) as error:
                return self.send_json({"error": str(error)}, 400)
        if parsed_path == "/api/setup/install":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 16 * 1024:
                    return self.send_json({"error": "Pedido vazio ou grande demais."}, 413)
                request = json.loads(self.rfile.read(length))
                feature = request.get("feature")
                backend = request.get("backend")
                if feature not in {"local-audio", "lyrics-align", "youtube"}:
                    return self.send_json({"error": "Escolha um recurso válido."}, 400)
                if feature == "local-audio" and backend not in {"cpu", "directml"}:
                    return self.send_json({"error": "Escolha CPU ou GPU DirectML."}, 400)
                with setup_jobs_lock:
                    active = next((job for job in setup_jobs.values() if job.get("stage") in {"starting", "installing"}), None)
                    if active:
                        return self.send_json({"error": "Outra instalação já está em andamento."}, 409)
                    job_id = str(uuid4())
                    setup_jobs[job_id] = {"id": job_id, "feature": feature, "backend": backend,
                                          "stage": "starting", "message": "Preparando a instalação…", "progress": 1}
                threading.Thread(target=setup_install_worker, args=(job_id, feature, backend), daemon=True).start()
                return self.send_json({"id": job_id, "stage": "starting"}, 202)
            except (ValueError, json.JSONDecodeError) as error:
                return self.send_json({"error": str(error)}, 400)
            except Exception as error:
                traceback.print_exc()
                return self.send_json({"error": f"Não consegui iniciar a instalação: {str(error)[:180]}"}, 500)
        if parsed_path == "/api/local/separations":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 64 * 1024:
                    return self.send_json({"error": "Pedido vazio ou grande demais."}, 413)
                request = json.loads(self.rfile.read(length))
                song_id = str(request.get("songId", ""))
                if not re.fullmatch(r"[a-f0-9-]{36}", song_id, re.I):
                    return self.send_json({"error": "Selecione uma música válida."}, 400)
                backend = request.get("backend", "cpu")
                if backend not in {"cpu", "directml"}:
                    return self.send_json({"error": "Escolha CPU ou GPU DirectML."}, 400)
                with local_separation_jobs_lock:
                    active = next((job for job in local_separation_jobs.values()
                                   if job.get("songId") == song_id and job.get("stage") not in {"done", "error"}), None)
                    if active:
                        return self.send_json(dict(active), 202)
                    if any(job.get("stage") not in {"done", "error"} for job in local_separation_jobs.values()):
                        return self.send_json({"error": "Já há uma separação local em andamento. Espere ela terminar antes de iniciar outra."}, 409)
                    job_id = str(uuid4())
                    local_separation_jobs[job_id] = {"id": job_id, "songId": song_id, "stage": "starting",
                                                     "message": "Preparando a separação local…", "progress": 1,
                                                     "indeterminate": True, "backend": backend}
                threading.Thread(target=local_audio_separation_worker,
                                 args=(job_id, song_id, backend), daemon=True).start()
                return self.send_json({"id": job_id, "songId": song_id, "stage": "starting"}, 202)
            except (ValueError, json.JSONDecodeError) as error:
                return self.send_json({"error": str(error)}, 400)
            except Exception as error:
                traceback.print_exc()
                return self.send_json({"error": f"Não consegui iniciar a separação local: {str(error)[:180]}"}, 500)
        if parsed_path in {"/api/mvsep/config", "/api/mvsep/models", "/api/youtube/search", "/api/youtube/metadata", "/api/youtube/separations", "/api/mvsep/separations", "/api/youtube/video-downloads", "/api/covers/search", "/api/covers/download"}:
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 1024 * 1024:
                    return self.send_json({"error": "Requisição vazia ou grande demais."}, 413)
                request = json.loads(self.rfile.read(length))
                if parsed_path == "/api/covers/search":
                    return self.send_json({"results": search_covers(request.get("query", ""))})
                if parsed_path == "/api/covers/download":
                    return self.send_json({"name": download_cover(request.get("url", ""))}, 201)
                if parsed_path == "/api/youtube/metadata":
                    return self.send_json(youtube_video_metadata((request.get("url") or "").strip()))
                if parsed_path == "/api/youtube/video-downloads":
                    video_url = (request.get("url") or "").strip()
                    if not valid_youtube_url(video_url):
                        return self.send_json({"error": "Cole um link direto de vídeo do YouTube."}, 400)
                    job_id = str(uuid4())
                    with video_download_jobs_lock:
                        video_download_jobs[job_id] = {"stage": "starting", "message": "Preparando o download…", "progress": 0, "indeterminate": True}
                    threading.Thread(target=youtube_video_download_worker, args=(job_id, video_url), daemon=True).start()
                    return self.send_json({"id": job_id, "stage": "starting"}, 202)
                if parsed_path == "/api/mvsep/config":
                    token = (request.get("token") or "").strip()
                    if not token:
                        try:
                            MVSEP_CONFIG.unlink()
                        except FileNotFoundError:
                            pass
                        return self.send_json({"configured": False})
                    if len(token) < 12 or len(token) > 300 or any(char.isspace() for char in token):
                        return self.send_json({"error": "A chave MVSep parece inválida."}, 400)
                    temp = MVSEP_CONFIG.with_suffix(".json.tmp")
                    protected_token = protect_local_secret(token)
                    temp.write_text(json.dumps({"protected_token": protected_token}, ensure_ascii=False), encoding="utf-8")
                    temp.replace(MVSEP_CONFIG)
                    return self.send_json({"configured": True})
                if parsed_path == "/api/mvsep/models":
                    return self.send_json({"models": mvsep_models(force_refresh=True)})
                if parsed_path == "/api/youtube/search":
                    return self.send_json({"results": youtube_search(request.get("query", ""), bool(request.get("includeYoutube", False)))})
                if not get_mvsep_token():
                    return self.send_json({"error": "Configure a chave da API MVSep nas configurações primeiro."}, 400)
                if parsed_path == "/api/mvsep/separations":
                    song_id = str(request.get("songId") or "")
                    song = next((item for item in read_library() if item.get("id") == song_id), None)
                    if not song or not SAFE_NAME.fullmatch(song.get("source", "")) or song.get("lead"):
                        return self.send_json({"error": "Selecione uma música completa salva na biblioteca."}, 400)
                    if not (MEDIA / song["source"]).is_file():
                        return self.send_json({"error": "O arquivo de origem não está mais na pasta music."}, 404)
                    model, model_options = validated_mvsep_options(request.get("modelId", 12), request.get("modelOptions", {}))
                    with youtube_jobs_lock:
                        active = next((dict(job, id=identifier) for identifier, job in youtube_jobs.items() if job.get("songId") == song_id and job.get("stage") not in {"done", "error", "missing"}), None)
                        if active:
                            return self.send_json(active, 202)
                        job_id = str(uuid4())
                        youtube_jobs[job_id] = {"id": job_id, "songId": song_id, "stage": "starting", "message": "Preparando a música salva…", "progress": 1, "title": song.get("title"), "artist": song.get("artist")}
                    threading.Thread(target=youtube_mvsep_worker, args=(job_id, "", model["id"], model_options, song_id), daemon=True).start()
                    return self.send_json({"id": job_id, "stage": "starting"}, 202)
                video_url = (request.get("url") or "").strip()
                if not valid_youtube_url(video_url):
                    return self.send_json({"error": "Selecione um vídeo do YouTube válido antes de continuar."}, 400)
                try:
                    model, model_options = validated_mvsep_options(request.get("modelId", 12), request.get("modelOptions", {}))
                except (TypeError, ValueError) as error:
                    return self.send_json({"error": str(error)}, 400)
                job_id = str(uuid4())
                with youtube_jobs_lock:
                    youtube_jobs[job_id] = {"stage": "starting", "message": f"Preparando o download local · {model['name']}…"}
                threading.Thread(target=youtube_mvsep_worker, args=(job_id, video_url, model["id"], model_options), daemon=True).start()
                return self.send_json({"id": job_id, "stage": "starting"}, 202)
            except (ValueError, json.JSONDecodeError) as error:
                return self.send_json({"error": str(error)}, 400)
            except RuntimeError as error:
                return self.send_json({"error": str(error)}, 503)
            except Exception as error:
                traceback.print_exc()
                message = "Não consegui buscar capas agora. Confira sua conexão e tente novamente." if parsed_path == "/api/covers/search" else "Não consegui baixar esta capa. Faça uma nova busca e tente novamente." if parsed_path == "/api/covers/download" else "Não foi possível buscar resultados no YouTube agora. Confira sua conexão e tente novamente." if parsed_path == "/api/youtube/search" else "Não foi possível iniciar a integração YouTube/MVSep. Confira as configurações e tente novamente."
                if parsed_path in {"/api/youtube/search", "/api/youtube/metadata"}:
                    return self.send_json({"error": youtube_error_message(error)}, 503)
                return self.send_json({"error": message}, 500)
        align_match = re.fullmatch(r"/api/align/([a-f0-9-]{36})", parsed_path, re.I)
        if align_match:
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 2 * 1024 * 1024:
                    return self.send_error(413, "Invalid alignment request size")
                request = json.loads(self.rfile.read(length))
                result = align_song_words(align_match.group(1), request.get("syncedLyrics", ""), request.get("language", "pt"), request.get("execution", "auto"))
                return self.send_json(result)
            except (ValueError, json.JSONDecodeError) as error:
                return self.send_json({"error": str(error)}, 400)
            except RuntimeError as error:
                return self.send_json({"error": str(error)}, 503)
            except Exception as error:
                traceback.print_exc()
                return self.send_json({"error": f"Falha no alinhamento: {error}"}, 500)
        if parsed_path != "/api/library":
            return self.send_error(404)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            item = json.loads(self.rfile.read(length))
            if not isinstance(item, dict) or not item.get("id"):
                raise ValueError("Invalid song metadata")
            with LIBRARY_LOCK:
                library = read_library()
                previous = next((song for song in library if song.get("id") == item["id"]), None)
                library = [song for song in library if song.get("id") != item["id"]]
                library.append(item)
                temp = LIBRARY.with_suffix(".json.tmp")
                temp.write_text(json.dumps(library, ensure_ascii=False, indent=2), encoding="utf-8")
                temp.replace(LIBRARY)
            if previous:
                retained = {item.get(key) for key in ("source", "inst", "lead", "back", "cover", "background", "backgroundVideo")}
                for key in ("source", "inst", "lead", "back", "cover", "background", "backgroundVideo"):
                    old_name = previous.get(key)
                    if old_name and old_name not in retained and SAFE_NAME.fullmatch(old_name):
                        try:
                            (MEDIA / old_name).unlink()
                        except FileNotFoundError:
                            pass
            self.send_json(item, 201)
        except (ValueError, json.JSONDecodeError) as error:
            self.send_error(400, str(error))

    def do_DELETE(self):
        if not self._allow_network_route():
            return self.send_error(403, "LAN access is limited to the paired remote control")
        match = re.fullmatch(r"/api/library/([a-f0-9-]{36})", urlparse(self.path).path, re.I)
        if not match:
            return self.send_error(400)
        song_id = match.group(1)
        with LIBRARY_LOCK:
            library = read_library()
            removed = [song for song in library if song.get("id") == song_id]
            library = [song for song in library if song.get("id") != song_id]
            temp = LIBRARY.with_suffix(".json.tmp")
            temp.write_text(json.dumps(library, ensure_ascii=False, indent=2), encoding="utf-8")
            temp.replace(LIBRARY)
        for song in removed:
            for key in ("source", "inst", "lead", "back", "cover", "background", "backgroundVideo"):
                name = song.get(key)
                if name and SAFE_NAME.fullmatch(name):
                    try:
                        (MEDIA / name).unlink()
                    except FileNotFoundError:
                        pass
        self.send_json({"deleted": song_id})

    def do_HEAD(self):
        if not self._allow_network_route():
            return self.send_error(403, "LAN access is limited to the paired remote control")
        return super().do_HEAD()


if __name__ == "__main__":
    host = os.environ.get("VOXSTAGE_HOST", "0.0.0.0")
    try:
        port = int(os.environ.get("VOXSTAGE_PORT", "8000"))
    except ValueError:
        port = 8000
    address = (host, port)
    lan_url = f"http://{get_lan_ipv4()}:{port}/remote" if host in {"0.0.0.0", ""} else ""
    print(f"VoxStage em http://localhost:{port}" + (f" (celular na mesma rede: {lan_url})" if lan_url else ""))
    try:
        ThreadingHTTPServer(address, Handler).serve_forever()
    except OSError as error:
        print(f"Não foi possível iniciar em {address[0]}:{address[1]}: {error}")
        input("Pressione Enter para fechar...")
