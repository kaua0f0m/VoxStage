"""Portable VoxStage libraries. Shared by desktop and the Android Python bridge."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

MEDIA_FIELDS = ("source", "inst", "lead", "back", "cover", "background", "backgroundVideo")
SONG_FIELDS = {
    "id", "title", "artist", "created", "favorite", "hidden", "separationStatus", "separationEngine", *MEDIA_FIELDS,
    "syncedLyrics", "plainLyrics", "lyricTrack", "lyricArtist", "lyricProvider", "wordTimings",
    "parallelWordTimings", "parallelLineStarts", "wordByWordEnabled", "vocalSilenceEnds",
    "manualVocalSilences", "lyricLineEnds", "backingSyncedLyrics", "backingPlainLyrics",
    "backingWordTimings", "backingLineEnds", "backingWordByWordEnabled", "backingLyricAdjustments",
    "backingLyricProvider", "profanityWords", "profanityMarks", "profanityCues", "lyricAdjustments",
    "lyricVoices", "parallelSyncedLyrics", "parallelPlainLyrics", "parallelLineEnds",
}
PREFERENCE_KEYS = {
    "voxstage-language", "voxstage-theme", "voxstage-library-view", "voxstage-processing-settings",
    "voxstage-score-settings", "voxstage-score-history", "voxstage-artwork-provider-v2",
}
PROCESSING_KEYS = {
    "mvsepModelId", "mvsepOptionsByModel", "showUpcomingWordPreview",
    "muteProfanity", "markProfanity", "blurProfanity", "pauseThresholdSeconds", "lyricsScale", "lyricsScaleTv", "lyricsFont", "interfaceFont",
    "seekStepSeconds", "themeCustomColor", "voice2Color", "voicesOverlapGradient", "useCoverTheme", "tvShowCover",
}
SCORE_KEYS = {"reference", "tolerance", "acceptOctave", "noiseDb", "offsetMs", "overlay", "laneLyrics"}
MEDIA_NAME = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,179}")
MAX_MANIFEST = 32 * 1024 * 1024
MAX_PACKAGE = 128 * 1024**3


def safe_name(name):
    return isinstance(name, str) and bool(MEDIA_NAME.fullmatch(name)) and ".." not in name


def package_path(data_dir, package_id):
    try:
        if str(UUID(str(package_id))) != package_id:
            raise ValueError()
    except (ValueError, AttributeError, TypeError):
        raise ValueError("Identificador de pacote inválido.") from None
    return Path(data_dir) / ".archives" / (package_id + ".zip")


def read_library(data_dir):
    path = Path(data_dir) / "library.json"
    result = json.loads(path.read_text(encoding="utf-8-sig")) if path.exists() else []
    if not isinstance(result, list):
        raise ValueError("A biblioteca local está em um formato inválido.")
    return result


def preferences(values):
    """Only portable settings; never API keys, paired-device URLs or microphone IDs."""
    result = {}
    if not isinstance(values, dict):
        return result
    for key in PREFERENCE_KEYS:
        value = values.get(key)
        if not isinstance(value, str) or len(value) > 1024 * 1024:
            continue
        if key in {"voxstage-processing-settings", "voxstage-score-settings"}:
            try:
                settings = json.loads(value)
            except ValueError:
                continue
            if not isinstance(settings, dict):
                continue
            allowed = PROCESSING_KEYS if key == "voxstage-processing-settings" else SCORE_KEYS
            value = json.dumps({name: item for name, item in settings.items() if name in allowed}, ensure_ascii=False)
        elif key == "voxstage-score-history":
            try:
                history = json.loads(value)
            except ValueError:
                continue
            if not isinstance(history, list):
                continue
            value = json.dumps(history[:20], ensure_ascii=False)
        result[key] = value
    return result


def song_data(raw):
    if not isinstance(raw, dict):
        raise ValueError("Música em formato inválido.")
    result = {key: value for key, value in raw.items() if key in SONG_FIELDS}
    try:
        UUID(result["id"])
    except (ValueError, TypeError, KeyError, AttributeError):
        raise ValueError("Uma música do pacote está sem identificador válido.") from None
    if not isinstance(result.get("title"), str) or not result["title"].strip():
        raise ValueError("Uma música do pacote está sem título.")
    for field in MEDIA_FIELDS:
        if result.get(field) is not None and not safe_name(result[field]):
            raise ValueError("O pacote contém um nome de arquivo inválido.")
    return result


def cleanup(data_dir):
    directory = Path(data_dir) / ".archives"
    directory.mkdir(exist_ok=True)
    # Old completed/abandoned packages are temporary, not part of the library.
    for path in directory.glob("*.zip"):
        if path.is_file() and not path.is_symlink() and path.stat().st_mtime < time.time() - 86400:
            path.unlink(missing_ok=True)
    return directory


def export_library(data_dir, song_id=None, settings=None, app_version=""):
    data_dir = Path(data_dir)
    directory = cleanup(data_dir)
    songs = [song_data(song) for song in read_library(data_dir) if song_id is None or song.get("id") == song_id]
    if song_id and not songs:
        raise ValueError("Essa música não está mais na biblioteca.")
    names = sorted({song[field] for song in songs for field in MEDIA_FIELDS if song.get(field)})
    media = data_dir / "music"
    total = 0
    for name in names:
        source = media / name
        if not source.is_file() or source.is_symlink():
            raise ValueError(f"Arquivo não encontrado: {name}. Confira os arquivos da música antes de exportar.")
        total += source.stat().st_size
    if total > MAX_PACKAGE:
        raise ValueError("A biblioteca ultrapassa o limite de 128 GB por pacote. Exporte as músicas separadamente.")
    if shutil.disk_usage(directory).free < total + MAX_MANIFEST:
        raise ValueError("Não há espaço livre para preparar a exportação.")
    package_id = str(uuid4())
    path = package_path(data_dir, package_id)
    manifest = {"format": "VoxStage", "version": 1, "appVersion": app_version,
                "created": datetime.now(timezone.utc).isoformat(), "songs": songs, "files": [],
                "preferences": preferences(settings) if song_id is None else {}}
    try:
        # Audio/video is already compressed; storing it avoids minutes of recompression.
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zipped:
            for name in names:
                digest = hashlib.sha256()
                size = 0
                with (media / name).open("rb") as source, zipped.open("media/" + name, "w", force_zip64=True) as target:
                    while chunk := source.read(1024 * 1024):
                        target.write(chunk)
                        digest.update(chunk)
                        size += len(chunk)
                manifest["files"].append({"name": name, "bytes": size, "sha256": digest.hexdigest()})
            raw = json.dumps(manifest, ensure_ascii=False).encode("utf-8")
            if len(raw) > MAX_MANIFEST:
                raise ValueError("Os dados da biblioteca são grandes demais para um único pacote.")
            zipped.writestr("manifest.json", raw)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    filename = "VoxStage-biblioteca" if song_id is None else "VoxStage-" + re.sub(r'[^\w .-]', '', songs[0]["title"]).strip()[:90]
    return {"id": package_id, "filename": filename + ".voxstage.zip", "bytes": path.stat().st_size,
            "songs": len(songs), "files": len(names)}


def read_manifest(path):
    try:
        with zipfile.ZipFile(path) as zipped:
            entries = zipped.infolist()
            if len(entries) > 100001 or len({entry.filename for entry in entries}) != len(entries):
                raise ValueError("O pacote contém arquivos repetidos ou entradas demais.")
            info = zipped.getinfo("manifest.json")
            if info.file_size > MAX_MANIFEST:
                raise ValueError("Os dados do pacote são grandes demais.")
            manifest = json.loads(zipped.read(info).decode("utf-8"))
            if not isinstance(manifest, dict) or manifest.get("format") != "VoxStage" or manifest.get("version") != 1:
                raise ValueError("Este não é um pacote VoxStage compatível.")
            if not isinstance(manifest.get("songs"), list) or len(manifest["songs"]) > 10000:
                raise ValueError("Lista de músicas inválida.")
            songs = [song_data(song) for song in manifest["songs"]]
            if len({song["id"] for song in songs}) != len(songs):
                raise ValueError("O pacote repete identificadores de músicas.")
            names = {song[field] for song in songs for field in MEDIA_FIELDS if song.get(field)}
            files = manifest.get("files")
            if not isinstance(files, list) or any(not isinstance(item, dict) for item in files):
                raise ValueError("Lista de arquivos inválida.")
            if any(not safe_name(item.get("name")) for item in files):
                raise ValueError("Nome de arquivo inválido no pacote.")
            if len(files) != len(names) or {item.get("name") for item in files} != names:
                raise ValueError("O pacote está incompleto: faltam arquivos das músicas.")
            total = 0
            for item in files:
                name = item["name"]
                if not safe_name(name) or not isinstance(item.get("bytes"), int) or item["bytes"] < 0:
                    raise ValueError("Arquivo do pacote inválido.")
                if not re.fullmatch(r"[a-f0-9]{64}", str(item.get("sha256", ""))):
                    raise ValueError("O pacote não informa a integridade dos arquivos.")
                entry = zipped.getinfo("media/" + name)
                if entry.file_size != item["bytes"] or entry.flag_bits & 1 or entry.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
                    raise ValueError("Um arquivo do pacote está incompleto ou não é compatível.")
                if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError("O pacote contém um atalho de arquivo não permitido.")
                total += item["bytes"]
            if total > MAX_PACKAGE or {entry.filename for entry in entries} != {"manifest.json", *("media/" + name for name in names)}:
                raise ValueError("O pacote contém arquivos não reconhecidos ou ultrapassa 128 GB.")
            return {**manifest, "songs": songs, "preferences": preferences(manifest.get("preferences"))}
    except (zipfile.BadZipFile, KeyError, UnicodeError, json.JSONDecodeError, RuntimeError, NotImplementedError) as error:
        raise ValueError("Não consegui ler o pacote VoxStage. Ele pode estar incompleto ou corrompido.") from error


def inspect_package(data_dir, package_id):
    manifest = read_manifest(package_path(data_dir, package_id))
    ids = {song.get("id") for song in read_library(data_dir)}
    existing = sum(song["id"] in ids for song in manifest["songs"])
    return {"id": package_id, "songs": len(manifest["songs"]), "existing": existing,
            "new": len(manifest["songs"]) - existing, "files": len(manifest["files"]),
            "bytes": sum(item["bytes"] for item in manifest["files"]),
            "preferences": bool(manifest["preferences"]), "titles": [song["title"] for song in manifest["songs"][:8]]}


def import_package(data_dir, package_id, replace_existing=False):
    """Caller holds its library lock. Commit library only after all media validates."""
    data_dir = Path(data_dir)
    path = package_path(data_dir, package_id)
    manifest = read_manifest(path)
    library = read_library(data_dir)
    existing = {song.get("id") for song in library}
    selected = [song for song in manifest["songs"] if replace_existing or song["id"] not in existing]
    needed = {song[field] for song in selected for field in MEDIA_FIELDS if song.get(field)}
    size = sum(item["bytes"] for item in manifest["files"] if item["name"] in needed)
    media = data_dir / "music"
    media.mkdir(exist_ok=True)
    if shutil.disk_usage(media).free < size + MAX_MANIFEST:
        raise ValueError("Não há espaço livre para importar os arquivos.")
    created = []
    renamed = {}
    try:
        with tempfile.TemporaryDirectory(prefix=".archive-import-", dir=media) as staging, zipfile.ZipFile(path) as zipped:
            for item in manifest["files"]:
                name = item["name"]
                if name not in needed:
                    continue
                target_name = str(uuid4()) + Path(name).suffix.lower()
                target = Path(staging) / target_name
                digest = hashlib.sha256()
                with zipped.open("media/" + name) as source, target.open("xb") as output:
                    while chunk := source.read(1024 * 1024):
                        digest.update(chunk)
                        output.write(chunk)
                if digest.hexdigest() != item["sha256"]:
                    raise ValueError("Um arquivo do pacote está corrompido. A biblioteca não foi alterada.")
                renamed[name] = target_name
            imported = []
            for song in selected:
                song = dict(song)
                for key in MEDIA_FIELDS:
                    if song.get(key):
                        song[key] = renamed[song[key]]
                imported.append(song)
            for name in renamed.values():
                destination = media / name
                if destination.exists():
                    raise ValueError("Não consegui reservar um arquivo para importação. Tente novamente.")
                (Path(staging) / name).replace(destination)
                created.append(destination)
            updated_ids = {song["id"] for song in imported}
            merged = [song for song in library if song.get("id") not in updated_ids] + imported
            temporary = data_dir / "library.archive.tmp"
            try:
                temporary.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
                os.replace(temporary, data_dir / "library.json")
            finally:
                temporary.unlink(missing_ok=True)
    except Exception as error:
        for file in created:
            file.unlink(missing_ok=True)
        if isinstance(error, (zipfile.BadZipFile, RuntimeError, NotImplementedError)):
            raise ValueError("Um arquivo do pacote está corrompido. A biblioteca não foi alterada.") from error
        raise
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass  # A completed import must not be reported as failed by temporary-file cleanup.
    return {"added": sum(song["id"] not in existing for song in selected),
            "updated": sum(song["id"] in existing for song in selected),
            "skipped": len(manifest["songs"]) - len(selected), "preferences": manifest["preferences"],
            "ids": [song["id"] for song in selected]}


def bridge_json(action, payload):
    """Android entry point, with app-private paths supplied by the Rust host."""
    try:
        request = json.loads(payload)
        data_dir = Path(request["dataDir"])
        if action == "export":
            result = export_library(data_dir, request.get("songId"), request.get("preferences"), request.get("appVersion", ""))
        elif action == "inspect":
            name = request.get("name", "")
            if not safe_name(name) or not name.endswith(".zip"):
                raise ValueError("Arquivo de importação inválido.")
            incoming = data_dir / "music" / name
            if not incoming.is_file() or incoming.is_symlink():
                raise ValueError("O pacote não foi recebido por completo.")
            cleanup(data_dir)
            package_id = str(uuid4())
            target = package_path(data_dir, package_id)
            incoming.replace(target)
            try:
                result = inspect_package(data_dir, package_id)
            except Exception:
                target.unlink(missing_ok=True)
                raise
        elif action == "import":
            result = import_package(data_dir, request.get("id"), request.get("replaceExisting") is True)
        else:
            raise ValueError("Operação de biblioteca inválida.")
        return json.dumps(result, ensure_ascii=False)
    except Exception as error:
        return json.dumps({"error": str(error) or "Não consegui processar o pacote."}, ensure_ascii=False)
