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

type Sessions = Arc<Mutex<HashMap<String, Session>>>;
type HostWriter = Arc<Mutex<io::Stdout>>;

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
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
) -> Result<()> {
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(pty_size(cols, rows))?;
    let mut command = CommandBuilder::new(shell);

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
    let pty_writer = pair.master.take_writer()?;

    sessions.lock().expect("session lock poisoned").insert(
        id.clone(),
        Session {
            master: pair.master,
            writer: pty_writer,
            killer,
        },
    );

    send_event(writer, HostEvent::Spawned { id: &id, pid })?;

    let read_sessions = Arc::clone(sessions);
    let read_writer = Arc::clone(writer);
    let read_id = id.clone();
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    let data = String::from_utf8_lossy(&buffer[..size]).to_string();
                    let _ = send_event(
                        &read_writer,
                        HostEvent::Data {
                            id: &read_id,
                            data,
                        },
                    );
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

fn handle_command(command: HostCommand, sessions: &Sessions, writer: &HostWriter) -> Result<bool> {
    match command {
        HostCommand::Spawn {
            id,
            shell,
            cwd,
            cols,
            rows,
            env,
        } => {
            let id_for_error = id.clone();
            if let Err(error) = spawn_session(sessions, writer, id, shell, cwd, cols, rows, env) {
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
                session.killer.kill()?;
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
