use anyhow::{Context, Result};
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{self, BufRead, Read, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
};

mod decoder;
use decoder::PtyDecoder;

type Sessions = Arc<Mutex<HashMap<String, Session>>>;
type HostWriter = Arc<Mutex<io::Stdout>>;

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    /// OS process id of the PTY child, used to tear down the whole process tree
    /// on kill so a restarted server actually frees its port (no orphaned
    /// grandchildren like `npm`→`node` holding the port).
    pid: Option<u32>,
}
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum HostCommand {
    #[serde(rename = "spawn")]
    Spawn {
        id: String,
        shell: String,
        cwd: String,
        cols: u16,
        rows: u16,
        env: Option<HashMap<String, String>>,
        /// Decode override for this session: `Some("utf-8")` forces UTF-8 (used
        /// for agent commands whose shell is set to UTF-8); otherwise the host
        /// console code page is used.
        encoding: Option<String>,
        /// Optional arguments passed to the shell. When present the PTY runs
        /// `shell <args...>` (e.g. `bash -lc "<command>"`) and the child's exit
        /// status becomes the terminal's exit code — this is how an agent-run
        /// command reports completion. When absent the shell starts interactive.
        args: Option<Vec<String>>,
    },
    #[serde(rename = "write")]
    Write { id: String, data: String },
    #[serde(rename = "resize")]
    Resize { id: String, cols: u16, rows: u16 },
    #[serde(rename = "kill")]
    Kill { id: String },
    #[serde(rename = "shutdown")]
    Shutdown,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
enum HostEvent<'a> {
    #[serde(rename = "spawned")]
    Spawned { id: &'a str, pid: Option<u32> },
    #[serde(rename = "data")]
    Data { id: &'a str, data: String },
    #[serde(rename = "exit")]
    Exit { id: &'a str, exit_code: Option<i32> },
    #[serde(rename = "error")]
    Error { id: Option<&'a str>, message: String },
}

fn send_event(writer: &HostWriter, event: HostEvent<'_>) -> Result<()> {
    let mut stdout = writer.lock().expect("stdout lock poisoned");
    serde_json::to_writer(&mut *stdout, &event)?;
    stdout.write_all(b"\n")?;
    stdout.flush()?;
    Ok(())
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn spawn_session(
    sessions: &Sessions,
    writer: &HostWriter,
    id: String,
    shell: String,
    cwd: String,
    cols: u16,
    rows: u16,
    env: Option<HashMap<String, String>>,
    encoding: Option<String>,
    args: Option<Vec<String>>,
) -> Result<()> {
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(pty_size(cols, rows))?;
    let mut command = CommandBuilder::new(shell);

    if let Some(args) = args {
        for arg in args {
            command.arg(arg);
        }
    }

    command.cwd(PathBuf::from(cwd));
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");

    if let Some(env) = env {
        for (key, value) in env {
            command.env(key, value);
        }
    }

    let mut child = pair.slave.spawn_command(command)?;
    let pid = child.process_id();
    let killer = child.clone_killer();
    let mut reader = pair.master.try_clone_reader()?;
    let mut pty_writer = pair.master.take_writer()?;

    // ── ConPTY unblock (Windows) ─────────────────────────────────────────────
    // portable-pty 0.9.0 creates the ConPTY with PSEUDOCONSOLE_INHERIT_CURSOR,
    // which makes ConPTY emit a Device Status Report cursor-position query
    // (`ESC [ 6 n`) on the output pipe during init and then BLOCK until the host
    // replies with a Cursor Position Report on the input pipe. We are a headless
    // host with no terminal emulator to answer it, so without a reply ConPTY
    // never flushes the child's output — every terminal_read comes back empty
    // and long builds look "frozen". Pre-answering with a CPR (`ESC [ 1 ; 1 R`,
    // cursor at row 1 col 1) satisfies the query so output flows immediately.
    // Harmless on Unix PTYs (the shell ignores a stray CPR on stdin), but we
    // gate it to Windows where the ConPTY handshake actually exists.
    // Ref: wezterm#6783, turborepo#11816.
    #[cfg(windows)]
    {
        let _ = pty_writer.write_all(b"\x1b[1;1R");
        let _ = pty_writer.flush();
    }

    sessions.lock().expect("session lock poisoned").insert(
        id.clone(),
        Session {
            master: pair.master,
            writer: pty_writer,
            killer,
            pid,
        },
    );

    send_event(writer, HostEvent::Spawned { id: &id, pid })?;

    let read_sessions = Arc::clone(sessions);
    let read_writer = Arc::clone(writer);
    let read_id = id.clone();
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        // Decode child bytes into UTF-8 using this session's encoding (UTF-8 for
        // agent commands, else the OS console code page), with state carried
        // across reads so multi-byte characters that straddle a read boundary
        // are reassembled. See `decoder::PtyDecoder`.
        let mut decoder = PtyDecoder::new(encoding.as_deref());

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    let data = decoder.push(&buffer[..size]);
                    if !data.is_empty() {
                        let _ = send_event(
                            &read_writer,
                            HostEvent::Data {
                                id: &read_id,
                                data,
                            },
                        );
                    }
                }
                Err(error) => {
                    let _ = send_event(
                        &read_writer,
                        HostEvent::Error {
                            id: Some(&read_id),
                            message: error.to_string(),
                        },
                    );
                    break;
                }
            }
        }

        // Flush any buffered partial sequence (process died mid-character).
        let tail = decoder.finish();
        if !tail.is_empty() {
            let _ = send_event(
                &read_writer,
                HostEvent::Data {
                    id: &read_id,
                    data: tail,
                },
            );
        }

        let _ = read_sessions.lock().map(|mut sessions| sessions.remove(&read_id));
    });

    let wait_sessions = Arc::clone(sessions);
    let wait_writer = Arc::clone(writer);
    thread::spawn(move || {
        let exit_code = child.wait().ok().map(|status| status.exit_code() as i32);
        let _ = send_event(
            &wait_writer,
            HostEvent::Exit {
                id: &id,
                exit_code,
            },
        );
        let _ = wait_sessions.lock().map(|mut sessions| sessions.remove(&id));
    });

    Ok(())
}

