use std::{fs::File, io, path::Path};

#[cfg(unix)]
pub(super) fn create_new(path: &Path) -> io::Result<File> {
    use std::{fs::OpenOptions, os::unix::fs::OpenOptionsExt};
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
}

#[cfg(windows)]
pub(super) fn create_new(path: &Path) -> io::Result<File> {
    use std::{
        ffi::c_void,
        mem::size_of,
        os::windows::{ffi::OsStrExt, io::FromRawHandle},
        path::{Component, Prefix},
        ptr,
    };
    use windows_sys::Win32::{
        Foundation::{INVALID_HANDLE_VALUE, LocalFree},
        Security::{
            Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW,
            SECURITY_ATTRIBUTES,
        },
        Storage::FileSystem::{
            CREATE_NEW, CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_FLAG_OPEN_REPARSE_POINT,
            FILE_GENERIC_WRITE, FILE_READ_ATTRIBUTES,
        },
    };

    struct Descriptor(*mut c_void);
    impl Drop for Descriptor {
        fn drop(&mut self) {
            unsafe {
                LocalFree(self.0);
            }
        }
    }

    let filename = path.file_name().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "Choose a regular file name.")
    })?;
    let filename = filename.to_string_lossy();
    let stem = filename
        .split_once('.')
        .map_or(filename.as_ref(), |(stem, _)| stem)
        .trim_end_matches(' ')
        .to_ascii_uppercase();
    let device = matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) || ["COM", "LPT"].iter().any(|prefix| {
        stem.strip_prefix(prefix).is_some_and(|suffix| {
            matches!(
                suffix,
                "1" | "2"
                    | "3"
                    | "4"
                    | "5"
                    | "6"
                    | "7"
                    | "8"
                    | "9"
                    | "\u{b9}"
                    | "\u{b2}"
                    | "\u{b3}"
            )
        })
    });
    let device_namespace = matches!(
        path.components().next(),
        Some(Component::Prefix(prefix))
            if matches!(prefix.kind(), Prefix::DeviceNS(_) | Prefix::Verbatim(_))
    );
    if filename.contains(':') || device || device_namespace {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Private transfers require an ordinary file, not a device or alternate stream.",
        ));
    }
    let mut name: Vec<u16> = path.as_os_str().encode_wide().collect();
    if name.contains(&0) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "The transfer filename contains a null character.",
        ));
    }
    name.push(0);
    let sddl: Vec<u16> = "D:P(A;;FA;;;OW)\0".encode_utf16().collect();
    let mut descriptor = ptr::null_mut();
    if unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            1,
            &mut descriptor,
            ptr::null_mut(),
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    let descriptor = Descriptor(descriptor);
    let attributes = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor.0,
        bInheritHandle: 0,
    };
    // Both the protected DACL and exclusive sharing apply at creation, not afterward.
    let handle = unsafe {
        CreateFileW(
            name.as_ptr(),
            FILE_GENERIC_WRITE | FILE_READ_ATTRIBUTES,
            0,
            &attributes,
            CREATE_NEW,
            FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT,
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { File::from_raw_handle(handle) })
}

#[cfg(not(any(unix, windows)))]
pub(super) fn create_new(_path: &Path) -> io::Result<File> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Private file transfers are unavailable on this operating system.",
    ))
}

#[cfg(unix)]
pub(super) fn verify(file: &File) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.permissions().mode() & 0o077 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "The selected filesystem cannot enforce private file permissions.",
        ));
    }
    Ok(())
}

#[cfg(windows)]
pub(super) fn verify(file: &File) -> io::Result<()> {
    use std::{os::windows::io::AsRawHandle, ptr};
    use windows_sys::Win32::{
        Storage::FileSystem::GetVolumeInformationByHandleW,
        System::SystemServices::FILE_PERSISTENT_ACLS,
    };
    if !file.metadata()?.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Private transfers require a regular file.",
        ));
    }
    let mut flags = 0;
    if unsafe {
        GetVolumeInformationByHandleW(
            file.as_raw_handle(),
            ptr::null_mut(),
            0,
            ptr::null_mut(),
            ptr::null_mut(),
            &mut flags,
            ptr::null_mut(),
            0,
        )
    } == 0
    {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            format!(
                "Unable to verify private file permissions on this filesystem: {}.",
                io::Error::last_os_error()
            ),
        ));
    }
    if flags & FILE_PERSISTENT_ACLS == 0 {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "The selected filesystem cannot enforce private file permissions.",
        ));
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
pub(super) fn verify(_file: &File) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Private file transfers are unavailable on this operating system.",
    ))
}

#[cfg(all(test, unix))]
mod unix_tests {
    use super::*;
    use std::{fs, os::unix::fs::PermissionsExt};

