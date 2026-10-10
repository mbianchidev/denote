use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{Shutdown, TcpListener, TcpStream},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, SyncSender},
    },
    thread,
    time::{Duration, Instant},
};

use command_group::{CommandGroup, GroupChild};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use super::package::metadata_is_link;
use crate::error::{AppError, AppResult};

const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;
const MAX_HEADER_BYTES: usize = 8192;
const MAX_EVENTS: usize = 256;
const MAX_EVENT_BYTES: usize = 2 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct CodeToolConfiguration {
    pub enabled: bool,
    pub executable: String,
    pub arguments: Vec<String>,
    pub transport: String,
    pub options: Value,
    pub launch: Value,
    pub attach: Value,
    pub executable_sha256: String,
}

impl Default for CodeToolConfiguration {
    fn default() -> Self {
        Self {
            enabled: false,
            executable: String::new(),
            arguments: vec![],
            transport: "stdio".to_string(),
            options: json!({}),
            launch: json!({}),
            attach: json!({}),
            executable_sha256: String::new(),
        }
    }
}

type PendingReply = (String, mpsc::Sender<Result<Value, String>>);

pub(super) struct CodeSession {
    pub(super) id: String,
    pub(super) plugin_id: String,
    pub(super) kind: String,
    pub(super) language: Mutex<String>,
    pub(super) project_id: Mutex<Option<String>>,
    debug_mode: Mutex<Option<String>>,
    pub(super) vault_root: PathBuf,
    pub(super) project_root: PathBuf,
    pub(super) configuration: CodeToolConfiguration,
    pub(super) document_path: Mutex<Option<String>>,
    pub(super) current: Arc<dyn Fn() -> bool + Send + Sync>,
    child: Mutex<Option<GroupChild>>,
    socket: Mutex<Option<TcpStream>>,
    writer: SyncSender<Value>,
    sequence: AtomicU64,
    ended: AtomicBool,
    pending: Mutex<BTreeMap<u64, PendingReply>>,
    server_requests: Mutex<BTreeSet<String>>,
    events: Mutex<(VecDeque<Value>, usize)>,
}

impl CodeSession {
    pub(super) fn spawn(
        plugin_id: &str,
        kind: &str,
        configuration: &CodeToolConfiguration,
        vault_root: &Path,
        project_root: &Path,
        current: Arc<dyn Fn() -> bool + Send + Sync>,
    ) -> AppResult<Arc<Self>> {
        let port = if configuration.transport == "tcp" {
            let listener = TcpListener::bind(("127.0.0.1", 0))?;
            Some(listener.local_addr()?.port())
        } else {
            None
        };
        let mut command = Command::new(&configuration.executable);
        command.args(
            configuration
                .arguments
                .iter()
                .map(|argument| argument.replace("%PORT%", &port.unwrap_or(0).to_string())),
        );
        command
            .current_dir(project_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut group = command.group();
        #[cfg(windows)]
        group.creation_flags(0x0800_0000);
        let mut guard = PendingChild(Some(group.spawn().map_err(|error|
            AppError::Plugin(format!("Unable to start the approved code tool: {error}. Check its executable and arguments.")))?));
        let child = guard
            .0
            .as_mut()
            .ok_or_else(|| AppError::Plugin("Code child was not created.".to_string()))?;
        let stdin = child
            .inner()
            .stdin
            .take()
            .ok_or_else(|| AppError::Plugin("Code tool has no input pipe.".to_string()))?;
        let mut stdout = Some(
            child
                .inner()
                .stdout
                .take()
                .ok_or_else(|| AppError::Plugin("Code tool has no output pipe.".to_string()))?,
        );
        let stderr = child
            .inner()
            .stderr
            .take()
            .ok_or_else(|| AppError::Plugin("Code tool has no log pipe.".to_string()))?;
        let stream = if let Some(port) = port {
            match connect_loopback(port, child) {
                Ok(stream) => Some(stream),
                Err(error) => return Err(error),
            }
        } else {
            None
        };
        let reader: Box<dyn Read + Send> = if let Some(stream) = &stream {
            Box::new(stream.try_clone()?)
        } else {
            Box::new(
                stdout
                    .take()
                    .ok_or_else(|| AppError::Plugin("Missing code output pipe.".to_string()))?,
            )
        };
        // TCP adapters use stdout for logs rather than protocol frames.
        let extra_logs = if stream.is_some() {
            stdout.take()
        } else {
            None
        };
        let writer: Box<dyn Write + Send> = if let Some(stream) = &stream {
            Box::new(stream.try_clone()?)
        } else {
            Box::new(stdin)
        };
        let session = Self::from_streams(
            plugin_id,
            kind,
            configuration,
            vault_root,
            project_root,
            current,
            guard.0.take(),
            stream,
            reader,
            writer,
        );
        Self::read_logs(&session, stderr);
        if let Some(logs) = extra_logs {
            Self::read_logs(&session, logs);
        }
        Ok(session)
    }

    pub(super) fn connect(
        plugin_id: &str,
        configuration: &CodeToolConfiguration,
        vault_root: &Path,
        project_root: &Path,
        current: Arc<dyn Fn() -> bool + Send + Sync>,
        port: u16,
    ) -> AppResult<Arc<Self>> {
        let stream =
            TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_secs(5))?;
        let reader = Box::new(stream.try_clone()?);
        let writer = Box::new(stream.try_clone()?);
        Ok(Self::from_streams(
            plugin_id,
            "dap",
            configuration,
            vault_root,
            project_root,
            current,
            None,
            Some(stream),
            reader,
            writer,
        ))
    }