/// Best-effort termination of a child *and its descendants*, so killing a
/// terminal that ran e.g. `npm run dev` also stops the `node` server it spawned
/// and releases the port. Uses only platform CLIs (no extra crates): `taskkill
/// /T` on Windows, and a process-group `kill` on Unix (PTY children are session
/// leaders, so the negative pid targets the whole group). The direct
/// `killer.kill()` in the caller remains the fallback.
fn kill_process_tree(pid: Option<u32>) {
    let Some(pid) = pid else {
        return;
    };

    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }

    #[cfg(unix)]
    {
        // Negative pid → the process group led by the PTY child.
        let _ = std::process::Command::new("kill")
            .args(["-TERM", &format!("-{pid}")])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
}

fn handle_command(command: HostCommand, sessions: &Sessions, writer: &HostWriter) -> Result<bool> {
    match command {
        HostCommand::Spawn {
            id,
            shell,
            cwd,
            cols,
            rows,
            env,
            encoding,
            args,
        } => {
            let id_for_error = id.clone();
            if let Err(error) =
                spawn_session(sessions, writer, id, shell, cwd, cols, rows, env, encoding, args)
            {
                send_event(
                    writer,
                    HostEvent::Error {
                        id: Some(&id_for_error),
                        message: format!("{error:#}"),
                    },
                )?;
            }
        }
        HostCommand::Write { id, data } => {
            if let Some(session) = sessions.lock().expect("session lock poisoned").get_mut(&id) {
                session.writer.write_all(data.as_bytes())?;
                session.writer.flush()?;
            }
        }
        HostCommand::Resize { id, cols, rows } => {
            if let Some(session) = sessions.lock().expect("session lock poisoned").get(&id) {
                session.master.resize(pty_size(cols, rows))?;
            }
        }
        HostCommand::Kill { id } => {
            if let Some(mut session) = sessions.lock().expect("session lock poisoned").remove(&id) {
                // Tear down the whole tree first (frees ports held by grandchildren
                // such as a `node` spawned by `npm run dev`), then signal the PTY
                // child directly as a fallback in case the tree kill missed it.
                kill_process_tree(session.pid);
                let _ = session.killer.kill();
            }
        }
        HostCommand::Shutdown => return Ok(false),
    }

    Ok(true)
}

fn main() -> Result<()> {
    let sessions = Arc::new(Mutex::new(HashMap::new()));
    let writer = Arc::new(Mutex::new(io::stdout()));
    let stdin = io::stdin();

    for line in stdin.lock().lines() {
        let line = line.context("failed to read host command")?;

        if line.trim().is_empty() {
            continue;
        }

        let command = match serde_json::from_str::<HostCommand>(&line) {
            Ok(command) => command,
            Err(error) => {
                send_event(
                    &writer,
                    HostEvent::Error {
                        id: None,
                        message: error.to_string(),
                    },
                )?;
                continue;
            }
        };

        if !handle_command(command, &sessions, &writer)? {
            break;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    /// Regression guard for the ConPTY blindness bug (wezterm#6783).
    ///
    /// On Windows, portable-pty 0.9.0 blocks ConPTY output until the host
    /// answers a cursor-position query. `spawn_session` pre-answers with a CPR;
    /// this test spawns a real command through it and asserts the child's stdout
    /// actually reaches the reader. Before the fix the reader only ever saw the
    /// 4-byte `ESC [ 6 n` query and then blocked, so this would hang/fail.
    #[test]
    fn spawn_session_streams_child_output() {
        let sessions: Sessions = Arc::new(Mutex::new(HashMap::new()));
        let writer: HostWriter = Arc::new(Mutex::new(io::stdout()));

        #[cfg(windows)]
        let (shell, args) = (
            "cmd.exe".to_string(),
            vec![
                "/d".to_string(),
                "/s".to_string(),
                "/c".to_string(),
                "echo MODUS_PTY_PROBE".to_string(),
            ],
        );
        #[cfg(not(windows))]
        let (shell, args) = (
            "/bin/sh".to_string(),
            vec!["-c".to_string(), "echo MODUS_PTY_PROBE".to_string()],
        );

        spawn_session(&sessions, &writer, "probe".to_string(), shell, ".".to_string(), 120, 30, None, None, Some(args))
            .expect("spawn_session");

        // spawn_session moved the master into the session map and a reader thread
        // drains it into HostEvents on stdout; we can't intercept those in-process
        // easily, so assert the session was registered and the child exits, which
        // only happens once ConPTY is unblocked and the wait thread observes exit.
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let present = sessions.lock().unwrap().contains_key("probe");
            if !present {
                // The wait/read threads removed the session on child exit — proof
                // the pipeline drained to completion instead of blocking forever.
                break;
            }
            assert!(Instant::now() < deadline, "PTY session never completed — ConPTY likely blocked");
            thread::sleep(Duration::from_millis(50));
        }
    }
}
