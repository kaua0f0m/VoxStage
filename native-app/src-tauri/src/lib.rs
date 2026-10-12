#[cfg(not(mobile))]
use std::{
    io,
    net::TcpStream,
    thread,
    time::Instant,
};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    net::Ipv4Addr,
    path::{Path, PathBuf},
    collections::{HashMap, HashSet},
    sync::{Mutex, OnceLock},
    time::Duration,
};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
mod tv_host;
use tv_host::mobile_tv_host_api;

#[cfg(all(not(mobile), not(debug_assertions)))]
use std::{
    process::{Child, Command, Stdio},
};

static MOBILE_MVSEP_JOBS: OnceLock<Mutex<HashMap<String, Value>>> = OnceLock::new();

fn mobile_mvsep_jobs() -> &'static Mutex<HashMap<String, Value>> {
    MOBILE_MVSEP_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn mobile_mvsep_update_job(id: &str, update: Value) {
    if let Ok(mut jobs) = mobile_mvsep_jobs().lock() {
        if let (Some(Value::Object(job)), Value::Object(changes)) = (jobs.get_mut(id), update) {
            job.extend(changes);
            #[cfg(target_os = "android")]
            {
                // The worker also updates notifications while WebView timers are paused.
                let notification = json!({"title":job.get("title"),"message":job.get("message"),"stage":job.get("stage")}).to_string();
                let _ = android_ytdlp_call("notifyJob",&notification,None);
            }
        }
    }
}

#[cfg(not(mobile))]
const APP_PORT: u16 = 8000;

fn mobile_music_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let music = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("music");
    fs::create_dir_all(&music).map_err(|error| error.to_string())?;
    Ok(music)
}

fn valid_media_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 180
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        && name != "."
        && name != ".."
}

fn valid_youtube_url(raw: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(raw.trim()) else { return false };
    if url.scheme() != "https" && url.scheme() != "http" { return false; }
    matches!(url.host_str(), Some("youtube.com" | "www.youtube.com" | "music.youtube.com" | "m.youtube.com" | "youtu.be"))
}

#[cfg(target_os = "android")]
fn android_ytdlp_call(method: &str, first: &str, second: Option<&str>) -> Result<String, String> {
    use jni::{objects::{JClass, JValue}, JavaVM};
    let android = ndk_context::android_context();
    let vm = unsafe { JavaVM::from_raw(android.vm() as *mut jni::sys::JavaVM) }
        .map_err(|error| format!("Não consegui iniciar o yt-dlp no Android: {error}"))?;
    let mut env = vm.attach_current_thread()
        .map_err(|error| format!("Não consegui acessar o motor yt-dlp: {error}"))?;
    // Tauri calls this from a Tokio worker. FindClass on an attached native
    // thread uses the system class loader, which cannot see app classes.
    let activity_thread = env.find_class("android/app/ActivityThread")
        .map_err(|error| format!("Não consegui acessar o app Android: {error}"))?;
    let application = env.call_static_method(
        activity_thread,
        "currentApplication",
        "()Landroid/app/Application;",
        &[],
    ).map_err(|error| format!("Não consegui acessar o app Android: {error}"))?
        .l().map_err(|error| error.to_string())?;
    let class_loader = env.call_method(
        application,
        "getClassLoader",
        "()Ljava/lang/ClassLoader;",
        &[],
    ).map_err(|error| format!("Não consegui carregar a ponte do yt-dlp: {error}"))?
        .l().map_err(|error| error.to_string())?;
    let class_name = env.new_string("app.voxstage.player.YtDlpBridge")
        .map_err(|error| error.to_string())?;
    let class = env.call_method(
        class_loader,
        "loadClass",
        "(Ljava/lang/String;)Ljava/lang/Class;",
        &[JValue::Object(&class_name)],
    ).map_err(|error| format!("A ponte nativa do yt-dlp não foi carregada: {error}"))?
        .l().map_err(|error| error.to_string())?;
    let class = JClass::from(class);
    let first = env.new_string(first).map_err(|error| error.to_string())?;
    let output = if let Some(second) = second {
        let second = env.new_string(second).map_err(|error| error.to_string())?;
        let args = [JValue::Object(&first), JValue::Object(&second)];
        env.call_static_method(class, method, "(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;", &args)
    } else {
        let args = [JValue::Object(&first)];
        env.call_static_method(class, method, "(Ljava/lang/String;)Ljava/lang/String;", &args)
    }.map_err(|error| format!("O yt-dlp falhou: {error}"))?
        .l().map_err(|error| format!("O yt-dlp retornou uma resposta inválida: {error}"))?;
    let output = jni::objects::JString::from(output);
    let output: String = env.get_string(&output).map_err(|error| error.to_string())?.into();
    Ok(output)
}

#[cfg(not(target_os = "android"))]
fn android_ytdlp_call(_method: &str, _first: &str, _second: Option<&str>) -> Result<String, String> {
    Err("O downloader integrado está disponível no app Android.".to_string())
}

fn map_ytdlp_entry(item: &Value) -> Option<Value> {
    let id = item.get("id")?.as_str()?;
    let title = item.get("title").and_then(Value::as_str).unwrap_or("Faixa do YouTube");
    let artist = ["artist", "creator", "channel", "uploader"]
        .iter().find_map(|key| item.get(key).and_then(Value::as_str)).unwrap_or("");
    let album = item.get("album").and_then(Value::as_str).unwrap_or("");
    let url = item.get("webpage_url").or_else(|| item.get("original_url"))
        .and_then(Value::as_str).map(str::to_string)
        .unwrap_or_else(|| format!("https://music.youtube.com/watch?v={id}"));
    let thumbnail_fallback = format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg");
    let thumbnail = item.get("thumbnail").and_then(Value::as_str)
        .or_else(|| item.get("thumbnails").and_then(Value::as_array).and_then(|items| items.last()).and_then(|image| image.get("url")).and_then(Value::as_str))
        .unwrap_or(&thumbnail_fallback);
    Some(json!({
        "id": id,
        "title": title,
        "artist": artist,
        "album": album,
        "source": item.get("source").and_then(Value::as_str).unwrap_or("YouTube Music"),
        "url": url,
        "duration": item.get("duration").and_then(Value::as_f64),
        "thumbnail": thumbnail,
        "thumbnailFallback": thumbnail_fallback
    }))
}

#[tauri::command]
async fn mobile_youtube_search(query: String, include_youtube: bool) -> Result<Vec<Value>, String> {
    let query = query.trim().to_owned();
    if query.is_empty() { return Err("Digite o nome da música ou cole um link do YouTube.".to_string()); }
    if query.starts_with("http") && !valid_youtube_url(&query) {
        return Err("Cole um link do YouTube ou pesquise pelo nome da música.".to_string());
    }
    let include_youtube = include_youtube.to_string();
    let output = tauri::async_runtime::spawn_blocking(move || android_ytdlp_call("searchJson", &query, Some(&include_youtube)))
        .await.map_err(|error| format!("A busca foi interrompida: {error}"))??;
    let parsed: Value = serde_json::from_str(&output)
        .map_err(|_| "O yt-dlp não retornou uma lista reconhecível. Tente outra busca ou cole o link direto.".to_string())?;
    if let Some(error) = parsed.get("__voxstage_error").and_then(Value::as_str) { return Err(error.to_string()); }
    let entries = parsed.get("entries").and_then(Value::as_array)
        .map(|items| items.iter().collect::<Vec<_>>())
        .unwrap_or_else(|| vec![&parsed]);
    let results = entries.into_iter().filter_map(map_ytdlp_entry).collect::<Vec<_>>();
    if results.is_empty() { return Err("Não encontrei resultados. Tente o título e o artista ou cole um link direto.".to_string()); }
    Ok(results)
}

#[tauri::command]
async fn mobile_youtube_download(app: AppHandle, url: String) -> Result<Value, String> {
    mobile_youtube_download_kind(app, url, "downloadAudio").await
}

#[tauri::command]
async fn mobile_youtube_video_download(app: AppHandle, url: String) -> Result<Value, String> {
    mobile_youtube_download_kind(app, url, "downloadVideo").await
}

