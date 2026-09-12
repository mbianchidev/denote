use std::{ffi::OsStr, io, process::Command};

use command_group::{CommandGroup, GroupChild};

pub(crate) mod askpass;
pub(super) mod auto_commit;
pub(super) mod clone;
pub(super) mod github;
pub(super) mod tools;
mod transport;

#[cfg(test)]
mod auto_commit_tests;
#[cfg(test)]
mod clone_tests;
#[cfg(test)]
mod git_tests;

pub(crate) use transport::*;

pub(crate) fn background_command(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    configure_background_command(&mut command);
    command
}

fn configure_background_command(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = command;
    }
}

pub(crate) fn spawn_background_group(command: &mut Command) -> io::Result<GroupChild> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

        // command-group replaces CommandExt flags with its own suspended flag,
        // so the no-window flag must be supplied through the group builder.
        return command.group().creation_flags(CREATE_NO_WINDOW).spawn();
    }
    #[cfg(not(windows))]
    {
        command.group_spawn()
    }
}
