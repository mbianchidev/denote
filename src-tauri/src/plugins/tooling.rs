use std::{
    collections::{BTreeMap, VecDeque},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc, Mutex, MutexGuard,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, SyncSender},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use command_group::{CommandGroup, GroupChild};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::tooling_output::{ToolOutputText, translate_linter_paths};
use crate::error::{AppError, AppResult};

const MAX_QUEUED_BYTES: usize = 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 8 * 1024 * 1024;

fn lock<'a, T>(mutex: &'a Mutex<T>) -> AppResult<MutexGuard<'a, T>> {
    mutex
        .lock()
        .map_err(|_| AppError::Plugin("External-tool state lock failed.".into()))
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolDocument {
    pub path: String,
    pub version: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolOutput {
    pub stream: String,
    pub data: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolPoll {
    pub status: String,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
    pub events: Vec<ToolOutput>,
}

struct OutputState {
    status: String,
    exit_code: Option<i32>,
    error: Option<String>,
    events: VecDeque<ToolOutput>,
    queued_bytes: usize,
    total_bytes: usize,
}

enum ToolChild {
    Process(GroupChild),
    #[cfg(unix)]
    Terminal {
        child: Box<dyn portable_pty::Child + Send + Sync>,
        session_id: u32,
    },
}

impl ToolChild {
    fn status(&mut self) -> AppResult<Option<i32>> {
        Ok(match self {
            Self::Process(child) => child
                .inner()
                .try_wait()?
                .map(|status| status.code().unwrap_or(-1)),
            #[cfg(unix)]
            Self::Terminal { session_id, .. } => {
                // Keep the leader unreaped until its interactive job groups are terminated.
                let mut info = std::mem::MaybeUninit::<libc::siginfo_t>::zeroed();
                if unsafe {
                    libc::waitid(
                        libc::P_PID,
                        *session_id as libc::id_t,
                        info.as_mut_ptr(),
                        libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
                    )
                } != 0
                {
                    return Err(std::io::Error::last_os_error().into());
                }
                let info = unsafe { info.assume_init() };
                if unsafe { info.si_pid() } == 0 {
                    None
                } else {
                    Some(if info.si_code == libc::CLD_EXITED {
                        unsafe { info.si_status() }
                    } else {
                        -1
                    })
                }
            }
        })
    }

    fn terminate(&mut self) -> AppResult<()> {
        match self {
            Self::Process(child) => {
                if let Err(error) = child.kill()
                    && child.inner().try_wait()?.is_none()
                {
                    return Err(AppError::Plugin(format!(
                        "Unable to terminate tool process group: {error}"
                    )));
                }
                child.wait()?;
            }
            #[cfg(unix)]
            Self::Terminal { child, session_id } => {
                terminate_terminal_session(*session_id)?;
                if let Err(error) = child.kill()
                    && child.try_wait()?.is_none()
                {
                    return Err(AppError::Plugin(format!(
                        "Unable to terminate terminal shell: {error}"
                    )));
                }
                child.wait()?;
            }
        }
        Ok(())
    }
}

#[cfg(unix)]
fn terminate_terminal_session(session_id: u32) -> AppResult<()> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, Signal, System};
    let mut system = System::new().map_err(|error| {
        AppError::Plugin(format!(
            "Unable to inspect terminal process ownership: {error}"
        ))
    })?;
    system.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    // Interactive jobs have separate process groups, but retain the PTY session.
    let members: Vec<_> = system
        .processes()
        .iter()
        .filter_map(|(pid, process)| {
            let session = unsafe { libc::getsid(pid.as_u32() as i32) };
            (session == session_id as i32).then_some((*pid, process.start_time()))
        })
        .collect();
    let mut failures = Vec::new();
    for (pid, start) in &members {
        if let Some(process) = system.process(*pid)
            && process.start_time() == *start
        {
            process.kill_with(Signal::Stop);
        }
    }
    system.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    for (pid, process) in system.processes() {
        if unsafe { libc::getsid(pid.as_u32() as i32) } == session_id as i32
            && process.kill_with(Signal::Kill) == Some(false)
        {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() != Some(libc::ESRCH) {
                failures.push(format!("PID {}: {error}", pid.as_u32()));
            }
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(AppError::Plugin(format!(
            "Terminal process cleanup failed: {}",
            failures.join("; ")
        )))
    }
}

pub(super) struct ToolSession {
    pub id: String,
    pub plugin_id: String,
    pub kind: String,
    format: String,
    pub language: String,
    pub project_id: Option<String>,
    pub vault_root: PathBuf,
    pub project_root: PathBuf,
    child: Mutex<Option<ToolChild>>,
    writer: Mutex<Option<SyncSender<Vec<u8>>>>,
    #[cfg(unix)]
    master: Mutex<Option<Box<dyn portable_pty::MasterPty + Send>>>,
    output: Mutex<OutputState>,
    workers: Mutex<Vec<JoinHandle<()>>>,
    lifecycle: Mutex<()>,
    stopping: AtomicBool,
    ended: AtomicBool,
    current: Arc<dyn Fn() -> bool + Send + Sync>,
}

pub(super) struct ToolLaunch<'a> {
    pub plugin_id: &'a str,
    pub kind: &'a str,
    pub format: &'a str,
    pub language: &'a str,
    pub project_id: Option<String>,
    pub executable: &'a str,
    pub arguments: &'a [String],
    pub vault_root: &'a Path,
    pub project_root: &'a Path,
    pub input: Option<String>,
    pub rows: u16,
    pub cols: u16,
    pub timeout: Duration,
    pub current: Arc<dyn Fn() -> bool + Send + Sync>,
}