async fn mobile_youtube_download_kind(app: AppHandle, url: String, method: &'static str) -> Result<Value, String> {
    if !valid_youtube_url(&url) { return Err("Este resultado não contém um link válido do YouTube.".to_string()); }
    let music = mobile_music_dir(&app)?;
    let directory = music.to_string_lossy().into_owned();
    let output = tauri::async_runtime::spawn_blocking(move || {
        android_ytdlp_call(method, &url, Some(&directory))
    }).await.map_err(|error| format!("O download foi interrompido: {error}"))??;
    let result: Value = serde_json::from_str(&output).map_err(|_| "O download terminou, mas não consegui registrar o arquivo na biblioteca.".to_string())?;
    if let Some(error) = result.get("__voxstage_error").and_then(Value::as_str) { return Err(error.to_string()); }
    Ok(result)
}

async fn itunes_tracks(query: &str, limit: u8) -> Result<Vec<Value>, String> {
    let mut url = reqwest::Url::parse("https://itunes.apple.com/search").map_err(|error| error.to_string())?;
    url.query_pairs_mut().append_pair("term", query).append_pair("entity", "song")
        .append_pair("limit", &limit.to_string()).append_pair("country", "br");
    let response = mvsep_client()?.get(url).timeout(Duration::from_secs(20)).send().await
        .map_err(|error| format!("Não consegui consultar o catálogo de músicas: {error}"))?;
    if !response.status().is_success() { return Err(format!("O catálogo de músicas respondeu HTTP {}.", response.status())); }
    let data: Value = response.json().await.map_err(|error| format!("Resposta inválida do catálogo de músicas: {error}"))?;
    Ok(data.get("results").and_then(Value::as_array).cloned().unwrap_or_default())
}

#[tauri::command]
async fn mobile_music_metadata(title: String, url: String) -> Result<Value, String> {
    let title = title.trim();
    if title.len() < 2 || title.len() > 180 { return Err("Título inválido para a pesquisa de metadados.".into()); }
    let youtube = if valid_youtube_url(&url) {
        tauri::async_runtime::spawn_blocking(move || android_ytdlp_call("metadataJson", &url, None))
            .await.ok().and_then(Result::ok).and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .filter(|value| value.get("__voxstage_error").is_none())
    } else { None };
    let source_artist = youtube.as_ref().and_then(|value| value.get("artist")).and_then(Value::as_str).unwrap_or("").trim();
    let track_title = youtube.as_ref().and_then(|value| value.get("title")).and_then(Value::as_str).filter(|value| !value.is_empty()).unwrap_or(title);
    let query = if source_artist.is_empty() { track_title.to_string() } else { format!("{track_title} {source_artist}") };
    let tracks = itunes_tracks(&query, 8).await.unwrap_or_default();
    let normalized = title.to_lowercase();
    let artist_lower = source_artist.to_lowercase();
    let best = tracks.iter().find(|item| {
        let track = item.get("trackName").and_then(Value::as_str).unwrap_or("").to_lowercase();
        let artist = item.get("artistName").and_then(Value::as_str).unwrap_or("").to_lowercase();
        (normalized.contains(&track) || track_title.to_lowercase().contains(&track)) && track.len() >= 4
            && (artist_lower.is_empty() || artist_lower.contains(&artist) || artist.contains(&artist_lower))
    });
    let unique_artist = if source_artist.is_empty() {
        let artists = tracks.iter().filter_map(|item| item.get("artistName").and_then(Value::as_str)).collect::<HashSet<_>>();
        artists.len() == 1
    } else { true };
    let mut result = json!({"artist":source_artist,"album":youtube.as_ref().and_then(|value| value.get("album")).and_then(Value::as_str).unwrap_or(""),
        "duration":youtube.as_ref().and_then(|value| value.get("duration"))});
    if let Some(track) = best.filter(|_| unique_artist) {
        result["artist"] = track.get("artistName").cloned().unwrap_or(Value::Null);
        result["album"] = track.get("collectionName").cloned().unwrap_or(Value::Null);
        result["albumArtist"] = track.get("collectionArtistName").cloned().unwrap_or(Value::Null);
        result["releaseYear"] = Value::String(track.get("releaseDate").and_then(Value::as_str).unwrap_or("").chars().take(4).collect());
    }
    Ok(result)
}

#[tauri::command]
async fn mobile_cover_search(query: String) -> Result<Vec<Value>, String> {
    let query = query.trim();
    if query.len() < 2 || query.len() > 180 { return Err("Digite o nome da música ou artista.".into()); }
    let tracks = itunes_tracks(query, 16).await?;
    let mut seen = HashSet::new();
    let mut results = Vec::new();
    for track in tracks {
        let Some(album) = track.get("collectionName").and_then(Value::as_str).filter(|name| !name.is_empty()) else { continue };
        let Some(artwork) = track.get("artworkUrl100").and_then(Value::as_str) else { continue };
        let id = track.get("collectionId").and_then(Value::as_u64).unwrap_or(0);
        if !seen.insert(id) { continue; }
        let large = artwork.replace("100x100bb", "1200x1200bb").replace("100x100", "1200x1200");
        results.push(json!({"id":id.to_string(),"title":album,
            "artist":track.get("artistName").and_then(Value::as_str).unwrap_or("Artista desconhecido"),
            "track":track.get("trackName").and_then(Value::as_str).unwrap_or(""),
            "previewUrl":artwork.replace("http://", "https://"),"imageUrl":large.replace("http://", "https://")}));
        if results.len() >= 8 { break; }
    }
    Ok(results)
}

#[tauri::command]
async fn mobile_cover_download(app: AppHandle, url: String) -> Result<Value, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Endereço de capa inválido.".to_string())?;
    let allowed = |host: &str| host.ends_with(".mzstatic.com") || host == "mzstatic.com" || host == "is1-ssl.mzstatic.com";
    if parsed.scheme() != "https" || !parsed.host_str().is_some_and(allowed) { return Err("Endereço de capa inválido.".into()); }
    let response = mvsep_client()?.get(parsed).timeout(Duration::from_secs(35)).send().await
        .map_err(|error| format!("Não consegui baixar a capa: {error}"))?;
    if !response.url().host_str().is_some_and(allowed) { return Err("A imagem foi redirecionada para um endereço inesperado.".into()); }
    if !response.status().is_success() { return Err(format!("A capa respondeu HTTP {}.", response.status())); }
    let mime = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|value| value.to_str().ok()).unwrap_or("").to_string();
    let ext = if mime.starts_with("image/jpeg") { "jpg" } else if mime.starts_with("image/png") { "png" }
        else if mime.starts_with("image/webp") { "webp" } else { return Err("O resultado não é uma imagem suportada.".into()); };
    if response.content_length().is_some_and(|size| size > 20 * 1024 * 1024) { return Err("A capa excede 20 MB.".into()); }
    let bytes = response.bytes().await.map_err(|error| format!("Não consegui receber a capa: {error}"))?;
    if bytes.is_empty() || bytes.len() > 20 * 1024 * 1024 { return Err("A capa está vazia ou excede 20 MB.".into()); }
    let name = format!("{}.{}", uuid::Uuid::new_v4(), ext);
    fs::write(mobile_music_dir(&app)?.join(&name), bytes).map_err(|error| format!("Não consegui salvar a capa: {error}"))?;
    Ok(json!({"name":name}))
}

fn mobile_mvsep_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root.join("mvsep-config.json"))
}

fn mobile_mvsep_token(app: &AppHandle) -> Result<String, String> {
    let path = mobile_mvsep_config_path(app)?;
    let value: Value = match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| error.to_string())?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Value::Null,
        Err(error) => return Err(error.to_string()),
    };
    Ok(value.get("token").and_then(Value::as_str).unwrap_or("").trim().to_string())
}

#[tauri::command]
fn mobile_mvsep_get_config(app: AppHandle) -> Result<Value, String> {
    Ok(json!({"configured": !mobile_mvsep_token(&app)?.is_empty()}))
}