    #[allow(clippy::too_many_arguments)]
    fn from_streams(
        plugin_id: &str,
        kind: &str,
        configuration: &CodeToolConfiguration,
        vault_root: &Path,
        project_root: &Path,
        current: Arc<dyn Fn() -> bool + Send + Sync>,
        child: Option<GroupChild>,
        socket: Option<TcpStream>,
        reader: Box<dyn Read + Send>,
        mut writer: Box<dyn Write + Send>,
    ) -> Arc<Self> {
        let (sender, receiver) = mpsc::sync_channel(64);
        let session = Arc::new(Self {
            id: Uuid::new_v4().to_string(),
            plugin_id: plugin_id.to_string(),
            kind: kind.to_string(),
            language: Mutex::new(String::new()),
            project_id: Mutex::new(None),
            debug_mode: Mutex::new(None),
            vault_root: vault_root.to_path_buf(),
            project_root: project_root.to_path_buf(),
            configuration: configuration.clone(),
            document_path: Mutex::new(None),
            current,
            child: Mutex::new(child),
            socket: Mutex::new(socket),
            writer: sender,
            sequence: AtomicU64::new(1),
            ended: AtomicBool::new(false),
            pending: Mutex::new(BTreeMap::new()),
            server_requests: Mutex::new(BTreeSet::new()),
            events: Mutex::new((VecDeque::new(), 0)),
        });
        let weak = Arc::downgrade(&session);
        thread::spawn(move || {
            loop {
                let Some(session) = weak.upgrade() else {
                    break;
                };
                if session.ended.load(Ordering::Acquire) {
                    break;
                }
                drop(session);
                match receiver.recv_timeout(Duration::from_millis(100)) {
                    Ok(message) => {
                        if let Err(error) = write_frame(&mut writer, &message) {
                            if let Some(session) = weak.upgrade() {
                                session.fail(&format!("Code tool input failed: {error}"));
                            }
                            break;
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });
        let weak = Arc::downgrade(&session);
        thread::spawn(move || {
            let mut reader = BufReader::new(reader);
            loop {
                match read_frame(&mut reader) {
                    Ok(Some(message)) => {
                        let Some(session) = weak.upgrade() else {
                            break;
                        };
                        if session.ended.load(Ordering::Acquire) {
                            break;
                        }
                        if let Err(error) = session.receive(message) {
                            session.fail(&error.to_string());
                            break;
                        }
                    }
                    Ok(None) => {
                        if let Some(session) = weak.upgrade() {
                            session.fail("Code tool exited. Check its logs and restart it.");
                        }
                        break;
                    }
                    Err(error) => {
                        if let Some(session) = weak.upgrade() {
                            session.fail(&format!("Code tool protocol failed: {error}"));
                        }
                        break;
                    }
                }
            }
        });
        let weak = Arc::downgrade(&session);
        thread::spawn(move || {
            loop {
                thread::sleep(Duration::from_millis(500));
                let Some(session) = weak.upgrade() else {
                    break;
                };
                if session.ended.load(Ordering::Acquire) {
                    break;
                }
                if !(session.current)() {
                    session.fail("Vault or project scope changed. Start the code tool again in the current project.");
                    break;
                }
                let status = match session.child.lock() {
                    Ok(mut child) => match child.as_mut() {
                        Some(child) => child.inner().try_wait(),
                        None => Ok(None),
                    },
                    Err(_) => {
                        session.fail("Code tool process lock failed.");
                        break;
                    }
                };
                match status {
                    Ok(Some(status)) => {
                        session.fail(&format!(
                            "Code tool exited ({status}). Check its logs and restart it."
                        ));
                        break;
                    }
                    Err(error) => {
                        session.fail(&format!("Unable to monitor code tool: {error}"));
                        break;
                    }
                    _ => {}
                }
            }
        });
        session
    }

    fn read_logs(session: &Arc<Self>, stream: impl Read + Send + 'static) {
        let weak = Arc::downgrade(session);
        thread::spawn(move || {
            let mut reader = BufReader::new(stream);
            loop {
                let mut bytes = Vec::new();
                match Read::by_ref(&mut reader)
                    .take(8193)
                    .read_until(b'\n', &mut bytes)
                {
                    Ok(0) => break,
                    Ok(count) => {
                        let Some(session) = weak.upgrade() else {
                            break;
                        };
                        if session.ended.load(Ordering::Acquire) {
                            break;
                        }
                        if count > 8192 {
                            session.fail("Code tool log line exceeds 8 KiB.");
                            break;
                        }
                        let text = String::from_utf8_lossy(&bytes).replace(
                            &crate::paths::path_for_display(&session.vault_root),
                            "[vault]",
                        );
                        if let Err(error) = session.enqueue(json!({"kind": "log", "text": text})) {
                            session.fail(&error.to_string());
                            break;
                        }
                    }
                    Err(error) => {
                        if let Some(session) = weak.upgrade() {
                            session.fail(&format!("Unable to read code tool logs: {error}"));
                        }
                        break;
                    }
                }
            }
        });
    }

    pub(super) fn request(&self, method: &str, mut params: Value, token: &str) -> AppResult<Value> {
        self.check_current()?;
        if token.is_empty() || token.len() > 128 {
            return Err(AppError::Plugin("Invalid code request token.".to_string()));
        }
        map_protocol_paths(&mut params, &self.vault_root, false, 0)?;
        if method == "initialize" && self.kind == "lsp" {
            params["initializationOptions"] = self.configuration.options.clone();
        }
        if matches!(method, "launch" | "attach") && self.kind == "dap" {
            *self
                .debug_mode
                .lock()
                .map_err(|_| AppError::Plugin("Debugger mode lock failed.".to_string()))? =
                Some(method.to_string());
            params = if method == "attach" {
                self.configuration.attach.clone()
            } else {
                self.configuration.launch.clone()
            };
            expand_launch(
                &mut params,
                &self.project_root,
                self.document_path
                    .lock()
                    .map_err(|_| AppError::Plugin("Code document lock failed.".to_string()))?
                    .as_deref(),
                &self.vault_root,
            )?;
        }
        if method == "disconnect" && self.kind == "dap" {
            params["terminateDebuggee"] = json!(
                self.debug_mode
                    .lock()
                    .map_err(|_| AppError::Plugin("Debugger mode lock failed.".to_string()))?
                    .as_deref()
                    == Some("launch")
            );
        }
        if method == "restart" && self.kind == "dap" {
            let attach = self
                .debug_mode
                .lock()
                .map_err(|_| AppError::Plugin("Debugger mode lock failed.".to_string()))?
                .as_deref()
                == Some("attach");
            let mut approved = if attach {
                self.configuration.attach.clone()
            } else {
                self.configuration.launch.clone()
            };
            expand_launch(
                &mut approved,
                &self.project_root,
                self.document_path
                    .lock()
                    .map_err(|_| AppError::Plugin("Code document lock failed.".to_string()))?
                    .as_deref(),
                &self.vault_root,
            )?;
            params = json!({"arguments": approved});
        }
        let id = self.sequence.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = mpsc::channel();
        {
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| AppError::Plugin("Code request lock failed.".to_string()))?;
            if pending.len() >= 32 {
                return Err(AppError::Plugin(
                    "Too many pending code requests; retry after the current request.".to_string(),
                ));
            }
            pending.insert(id, (token.to_string(), sender));
        }
        let message = if self.kind == "lsp" {
            json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params})
        } else {
            json!({"seq": id, "type": "request", "command": method, "arguments": params})
        };
        if let Err(error) = self.send(message) {
            self.pending
                .lock()
                .map_err(|_| AppError::Plugin("Code request lock failed.".to_string()))?
                .remove(&id);
            return Err(error);
        }
        match receiver.recv_timeout(REQUEST_TIMEOUT) {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(error)) => Err(AppError::Plugin(error)),
            Err(_) => {
                self.cancel(token)?;
                Err(AppError::Plugin(format!(
                    "Code request {method} timed out after 30 seconds. Check the server logs or restart it."
                )))
            }
        }
    }