    #[test]
    fn private_file_permissions_must_be_enforced_before_writing() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("synthetic-export.txt");
        let file = create_new(&path).unwrap();
        verify(&file).unwrap();
        file.set_permissions(fs::Permissions::from_mode(0o644))
            .unwrap();
        assert_eq!(
            verify(&file).unwrap_err().kind(),
            io::ErrorKind::Unsupported
        );
        assert!(fs::read(path).unwrap().is_empty());
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::{
        fs,
        io::Write,
        os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
        ptr,
    };
    use windows_sys::Win32::{
        Foundation::{ERROR_ACCESS_DENIED, ERROR_SHARING_VIOLATION},
        Security::{
            ImpersonateLoggedOnUser, LOGON32_LOGON_INTERACTIVE, LOGON32_PROVIDER_DEFAULT,
            LogonUserW, RevertToSelf,
        },
    };
    use zeroize::Zeroizing;

    #[test]
    fn windows_private_file_denies_read_handles_until_writing_finishes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("synthetic-export.txt");
        let mut file = create_new(&path).unwrap();
        verify(&file).unwrap();
        assert_eq!(
            File::open(&path).unwrap_err().raw_os_error(),
            Some(ERROR_SHARING_VIOLATION as i32)
        );
        file.write_all(b"invented export bytes").unwrap();
        file.sync_all().unwrap();
        assert!(create_new(&path).is_err());
        drop(file);
        assert_eq!(fs::read(path).unwrap(), b"invented export bytes");
    }

    #[test]
    fn windows_private_files_reject_devices_and_existing_file_streams() {
        let directory = tempfile::tempdir().unwrap();
        let existing = directory.path().join("public-control.txt");
        fs::write(&existing, b"invented existing content").unwrap();
        for name in [
            "public-control.txt:private-stream",
            "NUL.txt",
            "CON",
            "LPT1",
        ] {
            assert_eq!(
                create_new(&directory.path().join(name)).unwrap_err().kind(),
                io::ErrorKind::InvalidInput
            );
        }
        assert_eq!(fs::read(existing).unwrap(), b"invented existing content");
    }

    struct Impersonation;
    impl Drop for Impersonation {
        fn drop(&mut self) {
            if unsafe { RevertToSelf() } == 0 {
                eprintln!("Unable to restore the Windows test identity.");
                std::process::abort();
            }
        }
    }

    fn read_as(token: &OwnedHandle, path: &Path) -> io::Result<Vec<u8>> {
        if unsafe { ImpersonateLoggedOnUser(token.as_raw_handle()) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let _identity = Impersonation;
        fs::read(path)
    }

    #[test]
    #[ignore = "Requires an explicitly provisioned synthetic Windows account and shared fixture"]
    fn windows_private_exports_deny_non_owner_before_and_after_write() {
        let username = std::env::var("DENOTE_EXPORT_TEST_USER").expect("Synthetic Windows account");
        let password = Zeroizing::new(
            std::env::var("DENOTE_EXPORT_TEST_PASSWORD").expect("Synthetic account password"),
        );
        let directory = std::env::var_os("DENOTE_EXPORT_TEST_DIRECTORY")
            .map(std::path::PathBuf::from)
            .expect("Synthetic shared fixture directory");
        let username: Vec<u16> = username.encode_utf16().chain([0]).collect();
        let password = Zeroizing::new(password.encode_utf16().chain([0]).collect::<Vec<u16>>());
        let domain: Vec<u16> = ".\0".encode_utf16().collect();
        let mut token = ptr::null_mut();
        assert_ne!(
            unsafe {
                LogonUserW(
                    username.as_ptr(),
                    domain.as_ptr(),
                    password.as_ptr(),
                    LOGON32_LOGON_INTERACTIVE,
                    LOGON32_PROVIDER_DEFAULT,
                    &mut token,
                )
            },
            0,
            "Unable to log on the synthetic test account: {}",
            io::Error::last_os_error()
        );
        let token = unsafe { OwnedHandle::from_raw_handle(token) };
        let control = directory.join("public-control.txt");
        fs::write(&control, b"invented public control").unwrap();
        assert_eq!(
            read_as(&token, &control).unwrap(),
            b"invented public control"
        );

        let path = directory.join("private-export.txt");
        let mut file = create_new(&path).unwrap();
        verify(&file).unwrap();
        assert!(read_as(&token, &path).is_err());
        file.write_all(b"invented private export").unwrap();
        file.sync_all().unwrap();
        assert!(read_as(&token, &path).is_err());
        drop(file);
        assert_eq!(
            read_as(&token, &path).unwrap_err().raw_os_error(),
            Some(ERROR_ACCESS_DENIED as i32)
        );
        assert_eq!(fs::read(path).unwrap(), b"invented private export");
        assert_eq!(
            read_as(&token, &control).unwrap(),
            b"invented public control"
        );
    }
}