#[tauri::command]
async fn mobile_mvsep_validate_token(token: String) -> Result<Value, String> {
    let token = token.trim().to_string();
    if token.len() < 12 || token.len() > 300 || token.chars().any(char::is_whitespace) {
        return Err("A chave MVSep parece inválida.".into());
    }
        let client = mvsep_client()?;
        let mut url = reqwest::Url::parse("https://www.mvsep.com/api/app/user").map_err(|error| error.to_string())?;
        url.query_pairs_mut().append_pair("api_token", &token);
        let response = client.get(url).timeout(Duration::from_secs(25)).send().await
            .map_err(mvsep_network_error)?;
        if !response.status().is_success() {
            return Err(format!("A MVSep recusou a chave (HTTP {}). Confira a chave da API.", response.status()));
        }
        let payload: Value = response.json().await.map_err(|_| "Não consegui ler a resposta da MVSep. Tente novamente.".to_string())?;
        if !payload.get("success").and_then(Value::as_bool).unwrap_or(false) {
            return Err("A MVSep não validou esta chave. Confira a chave nas configurações da sua conta.".into());
        }
        Ok(json!({"valid": true, "name": payload.pointer("/data/name").and_then(Value::as_str).unwrap_or("")}))
}

#[tauri::command]
fn mobile_mvsep_save_config(app: AppHandle, token: String) -> Result<Value, String> {
    let token = token.trim();
    if token.len() < 12 || token.len() > 300 || token.chars().any(char::is_whitespace) {
        return Err("A chave MVSep parece inválida.".into());
    }
    let path = mobile_mvsep_config_path(&app)?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, serde_json::to_vec(&json!({"token": token})).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    fs::rename(temp, path).map_err(|error| error.to_string())?;
    Ok(json!({"configured": true}))
}

#[tauri::command]
fn mobile_mvsep_remove_config(app: AppHandle) -> Result<Value, String> {
    let path = mobile_mvsep_config_path(&app)?;
    match fs::remove_file(path) {
        Ok(()) => (),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
        Err(error) => return Err(error.to_string()),
    }
    Ok(json!({"configured": false}))
}

fn mvsep_client() -> Result<reqwest::Client, String> {
    network_client_builder()
        .no_proxy()
        .user_agent("VoxStage/0.1")
        .timeout(Duration::from_secs(120))
        .build().map_err(|error| format!("Não consegui iniciar a conexão MVSep: {error}"))
}

fn mvsep_network_error(error: reqwest::Error) -> String {
    if error.is_timeout() { return "A conexão com a MVSep demorou demais. Confira sua internet.".into(); }
    // Reqwest's Display includes the request URL, which can contain api_token.
    format!("Falha de conexão com a MVSep: {}", error.without_url())
}

fn network_client_builder() -> reqwest::ClientBuilder {
    let builder = reqwest::Client::builder();
    #[cfg(target_os = "android")]
    {
        // Reqwest 0.13's default verifier needs JNI initialization on Android.
        // Use the bundled Mozilla trust anchors for the native Rust requests.
        let roots = rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let tls = rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth();
        return builder.tls_backend_preconfigured(tls);
    }
    #[cfg(not(target_os = "android"))]
    builder
}

async fn mobile_mvsep_model_catalog() -> Result<Vec<Value>, String> {
    let client = mvsep_client()?;
    let response = client.get("https://www.mvsep.com/api/app/algorithms?scopes=single_upload")
        .timeout(Duration::from_secs(25)).send().await.map_err(|error| format!("Não consegui carregar os modelos MVSep: {error}"))?;
    if !response.status().is_success() { return Err(format!("A MVSep respondeu HTTP {} ao carregar os modelos.", response.status())); }
    let payload: Value = response.json().await.map_err(|error| format!("Resposta inválida da MVSep: {error}"))?;
    let entries = payload.as_array().cloned().or_else(|| payload.get("data").and_then(Value::as_array).cloned()).unwrap_or_default();
    let mut models = Vec::new();
    for entry in entries {
        if entry.get("audio_widget").and_then(Value::as_str).unwrap_or("single_upload") != "single_upload" { continue; }
        let Some(id) = entry.get("render_id").and_then(|value| value.as_i64().or_else(|| value.as_str()?.parse().ok())) else { continue; };
        let orientation = entry.get("orientation").and_then(|value| value.as_i64().or_else(|| value.as_str()?.parse().ok())).unwrap_or(0);
        if orientation > 1 { continue; }
        let name = entry.get("name").and_then(Value::as_str).unwrap_or("").trim();
        let lower = name.to_lowercase();
        if !lower.contains("vocal") && !lower.contains("lead/back") && !lower.contains("lead and backing") { continue; }
        if !["instrumental", "instrum", "music", "lead/back", "lead and backing"].iter().any(|term| lower.contains(term)) { continue; }
        let mut raw_fields = entry.get("algorithm_fields").cloned().unwrap_or(Value::Null);
        if let Some(serialized) = raw_fields.as_str() { raw_fields = serde_json::from_str(serialized).unwrap_or(Value::Null); }
        let mut fields = Vec::new();
        for field in raw_fields.as_array().into_iter().flatten() {
            let field_name = field.get("name").and_then(Value::as_str).unwrap_or("");
            if !["add_opt1", "add_opt2", "add_opt3"].contains(&field_name) { continue; }
            let mut options = field.get("options").cloned().unwrap_or(Value::Null);
            if let Some(serialized) = options.as_str() { options = serde_json::from_str(serialized).unwrap_or(Value::Null); }
            if let Some(items) = options.as_array() {
                let converted = items.iter().enumerate().filter_map(|(index, item)| {
                    let key = item.get("key").map(Value::to_string).unwrap_or_else(|| index.to_string()).trim_matches('"').to_string();
                    let value = item.get("value").or_else(|| item.get("text")).map(Value::to_string).unwrap_or_default().trim_matches('"').to_string();
                    Some((key, Value::String(value)))
                }).collect::<serde_json::Map<String, Value>>();
                options = Value::Object(converted);
            }
            let Some(options_map) = options.as_object() else { continue; };
            let default = field.get("default_key").map(Value::to_string).unwrap_or_else(|| options_map.keys().next().cloned().unwrap_or_default()).trim_matches('"').to_string();
            let default = if id == 12 && field_name == "add_opt1" && options_map.contains_key("1") { "1".to_string() } else { default };
            let mut values = serde_json::Map::new();
            for (key, value) in options_map { values.insert(key.clone(), Value::String(value.as_str().map(str::to_string).unwrap_or_else(|| value.to_string()))); }
            if !values.is_empty() {
                let selected = if values.contains_key(&default) { default } else { values.keys().next().cloned().unwrap_or_default() };
                fields.push(json!({"name":field_name,"label":field.get("text").or_else(||field.get("label")).and_then(Value::as_str).unwrap_or(field_name),"options":values,"default":selected}));
            }
        }
        models.push(json!({"id":id,"name":name,"orientation":orientation,"fields":fields}));
    }
    models.sort_by_key(|model| (model.get("orientation").and_then(Value::as_i64).unwrap_or(0), model.get("name").and_then(Value::as_str).unwrap_or("").to_lowercase(), model.get("id").and_then(Value::as_i64).unwrap_or(0)));
    if models.is_empty() { return Err("A MVSep não retornou modelos compatíveis para separar vocal e instrumental.".into()); }
    Ok(models)
}

#[tauri::command]
async fn mobile_mvsep_models() -> Result<Value, String> {
    mobile_mvsep_model_catalog().await.map(|models| json!({"models": models}))
}

fn mvsep_role(label: &str) -> &'static str {
    let normalized = label.to_lowercase().chars().filter(|c| c.is_ascii_alphabetic()).collect::<String>();
    if normalized.contains("vocalsfull") || normalized.contains("instrumentalonly") || normalized.contains("instrumonly") { "ignore" }
    else if normalized.contains("vocalsback") || normalized.contains("backing") || (normalized.contains("back") && !normalized.contains("instrum")) { "back" }
    else if normalized.contains("vocalslead") || normalized.contains("lead") || (normalized.contains("vocal") && !normalized.contains("instrum")) { "lead" }
    else if normalized == "instrumental" || normalized == "instrum" || normalized == "music" || normalized == "other" { "inst" }
    else { "ignore" }
}

