use std::path::Path;

use crate::error::{AppError, AppResult};

pub(super) struct ToolOutputText {
    utf8: Vec<u8>,
    text: String,
    replacements: Vec<(String, String)>,
    line_bytes: usize,
    line_limit: usize,
}

impl ToolOutputText {
    pub(super) fn new(root: &Path, legacy_process: bool) -> Self {
        let mut replacements = Vec::new();
        if !legacy_process {
            let root = crate::paths::path_for_display(root);
            let slash_root = root.replace('\\', "/");
            let escaped = root.replace('\\', "\\\\").replace('"', "\\\"");
            replacements = vec![
                (format!("{root}/"), String::new()),
                (format!("{root}\\"), String::new()),
                (format!("{escaped}/"), String::new()),
                (format!("{escaped}\\\\"), String::new()),
                (format!("{slash_root}/"), String::new()),
                (slash_root, "[vault]".into()),
                (root, "[vault]".into()),
            ];
            replacements.sort_by(|left, right| right.0.len().cmp(&left.0.len()));
            replacements.dedup();
        }
        Self {
            utf8: Vec::new(),
            text: String::new(),
            replacements,
            line_bytes: 0,
            line_limit: if legacy_process {
                1024 * 1024
            } else {
                64 * 1024
            },
        }
    }

    pub(super) fn push(&mut self, bytes: &[u8]) -> AppResult<String> {
        for byte in bytes {
            if *byte == b'\n' {
                self.line_bytes = 0;
            } else {
                self.line_bytes += 1;
                if self.line_bytes > self.line_limit {
                    return Err(AppError::Plugin(
                        "Tool output line exceeds its approved limit.".into(),
                    ));
                }
            }
        }
        self.utf8.extend_from_slice(bytes);
        self.decode(false);
        Ok(self.redact(false))
    }

    pub(super) fn finish(&mut self) -> String {
        self.decode(true);
        self.redact(true)
    }

    fn decode(&mut self, eof: bool) {
        let mut consumed = 0;
        while consumed < self.utf8.len() {
            match std::str::from_utf8(&self.utf8[consumed..]) {
                Ok(text) => {
                    self.text.push_str(text);
                    consumed = self.utf8.len();
                }
                Err(error) => {
                    let valid_end = consumed + error.valid_up_to();
                    self.text
                        .push_str(&String::from_utf8_lossy(&self.utf8[consumed..valid_end]));
                    consumed = valid_end;
                    match error.error_len() {
                        Some(length) => {
                            self.text.push(char::REPLACEMENT_CHARACTER);
                            consumed += length;
                        }
                        None if eof => {
                            self.text.push(char::REPLACEMENT_CHARACTER);
                            consumed = self.utf8.len();
                        }
                        None => break,
                    }
                }
            }
        }
        self.utf8.drain(..consumed);
    }

    fn redact(&mut self, eof: bool) -> String {
        let mut output = String::new();
        let mut consumed = 0;
        while consumed < self.text.len() {
            let remaining = &self.text[consumed..];
            // A longer path match may be split across reads, including its final separator.
            if !eof
                && self
                    .replacements
                    .iter()
                    .any(|(path, _)| path.starts_with(remaining))
            {
                break;
            }
            if let Some((path, replacement)) = self
                .replacements
                .iter()
                .find(|(path, _)| remaining.starts_with(path))
            {
                output.push_str(replacement);
                consumed += path.len();
            } else if let Some(character) = remaining.chars().next() {
                output.push(character);
                consumed += character.len_utf8();
            }
        }
        self.text.drain(..consumed);
        output
    }
}

pub(super) fn translate_linter_paths(bytes: &[u8], root: &Path) -> AppResult<String> {
    let mut value: serde_json::Value = serde_json::from_slice(bytes).map_err(|error| {
        AppError::Plugin(format!(
            "Linter output is not complete ESLint JSON: {error}"
        ))
    })?;
    let files = value
        .as_array_mut()
        .ok_or_else(|| AppError::Plugin("ESLint JSON must be a file-result array.".into()))?;
    let prefix = format!(
        "{}/",
        crate::paths::path_for_display(root)
            .replace('\\', "/")
            .trim_end_matches('/')
    );
    for file in files {
        let object = file
            .as_object_mut()
            .ok_or_else(|| AppError::Plugin("Invalid ESLint JSON file result.".into()))?;
        let path = object
            .get("filePath")
            .and_then(|path| path.as_str())
            .ok_or_else(|| AppError::Plugin("ESLint JSON file path is missing.".into()))?
            .replace('\\', "/");
        let relative = if path.starts_with(&prefix)
            || (cfg!(windows)
                && path
                    .as_bytes()
                    .get(..prefix.len())
                    .is_some_and(|start| start.eq_ignore_ascii_case(prefix.as_bytes())))
        {
            path[prefix.len()..].to_string()
        } else if path.starts_with('/') || path.as_bytes().get(1) == Some(&b':') {
            String::new()
        } else {
            path
        };
        object.insert("filePath".into(), relative.into());
        object.remove("source");
        object.remove("output");
    }
    serde_json::to_string(&value)
        .map_err(|error| AppError::Plugin(format!("Unable to translate linter paths: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streams_partial_lines_and_keeps_unicode_and_paths_intact_across_every_split() {
        let raw = "Building λ /synthetic/vault/src/example.rs\n";
        for split in 0..=raw.len() {
            let mut output = ToolOutputText::new(Path::new("/synthetic/vault"), false);
            let mut actual = output.push(&raw.as_bytes()[..split]).unwrap();
            actual.push_str(&output.push(&raw.as_bytes()[split..]).unwrap());
            actual.push_str(&output.finish());
            assert_eq!(actual, "Building λ src/example.rs\n", "split {split}");
        }
        let mut output = ToolOutputText::new(Path::new("/synthetic/vault"), false);
        assert_eq!(output.push(b"Building").unwrap(), "Building");
        assert_eq!(output.push(b" /synthetic/").unwrap(), " ");
        assert_eq!(output.push(b"vault/src").unwrap(), "src");
    }

    #[test]
    fn legacy_output_preserves_paths_and_enforces_its_original_line_limit() {
        let mut output = ToolOutputText::new(Path::new("/synthetic/vault"), true);
        assert_eq!(
            output.push(b"/synthetic/vault/example").unwrap(),
            "/synthetic/vault/example"
        );
        assert!(output.push(&vec![b'x'; 100_000]).is_ok());
        assert!(output.push(&vec![b'x'; 1024 * 1024]).is_err());
        let mut bounded = ToolOutputText::new(Path::new("/synthetic/vault"), false);
        assert!(bounded.push(&vec![b'x'; 64 * 1024 + 1]).is_err());
    }
}