    pub(super) fn notify(&self, method: &str, mut params: Value) -> AppResult<()> {
        self.check_current()?;
        map_protocol_paths(&mut params, &self.vault_root, false, 0)?;
        self.send(json!({"jsonrpc": "2.0", "method": method, "params": params}))
    }

    fn send(&self, message: Value) -> AppResult<()> {
        if self.ended.load(Ordering::Acquire) {
            return Err(AppError::Plugin("Code session has stopped.".to_string()));
        }
        if serde_json::to_vec(&message)
            .map_err(|error| AppError::Plugin(error.to_string()))?
            .len()
            > MAX_FRAME_BYTES
        {
            return Err(AppError::Plugin(
                "Code protocol message exceeds 8 MiB.".to_string(),
            ));
        }
        self.writer.try_send(message).map_err(|error| {
            AppError::Plugin(format!("Code tool input queue is unavailable: {error}"))
        })
    }

    fn receive(&self, mut message: Value) -> AppResult<()> {
        let id = if self.kind == "lsp" {
            message.get("id")
        } else {
            message.get("request_seq")
        }
        .and_then(Value::as_u64);
        let is_response = if self.kind == "lsp" {
            message.get("method").is_none()
        } else {
            message["type"] == "response"
        };
        if is_response {
            if let Some(id) = id
                && let Some((_, sender)) = self
                    .pending
                    .lock()
                    .map_err(|_| AppError::Plugin("Code request lock failed.".to_string()))?
                    .remove(&id)
            {
                let mapped = if self.kind == "dap" {
                    sanitize_debug_sources(&mut message, &self.vault_root)
                } else {
                    Ok(())
                }
                .and_then(|_| map_protocol_paths(&mut message, &self.vault_root, true, 0));
                let result = match mapped {
                    Err(error) => Err(error.to_string()),
                    Ok(()) if self.kind == "lsp" && message.get("error").is_some() => Err(format!(
                        "Language server error: {}",
                        message["error"]["message"]
                            .as_str()
                            .unwrap_or("request rejected")
                    )),
                    Ok(()) if self.kind == "dap" && message["success"] != true => Err(format!(
                        "Debugger error: {}",
                        message["message"].as_str().unwrap_or("request rejected")
                    )),
                    Ok(()) => Ok(if self.kind == "lsp" {
                        message["result"].clone()
                    } else {
                        message["body"].clone()
                    }),
                };
                // A cancelled request may already have dropped its receiver.
                let _ = sender.send(result);
            }
            return Ok(());
        }
        if self.kind == "dap" && message["type"] == "request" {
            return self.send(json!({
                "seq": self.sequence.fetch_add(1, Ordering::Relaxed), "type": "response",
                "request_seq": message["seq"], "command": message["command"], "success": false,
                "message": "Denote does not allow debugger-requested terminal or child-session launches."
            }));
        }
        if self.kind == "lsp" && message.get("method").is_some() && message.get("id").is_some() {
            let result = match message["method"].as_str() {
                Some("workspace/configuration") => {
                    let items = message["params"]["items"]
                        .as_array()
                        .filter(|items| items.len() <= 64)
                        .ok_or_else(|| {
                            AppError::Plugin(
                                "Invalid language-server configuration request.".to_string(),
                            )
                        })?;
                    Some(json!(
                        items
                            .iter()
                            .map(|item| {
                                let mut option = &self.configuration.options;
                                if let Some(section) = item["section"].as_str() {
                                    for key in section.split('.') {
                                        option = &option[key];
                                    }
                                }
                                option.clone()
                            })
                            .collect::<Vec<_>>()
                    ))
                }
                Some("workspace/applyEdit") => Some(
                    json!({"applied": false, "failureReason": "Use Denote's explicit formatting action; unsolicited workspace edits are not allowed."}),
                ),
                Some(
                    "window/workDoneProgress/create"
                    | "client/registerCapability"
                    | "client/unregisterCapability"
                    | "window/showMessageRequest",
                ) => Some(Value::Null),
                Some("workspace/workspaceFolders") => Some(json!([{
                    "uri": Url::from_file_path(&self.project_root).map_err(|_| AppError::Plugin("Invalid project URI.".to_string()))?.to_string(),
                    "name": self.project_root.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| "Vault".to_string())
                }])),
                _ => None,
            };
            if let Some(result) = result {
                return self.send(json!({"jsonrpc": "2.0", "id": message["id"], "result": result}));
            }
            let key = message["id"].to_string();
            let mut requests = self
                .server_requests
                .lock()
                .map_err(|_| AppError::Plugin("Code server request lock failed.".to_string()))?;
            if requests.len() >= 64 {
                return Err(AppError::Plugin(
                    "Language server exceeded the pending request limit.".to_string(),
                ));
            }
            requests.insert(key);
        }
        map_protocol_paths(&mut message, &self.vault_root, true, 0)?;
        self.enqueue(json!({"kind": "message", "message": message}))
    }

    pub(super) fn respond(&self, id: Value, result: Value) -> AppResult<()> {
        self.check_current()?;
        if !(id.is_string() || id.is_u64())
            || !self
                .server_requests
                .lock()
                .map_err(|_| AppError::Plugin("Code server request lock failed.".to_string()))?
                .remove(&id.to_string())
        {
            return Err(AppError::Plugin(
                "Language server response has no matching request.".to_string(),
            ));
        }
        self.send(json!({"jsonrpc": "2.0", "id": id, "result": result}))
    }

    pub(super) fn cancel(&self, token: &str) -> AppResult<()> {
        let cancelled: Vec<_> = {
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| AppError::Plugin("Code request lock failed.".to_string()))?;
            let ids: Vec<_> = pending
                .iter()
                .filter(|(_, (request_token, _))| request_token == token)
                .map(|(id, _)| *id)
                .collect();
            ids.into_iter()
                .filter_map(|id| pending.remove(&id).map(|(_, sender)| (id, sender)))
                .collect()
        };
        for (id, sender) in cancelled {
            let _ = sender.send(Err(
                "Code request cancelled because its document or scope changed.".to_string(),
            ));
            if self.kind == "lsp" && !self.ended.load(Ordering::Acquire) {
                self.send(
                    json!({"jsonrpc": "2.0", "method": "$/cancelRequest", "params": {"id": id}}),
                )?;
            }
        }
        Ok(())
    }

    fn enqueue(&self, event: Value) -> AppResult<()> {
        let bytes = serde_json::to_vec(&event)
            .map_err(|error| AppError::Plugin(error.to_string()))?
            .len();
        let mut events = self
            .events
            .lock()
            .map_err(|_| AppError::Plugin("Code event lock failed.".to_string()))?;
        if events.0.len() >= MAX_EVENTS || events.1 + bytes > MAX_EVENT_BYTES {
            return Err(AppError::Plugin(
                "Code tool event buffer exceeded its bounded limit. Restart the tool.".to_string(),
            ));
        }
        events.1 += bytes;
        events.0.push_back(event);
        Ok(())
    }

    pub(super) fn poll(&self) -> AppResult<Vec<Value>> {
        let mut events = self
            .events
            .lock()
            .map_err(|_| AppError::Plugin("Code event lock failed.".to_string()))?;
        let mut batch = Vec::new();
        for _ in 0..128 {
            let Some(event) = events.0.pop_front() else {
                break;
            };
            events.1 = events.1.saturating_sub(
                serde_json::to_vec(&event)
                    .map_err(|error| AppError::Plugin(error.to_string()))?
                    .len(),
            );
            batch.push(event);
        }
        Ok(batch)
    }

    pub(super) fn check_current(&self) -> AppResult<()> {
        if self.ended.load(Ordering::Acquire) || !(self.current)() {
            return Err(AppError::Plugin(
                "Code session is stopped or its project changed. Start or restart the tool."
                    .to_string(),
            ));
        }
        Ok(())
    }

    pub(super) fn stop(&self, reason: &str) -> AppResult<()> {
        if self.ended.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        let mut failures = Vec::new();
        if let Some(socket) = self
            .socket
            .lock()
            .map_err(|_| AppError::Plugin("Code socket lock failed.".to_string()))?
            .take()
            && let Err(error) = socket.shutdown(Shutdown::Both)
        {
            failures.push(error.to_string());
        }
        if let Some(mut child) = self
            .child
            .lock()
            .map_err(|_| AppError::Plugin("Code process lock failed.".to_string()))?
            .take()
            && let Err(error) = stop_child(&mut child)
        {
            failures.push(error.to_string());
        }
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| AppError::Plugin("Code request lock failed.".to_string()))?;
        for (_, (_, sender)) in std::mem::take(&mut *pending) {
            let _ = sender.send(Err(reason.to_string()));
        }
        drop(pending);
        self.server_requests
            .lock()
            .map_err(|_| AppError::Plugin("Code server request lock failed.".to_string()))?
            .clear();
        let mut events = self
            .events
            .lock()
            .map_err(|_| AppError::Plugin("Code event lock failed.".to_string()))?;
        if events.0.len() >= MAX_EVENTS || events.1 > MAX_EVENT_BYTES - 8192 {
            events.0.clear();
            events.1 = 0;
        }
        let event = json!({"kind": "exit", "text": reason.chars().take(4096).collect::<String>()});
        events.1 += serde_json::to_vec(&event)
            .map_err(|error| AppError::Plugin(error.to_string()))?
            .len();
        events.0.push_back(event);
        if failures.is_empty() {
            Ok(())
        } else {
            Err(AppError::Plugin(format!(
                "Unable to clean up code session: {}",
                failures.join("; ")
            )))
        }
    }

    fn fail(&self, reason: &str) {
        if let Err(error) = self.stop(reason) {
            eprintln!("Code tool cleanup failed: {error}");
        }
    }
}