fn mvsep_entries(files: &Value) -> Vec<(String, String, String)> {
    let entries: Vec<(String, Value)> = if let Some(object) = files.as_object() {
        object.iter().map(|(label, value)| {
            let entry = if value.is_object() { value.clone() } else { json!({"url": value}) };
            (label.clone(), entry)
        }).collect()
    } else {
        files.as_array().into_iter().flatten().map(|value| (String::new(), value.clone())).collect()
    };
    entries.into_iter().filter_map(|(fallback, entry)| {
        let label = ["name", "stem", "type", "title", "filename", "label"].iter().find_map(|key| entry.get(key).and_then(Value::as_str)).unwrap_or(&fallback).to_string();
        let url = ["url", "link", "download_url", "file_url", "filelink", "download"].iter().find_map(|key| entry.get(key).and_then(Value::as_str).filter(|url| url.starts_with("https://")))?;
        let parsed = reqwest::Url::parse(url).ok()?;
        if !parsed.host_str().is_some_and(|host| host == "mvsep.com" || host.ends_with(".mvsep.com")) { return None; }
        Some((label.clone(), url.to_string(), mvsep_role(&label).to_string()))
    }).collect()
}

#[tauri::command]
async fn mobile_mvsep_start_youtube(app: AppHandle, url: String, title: String, artist: String, model_id: i64, model_options: Value) -> Result<Value, String> {
    if !valid_youtube_url(url.trim()) { return Err("Cole um link válido do YouTube para enviar à MVSep.".into()); }
    if mobile_mvsep_token(&app)?.is_empty() { return Err("Configure a chave da API MVSep nas configurações primeiro.".into()); }
    let id = uuid::Uuid::new_v4().to_string();
    let initial = json!({"id":id,"stage":"preparing","message":"Preparando o áudio do YouTube no celular…","progress":1,"indeterminate":true,"title":title,"artist":artist,"files":[]});
    mobile_mvsep_jobs().lock().map_err(|_| "Não consegui iniciar a fila MVSep.".to_string())?.insert(id.clone(), initial.clone());
    spawn_mvsep_job(app, id, url, title, artist, model_id, model_options, None);
    Ok(initial)
}

#[tauri::command]
async fn mobile_mvsep_start_song(app: AppHandle, song_id: String, model_id: i64, model_options: Value) -> Result<Value, String> {
    if mobile_mvsep_token(&app)?.is_empty() { return Err("Configure sua chave MVSEP primeiro.".into()); }
    let library = mobile_get_library(app.clone())?;
    let song = library.iter().find(|song| song["id"] == song_id).ok_or("Música não encontrada.")?;
    if song.get("lead").and_then(Value::as_str).is_some_and(|name| !name.is_empty()) { return Err("Esta música já foi separada.".into()); }
    let source = song["source"].as_str().filter(|name| valid_media_name(name)).ok_or("Arquivo de origem inválido.")?;
    let source_path = mobile_music_dir(&app)?.join(source);
    if !source_path.is_file() { return Err("O arquivo da música completa não está mais neste aparelho.".into()); }
    let id = uuid::Uuid::new_v4().to_string();
    let title = song["title"].as_str().unwrap_or_default().to_string();
    let artist = song["artist"].as_str().unwrap_or_default().to_string();
    let initial = json!({"id":id,"songId":song_id,"stage":"preparing","message":"Preparando a música salva para MVSEP…","progress":1,"indeterminate":true,"title":title,"artist":artist,"files":[]});
    let mut jobs = mobile_mvsep_jobs().lock().map_err(|_| "Fila MVSep indisponível.")?;
    if let Some(job) = jobs.values().find(|job| job["songId"] == song_id && !matches!(job["stage"].as_str(), Some("done"|"error"|"missing"))) { return Ok(job.clone()); }
    jobs.insert(id.clone(), initial.clone()); drop(jobs);
    spawn_mvsep_job(app, id, String::new(), title, artist, model_id, model_options, Some(source_path));
    Ok(initial)
}

fn spawn_mvsep_job(app: AppHandle, id: String, url: String, title: String, artist: String, model_id: i64, model_options: Value, source_path: Option<PathBuf>) {
    tauri::async_runtime::spawn(async move {
        let result = mobile_mvsep_submit_youtube(app.clone(), url, title, artist, model_id, model_options, &id, source_path).await;
        match result {
            Ok(started) => {
                let hash = started.get("id").and_then(Value::as_str).unwrap_or("").to_string();
                mobile_mvsep_update_job(&id, json!({"stage":"waiting","message":"Áudio enviado. Aguardando na fila da MVSep…","progress":25,"indeterminate":true,"mvsepHash":hash}));
                let deadline = std::time::Instant::now() + Duration::from_secs(3600);
                loop {
                    if std::time::Instant::now() >= deadline {
                        mobile_mvsep_update_job(&id, json!({"stage":"error","message":"A consulta demorou mais de uma hora. Confira este processamento no site MVSEP.","indeterminate":false}));
                        break;
                    }
                    match mobile_mvsep_remote_status(app.clone(), hash.clone(), &id).await {
                        Ok(job) => {
                            let stage = job.get("stage").and_then(Value::as_str).unwrap_or("").to_string();
                            mobile_mvsep_update_job(&id, job);
                            if ["done", "error", "missing"].contains(&stage.as_str()) { break; }
                        }
                        Err(error) => {
                            mobile_mvsep_update_job(&id, json!({"stage":"error","message":error,"indeterminate":false}));
                            break;
                        }
                    }
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
            }
            Err(error) => mobile_mvsep_update_job(&id, json!({"stage":"error","message":error,"indeterminate":false})),
        }
    });
}

async fn mobile_mvsep_submit_youtube(app: AppHandle, url: String, title: String, artist: String, model_id: i64, model_options: Value, job_id: &str, saved_source: Option<PathBuf>) -> Result<Value, String> {
    let url = url.trim().to_string();
    if saved_source.is_none() && !valid_youtube_url(&url) { return Err("Cole um link válido do YouTube para enviar à MVSep.".into()); }
    let title = title.trim().chars().take(200).collect::<String>();
    let artist = artist.trim().chars().take(200).collect::<String>();
    let token = mobile_mvsep_token(&app)?;
    if token.is_empty() { return Err("Configure a chave da API MVSep nas configurações primeiro.".into()); }
    let models = mobile_mvsep_model_catalog().await?;
    let model = models.iter().find(|model| model.get("id").and_then(Value::as_i64) == Some(model_id)).cloned().ok_or("Selecione um modelo MVSep compatível.")?;
    let mut options = serde_json::Map::new();
    for field in model.get("fields").and_then(Value::as_array).into_iter().flatten() {
        let name = field.get("name").and_then(Value::as_str).unwrap_or("");
        let default = field.get("default").and_then(Value::as_str).unwrap_or("");
        let value = model_options.get(name).and_then(Value::as_str).unwrap_or(default);
        let allowed = field.get("options").and_then(Value::as_object).is_some_and(|items| items.contains_key(value));
        if !allowed { return Err("Uma opção do modelo MVSep não é válida.".into()); }
        options.insert(name.to_string(), Value::String(value.to_string()));
    }
    let music_dir = mobile_music_dir(&app)?;
    let delete_source = saved_source.is_none();
    let directory = music_dir.to_string_lossy().into_owned();
    let audio_path = if let Some(path) = saved_source { path } else {
    mobile_mvsep_update_job(job_id, json!({"stage":"downloading-source","message":"Baixando o áudio do YouTube no celular…","progress":5,"indeterminate":true}));
    tauri::async_runtime::spawn_blocking(move || {
        let downloaded = android_ytdlp_call("downloadAudio", &url, Some(&directory))?;
        let download: Value = serde_json::from_str(&downloaded).map_err(|_| "O yt-dlp não registrou o áudio baixado.".to_string())?;
        if let Some(error) = download.get("__voxstage_error").and_then(Value::as_str) { return Err(error.to_string()); }
        let filename = download.get("filename").and_then(Value::as_str).ok_or("O yt-dlp não retornou o arquivo de áudio.")?.to_string();
        if !valid_media_name(&filename) { return Err("O yt-dlp retornou um nome de arquivo inválido.".into()); }
        Ok::<PathBuf, String>(PathBuf::from(&directory).join(filename))
    }).await.map_err(|error| format!("O download foi interrompido: {error}"))?? };
    mobile_mvsep_update_job(job_id, json!({"stage":"sending","message":"Enviando o áudio à MVSep…","progress":20,"indeterminate":true}));
    let mut form = reqwest::multipart::Form::new()
        .text("api_token", token)
        .text("sep_type", model_id.to_string())
        .text("output_format", "0");
    for (key, value) in options { form = form.text(key, value.as_str().unwrap_or("").to_string()); }
    form = form.file("audiofile", &audio_path).await
        .map_err(|error| format!("Não consegui preparar o arquivo para a MVSep: {error}"))?;
    let response = mvsep_client()?.post("https://www.mvsep.com/api/separation/create")
        .timeout(Duration::from_secs(600)).multipart(form).send().await;
    if delete_source { let _ = fs::remove_file(&audio_path); }
    let response = response.map_err(mvsep_network_error)?;
    let status = response.status();
    let payload: Value = response.json().await.map_err(|error| format!("Resposta inválida da MVSep: {error}"))?;
    if !status.is_success() || !payload.get("success").and_then(Value::as_bool).unwrap_or(false) {
        let message = payload.pointer("/data/message").and_then(Value::as_str).unwrap_or("a MVSep recusou o envio");
        return Err(format!("MVSep: {message}"));
    }
    let hash = payload.pointer("/data/hash").and_then(Value::as_str).ok_or("A MVSep não retornou o código do processamento.")?;
    Ok(json!({"id":hash,"stage":"processing","message":"Áudio enviado. Aguardando separação da MVSep…","progress":25,"indeterminate":true,"title":title,"artist":artist}))
}

#[tauri::command]
async fn mobile_mvsep_youtube_status(job_hash: String) -> Result<Value, String> {
    if job_hash.len() < 8 || job_hash.len() > 200 || job_hash == ".." || !job_hash.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte)) { return Err("Identificador de processamento MVSep inválido.".into()); }
    mobile_mvsep_jobs().lock().map_err(|_| "Não consegui consultar a fila MVSep.".to_string())?
        .get(&job_hash).cloned().ok_or("Esta tarefa não está mais ativa. Reabra a importação para tentar novamente.".to_string())
}