impl ToolSession {
    pub(super) fn spawn(launch: ToolLaunch<'_>) -> AppResult<Arc<Self>> {
        let terminal = launch.kind == "terminal";
        #[cfg(not(unix))]
        if terminal {
            return Err(AppError::Plugin("Embedded terminals are currently supported on macOS and Linux. Windows PTY process-tree shutdown is not yet verified.".into()));
        }
        let mut readers: Vec<(String, Box<dyn Read + Send>)> = Vec::new();
        let writer: Box<dyn Write + Send>;
        #[cfg(unix)]
        let mut master = None;
        let child = if terminal {
            #[cfg(unix)]
            {
                use portable_pty::{CommandBuilder, PtySize, native_pty_system};
                let pair = native_pty_system()
                    .openpty(PtySize {
                        rows: launch.rows,
                        cols: launch.cols,
                        pixel_width: 0,
                        pixel_height: 0,
                    })
                    .map_err(|error| {
                        AppError::Plugin(format!("Unable to create terminal: {error}"))
                    })?;
                let mut command = CommandBuilder::new(launch.executable);
                command.args(launch.arguments);
                command.cwd(launch.project_root);
                command.env("TERM", "xterm-256color");
                command.env("COLORTERM", "truecolor");
                writer = pair.master.take_writer().map_err(|error| {
                    AppError::Plugin(format!("Unable to open terminal input: {error}"))
                })?;
                readers.push((
                    "terminal".into(),
                    pair.master.try_clone_reader().map_err(|error| {
                        AppError::Plugin(format!("Unable to open terminal output: {error}"))
                    })?,
                ));
                let child = pair.slave.spawn_command(command).map_err(|error| {
                    AppError::Plugin(format!("Unable to start approved shell: {error}"))
                })?;
                let session_id = match child.process_id() {
                    Some(id) => id,
                    None => {
                        let mut child = child;
                        let result = child.kill().and_then(|_| child.wait().map(|_| ()));
                        return Err(AppError::Plugin(format!(
                            "Terminal did not expose a process identity; cleanup: {result:?}"
                        )));
                    }
                };
                master = Some(pair.master);
                ToolChild::Terminal { child, session_id }
            }
            #[cfg(not(unix))]
            unreachable!()
        } else {
            let mut command = Command::new(launch.executable);
            command
                .args(launch.arguments)
                .current_dir(launch.project_root)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            #[cfg(unix)]
            if launch.kind == "process" {
                use std::os::unix::process::CommandExt;
                unsafe {
                    command.pre_exec(|| {
                        rlimit::setrlimit(rlimit::Resource::FSIZE, 1024 * 1024, 1024 * 1024)
                            .map_err(std::io::Error::other)
                    });
                }
            }
            let mut group = command.group();
            #[cfg(windows)]
            group.creation_flags(0x0800_0000);
            let mut child = group.spawn().map_err(|error| {
                AppError::Plugin(format!(
                    "Unable to start approved tool: {error}. Check its executable and arguments."
                ))
            })?;
            let pipes = (
                child.inner().stdin.take(),
                child.inner().stdout.take(),
                child.inner().stderr.take(),
            );
            let (Some(stdin), Some(stdout), Some(stderr)) = pipes else {
                let cleanup = child.kill().and_then(|_| child.wait().map(|_| ()));
                return Err(AppError::Plugin(format!(
                    "Tool process pipes are unavailable; cleanup: {cleanup:?}"
                )));
            };
            writer = Box::new(stdin);
            readers.push(("stdout".into(), Box::new(stdout)));
            readers.push(("stderr".into(), Box::new(stderr)));
            ToolChild::Process(child)
        };
        let (sender, receiver) = mpsc::sync_channel::<Vec<u8>>(64);
        let session = Arc::new(Self {
            id: Uuid::new_v4().to_string(),
            plugin_id: launch.plugin_id.into(),
            kind: launch.kind.into(),
            format: launch.format.into(),
            language: launch.language.into(),
            project_id: launch.project_id,
            vault_root: launch.vault_root.into(),
            project_root: launch.project_root.into(),
            child: Mutex::new(Some(child)),
            writer: Mutex::new(Some(sender)),
            #[cfg(unix)]
            master: Mutex::new(master),
            output: Mutex::new(OutputState {
                status: "running".into(),
                exit_code: None,
                error: None,
                events: VecDeque::new(),
                queued_bytes: 0,
                total_bytes: 0,
            }),
            workers: Mutex::new(Vec::new()),
            lifecycle: Mutex::new(()),
            stopping: AtomicBool::new(false),
            ended: AtomicBool::new(false),
            current: launch.current,
        });
        let weak = Arc::downgrade(&session);
        let input = launch.input;
        let worker = thread::spawn(move || {
            let mut writer = writer;
            if !terminal {
                if let Some(input) = input
                    && let Err(error) = writer
                        .write_all(input.as_bytes())
                        .and_then(|_| writer.flush())
                    && let Some(session) = weak.upgrade()
                {
                    session.request_failure(&format!("Tool standard input failed: {error}"));
                }
                return;
            }
            loop {
                let Some(session) = weak.upgrade() else { break };
                if session.stopping.load(Ordering::Acquire) {
                    break;
                }
                drop(session);
                match receiver.recv_timeout(Duration::from_millis(100)) {
                    Ok(bytes) => {
                        if let Err(error) = writer.write_all(&bytes).and_then(|_| writer.flush()) {
                            if let Some(session) = weak.upgrade() {
                                session.request_failure(&format!("Terminal input failed: {error}"));
                            }
                            break;
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });
        lock(&session.workers)?.push(worker);
        for (stream, reader) in readers {
            Self::read_output(&session, stream, reader)?;
        }
        let weak = Arc::downgrade(&session);
        let timeout = launch.timeout;
        thread::spawn(move || {
            let started = Instant::now();
            loop {
                thread::sleep(Duration::from_millis(50));
                let Some(session) = weak.upgrade() else { break };
                if session.ended.load(Ordering::Acquire) {
                    break;
                }
                let failure = match lock(&session.output) {
                    Ok(output) => output.error.clone(),
                    Err(error) => Some(error.to_string()),
                };
                if let Some(error) = failure {
                    session.fail(&error);
                    break;
                }
                if !(session.current)() {
                    session.fail("Vault, project, encryption state, or plugin approval changed. Start the tool again.");
                    break;
                }
                if !terminal && started.elapsed() > timeout {
                    session.fail("Tool exceeded its approved timeout.");
                    break;
                }
                let status = lock(&session.child).and_then(|mut child| {
                    child.as_mut().map(ToolChild::status).unwrap_or(Ok(None))
                });
                match status {
                    Ok(Some(code)) => {
                        if let Err(error) = session.finish(Some(code), None) {
                            eprintln!("Tool exit cleanup failed: {error}");
                        }
                        break;
                    }
                    Err(error) => {
                        session.fail(&format!("Unable to monitor tool: {error}"));
                        break;
                    }
                    Ok(None) => {}
                }
            }
        });
        Ok(session)
    }

    fn read_output(
        session: &Arc<Self>,
        stream: String,
        reader: Box<dyn Read + Send>,
    ) -> AppResult<()> {
        let weak = Arc::downgrade(session);
        let json_output = stream == "stdout" && session.format == "eslint-json";
        let line_limit = if session.kind == "process" {
            1024 * 1024
        } else {
            64 * 1024
        };
        let mut text = ToolOutputText::new(&session.vault_root, session.kind == "process");
        let worker = thread::spawn(move || {
            let mut reader = BufReader::new(reader);
            loop {
                let mut bytes = vec![0; if json_output { 0 } else { 8192 }];
                let result = if !json_output {
                    reader.read(&mut bytes)
                } else {
                    Read::by_ref(&mut reader)
                        .take(line_limit as u64 + 1)
                        .read_until(b'\n', &mut bytes)
                };
                let Some(session) = weak.upgrade() else { break };
                match result {
                    Ok(0) => {
                        if stream != "terminal" && !json_output {
                            let data = text.finish();
                            if !data.is_empty()
                                && let Err(error) = session.enqueue(ToolOutput {
                                    stream: stream.clone(),
                                    data,
                                })
                            {
                                session.request_failure(&error.to_string());
                            }
                        }
                        break;
                    }
                    Ok(count) => {
                        bytes.truncate(count);
                        if json_output && count > line_limit {
                            session.request_failure("Tool output line exceeds its approved limit.");
                            break;
                        }
                        let data = if stream == "terminal" {
                            use base64::Engine;
                            base64::engine::general_purpose::STANDARD.encode(bytes)
                        } else if json_output {
                            match translate_linter_paths(&bytes, &session.vault_root) {
                                Ok(data) => data,
                                Err(error) => {
                                    session.request_failure(&error.to_string());
                                    break;
                                }
                            }
                        } else {
                            match text.push(&bytes) {
                                Ok(data) => data,
                                Err(error) => {
                                    session.request_failure(&error.to_string());
                                    break;
                                }
                            }
                        };
                        if data.is_empty() {
                            continue;
                        }
                        if let Err(error) = session.enqueue(ToolOutput {
                            stream: stream.clone(),
                            data,
                        }) {
                            session.request_failure(&error.to_string());
                            break;
                        }
                    }
                    Err(error)
                        if stream == "terminal" && error.raw_os_error() == Some(libc_eio()) =>
                    {
                        break;
                    }
                    Err(error) => {
                        session.request_failure(&format!("Tool output failed: {error}"));
                        break;
                    }
                }
            }
        });
        lock(&session.workers)?.push(worker);
        Ok(())
    }

    fn enqueue(&self, event: ToolOutput) -> AppResult<()> {
        if self.ended.load(Ordering::Acquire) {
            return Ok(());
        }
        let mut output = lock(&self.output)?;
        let queue_limit = if self.kind == "process" {
            2 * MAX_QUEUED_BYTES
        } else {
            MAX_QUEUED_BYTES
        };
        if (self.kind != "process" && output.events.len() >= 512)
            || output.queued_bytes + event.data.len() > queue_limit
            || (self.kind != "terminal" && output.total_bytes + event.data.len() > MAX_OUTPUT_BYTES)
        {
            return Err(AppError::Plugin(
                "Tool output limit exceeded. Narrow the command or reduce its verbosity.".into(),
            ));
        }
        output.queued_bytes += event.data.len();
        output.total_bytes += event.data.len();
        if self.kind == "process"
            && let Some(previous) = output
                .events
                .iter_mut()
                .find(|previous| previous.stream == event.stream)
        {
            previous.data.push_str(&event.data);
            return Ok(());
        }
        output.events.push_back(event);
        Ok(())
    }

    fn request_failure(&self, message: &str) {
        if let Ok(mut output) = self.output.lock() {
            if output.error.is_none() {
                output.error = Some(message.into());
            }
        } else {
            eprintln!("External-tool output lock failed: {message}");
        }
    }

    fn fail(&self, message: &str) {
        if let Err(error) = self.finish(None, Some(message)) {
            eprintln!("External-tool cleanup failed: {error}");
        }
    }

    pub(super) fn poll(&self) -> AppResult<ToolPoll> {
        let mut output = lock(&self.output)?;
        let events = output.events.drain(..).collect();
        output.queued_bytes = 0;
        Ok(ToolPoll {
            status: output.status.clone(),
            exit_code: output.exit_code,
            error: output.error.clone(),
            events,
        })
    }

    pub(super) fn input(&self, data: &str) -> AppResult<()> {
        if self.kind != "terminal"
            || self.stopping.load(Ordering::Acquire)
            || data.len() > 64 * 1024
        {
            return Err(AppError::Plugin(
                "Terminal input is unavailable or exceeds 64 KiB.".into(),
            ));
        }
        lock(&self.writer)?
            .as_ref()
            .ok_or_else(|| AppError::Plugin("Terminal input is closed.".into()))?
            .try_send(data.as_bytes().to_vec())
            .map_err(|error| {
                AppError::Plugin(format!("Terminal input queue is unavailable: {error}"))
            })
    }

    pub(super) fn resize(&self, rows: u16, cols: u16) -> AppResult<()> {
        if self.kind != "terminal"
            || self.stopping.load(Ordering::Acquire)
            || !(2..=500).contains(&rows)
            || !(2..=500).contains(&cols)
        {
            return Err(AppError::Plugin(
                "Terminal dimensions must be between 2 and 500 cells.".into(),
            ));
        }
        #[cfg(unix)]
        {
            lock(&self.master)?
                .as_ref()
                .ok_or_else(|| AppError::Plugin("Terminal is closed.".into()))?
                .resize(portable_pty::PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|error| AppError::Plugin(format!("Unable to resize terminal: {error}")))?;
            Ok(())
        }
        #[cfg(not(unix))]
        Err(AppError::Plugin(
            "Interactive terminals are unavailable on this platform.".into(),
        ))
    }

    pub(super) fn stop(&self) -> AppResult<()> {
        self.finish(None, Some("Tool cancelled."))
    }

    fn finish(&self, exit_code: Option<i32>, reason: Option<&str>) -> AppResult<()> {
        let _lifecycle = lock(&self.lifecycle)?;
        if self.ended.load(Ordering::Acquire) {
            return Ok(());
        }
        self.stopping.store(true, Ordering::Release);
        let mut failures = Vec::new();
        if let Some(mut child) = lock(&self.child)?.take()
            && let Err(error) = child.terminate()
        {
            failures.push(error.to_string());
            *lock(&self.child)? = Some(child);
        }
        lock(&self.writer)?.take();
        #[cfg(unix)]
        lock(&self.master)?.take();
        if !failures.is_empty() {
            self.request_failure(&failures.join("; "));
            return Err(AppError::Plugin(failures.join("; ")));
        }
        for worker in std::mem::take(&mut *lock(&self.workers)?) {
            if worker.join().is_err() {
                failures.push("Tool I/O worker failed.".into());
            }
        }
        let mut output = lock(&self.output)?;
        if let Some(reason) = reason {
            output.error = Some(reason.into());
        }
        if !failures.is_empty() {
            output.error = Some(failures.join("; "));
        }
        output.exit_code = exit_code;
        output.status = if reason == Some("Tool cancelled.") {
            "cancelled"
        } else if exit_code == Some(0) && output.error.is_none() {
            "succeeded"
        } else {
            "failed"
        }
        .into();
        self.ended.store(true, Ordering::Release);
        Ok(())
    }
}

fn libc_eio() -> i32 {
    #[cfg(unix)]
    {
        libc::EIO
    }
    #[cfg(not(unix))]
    {
        -1
    }
}

impl Drop for ToolSession {
    fn drop(&mut self) {
        if let Err(error) = self.stop() {
            eprintln!("External-tool final cleanup failed: {error}");
        }
    }
}

#[derive(Default)]
pub(super) struct ToolSessionRegistry {
    sessions: Mutex<BTreeMap<String, Arc<ToolSession>>>,
    generations: Mutex<BTreeMap<String, u64>>,
}

impl ToolSessionRegistry {
    pub(super) fn generation(&self, plugin_id: &str) -> AppResult<u64> {
        Ok(*lock(&self.generations)?
            .entry(plugin_id.into())
            .or_default())
    }

    pub(super) fn insert(&self, session: Arc<ToolSession>, generation: u64) -> AppResult<()> {
        let generations = lock(&self.generations)?;
        let mut sessions = lock(&self.sessions)?;
        if *generations.get(&session.plugin_id).unwrap_or(&0) != generation || sessions.len() >= 12
        {
            drop(sessions);
            drop(generations);
            session.stop()?;
            return Err(AppError::Plugin("Tool start was cancelled or the 12-session limit was reached. Close unused terminals or runs.".into()));
        }
        sessions.insert(session.id.clone(), session);
        Ok(())
    }

    pub(super) fn get(&self, plugin_id: &str, run_id: &str) -> AppResult<Arc<ToolSession>> {
        lock(&self.sessions)?
            .get(run_id)
            .filter(|session| session.plugin_id == plugin_id)
            .cloned()
            .ok_or_else(|| {
                AppError::Plugin("Tool run is unavailable or belongs to another plugin.".into())
            })
    }

    pub(super) fn stop_one(&self, plugin_id: &str, run_id: &str) -> AppResult<()> {
        let session = lock(&self.sessions)?
            .get(run_id)
            .filter(|session| session.plugin_id == plugin_id)
            .cloned();
        if let Some(session) = session {
            session.stop()?;
            lock(&self.sessions)?.remove(run_id);
        }
        Ok(())
    }

    pub(super) fn stop_plugin(&self, plugin_id: Option<&str>) -> AppResult<()> {
        let mut generations = lock(&self.generations)?;
        if let Some(plugin_id) = plugin_id {
            *generations.entry(plugin_id.into()).or_default() += 1;
        } else {
            for generation in generations.values_mut() {
                *generation += 1;
            }
        }
        let sessions: Vec<_> = lock(&self.sessions)?
            .values()
            .filter(|session| plugin_id.is_none_or(|id| session.plugin_id == id))
            .cloned()
            .collect();
        drop(generations);
        let mut failures = Vec::new();
        for session in sessions {
            match session.stop() {
                Ok(()) => {
                    lock(&self.sessions)?.remove(&session.id);
                }
                Err(error) => failures.push(error.to_string()),
            }
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(AppError::Plugin(format!(
                "External-tool shutdown failed: {}",
                failures.join("; ")
            )))
        }
    }
}

impl Drop for ToolSessionRegistry {
    fn drop(&mut self) {
        if let Err(error) = self.stop_plugin(None) {
            eprintln!("External-tool registry cleanup failed: {error}");
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use base64::Engine;
    use tempfile::TempDir;

    fn launch(root: &Path, kind: &str, script: &str) -> Arc<ToolSession> {
        ToolSession::spawn(ToolLaunch {
            plugin_id: "denote.example",
            kind,
            format: "unix",
            language: "text",
            project_id: None,
            executable: "/bin/sh",
            arguments: &["-c".into(), script.into()],
            vault_root: root,
            project_root: root,
            input: None,
            rows: 24,
            cols: 80,
            timeout: Duration::from_secs(5),
            current: Arc::new(|| true),
        })
        .expect("synthetic process starts")
    }

    fn drain(session: &ToolSession) -> (ToolPoll, String, String) {
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut stdout = String::new();
        let mut stderr = String::new();
        loop {
            let result = session.poll().unwrap();
            for event in &result.events {
                match event.stream.as_str() {
                    "terminal" => stdout.push_str(&String::from_utf8_lossy(
                        &base64::engine::general_purpose::STANDARD
                            .decode(&event.data)
                            .unwrap(),
                    )),
                    "stdout" => stdout.push_str(&event.data),
                    _ => stderr.push_str(&event.data),
                }
            }
            if result.status != "running" {
                return (result, stdout, stderr);
            }
            assert!(Instant::now() < deadline, "synthetic process must settle");
            thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn streamed_tools_keep_both_streams_and_nonzero_exit_status() {
        let root = TempDir::new().unwrap();
        let session = launch(
            root.path(),
            "build",
            "printf 'example.rs:1:1: error: Example.\\n'; printf 'compiler failed\\n' >&2; exit 7",
        );
        let (result, stdout, stderr) = drain(&session);
        assert_eq!(result.status, "failed");
        assert_eq!(result.exit_code, Some(7));
        assert!(result.error.is_none());
        assert!(stdout.contains("example.rs:1:1"));
        assert!(stderr.contains("compiler failed"));
    }

    #[test]
    fn builds_stream_partial_unicode_output_before_the_process_finishes() {
        let root = TempDir::new().unwrap();
        let session = launch(
            root.path(),
            "build",
            "printf 'Building λ'; printf 'warning preview' >&2; while [ ! -f finish ]; do sleep 0.02; done",
        );
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut stdout = String::new();
        let mut stderr = String::new();
        while Instant::now() < deadline && (stdout.is_empty() || stderr.is_empty()) {
            let result = session.poll().unwrap();
            assert_eq!(result.status, "running");
            for event in result.events {
                if event.stream == "stdout" {
                    stdout.push_str(&event.data);
                } else if event.stream == "stderr" {
                    stderr.push_str(&event.data);
                }
            }
            thread::sleep(Duration::from_millis(10));
        }
        session.stop().unwrap();
        assert_eq!(stdout, "Building λ");
        assert_eq!(stderr, "warning preview");
    }

    #[test]
    fn normal_exit_removes_descendants_that_keep_output_open() {
        let root = TempDir::new().unwrap();
        let session = launch(root.path(), "build", "sleep 30 & printf 'done\\n'; exit 0");
        let (result, stdout, _) = drain(&session);
        assert_eq!(result.status, "succeeded");
        assert_eq!(stdout, "done\n");
    }

    #[test]
    fn legacy_finite_processes_retain_their_one_mib_line_contract() {
        let root = TempDir::new().unwrap();
        let session = launch(root.path(), "process", "printf '%0100000d' 1");
        let (result, stdout, _) = drain(&session);
        assert_eq!(result.status, "succeeded");
        assert_eq!(stdout.len(), 100000);
    }

    #[test]
    fn stdin_is_streamed_without_a_plaintext_file() {
        let root = TempDir::new().unwrap();
        let session = ToolSession::spawn(ToolLaunch {
            plugin_id: "denote.example",
            kind: "linter",
            format: "unix",
            language: "text",
            project_id: None,
            executable: "/bin/sh",
            arguments: &["-c".into(), "cat".into()],
            vault_root: root.path(),
            project_root: root.path(),
            input: Some("invented λ source\n".into()),
            rows: 24,
            cols: 80,
            timeout: Duration::from_secs(5),
            current: Arc::new(|| true),
        })
        .unwrap();
        let (result, stdout, _) = drain(&session);
        assert_eq!(result.status, "succeeded");
        assert_eq!(stdout, "invented λ source\n");
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    }

    #[test]
    fn linter_path_translation_never_rewrites_proposed_source_text() {
        let root = TempDir::new().unwrap();
        let proposed = format!("\"{}/example\"", root.path().display());
        let input = serde_json::json!([{
            "filePath": root.path().join("example.ts").to_string_lossy(),
            "messages": [{ "line": 1, "column": 1, "severity": 1, "message": "Example.",
                "fix": { "range": [0, 0], "text": proposed } }]
        }])
        .to_string();
        let session = ToolSession::spawn(ToolLaunch {
            plugin_id: "denote.example",
            kind: "linter",
            format: "eslint-json",
            language: "typescript",
            project_id: None,
            executable: "/bin/sh",
            arguments: &["-c".into(), "cat".into()],
            vault_root: root.path(),
            project_root: root.path(),
            input: Some(input),
            rows: 24,
            cols: 80,
            timeout: Duration::from_secs(5),
            current: Arc::new(|| true),
        })
        .unwrap();
        let (result, stdout, _) = drain(&session);
        assert_eq!(result.status, "succeeded");
        let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap();
        assert_eq!(parsed[0]["filePath"], "example.ts");
        assert_eq!(parsed[0]["messages"][0]["fix"]["text"], proposed);
    }

    #[test]
    fn terminal_preserves_unicode_resizes_and_returns_its_exit_code() {
        let root = TempDir::new().unwrap();
        let session = launch(
            root.path(),
            "terminal",
            "read value; stty size; printf 'λ %s\\n' \"$value\"; exit 9",
        );
        session.resize(30, 90).unwrap();
        session.input("example\n").unwrap();
        let (result, stdout, _) = drain(&session);
        assert_eq!(result.exit_code, Some(9));
        assert!(stdout.contains("30 90"), "{stdout}");
        assert!(stdout.contains("λ example"), "{stdout}");
    }

    #[test]
    fn disable_and_stale_start_terminate_process_groups() {
        let root = TempDir::new().unwrap();
        let registry = ToolSessionRegistry::default();
        let generation = registry.generation("denote.example").unwrap();
        let session = launch(root.path(), "build", "sleep 30");
        registry.insert(session.clone(), generation).unwrap();
        assert!(registry.get("denote.foreign", &session.id).is_err());
        registry.stop_plugin(Some("denote.example")).unwrap();
        assert_eq!(session.poll().unwrap().status, "cancelled");
        let stale = launch(root.path(), "build", "sleep 30");
        assert!(registry.insert(stale.clone(), generation).is_err());
        assert_eq!(stale.poll().unwrap().status, "cancelled");
    }

    #[test]
    fn terminal_shutdown_kills_background_job_groups() {
        let root = TempDir::new().unwrap();
        let pid_file = root.path().join("child.pid");
        let session = launch(
            root.path(),
            "terminal",
            "set -m; (trap '' HUP TERM; printf '%s' \"$BASHPID\" > /dev/null; sleep 30) & printf '%s' \"$!\" > child.pid; wait",
        );
        let deadline = Instant::now() + Duration::from_secs(5);
        while !pid_file.exists() {
            assert!(Instant::now() < deadline);
            thread::sleep(Duration::from_millis(10));
        }
        let pid: i32 = std::fs::read_to_string(pid_file).unwrap().parse().unwrap();
        session.stop().unwrap();
        let mut system = sysinfo::System::new().unwrap();
        loop {
            system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
            let terminated = system
                .process(sysinfo::Pid::from_u32(pid as u32))
                .is_none_or(|process| process.status() == sysinfo::ProcessStatus::Zombie);
            if terminated {
                break;
            }
            assert!(Instant::now() < deadline, "background job must terminate");
            thread::sleep(Duration::from_millis(10));
        }
    }
}