impl Drop for CodeSession {
    fn drop(&mut self) {
        if let Err(error) = self.stop("Code session released.") {
            eprintln!("Code session cleanup failed: {error}");
        }
    }
}

#[derive(Default)]
pub(super) struct CodeSessionRegistry {
    sessions: Mutex<BTreeMap<String, Arc<CodeSession>>>,
    generations: Mutex<BTreeMap<String, u64>>,
}

impl CodeSessionRegistry {
    pub(super) fn generation(&self, plugin_id: &str) -> AppResult<u64> {
        Ok(*self
            .generations
            .lock()
            .map_err(|_| AppError::Plugin("Code lifecycle lock failed.".to_string()))?
            .entry(plugin_id.to_string())
            .or_default())
    }

    pub(super) fn insert(&self, session: Arc<CodeSession>, generation: u64) -> AppResult<()> {
        let generations = self
            .generations
            .lock()
            .map_err(|_| AppError::Plugin("Code lifecycle lock failed.".to_string()))?;
        if *generations.get(&session.plugin_id).unwrap_or(&0) != generation {
            session.stop("Code session start was cancelled.")?;
            return Err(AppError::Plugin(
                "Code session start was cancelled after a scope change.".to_string(),
            ));
        }
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::Plugin("Code session lock failed.".to_string()))?;
        sessions.retain(|_, session| !session.ended.load(Ordering::Acquire));
        if sessions.len() >= 12 {
            session.stop("Code session limit reached.")?;
            return Err(AppError::Plugin(
                "At most 12 code tool sessions may run at once.".to_string(),
            ));
        }
        sessions.insert(session.id.clone(), session);
        Ok(())
    }

    pub(super) fn get(&self, plugin_id: &str, id: &str) -> AppResult<Arc<CodeSession>> {
        self.sessions
            .lock()
            .map_err(|_| AppError::Plugin("Code session lock failed.".to_string()))?
            .get(id)
            .filter(|session| session.plugin_id == plugin_id)
            .cloned()
            .ok_or_else(|| {
                AppError::Plugin(
                    "Code session is unavailable or belongs to another plugin.".to_string(),
                )
            })
    }

    pub(super) fn find(
        &self,
        plugin_id: &str,
        kind: &str,
        root: &Path,
        language: &str,
        project_id: Option<&str>,
    ) -> AppResult<Option<Arc<CodeSession>>> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::Plugin("Code session lock failed.".to_string()))?;
        for session in sessions.values() {
            if session.plugin_id == plugin_id
                && session.kind == kind
                && session.project_root == root
                && !session.ended.load(Ordering::Acquire)
                && *session
                    .language
                    .lock()
                    .map_err(|_| AppError::Plugin("Code language lock failed.".to_string()))?
                    == language
                && session
                    .project_id
                    .lock()
                    .map_err(|_| AppError::Plugin("Code project lock failed.".to_string()))?
                    .as_deref()
                    == project_id
            {
                return Ok(Some(session.clone()));
            }
        }
        Ok(None)
    }

    pub(super) fn stop_one(&self, plugin_id: &str, id: &str) -> AppResult<()> {
        let session = {
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|_| AppError::Plugin("Code session lock failed.".to_string()))?;
            let Some(session) = sessions.get(id) else {
                return Ok(());
            };
            if session.plugin_id != plugin_id {
                return Err(AppError::Plugin(
                    "Code session belongs to another plugin.".to_string(),
                ));
            }
            sessions.remove(id).ok_or_else(|| {
                AppError::Plugin("Code session disappeared during cleanup.".to_string())
            })?
        };
        session.stop("Code session stopped.")
    }

    pub(super) fn cancel(&self, plugin_id: &str, token: &str) -> AppResult<()> {
        let sessions: Vec<_> = self
            .sessions
            .lock()
            .map_err(|_| AppError::Plugin("Code session lock failed.".to_string()))?
            .values()
            .filter(|session| session.plugin_id == plugin_id)
            .cloned()
            .collect();
        for session in sessions {
            session.cancel(token)?;
        }
        Ok(())
    }

    pub(super) fn stop_plugin(&self, plugin_id: Option<&str>) -> AppResult<()> {
        let mut generations = self
            .generations
            .lock()
            .map_err(|_| AppError::Plugin("Code lifecycle lock failed.".to_string()))?;
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::Plugin("Code session lock failed.".to_string()))?;
        if let Some(id) = plugin_id {
            *generations.entry(id.to_string()).or_default() += 1;
        } else {
            for generation in generations.values_mut() {
                *generation += 1;
            }
        }
        let ids: Vec<_> = sessions
            .iter()
            .filter(|(_, session)| plugin_id.is_none_or(|id| session.plugin_id == id))
            .map(|(id, _)| id.clone())
            .collect();
        let removed: Vec<_> = ids.iter().filter_map(|id| sessions.remove(id)).collect();
        drop(sessions);
        drop(generations);
        let mut failures = Vec::new();
        for session in removed {
            if let Err(error) =
                session.stop("Code tools stopped after plugin or workspace teardown.")
            {
                failures.push(error.to_string());
            }
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(AppError::Plugin(failures.join("; ")))
        }
    }
}

