"""Android adapter using structured yt-dlp API results, never stdout parsing."""
import json
import re
import shutil
import uuid
from pathlib import Path
from urllib.parse import quote, urlparse
from yt_dlp import YoutubeDL

_runtime = None
_clients = (None, 'android_vr', 'tv_downgraded')

def configure_runtime(path):
    global _runtime
    runtime = Path(path)
    if not runtime.is_file():
        raise ValueError('O motor JavaScript do YouTube não foi encontrado. Reinstale a atualização.')
    _runtime = str(runtime)

def _retryable(error):
    message = str(error).lower()
    return any(part in message for part in ('403', 'not a bot', 'confirm you', 'requested format is not available', 'no video formats'))

def _friendly_error(error):
    if any(part in str(error).lower() for part in ('not a bot', 'confirm you', 'robô')):
        return ValueError('O YouTube bloqueou o acesso neste aparelho ou nesta rede. Tente novamente em outra rede. Você também pode importar o áudio como música completa, salvar e escolher Separar com MVSEP no menu da música.')
    return error

def _client_options(base, client):
    options = dict(base)
    if client:
        options['extractor_args'] = {'youtube': {'player_client': [client]}}
    return options

def _metadata(url):
    for attempt, client in enumerate(_clients):
        try:
            with YoutubeDL(_client_options(dict(_options(), skip_download=True), client)) as ydl:
                return ydl.extract_info(url, download=False)
        except Exception as error:
            if attempt == len(_clients)-1 or not _retryable(error):
                raise _friendly_error(error) from None


def _options():
    options = dict(quiet=True, no_warnings=True, noprogress=True, socket_timeout=20,
                retries=2, extractor_retries=2, fragment_retries=2, proxy="",
                cachedir=False, noplaylist=True)
    if _runtime:
        options['js_runtimes'] = {'quickjs': {'path': _runtime}}
    return options


def _youtube_url(value):
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in ("http", "https") or not (
        host in ("youtube.com", "youtu.be") or host.endswith(".youtube.com")
    ) or parsed.username or parsed.password:
        raise ValueError("Use um link do YouTube.")
    return value


def _entry(item, source="music"):
    video_id = item.get("id", "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        return None
    images = item.get("thumbnails") or []
    return dict(id=video_id, title=item.get("title") or "YouTube",
                artist=item.get("artist") or item.get("channel") or item.get("uploader") or "",
                album=item.get("album") or "", source="YouTube Music" if source == "music" else "YouTube", duration=item.get("duration"),
                webpage_url=f"https://{'music.' if source == 'music' else ''}youtube.com/watch?v={video_id}",
                thumbnail=item.get("thumbnail") or (images[-1].get("url") if images else None)
                or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg")


def search_json(query, include_youtube="false"):
    query = query.strip()
    if not query or len(query) > 180 or any(c in query for c in "\r\n\0"):
        raise ValueError("Digite uma busca de até 180 caracteres.")
    is_url = query.startswith(("http://", "https://"))
    targets = [( _youtube_url(query), "youtube")] if is_url else [
        (f"https://music.youtube.com/search?q={quote(query)}#songs", "music"),
        (f"ytsearch8:{query}", "youtube")]
    include_youtube = str(include_youtube).lower() in ("1", "true", "yes", "on")
    last_error = None
    entries = []
    seen_ids = set()
    for target, source in targets:
        try:
            opts = dict(_options(), skip_download=True, extract_flat="in_playlist", playlistend=8)
            with YoutubeDL(opts) as ydl:
                info = _metadata(target) if is_url else ydl.extract_info(target, download=False)
                raw = info.get("entries") if "entries" in info else [info]
                for item in raw or []:
                    entry = _entry(item or {}, source)
                    if entry and entry["id"] not in seen_ids:
                        seen_ids.add(entry["id"])
                        entries.append(entry)
                    if len(entries) >= (16 if include_youtube else 8):
                        break
                if entries and source == "music" and not include_youtube:
                    break
        except Exception as error:
            last_error = error
    if last_error and not entries:
        raise _friendly_error(last_error) from None
    return json.dumps({"entries": entries}, ensure_ascii=False)


def metadata_json(url):
    _youtube_url(url)
    info = _metadata(url)
    artist = info.get("artist") or info.get("creator") or info.get("channel") or info.get("uploader") or ""
    if artist.endswith(" - Topic"):
        artist = artist[:-8]
    return json.dumps({"title": info.get("track") or info.get("title") or "",
                       "artist": artist, "album": info.get("album") or "",
                       "duration": info.get("duration")}, ensure_ascii=False)


def download_json(url, directory, kind="audio"):
    _youtube_url(url)
    if kind not in ("audio", "video"):
        raise ValueError("Tipo de download inválido.")
    root = Path(directory).resolve()
    root.mkdir(parents=True, exist_ok=True)
    job = root / (".ytdlp-" + uuid.uuid4().hex)
    job.mkdir()
    try:
        # Single streams avoid depending on a system ffmpeg executable on Android.
        formats = "bestaudio[ext=m4a]/bestaudio[ext=webm]/best" if kind == "audio" else (
            "best[ext=mp4][height<=720]/best[height<=720]/bestvideo[ext=mp4][height<=720]")
        info = None
        source = None
        for attempt, player_client in enumerate(_clients):
            attempt_dir = job / str(attempt)
            attempt_dir.mkdir()
            opts = dict(_options(), format=formats,
                        outtmpl=str(attempt_dir / "media.%(ext)s"),
                        writethumbnail=False, writeinfojson=False)
            opts = _client_options(opts, player_client)
            try:
                with YoutubeDL(opts) as ydl:
                    info = ydl.extract_info(url, download=True)
                    downloads = info.get("requested_downloads") or []
                    filename = downloads[0].get("filepath") if downloads else None
                    source = Path(filename or ydl.prepare_filename(info)).resolve()
                break
            except Exception as error:
                if attempt == len(_clients)-1 or not _retryable(error):
                    raise _friendly_error(error) from None
        if source is None or source.parent != attempt_dir or not source.is_file() or source.suffix in (".part", ".ytdl"):
            raise ValueError("O YouTube não entregou um arquivo de mídia completo.")
        if not source.stat().st_size:
            raise ValueError("O arquivo recebido está vazio.")
        extension = source.suffix.lstrip(".")
        if not re.fullmatch(r"[a-zA-Z0-9]{1,8}", extension):
            raise ValueError("Formato de mídia inválido.")
        name = f"youtube-{uuid.uuid4().hex}.{extension}"
        destination = root / name
        source.replace(destination)
        return json.dumps(dict(filename=name, name=name, bytes=destination.stat().st_size,
                               title=info.get("title") or "YouTube", extension=extension,
                               hasAudio=info.get("acodec") not in (None, "none"), stage="done",
                               progress=100), ensure_ascii=False)
    finally:
        shutil.rmtree(job, ignore_errors=True)
