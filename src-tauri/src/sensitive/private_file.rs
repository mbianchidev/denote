use crate::error::{AppError, AppResult};
use std::fs::File;

pub(super) fn restrict(file: &File) -> AppResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|_| {
                AppError::Io(std::io::Error::other(
                    "Unable to restrict exported file permissions.",
                ))
            })?;
    }
    #[cfg(windows)]
    {
        use std::{os::windows::io::AsRawHandle, ptr};
        use windows_sys::Win32::{
            Foundation::LocalFree,
            Security::Authorization::{
                ConvertStringSecurityDescriptorToSecurityDescriptorW, SE_FILE_OBJECT,
                SetSecurityInfo,
            },
            Security::{
                ACL, DACL_SECURITY_INFORMATION, GetSecurityDescriptorDacl,
                PROTECTED_DACL_SECURITY_INFORMATION,
            },
        };
        let sddl: Vec<u16> = "D:P(A;;FA;;;OW)\0".encode_utf16().collect();
        let mut descriptor = ptr::null_mut();
        let mut dacl: *mut ACL = ptr::null_mut();
        let mut present = 0;
        let mut defaulted = 0;
        // A protected owner-rights DACL is applied before any plaintext is written.
        let result = unsafe {
            if ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                1,
                &mut descriptor,
                ptr::null_mut(),
            ) == 0
            {
                Err(())
            } else {
                let result = if GetSecurityDescriptorDacl(
                    descriptor,
                    &mut present,
                    &mut dacl,
                    &mut defaulted,
                ) == 0
                    || present == 0
                {
                    Err(())
                } else if SetSecurityInfo(
                    file.as_raw_handle(),
                    SE_FILE_OBJECT,
                    DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                    ptr::null_mut(),
                    ptr::null_mut(),
                    dacl,
                    ptr::null_mut(),
                ) != 0
                {
                    Err(())
                } else {
                    Ok(())
                };
                LocalFree(descriptor);
                result
            }
        };
        result.map_err(|_| {
            AppError::Io(std::io::Error::other(
                "Unable to restrict exported file permissions.",
            ))
        })?;
    }
    Ok(())
}