impl Drop for CodeSessionRegistry {
    fn drop(&mut self) {
        if let Err(error) = self.stop_plugin(None) {
            eprintln!("Unable to stop code tools: {error}");
        }
    }
}

fn stop_child(child: &mut GroupChild) -> AppResult<()> {
    if let Err(error) = child.kill()
        && child.inner().try_wait()?.is_none()
    {
        return Err(AppError::Plugin(format!(
            "Unable to terminate code tool process group: {error}"
        )));
    }
    child.wait().map_err(|error| {
        AppError::Plugin(format!("Unable to reap code tool process group: {error}"))
    })?;
    Ok(())
}

struct PendingChild(Option<GroupChild>);

impl Drop for PendingChild {
    fn drop(&mut self) {
        if let Some(child) = self.0.as_mut()
            && let Err(error) = stop_child(child)
        {
            eprintln!("Unable to clean up a failed code tool start: {error}");
        }
    }
}

fn connect_loopback(port: u16, child: &mut GroupChild) -> AppResult<TcpStream> {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(100))
        {
            Ok(stream) => return Ok(stream),
            Err(error) if Instant::now() >= deadline => {
                return Err(AppError::Plugin(format!(
                    "Debugger did not open its approved loopback port: {error}. Use %PORT% in the adapter arguments."
                )));
            }
            Err(_) => {
                if let Some(status) = child.inner().try_wait()? {
                    return Err(AppError::Plugin(format!(
                        "Debugger exited before opening its port ({status}). Check the adapter arguments."
                    )));
                }
                thread::sleep(Duration::from_millis(50));
            }
        }
    }
}

