use std::path::{Path, PathBuf};

pub(crate) fn without_windows_verbatim_prefix(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let value = path.to_string_lossy();
        if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = value.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
    }
    path.to_path_buf()
}

pub(crate) fn path_for_display(path: &Path) -> String {
    without_windows_verbatim_prefix(path)
        .to_string_lossy()
        .into_owned()
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn removes_windows_verbatim_drive_and_unc_prefixes() {
        assert_eq!(
            without_windows_verbatim_prefix(Path::new(r"\\?\C:\workspace")),
            PathBuf::from(r"C:\workspace")
        );
        assert_eq!(
            without_windows_verbatim_prefix(Path::new(r"\\?\UNC\server\share")),
            PathBuf::from(r"\\server\share")
        );
    }
}
