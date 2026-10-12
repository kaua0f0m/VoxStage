//! Optional LAN playback remote for Android TV. No AI runtime or PC backend.
use std::{collections::HashMap, fs, io::{Read, Write}, net::{TcpListener, TcpStream, UdpSocket}, path::PathBuf, sync::{Mutex, OnceLock}, time::{Duration, SystemTime, UNIX_EPOCH}};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

struct Host {
    app: AppHandle,
    token: String,
    address: String,
    library_path: PathBuf,
    state: Value,
    commands: Vec<Value>,
    requests: Vec<Value>,
    transfers: HashMap<String, Value>,
}
static HOST: OnceLock<Mutex<Option<Host>>> = OnceLock::new();
fn storage() -> &'static Mutex<Option<Host>> { HOST.get_or_init(|| Mutex::new(None)) }
fn new_token() -> String { uuid::Uuid::new_v4().simple().to_string() }
fn library(host: &Host) -> Vec<Value> {
    fs::read(&host.library_path).ok().and_then(|bytes| serde_json::from_slice::<Vec<Value>>(&bytes).ok()).unwrap_or_default()
        .into_iter().filter(|song| song["hidden"] != true).collect()
}
fn lan_address() -> String {
    // UDP connect selects the local interface without sending a packet.
    UdpSocket::bind("0.0.0.0:0").ok().and_then(|socket| {
        socket.connect("192.0.2.1:8000").ok()?;
        Some(socket.local_addr().ok()?.ip().to_string())
    }).unwrap_or_default()
}
fn start(app: &AppHandle) -> Result<(), String> {
    let mut guard = storage().lock().map_err(|_| "Controle TV indisponível.")?;
    if let Some(host) = guard.as_mut() { host.address = lan_address(); return Ok(()); }
    let listener = TcpListener::bind("0.0.0.0:8000").map_err(|error| format!("Não consegui abrir o controle da TV na porta 8000: {error}"))?;
    let path = app.path().app_data_dir().map_err(|error| error.to_string())?.join("library.json");
    *guard = Some(Host {app:app.clone(), token:new_token(), address:lan_address(), library_path:path,
        state:json!({"playing":false,"title":"","artist":"","hostType":"tv"}),commands:vec![],requests:vec![],transfers:HashMap::new()});
    if let Err(error) = std::thread::Builder::new().name("voxstage-tv-remote".into()).spawn(move || {
        for stream in listener.incoming().flatten() { serve(stream); }
    }) { *guard = None; return Err(error.to_string()); }
    Ok(())
}
fn info(host: &Host) -> Value {
    let address = &host.address;
    let usable = !address.is_empty() && !address.starts_with("127.") && address != "0.0.0.0";
    json!({"address":address,"port":8000,"hostType":"tv","url":if usable {format!("http://{address}:8000/remote?target=tv#{}",host.token)} else {String::new()}})
}
fn short_text(body: &Value, name: &str) -> String { body[name].as_str().unwrap_or_default().chars().take(200).collect() }
const MEDIA_KEYS: [&str; 7] = ["source", "inst", "lead", "back", "cover", "background", "backgroundVideo"];
fn transfer_dir(host: &Host, id: &str) -> PathBuf {
    host.library_path.parent().unwrap().join("incoming").join(id)
}
fn transfer_time() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() }
fn create_transfer(host: &mut Host, body: Value) -> Result<Value, String> {
    // A disconnected phone must not permanently occupy an upload slot.
    let now = transfer_time();
    let stale: Vec<String> = host.transfers.iter().filter(|(_,item)| item["status"] == "uploading"
        && (now.saturating_sub(item["lastActive"].as_u64().unwrap_or(0)) > 600 || item["song"]["id"] == body["song"]["id"]))
        .map(|(id,_)|id.clone()).collect();
    for id in stale { host.transfers.remove(&id); let _ = fs::remove_dir_all(transfer_dir(host,&id)); }
    if host.transfers.values().filter(|item| item["status"] == "uploading").count() >= 4 {
        return Err("Aguarde os envios em andamento.".into());
    }
    let mut song = body["song"].clone();
    let song_id = song["id"].as_str().ok_or("Música sem identificador.")?;
    uuid::Uuid::parse_str(song_id).map_err(|_| "Identificador de música inválido.")?;
    if !song.is_object() || short_text(&song,"title").trim().is_empty() { return Err("Música sem título.".into()); }
    let mut files = serde_json::Map::new();
    for key in MEDIA_KEYS {
        if song[key].is_null() { continue; }
        let name = song[key].as_str().ok_or("Nome de arquivo inválido.")?;
        if !super::valid_media_name(name) || !name.contains('.') { return Err("Nome de arquivo inválido.".into()); }
        files.insert(name.to_owned(), json!({"received":0,"total":0}));
    }
    if files.is_empty() || (song["source"].as_str().is_none() && song["inst"].as_str().is_none()) {
        return Err("A música não contém uma faixa completa ou instrumental.".into());
    }
    song["hidden"] = json!(false);
    let id = uuid::Uuid::new_v4().to_string();
    fs::create_dir_all(transfer_dir(host,&id)).map_err(|error| error.to_string())?;
    if host.transfers.len() >= 100 {
        host.transfers.retain(|_,item| item["status"] == "uploading");
    }
    let item = json!({"id":id,"status":"uploading","song":song,"files":files,"lastActive":now});
    host.transfers.insert(id,item.clone());
    Ok(item)
}
fn receive_chunk(host: &mut Host, path: &str, offset: u64, total: u64, bytes: &[u8]) -> Result<Value, String> {
    let (id,name) = path.trim_start_matches("/api/remote/transfers/").split_once("/media/").ok_or("Envio inválido.")?;
    let dir = transfer_dir(host,id);
    let item = host.transfers.get_mut(id).ok_or("Envio não encontrado.")?;
    if item["status"] != "uploading" { return Err("Este envio já foi concluído.".into()); }
    let file = item["files"].get_mut(name).ok_or("Arquivo não solicitado.")?;
    let received = file["received"].as_u64().unwrap_or(0);
    let expected = file["total"].as_u64().unwrap_or(0);
    if total == 0 || total > 2 * 1024 * 1024 * 1024 || offset != received || (expected != 0 && expected != total)
        || bytes.is_empty() || bytes.len() > 1024 * 1024 || offset.saturating_add(bytes.len() as u64) > total {
        return Err("Tamanho ou posição do arquivo inválidos.".into());
    }
    let mut output = fs::OpenOptions::new().create(true).append(true).open(dir.join(name)).map_err(|error|error.to_string())?;
    if output.metadata().map_err(|error|error.to_string())?.len() != offset { return Err("Envio interrompido; envie a música novamente.".into()); }
    output.write_all(bytes).map_err(|error|error.to_string())?;
    file["received"] = json!(offset + bytes.len() as u64); file["total"] = json!(total);
    item["lastActive"] = json!(transfer_time());
    Ok(json!({"ok":true}))
}
fn finish_transfer(host: &mut Host, id: &str) -> Result<Value, String> {
    let item = host.transfers.get(id).ok_or("Envio não encontrado.")?.clone();
    if item["status"] == "approved" { return Ok(item); }
    let files = item["files"].as_object().ok_or("Envio inválido.")?;
    if files.values().any(|file| file["total"].as_u64().unwrap_or(0) == 0 || file["total"] != file["received"]) {
        return Err("Ainda faltam arquivos para concluir o envio.".into());
    }
    let dir = transfer_dir(host,id);
    let mut song = item["song"].clone();
    // Keep a song already saved on the TV rather than replacing its edits.
    if let Some(existing) = library(host).into_iter().find(|entry| entry["id"] == song["id"]) {
        song = existing;
    } else {
        let music = super::mobile_music_dir(&host.app)?;
        let mut copied = Vec::new();
        let result = (|| -> Result<Value,String> {
            for name in files.keys() {
                let extension = name.rsplit_once('.').ok_or("Arquivo sem extensão.")?.1;
                let destination = format!("{}.{}",uuid::Uuid::new_v4(),extension);
                let target = music.join(&destination);
                copied.push(target.clone());
                fs::copy(dir.join(name),&target).map_err(|error|error.to_string())?;
                for key in MEDIA_KEYS { if song[key] == *name { song[key] = json!(destination); } }
            }
            super::mobile_save_song(host.app.clone(),song.clone())
        })();
        if let Err(error) = result { for path in copied { let _ = fs::remove_file(path); } return Err(error); }
        host.commands.retain(|command| command["action"] != "library-changed");
        host.commands.push(json!({"action":"library-changed"}));
    }
    let _ = fs::remove_dir_all(dir);
    let completed = json!({"id":id,"status":"approved","song":song});
    host.transfers.insert(id.to_owned(),completed.clone());
    Ok(completed)
}
fn public_api(host: &mut Host, path: &str, method: &str, body: Value) -> (u16, Value) {
    match (method, path) {
        ("POST", "/api/remote/mvsep/config") => {
            let token = body["token"].as_str().unwrap_or_default().to_string();
            if token.trim().is_empty() { return (400,json!({"error":"Cole sua chave MVSEP antes de enviar."})); }
            match super::mobile_mvsep_save_config(host.app.clone(), token) {
                Ok(_) => {
                    host.commands.retain(|command| command["action"] != "mvsep-configured");
                    host.commands.push(json!({"action":"mvsep-configured"}));
                    (200,json!({"configured":true}))
                },
                Err(error) => (400,json!({"error":error})),
            }
        },
        ("GET", "/api/remote/state") => (200, host.state.clone()),
        ("GET", "/api/remote/library") => (200, json!(library(host))),
        ("POST", "/api/remote/transfers") => match create_transfer(host,body) { Ok(item)=>(200,item),Err(error)=>(400,json!({"error":error})) },
        ("POST", _) if path.starts_with("/api/remote/transfers/") && path.ends_with("/ready") => {
            let id = path.trim_start_matches("/api/remote/transfers/").trim_end_matches("/ready");
            match finish_transfer(host,id) { Ok(item)=>(200,item),Err(error)=>(400,json!({"error":error})) }
        },
        ("GET", _) if path.starts_with("/api/remote/transfers/") => host.transfers.get(path.trim_start_matches("/api/remote/transfers/"))
            .map(|item|(200,item.clone())).unwrap_or((404,json!({"error":"Envio não encontrado."}))),
        ("POST", "/api/remote/control") => {
            let action = short_text(&body,"action");
            if !matches!(action.as_str(),"play"|"pause"|"next"|"previous") { return (400,json!({"error":"Comando inválido."})); }
            let id = short_text(&body,"songId");
            if !id.is_empty() && !library(host).iter().any(|song| song["id"] == id) { return (404,json!({"error":"Música indisponível ou oculta."})); }
            if host.commands.len() >= 50 { return (429,json!({"error":"Aguarde a TV executar os comandos."})); }
            host.commands.push(json!({"action":action,"songId":if id.is_empty(){Value::Null}else{json!(id)}}));
            (200,json!({"ok":true}))
        },
        ("POST", "/api/remote/request") => {
            let mut song_id = short_text(&body,"songId");
            let requested_title = short_text(&body,"title");
            let requested_artist = short_text(&body,"artist");
            let found = library(host).into_iter().find(|song| {
                if !song_id.is_empty() { return song["id"] == song_id; }
                !requested_title.trim().is_empty() && short_text(song,"title").trim().eq_ignore_ascii_case(requested_title.trim())
                    && (requested_artist.trim().is_empty() || short_text(song,"artist").trim().eq_ignore_ascii_case(requested_artist.trim()))
            });
            if let Some(song) = found.as_ref() { song_id = short_text(song,"id"); }
            if !song_id.is_empty() && found.is_none() { return (404,json!({"error":"Música indisponível ou oculta."})); }
            if found.is_none() && host.requests.iter().filter(|item| item["status"] == "pending").count() >= 40 { return (429,json!({"error":"Muitos pedidos pendentes."})); }
            let (title,artist) = if let Some(song) = found.as_ref() { (short_text(song,"title"),short_text(song,"artist")) } else { (short_text(&body,"title"),short_text(&body,"artist")) };
            if title.trim().is_empty() { return (400,json!({"error":"Digite o nome da música."})); }
            let item = json!({"id":new_token(),"songId":if song_id.is_empty(){Value::Null}else{json!(song_id)},"title":title,"artist":artist,"status":if found.is_some(){"approved"}else{"pending"}});
            if let Some(song) = found.as_ref() {
                let id = song["id"].as_str().unwrap_or_default();
                if host.commands.len() >= 50 { host.commands.remove(0); }
                host.commands.push(json!({"action":"queue","songId":id}));
            }
            if host.requests.len() >= 100 { if let Some(index) = host.requests.iter().position(|item| item["status"] != "pending") { host.requests.remove(index); } }
            host.requests.push(item.clone()); (200,item)
        },
        ("GET", _) if path.starts_with("/api/remote/request/") => {
            host.requests.iter().find(|item| item["id"] == path.trim_start_matches("/api/remote/request/"))
                .map(|item|(200,item.clone())).unwrap_or((404,json!({"error":"Pedido não encontrado."})))
        },
        _ => (404,json!({"error":"Recurso indisponível nesta conexão da TV."})),
    }
}
#[tauri::command]
pub fn mobile_tv_host_api(app: AppHandle, path: String, method: String, body: Option<Value>) -> Result<Value, String> {
    // Host administration only uses the trusted native bridge, never HTTP.
    if path == "/api/remote/host-info" { start(&app)?; }
    let mut guard = storage().lock().map_err(|_| "Controle TV indisponível.")?;
    let host = guard.as_mut().ok_or("Abra Conectar com o celular para ativar o controle da TV.")?;
    match (method.as_str(),path.as_str()) {
        ("GET","/api/remote/host-info") => Ok(info(host)),
        ("POST","/api/remote/rotate") => { host.token = new_token(); host.commands.clear(); host.requests.clear(); Ok(info(host)) },
        ("POST","/api/remote/state") => { host.state = body.unwrap_or(json!({})); host.state["hostType"] = json!("tv"); Ok(json!({"ok":true})) },
        ("GET","/api/remote/commands") => Ok(json!({"commands":std::mem::take(&mut host.commands)})),
        ("GET","/api/remote/requests") => Ok(json!(host.requests)),
        ("GET","/api/remote/transfers") => Ok(json!([])),
        ("POST",_) if path.starts_with("/api/remote/requests/") && path.ends_with("/decision") => {
            let id = path.trim_start_matches("/api/remote/requests/").trim_end_matches("/decision");
            let decision = body.unwrap_or(json!({}))["decision"].as_str().unwrap_or_default().to_owned();
            if !matches!(decision.as_str(),"approve"|"reject") { return Err("Decisão inválida.".into()); }
            let index = host.requests.iter().position(|item| item["id"] == id).ok_or("Pedido não encontrado.")?;
            if host.requests[index]["status"] != "pending" { return Ok(host.requests[index].clone()); }
            let song_id = host.requests[index]["songId"].as_str().unwrap_or_default().to_owned();
            if decision == "approve" && !song_id.is_empty() {
                if !library(host).iter().any(|song| song["id"] == song_id) { return Err("A música foi ocultada ou removida.".into()); }
                host.commands.push(json!({"action":"play","songId":song_id}));
            }
            host.requests[index]["status"] = json!(if decision == "approve" {"approved"} else {"rejected"});
            Ok(host.requests[index].clone())
        },
        _ => Err("Operação do host TV inválida.".into()),
    }
}
fn reply(stream: &mut TcpStream, code: u16, content_type: &str, body: &[u8]) {
    let reason = match code {200=>"OK",400=>"Bad Request",401=>"Unauthorized",404=>"Not Found",429=>"Too Many Requests",_=>"Error"};
    let header = format!("HTTP/1.1 {code} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n\r\n",body.len());
    let _ = stream.write_all(header.as_bytes()); let _ = stream.write_all(body);
}
fn serve(mut stream: TcpStream) {
    // Sequential and bounded: a stalled peer cannot consume unbounded threads or RAM.
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    let mut bytes = Vec::new(); let mut buffer = [0u8;4096];
    let end = loop {
        match stream.read(&mut buffer) { Ok(0)|Err(_) => return, Ok(n) => bytes.extend_from_slice(&buffer[..n]) }
        if bytes.len() > 32768 { reply(&mut stream,400,"application/json",b"{\"error\":\"Request too large\"}"); return; }
        if let Some(index) = bytes.windows(4).position(|part| part == b"\r\n\r\n") { break index+4; }
    };
    let header = String::from_utf8_lossy(&bytes[..end]).to_string();
    let mut lines = header.lines(); let request = lines.next().unwrap_or_default();
    let mut parts = request.split_whitespace(); let method = parts.next().unwrap_or_default();
    let path = parts.next().unwrap_or_default().split('?').next().unwrap_or_default();
    let mut auth = ""; let mut length = 0usize;
    let mut offset = None; let mut total = None;
    let upload = method == "PUT" && path.starts_with("/api/remote/transfers/") && path.contains("/media/");
    for line in lines { if let Some((key,value)) = line.split_once(':') {
        if key.eq_ignore_ascii_case("authorization") { auth = value.trim().strip_prefix("Bearer ").unwrap_or_default(); }
        if key.eq_ignore_ascii_case("content-length") { length = match value.trim().parse::<usize>() { Ok(n) if n <= 1024*1024 => n,_=>return }; }
        if key.eq_ignore_ascii_case("x-offset") { offset = value.trim().parse::<u64>().ok(); }
        if key.eq_ignore_ascii_case("x-total") { total = value.trim().parse::<u64>().ok(); }
        if key.eq_ignore_ascii_case("transfer-encoding") { return; }
    } }
    if method == "GET" && matches!(path,"/remote"|"/remote/"|"/") {
        reply(&mut stream,200,"text/html; charset=utf-8",include_bytes!("../../web-dist/remote.html")); return;
    }
    let Ok(mut guard) = storage().lock() else { return; };
    let Some(host) = guard.as_mut() else { return; };
    if auth != host.token { reply(&mut stream,401,"application/json",b"{\"error\":\"Sessao remota expirada. Leia outro QR.\"}"); return; }
    // Do not hold the shared host mutex while waiting for a request body.
    let session = host.token.clone(); drop(guard);
    while bytes.len() < end+length {
        match stream.read(&mut buffer[..(end+length-bytes.len()).min(4096)]) { Ok(0)|Err(_) => return, Ok(n) => bytes.extend_from_slice(&buffer[..n]) }
    }
    let body = if upload || length == 0 {json!({})} else { match serde_json::from_slice(&bytes[end..end+length]) { Ok(body)=>body, Err(_)=>{reply(&mut stream,400,"application/json",b"{\"error\":\"Invalid JSON\"}");return;} } };
    let Ok(mut guard) = storage().lock() else { return; };
    let Some(host) = guard.as_mut() else { return; };
    if host.token != session { reply(&mut stream,401,"application/json",b"{\"error\":\"Sessao remota expirada.\"}"); return; }
    let (code,body) = if upload {
        match offset.zip(total).ok_or("Envio sem tamanho ou posição.".to_string())
            .and_then(|(offset,total)|receive_chunk(host,path,offset,total,&bytes[end..end+length])) {
            Ok(item)=>(200,item),Err(error)=>(400,json!({"error":error}))
        }
    } else { public_api(host,path,method,body) };
    reply(&mut stream,code,"application/json; charset=utf-8",body.to_string().as_bytes());
}