pub(super) fn safe_code_path(
    root: &Path,
    relative: &str,
    allow_missing: bool,
) -> AppResult<PathBuf> {
    if relative.len() > 4096
        || relative.contains(['\\', ':'])
        || relative.chars().any(char::is_control)
    {
        return Err(AppError::Plugin(
            "Invalid vault-relative code path.".to_string(),
        ));
    }
    let mut result = root.to_path_buf();
    for component in Path::new(relative).components() {
        let Component::Normal(name) = component else {
            return Err(AppError::Plugin("Code path escapes the vault.".to_string()));
        };
        if name == ".denote" || name == ".git" {
            return Err(AppError::Plugin(
                "Code tools cannot access Denote or Git metadata.".to_string(),
            ));
        }
        result.push(name);
        match fs::symlink_metadata(&result) {
            Ok(metadata) if metadata_is_link(&metadata) => {
                return Err(AppError::Plugin(
                    "Code paths cannot traverse links or reparse points.".to_string(),
                ));
            }
            Ok(_) => {}
            Err(error) if allow_missing && error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(result)
}

pub(super) fn detect_code_root(
    root: &Path,
    document: Option<&str>,
    language: &str,
) -> AppResult<PathBuf> {
    let markers: &[&str] = match language {
        "rust" => &["Cargo.toml"],
        "go" => &["go.work", "go.mod"],
        "python" => &[
            "pyproject.toml",
            "setup.py",
            "setup.cfg",
            "requirements.txt",
        ],
        "java" => &["pom.xml", "build.gradle", "build.gradle.kts", ".project"],
        "cpp" => &["compile_commands.json", "CMakeLists.txt", "Makefile"],
        "typescript" => &["tsconfig.json", "jsconfig.json", "package.json"],
        _ => return Err(AppError::Plugin("Unsupported code language.".to_string())),
    };
    let Some(document) = document else {
        return Ok(root.to_path_buf());
    };
    let file = safe_code_path(root, document, false)?;
    if !file.is_file() {
        return Err(AppError::Plugin(
            "Code context needs a regular source file.".to_string(),
        ));
    }
    let mut candidate = file.parent().unwrap_or(root);
    for _ in 0..64 {
        if markers.iter().any(|marker| {
            fs::symlink_metadata(candidate.join(marker))
                .is_ok_and(|metadata| metadata.is_file() && !metadata_is_link(&metadata))
        }) {
            return Ok(candidate.to_path_buf());
        }
        if candidate == root {
            return Ok(root.to_path_buf());
        }
        candidate = candidate
            .parent()
            .filter(|parent| parent.starts_with(root))
            .ok_or_else(|| {
                AppError::Plugin("Unable to resolve a safe code project root.".to_string())
            })?;
    }
    Err(AppError::Plugin(
        "Code project nesting exceeds 64 folders.".to_string(),
    ))
}

fn decode_path(path: &str) -> AppResult<String> {
    let bytes = path.as_bytes();
    let mut decoded = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let pair = path
                .get(index + 1..index + 3)
                .ok_or_else(|| AppError::Plugin("Invalid encoded code path.".to_string()))?;
            decoded.push(
                u8::from_str_radix(pair, 16)
                    .map_err(|_| AppError::Plugin("Invalid encoded code path.".to_string()))?,
            );
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).map_err(|_| AppError::Plugin("Code path is not UTF-8.".to_string()))
}

fn virtual_uri(root: &Path, path: &Path) -> AppResult<String> {
    let visible_root = crate::paths::without_windows_verbatim_prefix(root);
    let visible_path = crate::paths::without_windows_verbatim_prefix(path);
    let relative = visible_path.strip_prefix(&visible_root).map_err(|_| {
        AppError::Plugin(
            "Language server target is outside this vault and cannot be opened here.".to_string(),
        )
    })?;
    let relative = relative.to_string_lossy().replace('\\', "/");
    safe_code_path(root, &relative, true)?;
    let mut uri =
        Url::parse("denote://vault/").map_err(|error| AppError::Plugin(error.to_string()))?;
    uri.path_segments_mut()
        .map_err(|_| AppError::Plugin("Unable to encode a virtual code path.".to_string()))?
        .clear()
        .extend(relative.split('/'));
    Ok(uri.to_string())
}

pub(super) fn map_protocol_paths(
    value: &mut Value,
    root: &Path,
    incoming: bool,
    depth: usize,
) -> AppResult<()> {
    if depth > 32 {
        return Err(AppError::Plugin(
            "Code protocol nesting exceeds 32 levels.".to_string(),
        ));
    }
    match value {
        Value::Array(values) => {
            if values.len() > 20_000 {
                return Err(AppError::Plugin(
                    "Code protocol array exceeds its bounded limit.".to_string(),
                ));
            }
            for value in values {
                map_protocol_paths(value, root, incoming, depth + 1)?;
            }
        }
        Value::Object(values) => {
            for (key, value) in values {
                let uri_field = matches!(
                    key.as_str(),
                    "uri" | "targetUri" | "rootUri" | "documentUri" | "oldUri" | "newUri"
                );
                let path_field = matches!(key.as_str(), "path" | "rootPath" | "cwd" | "program");
                if (uri_field || path_field)
                    && let Some(text) = value.as_str()
                {
                    if !incoming && let Some(relative) = text.strip_prefix("denote://vault/") {
                        let path = safe_code_path(root, &decode_path(relative)?, true)?;
                        *value = if path_field {
                            json!(crate::paths::path_for_display(&path))
                        } else {
                            json!(
                                Url::from_file_path(path)
                                    .map_err(|_| AppError::Plugin(
                                        "Unable to encode code path.".to_string()
                                    ))?
                                    .to_string()
                            )
                        };
                    } else if incoming && text.starts_with("file:") {
                        let path = Url::parse(text)
                            .ok()
                            .and_then(|url| url.to_file_path().ok())
                            .ok_or_else(|| {
                                AppError::Plugin("Invalid language server file URI.".to_string())
                            })?;
                        *value = json!(virtual_uri(root, &path)?);
                    } else if incoming && path_field && Path::new(text).is_absolute() {
                        let path = PathBuf::from(text);
                        *value = json!(virtual_uri(root, &path)?);
                    } else if !incoming && (uri_field || path_field) {
                        return Err(AppError::Plugin(
                            "Plugins must use virtual vault URIs, not arbitrary filesystem paths or network URIs.".to_string(),
                        ));
                    }
                }
                map_protocol_paths(value, root, incoming, depth + 1)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn expand_launch(
    value: &mut Value,
    project: &Path,
    document: Option<&str>,
    root: &Path,
) -> AppResult<()> {
    match value {
        Value::String(text) => {
            if let Some(relative) = text.strip_prefix("denote://vault/") {
                *text = crate::paths::path_for_display(&safe_code_path(
                    root,
                    &decode_path(relative)?,
                    true,
                )?);
            }
            *text = text.replace(
                "${workspaceFolder}",
                &crate::paths::path_for_display(project),
            );
            if text.contains("${file}") {
                let path = document.ok_or_else(|| {
                    AppError::Plugin(
                        "This launch configuration needs an open source file.".to_string(),
                    )
                })?;
                *text = text.replace(
                    "${file}",
                    &crate::paths::path_for_display(&safe_code_path(root, path, false)?),
                );
            }
        }
        Value::Array(values) => {
            for value in values {
                expand_launch(value, project, document, root)?;
            }
        }
        Value::Object(values) => {
            for value in values.values_mut() {
                expand_launch(value, project, document, root)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn sanitize_debug_sources(value: &mut Value, root: &Path) -> AppResult<()> {
    match value {
        Value::Object(values) => {
            if let Some(source) = values.get_mut("source").and_then(Value::as_object_mut)
                && let Some(path) = source.get("path").and_then(Value::as_str)
            {
                let local = if path.starts_with("denote://vault/") {
                    safe_code_path(
                        root,
                        &decode_path(path.trim_start_matches("denote://vault/"))?,
                        true,
                    )
                    .is_ok()
                } else if path.starts_with("file:") {
                    Url::parse(path)
                        .ok()
                        .and_then(|uri| uri.to_file_path().ok())
                        .is_some_and(|path| virtual_uri(root, &path).is_ok())
                } else {
                    Path::new(path).is_absolute() && virtual_uri(root, Path::new(path)).is_ok()
                };
                if !local {
                    source.clear();
                    source.insert("name".to_string(), json!("External source"));
                    source.insert("path".to_string(), Value::Null);
                }
            }
            for value in values.values_mut() {
                sanitize_debug_sources(value, root)?;
            }
        }
        Value::Array(values) => {
            for value in values {
                sanitize_debug_sources(value, root)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn write_frame(writer: &mut impl Write, value: &Value) -> AppResult<()> {
    let bytes = serde_json::to_vec(value)
        .map_err(|error| AppError::Plugin(format!("Invalid code protocol message: {error}")))?;
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(AppError::Plugin(
            "Code protocol message exceeds 8 MiB.".to_string(),
        ));
    }
    write!(writer, "Content-Length: {}\r\n\r\n", bytes.len())?;
    writer.write_all(&bytes)?;
    writer.flush()?;
    Ok(())
}

fn read_frame(reader: &mut impl BufRead) -> AppResult<Option<Value>> {
    let mut length = None;
    let mut header_bytes = 0;
    loop {
        let mut line = Vec::new();
        let count = Read::by_ref(reader)
            .take((MAX_HEADER_BYTES + 1) as u64)
            .read_until(b'\n', &mut line)?;
        if count == 0 && header_bytes == 0 {
            return Ok(None);
        }
        header_bytes += count;
        if count == 0 || header_bytes > MAX_HEADER_BYTES || !line.ends_with(b"\r\n") {
            return Err(AppError::Plugin(
                "Invalid or oversized code protocol header.".to_string(),
            ));
        }
        if line == b"\r\n" {
            break;
        }
        let line = std::str::from_utf8(&line)
            .map_err(|_| AppError::Plugin("Invalid code protocol header encoding.".to_string()))?;
        let (name, value) = line
            .trim_end()
            .split_once(':')
            .ok_or_else(|| AppError::Plugin("Malformed code protocol header.".to_string()))?;
        if name.eq_ignore_ascii_case("Content-Length") {
            if length.is_some() {
                return Err(AppError::Plugin(
                    "Duplicate code protocol content length.".to_string(),
                ));
            }
            length = Some(value.trim().parse::<usize>().map_err(|_| {
                AppError::Plugin("Invalid code protocol content length.".to_string())
            })?);
        }
    }
    let length = length
        .filter(|length| *length > 0 && *length <= MAX_FRAME_BYTES)
        .ok_or_else(|| {
            AppError::Plugin("Missing or oversized code protocol content length.".to_string())
        })?;
    let mut bytes = vec![0; length];
    reader.read_exact(&mut bytes)?;
    let value = serde_json::from_slice(&bytes)
        .map_err(|error| AppError::Plugin(format!("Invalid code protocol JSON: {error}")))?;
    Ok(Some(value))
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        io::Cursor,
        process::Command,
        sync::{Arc, atomic::Ordering},
    };

    use serde_json::json;

    use super::*;

    #[test]
    fn frames_protocol_messages_by_utf8_bytes_and_accepts_extra_headers() {
        let message = json!({"jsonrpc": "2.0", "id": 1, "result": "synthetic \u{1f680}"});
        let mut bytes = Vec::new();
        write_frame(&mut bytes, &message).expect("write frame");
        assert_eq!(
            read_frame(&mut Cursor::new(bytes)).expect("read frame"),
            Some(message)
        );
        let body = br#"{"seq":1,"type":"event","event":"initialized"}"#;
        let framed = format!(
            "Content-Type: application/json\r\nContent-Length: {}\r\n\r\n",
            body.len()
        );
        let mut bytes = framed.into_bytes();
        bytes.extend(body);
        assert_eq!(
            read_frame(&mut Cursor::new(bytes))
                .expect("DAP frame")
                .unwrap()["event"],
            "initialized"
        );
    }

    #[test]
    fn rejects_duplicate_lengths_large_headers_truncation_and_invalid_json() {
        for input in [
            "Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}",
            "Content-Length: 8388609\r\n\r\n",
            "Content-Length: 2\r\n\r\n{",
            "Content-Length: 3\r\n\r\nbad",
        ] {
            assert!(read_frame(&mut Cursor::new(input)).is_err());
        }

        let header = format!(
            "X-Test: {}\r\nContent-Length: 2\r\n\r\n{{}}",
            "x".repeat(MAX_HEADER_BYTES)
        );
        assert!(read_frame(&mut Cursor::new(header)).is_err());
    }

    #[test]
    fn keeps_external_debug_frames_visible_without_exposing_or_opening_their_paths() {
        let vault = tempfile::tempdir().expect("vault");
        let root = fs::canonicalize(vault.path()).expect("root");
        let mut frames = json!({"stackFrames": [{
            "id": 1, "name": "synthetic::entry", "source": {"path": "/synthetic/external/library.rs", "name": "library.rs"}
        }]});
        sanitize_debug_sources(&mut frames, &root).expect("sanitize external source");
        assert_eq!(frames["stackFrames"][0]["name"], "synthetic::entry");
        assert!(frames["stackFrames"][0]["source"]["path"].is_null());
        map_protocol_paths(&mut frames, &root, true, 0).expect("safe frames");
    }

    #[test]
    fn maps_only_protocol_paths_and_rejects_escapes_and_symlinks() {
        let vault = tempfile::tempdir().expect("vault");
        fs::create_dir(vault.path().join("sample")).expect("project");
        fs::write(vault.path().join("sample/main.rs"), "fn main() {}\n").expect("source");
        let root = fs::canonicalize(vault.path()).expect("root");
        let mut value =
            json!({"uri": "denote://vault/sample/main.rs", "text": "denote://vault/literal"});
        map_protocol_paths(&mut value, &root, false, 0).expect("outgoing paths");
        assert!(value["uri"].as_str().expect("URI").starts_with("file://"));
        assert_eq!(value["text"], "denote://vault/literal");
        map_protocol_paths(&mut value, &root, true, 0).expect("incoming paths");
        assert_eq!(value["uri"], "denote://vault/sample/main.rs");
        assert!(
            map_protocol_paths(
                &mut json!({"uri": "denote://vault/%2E%2E/secret"}),
                &root,
                false,
                0
            )
            .is_err()
        );
        assert!(safe_code_path(&root, ".denote/state", true).is_err());
        assert!(
            map_protocol_paths(
                &mut json!({"path": "/synthetic/outside.rs"}),
                &root,
                false,
                0,
            )
            .is_err()
        );
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(vault.path().parent().expect("parent"), root.join("linked"))
                .expect("link");
            assert!(safe_code_path(&root, "linked/outside.rs", true).is_err());
        }
    }

    #[test]
    fn detects_the_nearest_language_root_without_reading_project_content() {
        let vault = tempfile::tempdir().expect("vault");
        fs::create_dir_all(vault.path().join("sample/nested/src")).expect("folders");
        fs::write(
            vault.path().join("sample/Cargo.toml"),
            "[package]\nname='sample'",
        )
        .expect("outer marker");
        fs::write(
            vault.path().join("sample/nested/Cargo.toml"),
            "[package]\nname='nested'",
        )
        .expect("inner marker");
        fs::write(
            vault.path().join("sample/nested/src/main.rs"),
            "fn main() {}",
        )
        .expect("source");
        let root = fs::canonicalize(vault.path()).expect("root");
        assert_eq!(
            detect_code_root(&root, Some("sample/nested/src/main.rs"), "rust").expect("detect"),
            root.join("sample/nested")
        );
        assert_eq!(
            detect_code_root(&root, None, "rust").expect("vault fallback"),
            root
        );
    }

    #[test]
    fn runs_a_loopback_debug_adapter_and_releases_its_socket_and_process() {
        let vault = tempfile::tempdir().expect("vault");
        let root = fs::canonicalize(vault.path()).expect("root");
        let node = Command::new("node")
            .args(["-p", "process.execPath"])
            .output()
            .expect("Node");
        assert!(node.status.success());
        let configuration = CodeToolConfiguration {
            enabled: true,
            transport: "tcp".to_string(),
            executable: String::from_utf8(node.stdout)
                .expect("Node path")
                .trim()
                .to_string(),
            arguments: vec![
                concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/tests/fixtures/code-protocol-server.cjs"
                )
                .to_string(),
                "--tcp".to_string(),
                "%PORT%".to_string(),
            ],
            ..Default::default()
        };
        let session = CodeSession::spawn(
            "denote.synthetic",
            "dap",
            &configuration,
            &root,
            &root,
            Arc::new(|| true),
        )
        .expect("TCP adapter");
        assert_eq!(
            session
                .request("initialize", json!({}), "debug-example")
                .expect("initialize")["supportsConfigurationDoneRequest"],
            true
        );
        let address = session
            .socket
            .lock()
            .expect("socket")
            .as_ref()
            .expect("connected")
            .peer_addr()
            .expect("peer");
        assert!(address.ip().is_loopback());
        session.stop("Stop TCP adapter.").expect("stop");
        assert!(session.socket.lock().expect("socket").is_none());
        assert!(session.child.lock().expect("child").is_none());
        assert!(TcpStream::connect_timeout(&address, Duration::from_millis(100)).is_err());
    }

    #[test]
    fn cancellation_rejects_a_pending_request_without_terminating_the_language_server() {
        let vault = tempfile::tempdir().expect("vault");
        let root = fs::canonicalize(vault.path()).expect("root");
        let node = Command::new("node")
            .args(["-p", "process.execPath"])
            .output()
            .expect("Node");
        let configuration = CodeToolConfiguration {
            enabled: true,
            executable: String::from_utf8(node.stdout)
                .expect("Node path")
                .trim()
                .to_string(),
            arguments: vec![
                concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/tests/fixtures/code-protocol-server.cjs"
                )
                .to_string(),
            ],
            ..Default::default()
        };
        let session = CodeSession::spawn(
            "denote.synthetic",
            "lsp",
            &configuration,
            &root,
            &root,
            Arc::new(|| true),
        )
        .expect("server");
        let request_session = session.clone();
        let pending = thread::spawn(move || {
            request_session.request("synthetic/hang", json!({}), "cancel-example")
        });
        let deadline = Instant::now() + Duration::from_secs(2);
        while session.pending.lock().expect("pending").is_empty() {
            assert!(Instant::now() < deadline, "request registered");
            thread::sleep(Duration::from_millis(10));
        }
        session.cancel("cancel-example").expect("cancel");
        assert!(
            pending
                .join()
                .expect("thread")
                .expect_err("cancelled")
                .to_string()
                .contains("cancelled")
        );
        assert!(!session.ended.load(Ordering::Acquire));
        assert!(
            session
                .request(
                    "synthetic/echo",
                    json!({"value": "synthetic"}),
                    "after-cancel"
                )
                .is_ok()
        );
        session.stop("Stop cancelled test.").expect("stop");
    }

    #[test]
    fn correlates_protocol_responses_drains_logs_and_reaps_process_groups() {
        let vault = tempfile::tempdir().expect("vault");
        let root = fs::canonicalize(vault.path()).expect("root");
        let node = Command::new("node")
            .args(["-p", "process.execPath"])
            .output()
            .expect("Node test prerequisite");
        assert!(node.status.success());
        let configuration = CodeToolConfiguration {
            enabled: true,
            executable: String::from_utf8(node.stdout)
                .expect("Node path")
                .trim()
                .to_string(),
            arguments: vec![
                concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/tests/fixtures/code-protocol-server.cjs"
                )
                .to_string(),
            ],
            ..Default::default()
        };
        let session = CodeSession::spawn(
            "denote.synthetic",
            "lsp",
            &configuration,
            &root,
            &root,
            Arc::new(|| true),
        )
        .expect("start mock");
        let result = session
            .request("initialize", json!({}), "request-example")
            .expect("initialize");
        assert_eq!(result["capabilities"]["hoverProvider"], true);
        assert_eq!(
            session
                .request(
                    "synthetic/echo",
                    json!({"label": "example"}),
                    "request-echo"
                )
                .expect("echo")["label"],
            "example"
        );
        session.stop("Stopped synthetic server.").expect("stop");
        assert!(session.ended.load(Ordering::Acquire));
        assert!(session.child.lock().expect("child").is_none());
        assert!(
            session
                .request("synthetic/echo", json!({}), "after-stop")
                .is_err()
        );
    }
}