async fn mobile_mvsep_remote_status(app: AppHandle, job_hash: String, job_id: &str) -> Result<Value, String> {
    let token = mobile_mvsep_token(&app)?;
    let directory = mobile_music_dir(&app)?.to_string_lossy().into_owned();
        let client = mvsep_client()?;
        let mut status_url = reqwest::Url::parse("https://www.mvsep.com/api/separation/get").map_err(|error| error.to_string())?;
        status_url.query_pairs_mut().append_pair("hash", &job_hash).append_pair("api_token", &token);
        let response = match client.get(status_url).timeout(Duration::from_secs(35)).send().await {
            Ok(response) => response,
            Err(_) => return Ok(json!({"stage":"reconnecting","message":"Conexão interrompida. Tentando consultar novamente, sem reenviar a música…","indeterminate":true})),
        };
        if response.status().is_server_error() || response.status().as_u16() == 429 {
            return Ok(json!({"stage":"reconnecting","message":"MVSep temporariamente indisponível. Tentando consultar novamente…","indeterminate":true}));
        }
        if !response.status().is_success() { return Err(format!("MVSep respondeu HTTP {} ao consultar o processamento.", response.status())); }
        let result: Value = match response.json().await {
            Ok(result) => result,
            Err(_) => return Ok(json!({"stage":"reconnecting","message":"Resposta MVSep interrompida. Tentando consultar novamente…","indeterminate":true})),
        };
        let status = result.get("status").and_then(Value::as_str).unwrap_or("processing");
        let data = result.get("data").unwrap_or(&Value::Null);
        match status {
            "failed" => return Ok(json!({"stage":"error","message":data.get("message").and_then(Value::as_str).unwrap_or("A MVSep não conseguiu separar esta música.").replace(&token,"[chave oculta]"),"progress":0,"indeterminate":false})),
            "not_found" => return Ok(json!({"stage":"missing","message":"A MVSep não encontrou este processamento."})),
            "done" => {
                let entries = mvsep_entries(data.get("files").unwrap_or(&Value::Null));
                if entries.is_empty() { return Ok(json!({"stage":"error","message":"A MVSep terminou, mas não retornou os links dos stems."})); }
                let root = PathBuf::from(directory);
                let count = entries.len();
                let mut transfers = entries.iter().map(|(label, _, role)| json!({"label":label,"role":role,"state":"pending","received":0,"total":null})).collect::<Vec<_>>();
                if let Ok(jobs) = mobile_mvsep_jobs().lock() {
                    if let Some(previous) = jobs.get(job_id).and_then(|job| job["files"].as_array()) {
                        for transfer in &mut transfers {
                            if let Some(done) = previous.iter().find(|file| file["label"] == transfer["label"] && file["state"] == "done"
                                && file["name"].as_str().is_some_and(|name| valid_media_name(name) && root.join(name).is_file())) { *transfer = done.clone(); }
                        }
                    }
                }
                mobile_mvsep_update_job(job_id, json!({"stage":"receiving","message":format!("MVSep terminou. Preparando {count} arquivo(s) para download…"),"progress":90,"indeterminate":true,"files":transfers}));
                let mut outputs = Vec::new();
                for (index, (_, url, _)) in entries.into_iter().enumerate() {
                    if transfers[index]["state"] == "done" { outputs.push(transfers[index].clone()); continue; }
                    transfers[index]["state"] = json!("connecting");
                    mobile_mvsep_update_job(job_id, json!({"stage":"receiving","message":format!("Conectando ao arquivo {} de {}…",index+1,count),"files":transfers}));
                    let parsed = reqwest::Url::parse(&url).map_err(|error| error.to_string())?;
                    let ext = Path::new(parsed.path()).extension().and_then(|value| value.to_str()).unwrap_or("mp3").to_lowercase();
                    let ext = ext.chars().filter(|c| c.is_ascii_alphanumeric()).take(8).collect::<String>();
                    let filename = format!("{}.{}", uuid::Uuid::new_v4(), if ext.is_empty() { "mp3" } else { &ext });
                    let mut response = match client.get(url).send().await {
                        Ok(response) => response,
                        Err(_) => return Ok(json!({"stage":"reconnecting","message":"Download interrompido. Tentando receber os stems novamente…","indeterminate":true})),
                    };
                    if response.status().is_server_error() || response.status().as_u16() == 429 {
                        return Ok(json!({"stage":"reconnecting","message":"Servidor de arquivos ocupado. Tentando receber os stems novamente…","indeterminate":true}));
                    }
                    if !response.status().is_success() { return Err(format!("Falha ao receber um stem da MVSep: HTTP {}", response.status())); }
                    let total = response.content_length();
                    transfers[index]["state"] = json!("downloading");
                    transfers[index]["total"] = json!(total);
                    mobile_mvsep_update_job(job_id, json!({"stage":"receiving","message":format!("Baixando arquivo {} de {}…",index+1,count),"files":transfers}));
                    let partial = root.join(format!(".{filename}.download"));
                    let mut file = fs::File::create(&partial).map_err(|error| error.to_string())?;
                    let mut received = 0u64;
                    loop {
                        let chunk = match response.chunk().await {
                            Ok(Some(chunk)) => chunk,
                            Ok(None) => break,
                            Err(_) => { drop(file); let _ = fs::remove_file(&partial);
                                return Ok(json!({"stage":"reconnecting","message":"Download interrompido. Tentando receber os stems novamente…","indeterminate":true})); }
                        };
                        file.write_all(&chunk).map_err(|error| format!("Não consegui salvar o stem: {error}"))?;
                        received += chunk.len() as u64;
                        transfers[index]["received"] = json!(received);
                        let progress = 90 + ((index as f64 + total.map(|size| (received as f64 / size.max(1) as f64).min(1.0)).unwrap_or(0.0)) * 9.0 / count as f64) as i64;
                        mobile_mvsep_update_job(job_id, json!({"progress":progress,"indeterminate":total.is_none(),"files":transfers}));
                    }
                    drop(file);
                    fs::rename(&partial, root.join(&filename)).map_err(|error| format!("Não consegui concluir o arquivo recebido: {error}"))?;
                    transfers[index]["state"] = json!("done");
                    transfers[index]["name"] = json!(filename);
                    mobile_mvsep_update_job(job_id, json!({"progress":90+((index+1)*9/count) as i64,"files":transfers}));
                    outputs.push(transfers[index].clone());
                }
                return Ok(json!({"stage":"done","message":"Arquivos recebidos da MVSep. Confira os papéis e salve a música.","progress":100,"indeterminate":false,"files":outputs}));
            }
            "waiting" => {
                let position = data.get("current_order").and_then(|value| value.as_i64().or_else(|| value.as_str()?.parse().ok()));
                let ahead = data.get("queue_count").and_then(|value| value.as_i64().or_else(|| value.as_str()?.parse().ok()));
                let message = position.filter(|value| *value > 0).map(|value| format!("Aguardando na fila da MVSep · posição {value}"))
                    .or_else(|| ahead.map(|value| format!("Aguardando na fila da MVSep · {value} faixa(s) antes")))
                    .unwrap_or_else(|| "Aguardando na fila da MVSep…".to_string());
                return Ok(json!({"stage":"waiting","message":message,"progress":25,"indeterminate":true}));
            }
            "distributing" => {
                let finished = data.get("finished_chunks").and_then(Value::as_i64).unwrap_or(0);
                let total = data.get("all_chunks").and_then(Value::as_i64).unwrap_or(0);
                let progress = if total > 0 { (30 + finished * 55 / total).min(85) } else { 30 };
                return Ok(json!({"stage":"distributing","message":if total > 0 { format!("Separando a faixa em partes… {finished} de {total}") } else { "Separando a faixa…".to_string() },"progress":progress,"indeterminate":total == 0}));
            }
            "merging" => return Ok(json!({"stage":"merging","message":"Unindo as partes da faixa…","progress":88,"indeterminate":true})),
            _ => Ok(json!({"stage":"processing","message":"Separando os vocais e o instrumental na MVSep…","progress":55,"indeterminate":true})),
        }
}

static MOBILE_LIBRARY_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
fn save_mobile_library(path: &Path, songs: &[Value]) -> Result<(), String> {
    let temp = path.with_extension("json.tmp");
    let data = serde_json::to_vec_pretty(songs).map_err(|error| error.to_string())?;
    fs::write(&temp, data).map_err(|error| error.to_string())?;
    fs::rename(temp, path).map_err(|error| error.to_string())
}

#[tauri::command]
fn mobile_get_music_dir(app: AppHandle) -> Result<String, String> {
    mobile_music_dir(&app).map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn mobile_get_library(app: AppHandle) -> Result<Vec<Value>, String> {
    let library_path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("library.json");
    if !library_path.exists() {
        return Ok(Vec::new());
    }
    let contents = fs::read(library_path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&contents).map_err(|error| error.to_string())
}

#[tauri::command]
fn mobile_save_song(app: AppHandle, song: Value) -> Result<Value, String> {
    let _guard = MOBILE_LIBRARY_LOCK.lock().map_err(|_| "Biblioteca indisponível.")?;
    let id = song
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "A música precisa de um identificador.".to_string())?;
    let data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    let library_path = data_dir.join("library.json");
    let mut songs = mobile_get_library(app.clone())?;
    let old = songs.iter().find(|entry| entry.get("id").and_then(Value::as_str) == Some(id)).cloned();
    songs.retain(|entry| entry.get("id").and_then(Value::as_str) != Some(id));
    songs.push(song.clone());
    save_mobile_library(&library_path, &songs)?;

    if let Some(old) = old {
        let music = mobile_music_dir(&app)?;
        let retained: Vec<&str> = ["source", "inst", "lead", "back", "cover", "background", "backgroundVideo"]
            .iter()
            .filter_map(|key| song.get(key).and_then(Value::as_str))
            .collect();
        for key in ["source", "inst", "lead", "back", "cover", "background", "backgroundVideo"] {
            if let Some(name) = old.get(key).and_then(Value::as_str) {
                if valid_media_name(name) && !retained.contains(&name) {
                    let _ = fs::remove_file(music.join(name));
                }
            }
        }
    }
    Ok(song)
}

#[tauri::command]
fn mobile_delete_song(app: AppHandle, id: String) -> Result<(), String> {
    let _guard = MOBILE_LIBRARY_LOCK.lock().map_err(|_| "Biblioteca indisponível.")?;
    let mut songs = mobile_get_library(app.clone())?;
    let removed: Vec<Value> = songs
        .iter()
        .filter(|song| song.get("id").and_then(Value::as_str) == Some(&id))
        .cloned()
        .collect();
    songs.retain(|song| song.get("id").and_then(Value::as_str) != Some(&id));
    let library_path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("library.json");
    save_mobile_library(&library_path, &songs)?;
    let music = mobile_music_dir(&app)?;
    for song in removed {
        for key in ["source", "inst", "lead", "back", "cover", "background", "backgroundVideo"] {
            if let Some(name) = song.get(key).and_then(Value::as_str) {
                if valid_media_name(name) {
                    let _ = fs::remove_file(music.join(name));
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn mobile_write_file_chunk(
    app: AppHandle,
    name: String,
    offset: u64,
    chunk: Vec<u8>,
    final_chunk: bool,
) -> Result<(), String> {
    if !valid_media_name(&name) {
        return Err("Nome de arquivo inválido.".to_string());
    }
    let music = mobile_music_dir(&app)?;
    let partial = music.join(format!(".{name}.upload"));
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .open(&partial)
        .map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(offset)).map_err(|error| error.to_string())?;
    file.write_all(&chunk).map_err(|error| error.to_string())?;
    file.flush().map_err(|error| error.to_string())?;
    drop(file);
    if final_chunk {
        fs::rename(partial, music.join(name)).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn pc_library_url(base_url: &str) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(base_url.trim()).map_err(|_| "Link do computador inválido.".to_string())?;
    if url.scheme() != "http" || url.username() != "" || url.password().is_some() {
        return Err("Use o link HTTP local mostrado pelo computador.".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "O link não contém o endereço do computador.".to_string())?;
    let local_host = host == "localhost"
        || host
            .parse::<Ipv4Addr>()
            .map(|address| address.is_private() || address.is_loopback() || address.is_link_local())
            .unwrap_or(false);
    if !local_host {
        return Err("Por segurança, conecte-se ao endereço local do computador na mesma rede.".to_string());
    }
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn checked_remote_token(token: &str) -> Result<&str, String> {
    let token = token.trim();
    if token.len() < 20 || token.len() > 100 || !token.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')) {
        return Err("O código do computador é inválido. Leia novamente o QR code.".to_string());
    }
    Ok(token)
}

async fn fetch_pc_library(client: &reqwest::Client, base: &reqwest::Url, token: &str) -> Result<Vec<Value>, String> {
    let mut url = base.clone();
    url.set_path("/api/remote/library");
    let response = client
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("Não consegui acessar o computador: {error}"))?;
    if !response.status().is_success() {
        return Err(if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
            "O código expirou ou não corresponde a este computador. Gere um novo QR code.".to_string()
        } else {
            format!("O computador respondeu com HTTP {}.", response.status())
        });
    }
    response.json().await.map_err(|_| "Não consegui ler a biblioteca do computador.".to_string())
}

async fn send_pc_remote_json(
    client: &reqwest::Client,
    base: &reqwest::Url,
    token: &str,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let mut url = base.clone();
    url.set_path(path);
    let request = if let Some(payload) = body {
        client.post(url).bearer_auth(token).json(&payload)
    } else {
        client.get(url).bearer_auth(token)
    };
    let response = request
        .send()
        .await
        .map_err(|error| format!("Não consegui acessar o VoxStage no PC: {error}"))?;
    if !response.status().is_success() {
        return Err(if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
            "O código do PC expirou. Leia o QR novamente.".to_string()
        } else {
            format!("O PC respondeu com HTTP {}.", response.status())
        });
    }
    response.json().await.map_err(|_| "O PC enviou uma resposta inválida.".to_string())
}

fn pc_remote_client() -> Result<reqwest::Client, String> {
    network_client_builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn mobile_remote_state(base_url: String, token: String) -> Result<Value, String> {
    let base = pc_library_url(&base_url)?;
    let token = checked_remote_token(&token)?;
    send_pc_remote_json(&pc_remote_client()?, &base, token, "/api/remote/state", None).await
}

#[tauri::command]
async fn mobile_remote_send_mvsep_key(app: AppHandle, base_url: String, token: String, api_key: Option<String>) -> Result<Value, String> {
    let base = pc_library_url(&base_url)?;
    let remote_token = checked_remote_token(&token)?;
    let key = match api_key { Some(key) => key, None => mobile_mvsep_token(&app)? };
    let key = key.trim();
    if key.len() < 12 || key.len() > 300 || key.chars().any(char::is_whitespace) { return Err("Salve uma chave MVSEP neste celular ou cole uma chave válida antes de enviar.".into()); }
    let client = pc_remote_client()?;
    let state = send_pc_remote_json(&client, &base, remote_token, "/api/remote/state", None).await?;
    if state["hostType"] != "tv" { return Err("Conecte ao QR da Google TV para enviar a chave.".into()); }
    send_pc_remote_json(&client, &base, remote_token, "/api/remote/mvsep/config", Some(json!({"token":key}))).await
}

#[tauri::command]
async fn mobile_remote_control(
    base_url: String,
    token: String,
    action: String,
    song_id: Option<String>,
) -> Result<Value, String> {
    if !matches!(action.as_str(), "play" | "pause" | "next" | "previous") {
        return Err("Comando remoto inválido.".to_string());
    }
    let base = pc_library_url(&base_url)?;
    let token = checked_remote_token(&token)?;
    let payload = json!({"action": action, "songId": song_id});
    send_pc_remote_json(&pc_remote_client()?, &base, token, "/api/remote/control", Some(payload)).await
}

#[tauri::command]
async fn mobile_remote_request(
    app: AppHandle,
    base_url: String,
    token: String,
    title: String,
    artist: String,
    song_id: Option<String>,
) -> Result<Value, String> {
    if title.trim().is_empty() && song_id.as_deref().unwrap_or_default().is_empty() {
        return Err("Digite o nome da música que quer pedir.".to_string());
    }
    let base = pc_library_url(&base_url)?;
    let token = checked_remote_token(&token)?;
    let client = pc_remote_client()?;
    let remote = fetch_pc_library(&client,&base,token).await?;
    let matches = |song: &Value| -> bool {
        if let Some(id) = song_id.as_deref().filter(|id| !id.is_empty()) { return song["id"] == id; }
        song["title"].as_str().unwrap_or_default().trim().eq_ignore_ascii_case(title.trim())
            && (artist.trim().is_empty() || song["artist"].as_str().unwrap_or_default().trim().eq_ignore_ascii_case(artist.trim()))
    };
    let resolved_id = if let Some(song) = remote.iter().find(|song| matches(song)) {
        song["id"].as_str().map(str::to_owned)
    } else if let Some(song) = mobile_get_library(app.clone())?.into_iter().find(|song| song["hidden"] != true && matches(song)) {
        let id = song["id"].as_str().ok_or("Música sem identificador.")?.to_owned();
        mobile_send_pc_song(app,base_url,token.to_owned(),id.clone()).await?;
        Some(id)
    } else { song_id };
    let payload = json!({"title": title, "artist": artist, "songId": resolved_id});
    send_pc_remote_json(&pc_remote_client()?, &base, token, "/api/remote/request", Some(payload)).await
}

#[tauri::command]
async fn mobile_get_pc_library(base_url: String, token: String) -> Result<Vec<Value>, String> {
    let base = pc_library_url(&base_url)?;
    let token = checked_remote_token(&token)?;
    let client = network_client_builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|error| error.to_string())?;
    fetch_pc_library(&client, &base, token).await
}

#[tauri::command]
async fn mobile_import_pc_songs(
    app: AppHandle,
    base_url: String,
    token: String,
    ids: Vec<String>,
) -> Result<usize, String> {
    if ids.is_empty() {
        return Err("Selecione pelo menos uma música.".to_string());
    }
    let base = pc_library_url(&base_url)?;
    let token = checked_remote_token(&token)?;
    let selected_ids: HashSet<String> = ids.into_iter().collect();
    let client = network_client_builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|error| error.to_string())?;
    let remote_songs = fetch_pc_library(&client, &base, token).await?;
    let songs: Vec<Value> = remote_songs
        .into_iter()
        .filter(|song| song.get("id").and_then(Value::as_str).map(|id| selected_ids.contains(id)).unwrap_or(false))
        .collect();
    if songs.is_empty() {
        return Err("As músicas selecionadas não estão mais na biblioteca do computador.".to_string());
    }

    let music = mobile_music_dir(&app)?;
    for song in &songs {
        for key in ["source", "inst", "lead", "back", "cover", "background", "backgroundVideo"] {
            let Some(name) = song.get(key).and_then(Value::as_str) else { continue };
            if !valid_media_name(name) {
                return Err("A biblioteca do computador contém um nome de arquivo inválido.".to_string());
            }
            let destination = music.join(name);
            if destination.is_file() { continue; }

            let mut media_url = base.clone();
            media_url.set_path(&format!("/api/remote/media/{name}"));
            let mut response = client
                .get(media_url)
                .bearer_auth(token)
                .send()
                .await
                .map_err(|error| format!("Não consegui baixar um arquivo de música: {error}"))?;
            if !response.status().is_success() {
                return Err(format!("O computador não conseguiu enviar o arquivo {name} (HTTP {}).", response.status()));
            }
            let partial = music.join(format!(".{name}.download"));
            let mut output = fs::File::create(&partial).map_err(|error| error.to_string())?;
            while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
                output.write_all(&chunk).map_err(|error| error.to_string())?;
            }
            output.flush().map_err(|error| error.to_string())?;
            drop(output);
            fs::rename(partial, destination).map_err(|error| error.to_string())?;
        }
    }

    let _guard = MOBILE_LIBRARY_LOCK.lock().map_err(|_| "Biblioteca indisponível.")?;
    let mut local_songs = mobile_get_library(app.clone())?;
    for imported in &songs {
        let id = imported.get("id").and_then(Value::as_str).unwrap_or_default();
        local_songs.retain(|song| song.get("id").and_then(Value::as_str) != Some(id));
        local_songs.push(imported.clone());
    }
    let data_dir = mobile_music_dir_from_app_data(&app)?;
    save_mobile_library(&data_dir.join("library.json"), &local_songs)?;
    Ok(songs.len())
}

async fn transfer_response(response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    let body: Value = response.json().await.map_err(|error| format!("Resposta inválida do aparelho conectado: {error}"))?;
    if !status.is_success() {
        return Err(body.get("error").and_then(Value::as_str).unwrap_or("Falha na transferência.").to_string());
    }
    Ok(body)
}

#[tauri::command]
async fn mobile_send_pc_song(app: AppHandle, base_url: String, token: String, id: String) -> Result<Value, String> {
    let base = pc_library_url(&base_url)?;
    let token = checked_remote_token(&token)?;
    let song = mobile_get_library(app.clone())?.into_iter()
        .find(|item| item.get("id").and_then(Value::as_str) == Some(id.as_str()))
        .ok_or_else(|| "Esta música não está mais no celular.".to_string())?;
    let media_keys = ["source", "inst", "lead", "back", "cover", "background", "backgroundVideo"];
    let mut files = Vec::<String>::new();
    for key in media_keys {
        if let Some(name) = song.get(key).and_then(Value::as_str) {
            if !valid_media_name(name) || !name.contains('.') {
                return Err(format!("Arquivo inválido: {name}"));
            }
            if !files.iter().any(|saved| saved == name) { files.push(name.to_string()); }
        }
    }
    if files.is_empty() { return Err("Esta música não contém arquivos para transferir.".to_string()); }
    let music = mobile_music_dir(&app)?;
    let mut total_bytes = 0_u64;
    for name in &files {
        total_bytes += fs::metadata(music.join(name)).map_err(|_| format!("Arquivo ausente no celular: {name}"))?.len();
    }
    let client = network_client_builder().timeout(Duration::from_secs(90)).build().map_err(|error| error.to_string())?;
    let mut init_url = base.clone(); init_url.set_path("/api/remote/transfers");
    let created = transfer_response(client.post(init_url).bearer_auth(token).json(&json!({"song": song})).send().await
        .map_err(|error| format!("Não consegui pedir a transferência: {error}"))?).await?;
    let transfer_id = created.get("id").and_then(Value::as_str).ok_or_else(|| "O aparelho conectado não criou a transferência.".to_string())?;
    let mut sent_total = 0_u64;
    for name in &files {
        let mut file = fs::File::open(music.join(name)).map_err(|error| error.to_string())?;
        let file_total = file.metadata().map_err(|error| error.to_string())?.len();
        if file_total == 0 { return Err(format!("Arquivo vazio: {name}")); }
        let mut file_offset = 0_u64;
        let mut buffer = vec![0_u8; 1024 * 1024];
        while file_offset < file_total {
            let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
            if count == 0 { return Err(format!("Leitura interrompida: {name}")); }
            let mut url = base.clone(); url.set_path(&format!("/api/remote/transfers/{transfer_id}/media/{name}"));
            transfer_response(client.put(url).bearer_auth(token)
                .header("X-Offset", file_offset.to_string()).header("X-Total", file_total.to_string())
                .body(buffer[..count].to_vec()).send().await
                .map_err(|error| format!("Falha ao enviar {name}: {error}"))?).await?;
            file_offset += count as u64;
            sent_total += count as u64;
            let _ = app.emit("voxstage-pc-transfer-progress", json!({"songId": id, "file": name,
                "fileSent": file_offset, "fileTotal": file_total, "sent": sent_total, "total": total_bytes}));
        }
    }
    let mut ready_url = base.clone(); ready_url.set_path(&format!("/api/remote/transfers/{transfer_id}/ready"));
    transfer_response(client.post(ready_url).bearer_auth(token).json(&json!({})).send().await
        .map_err(|error| format!("Não consegui concluir a transferência: {error}"))?).await
}

#[tauri::command]
async fn mobile_pc_transfer_status(base_url: String, token: String, id: String) -> Result<Value, String> {
    let base = pc_library_url(&base_url)?;
    let token = checked_remote_token(&token)?;
    let transfer_id = uuid::Uuid::parse_str(&id).map_err(|_| "Transferência inválida.".to_string())?;
    let mut url = base.clone(); url.set_path(&format!("/api/remote/transfers/{transfer_id}"));
    let client = pc_remote_client()?;
    transfer_response(client.get(url).bearer_auth(token).send().await
        .map_err(|error| format!("Não consegui consultar a transferência: {error}"))?).await
}

fn mobile_music_dir_from_app_data(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

#[cfg(all(not(mobile), not(debug_assertions)))]
struct BackendProcess(Mutex<Option<Child>>);

#[cfg(not(mobile))]
fn wait_for_server() -> Result<(), Box<dyn std::error::Error>> {
    let deadline = Instant::now() + Duration::from_secs(25);
    while Instant::now() < deadline {
        if TcpStream::connect(("127.0.0.1", APP_PORT)).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(250));
    }
    Err(io::Error::new(
        io::ErrorKind::TimedOut,
        "O servidor local do VoxStage não respondeu na porta 8000.",
    )
    .into())
}

#[cfg(all(not(mobile), not(debug_assertions)))]
fn start_packaged_backend(app: &tauri::App) -> Result<Child, Box<dyn std::error::Error>> {
    let resources = app.path().resource_dir()?.join("app");
    if TcpStream::connect(("127.0.0.1", APP_PORT)).is_ok() {
        return Err(io::Error::new(io::ErrorKind::AddrInUse,
            "A porta 8000 está em uso. Feche a outra janela/servidor do VoxStage e abra novamente.").into());
    }
    let default_data = app.path().app_data_dir()?;
    // A portable release beside an existing development checkout uses its library.
    // A fresh installation stores songs in AppData; an explicit override wins.
    let previous_data = resources.ancestors().find_map(|ancestor| {
        [ancestor.join("dev-data"), ancestor.join("native-app/dev-data")].into_iter()
            .find(|candidate| candidate.join("library.json").is_file())
    });
    let data_dir = std::env::var_os("VOXSTAGE_DATA_DIR").map(PathBuf::from)
        .unwrap_or_else(|| if default_data.join("library.json").is_file() { default_data.clone() }
            else { previous_data.unwrap_or(default_data) });
    std::fs::create_dir_all(&data_dir)?;
    let bundled_python = resources.join("python/python.exe");
    let mut command = if cfg!(windows) && bundled_python.is_file() {
        let mut command = Command::new(bundled_python);
        command.args(["-E", "-s", "-u", "server.py"]);
        command
    } else if cfg!(windows) {
        let mut command = Command::new("py");
        command.args(["-3.13", "server.py"]);
        command
    } else {
        let mut command = Command::new("python3");
        command.args(["server.py"]);
        command
    };

    let log = OpenOptions::new().create(true).append(true).open(data_dir.join("voxstage-server.log"))?;
    let runtime_bin = resources.join("bin");
    let mut runtime_path = vec![runtime_bin];
    runtime_path.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()));
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    Ok(command
        .current_dir(&resources)
        .env("VOXSTAGE_DATA_DIR", data_dir)
        .env("VOXSTAGE_HOST", "0.0.0.0")
        .env("VOXSTAGE_PORT", APP_PORT.to_string())
        .env("PATH", std::env::join_paths(runtime_path)?)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone()?))
        .stderr(Stdio::from(log))
        .spawn()?)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().invoke_handler(tauri::generate_handler![
        mobile_get_music_dir,
        mobile_get_library,
        mobile_save_song,
        mobile_delete_song,
        mobile_write_file_chunk,
        mobile_get_pc_library,
        mobile_import_pc_songs,
        mobile_send_pc_song,
        mobile_pc_transfer_status,
        mobile_remote_state,
        mobile_remote_send_mvsep_key,
        mobile_remote_control,
        mobile_remote_request,
        mobile_tv_host_api,
        mobile_youtube_search,
        mobile_youtube_download,
        mobile_youtube_video_download,
        mobile_music_metadata,
        mobile_cover_search,
        mobile_cover_download,
        mobile_mvsep_get_config,
        mobile_mvsep_validate_token,
        mobile_mvsep_save_config,
        mobile_mvsep_remove_config,
        mobile_mvsep_models,
        mobile_mvsep_start_youtube,
        mobile_mvsep_start_song,
        mobile_mvsep_youtube_status
    ]);

    #[cfg(not(mobile))]
    let builder = builder.setup(|app| {
        #[cfg(not(debug_assertions))]
        app.manage(BackendProcess(Mutex::new(Some(start_packaged_backend(app)?))));

        wait_for_server()?;
        Ok(())
    });

    builder
        .build(tauri::generate_context!())
        .expect("Não foi possível iniciar o VoxStage.")
        .run(|_app, _event| {
            #[cfg(all(not(mobile), not(debug_assertions)))]
            if let tauri::RunEvent::Exit = _event {
                if let Some(backend) = _app.try_state::<BackendProcess>() {
                    if let Ok(mut child) = backend.0.lock() {
                        if let Some(child) = child.as_mut() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            }
        });
}
