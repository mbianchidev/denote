use std::{
    collections::BTreeSet,
    fs::{self, File, OpenOptions},
    io::Read,
    path::{Component, Path, PathBuf},
};

use ignore::{
    Match,
    gitignore::{Gitignore, GitignoreBuilder},
};

use crate::{
    error::{AppError, AppResult},
    models::{FileKind, FileNode, ProjectRoot},
};

const MAX_GITIGNORE_BYTES: u64 = 1024 * 1024;

#[derive(Clone)]
struct AvailableProjectRoot<'a> {
    project: &'a ProjectRoot,
    path: PathBuf,
    depth: usize,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ScopeRelation {
    Unrelated,
    Ancestor,
    InScope,
}

pub fn ignored_paths(root: &Path, tree: &[FileNode], project_roots: &[ProjectRoot]) -> Vec<String> {
    let roots = available_project_roots(project_roots);
    let mut ignored = BTreeSet::new();

    for project in &roots {
        let Some(nodes) = project_nodes(tree, project.project.root_path.as_str()) else {
            continue;
        };
        let project_directory = root.join(&project.path);
        let mut matchers = Vec::new();
        if let Some(matcher) = load_gitignore(&project_directory) {
            matchers.push(matcher);
        }
        evaluate_nodes(
            root,
            nodes,
            project.project.id.as_str(),
            &roots,
            &mut matchers,
            &mut ignored,
        );
    }

    ignored.into_iter().collect()
}

pub fn ignored_paths_in_scopes(
    root: &Path,
    tree: &[FileNode],
    project_roots: &[ProjectRoot],
    scope_paths: &[String],
) -> Vec<String> {
    if scope_paths.is_empty() || scope_paths.iter().any(String::is_empty) {
        return ignored_paths(root, tree, project_roots);
    }

    ignored_paths_in_scopes_with(root, tree, project_roots, scope_paths, &mut |_| {})
}

pub fn normalize_scope_paths(scope_paths: Vec<String>) -> AppResult<Vec<String>> {
    let mut normalized = Vec::new();
    let mut seen = BTreeSet::new();

    for scope_path in scope_paths {
        let value = if scope_path.is_empty() {
            String::new()
        } else {
            let candidate = Path::new(&scope_path);
            if candidate.is_absolute() {
                return Err(AppError::InvalidPath(scope_path));
            }
            let mut parts = Vec::new();
            for component in candidate.components() {
                match component {
                    Component::Normal(part)
                        if !part.to_string_lossy().eq_ignore_ascii_case(".denote") =>
                    {
                        parts.push(part.to_string_lossy().into_owned());
                    }
                    _ => return Err(AppError::InvalidPath(scope_path)),
                }
            }
            if parts.is_empty() {
                return Err(AppError::InvalidPath(scope_path));
            }
            parts.join("/")
        };
        if seen.insert(value.clone()) {
            normalized.push(value);
        }
    }

    Ok(normalized)
}

fn available_project_roots(project_roots: &[ProjectRoot]) -> Vec<AvailableProjectRoot<'_>> {
    project_roots
        .iter()
        .filter(|project| project.available)
        .map(|project| {
            let path = PathBuf::from(&project.root_path);
            let depth = path.components().count();
            AvailableProjectRoot {
                project,
                path,
                depth,
            }
        })
        .collect()
}

fn project_nodes<'a>(tree: &'a [FileNode], project_path: &str) -> Option<&'a [FileNode]> {
    if project_path.is_empty() {
        return Some(tree);
    }
    find_node(tree, project_path)
        .filter(|node| node.kind == FileKind::Folder)
        .map(|node| node.children.as_slice())
}

fn find_node<'a>(nodes: &'a [FileNode], path: &str) -> Option<&'a FileNode> {
    for node in nodes {
        if node.path == path {
            return Some(node);
        }
        if path.starts_with(&format!("{}/", node.path))
            && let Some(found) = find_node(&node.children, path)
        {
            return Some(found);
        }
    }
    None
}

fn ignored_paths_in_scopes_with(
    root: &Path,
    tree: &[FileNode],
    project_roots: &[ProjectRoot],
    scope_paths: &[String],
    visit: &mut impl FnMut(&str),
) -> Vec<String> {
    let roots = available_project_roots(project_roots);
    let mut ignored = BTreeSet::new();

    for project in &roots {
        if !project_intersects_scopes(project.project.root_path.as_str(), scope_paths) {
            continue;
        }
        let Some(nodes) = project_nodes(tree, project.project.root_path.as_str()) else {
            continue;
        };
        let project_directory = root.join(&project.path);
        let mut matchers = Vec::new();
        if let Some(matcher) = load_gitignore(&project_directory) {
            matchers.push(matcher);
        }
        evaluate_scoped_nodes(
            root,
            nodes,
            project.project.id.as_str(),
            &roots,
            scope_paths,
            &mut matchers,
            &mut ignored,
            visit,
        );
    }

    ignored.into_iter().collect()
}

fn evaluate_nodes(
    root: &Path,
    nodes: &[FileNode],
    project_id: &str,
    project_roots: &[AvailableProjectRoot<'_>],
    matchers: &mut Vec<Gitignore>,
    ignored: &mut BTreeSet<String>,
) {
    for node in nodes {
        if closest_project_id(&node.path, project_roots) != Some(project_id) {
            continue;
        }

        let is_directory = node.kind == FileKind::Folder;
        let absolute_path = root.join(Path::new(&node.path));
        if path_is_ignored(&absolute_path, is_directory, matchers) {
            ignored.insert(node.path.clone());
            if is_directory {
                mark_owned_descendants_ignored(&node.children, project_id, project_roots, ignored);
            }
            continue;
        }

        if !is_directory || !safe_real_directory(&absolute_path) {
            continue;
        }

        let matcher = load_gitignore(&absolute_path);
        let loaded_matcher = matcher.is_some();
        if let Some(matcher) = matcher {
            matchers.push(matcher);
        }
        evaluate_nodes(
            root,
            &node.children,
            project_id,
            project_roots,
            matchers,
            ignored,
        );
        if loaded_matcher {
            matchers.pop();
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn evaluate_scoped_nodes(
    root: &Path,
    nodes: &[FileNode],
    project_id: &str,
    project_roots: &[AvailableProjectRoot<'_>],
    scope_paths: &[String],
    matchers: &mut Vec<Gitignore>,
    ignored: &mut BTreeSet<String>,
    visit: &mut impl FnMut(&str),
) {
    for node in nodes {
        if closest_project_id(&node.path, project_roots) != Some(project_id) {
            continue;
        }

        let relation = scope_relation(&node.path, scope_paths);
        if relation == ScopeRelation::Unrelated {
            continue;
        }
        visit(&node.path);

        let is_directory = node.kind == FileKind::Folder;
        let absolute_path = root.join(Path::new(&node.path));
        if path_is_ignored(&absolute_path, is_directory, matchers) {
            if relation == ScopeRelation::InScope {
                ignored.insert(node.path.clone());
            }
            if is_directory {
                mark_scoped_owned_descendants_ignored(
                    &node.children,
                    project_id,
                    project_roots,
                    scope_paths,
                    ignored,
                    visit,
                );
            }
            continue;
        }

        if !is_directory || !safe_real_directory(&absolute_path) {
            continue;
        }

        let matcher = load_gitignore(&absolute_path);
        let loaded_matcher = matcher.is_some();
        if let Some(matcher) = matcher {
            matchers.push(matcher);
        }
        evaluate_scoped_nodes(
            root,
            &node.children,
            project_id,
            project_roots,
            scope_paths,
            matchers,
            ignored,
            visit,
        );
        if loaded_matcher {
            matchers.pop();
        }
    }
}

fn mark_owned_descendants_ignored(
    nodes: &[FileNode],
    project_id: &str,
    project_roots: &[AvailableProjectRoot<'_>],
    ignored: &mut BTreeSet<String>,
) {
    for node in nodes {
        if closest_project_id(&node.path, project_roots) != Some(project_id) {
            continue;
        }
        ignored.insert(node.path.clone());
        mark_owned_descendants_ignored(&node.children, project_id, project_roots, ignored);
    }
}

fn mark_scoped_owned_descendants_ignored(
    nodes: &[FileNode],
    project_id: &str,
    project_roots: &[AvailableProjectRoot<'_>],
    scope_paths: &[String],
    ignored: &mut BTreeSet<String>,
    visit: &mut impl FnMut(&str),
) {
    for node in nodes {
        if closest_project_id(&node.path, project_roots) != Some(project_id) {
            continue;
        }

        let relation = scope_relation(&node.path, scope_paths);
        if relation == ScopeRelation::Unrelated {
            continue;
        }
        visit(&node.path);
        if relation == ScopeRelation::InScope {
            ignored.insert(node.path.clone());
        }
        mark_scoped_owned_descendants_ignored(
            &node.children,
            project_id,
            project_roots,
            scope_paths,
            ignored,
            visit,
        );
    }
}

fn project_intersects_scopes(project_path: &str, scope_paths: &[String]) -> bool {
    scope_paths.iter().any(|scope| {
        is_same_or_descendant(scope, project_path) || is_same_or_descendant(project_path, scope)
    })
}

fn scope_relation(path: &str, scope_paths: &[String]) -> ScopeRelation {
    if scope_paths
        .iter()
        .any(|scope| is_same_or_descendant(path, scope))
    {
        ScopeRelation::InScope
    } else if scope_paths
        .iter()
        .any(|scope| is_same_or_descendant(scope, path))
    {
        ScopeRelation::Ancestor
    } else {
        ScopeRelation::Unrelated
    }
}

fn is_same_or_descendant(path: &str, ancestor: &str) -> bool {
    ancestor.is_empty()
        || path == ancestor
        || path
            .strip_prefix(ancestor)
            .is_some_and(|remainder| remainder.starts_with('/'))
}

fn closest_project_id<'a>(
    path: &str,
    project_roots: &'a [AvailableProjectRoot<'a>],
) -> Option<&'a str> {
    project_roots
        .iter()
        .filter(|project| {
            project.project.root_path.is_empty()
                || path == project.project.root_path
                || path.starts_with(&format!("{}/", project.project.root_path))
        })
        .max_by_key(|project| project.depth)
        .map(|project| project.project.id.as_str())
}

fn path_is_ignored(path: &Path, is_directory: bool, matchers: &[Gitignore]) -> bool {
    let mut ignored = false;
    for matcher in matchers {
        match matcher.matched(path, is_directory) {
            Match::Ignore(_) => ignored = true,
            Match::Whitelist(_) => ignored = false,
            Match::None => {}
        }
    }
    ignored
}

fn safe_real_directory(path: &Path) -> bool {
    match fs::symlink_metadata(path) {
        Ok(metadata) => !metadata_is_link(&metadata) && metadata.is_dir(),
        Err(error) => {
            eprintln!(
                "Unable to inspect directory while evaluating .gitignore rules at {}: {error}",
                path.display()
            );
            false
        }
    }
}

fn load_gitignore(directory: &Path) -> Option<Gitignore> {
    load_gitignore_with(directory, |_| {})
}

fn load_gitignore_with(directory: &Path, before_open: impl FnOnce(&Path)) -> Option<Gitignore> {
    let path = directory.join(".gitignore");
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        Err(error) => {
            eprintln!("Unable to inspect .gitignore {}: {error}", path.display());
            return None;
        }
    };
    if metadata_is_link(&metadata) {
        eprintln!("Skipping symlinked .gitignore {}", path.display());
        return None;
    }
    if !metadata.is_file() {
        eprintln!(
            "Skipping .gitignore {} because it is not a regular file",
            path.display()
        );
        return None;
    }
    if metadata.len() > MAX_GITIGNORE_BYTES {
        eprintln!(
            "Skipping oversized .gitignore {} ({} bytes; limit is {} bytes)",
            path.display(),
            metadata.len(),
            MAX_GITIGNORE_BYTES
        );
        return None;
    }

    before_open(&path);
    let file = match open_gitignore_without_following_links(&path) {
        Ok(file) => file,
        Err(error) => {
            eprintln!("Unable to open .gitignore {}: {error}", path.display());
            return None;
        }
    };
    let opened_metadata = match file.metadata() {
        Ok(metadata) => metadata,
        Err(error) => {
            eprintln!(
                "Unable to inspect open .gitignore {}: {error}",
                path.display()
            );
            return None;
        }
    };
    if metadata_is_link(&opened_metadata) || !opened_metadata.is_file() {
        eprintln!(
            "Skipping .gitignore {} because it changed to an unsafe file",
            path.display()
        );
        return None;
    }
    if opened_metadata.len() > MAX_GITIGNORE_BYTES {
        eprintln!(
            "Skipping oversized .gitignore {} ({} bytes; limit is {} bytes)",
            path.display(),
            opened_metadata.len(),
            MAX_GITIGNORE_BYTES
        );
        return None;
    }

    let mut bytes = Vec::new();
    if let Err(error) = file.take(MAX_GITIGNORE_BYTES + 1).read_to_end(&mut bytes) {
        eprintln!("Unable to read .gitignore {}: {error}", path.display());
        return None;
    }
    if bytes.len() as u64 > MAX_GITIGNORE_BYTES {
        eprintln!(
            "Skipping .gitignore {} because it grew beyond the {} byte limit",
            path.display(),
            MAX_GITIGNORE_BYTES
        );
        return None;
    }
    let content = match String::from_utf8(bytes) {
        Ok(content) => content,
        Err(error) => {
            eprintln!("Skipping non-UTF-8 .gitignore {}: {error}", path.display());
            return None;
        }
    };

    let mut builder = GitignoreBuilder::new(directory);
    for (index, line) in content.lines().enumerate() {
        let line = if index == 0 {
            line.trim_start_matches('\u{feff}')
        } else {
            line
        };
        if let Err(error) = builder.add_line(Some(path.clone()), line) {
            eprintln!(
                "Skipping malformed .gitignore rule in {} at line {} ({line:?}): {error}",
                path.display(),
                index + 1
            );
        }
    }
    match builder.build() {
        Ok(matcher) => Some(matcher),
        Err(error) => {
            eprintln!("Skipping malformed .gitignore {}: {error}", path.display());
            None
        }
    }
}

fn open_gitignore_without_following_links(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    options.open(path)
}

fn metadata_is_link(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        return metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    }
    #[cfg(not(windows))]
    false
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    fn folder(path: &str, children: Vec<FileNode>) -> FileNode {
        FileNode {
            path: path.to_string(),
            name: path.rsplit('/').next().unwrap_or(path).to_string(),
            kind: FileKind::Folder,
            children,
            size: 0,
            modified_at: None,
            bookmarked: false,
            pinned: false,
            position: None,
        }
    }

    fn file(path: &str) -> FileNode {
        FileNode {
            path: path.to_string(),
            name: path.rsplit('/').next().unwrap_or(path).to_string(),
            kind: FileKind::File,
            children: Vec::new(),
            size: 0,
            modified_at: None,
            bookmarked: false,
            pinned: false,
            position: None,
        }
    }

    fn project(id: &str, root_path: &str, available: bool, explicit: bool) -> ProjectRoot {
        ProjectRoot {
            id: id.to_string(),
            root_path: root_path.to_string(),
            available,
            explicit,
            workspace_id: (!explicit).then(|| "workspace".to_string()),
        }
    }

    #[test]
    fn supports_root_nested_last_negated_directory_and_anchored_patterns() {
        let directory = tempdir().expect("temp directory");
        let root = directory.path();
        fs::create_dir_all(root.join("src/generated")).expect("generated");
        fs::create_dir_all(root.join("logs")).expect("logs");
        fs::write(
            root.join(".gitignore"),
            "\u{feff}*.tmp\n!important.tmp\n/logs/\nsrc/*.gen\n\\#literal\n\\!literal\n.gitignore\nsrc/.gitignore\n",
        )
        .expect("root ignore");
        fs::write(root.join("src/.gitignore"), "*.gen\n!keep.gen\n").expect("nested ignore");
        let tree = vec![
            file(".gitignore"),
            file("#literal"),
            file("!literal"),
            file("draft.tmp"),
            file("important.tmp"),
            folder(
                "logs",
                vec![file("logs/output.txt"), file("logs/.gitignore")],
            ),
            folder(
                "src",
                vec![
                    file("src/.gitignore"),
                    file("src/data.gen"),
                    file("src/keep.gen"),
                    folder(
                        "src/generated",
                        vec![
                            file("src/generated/deep.gen"),
                            file("src/generated/note.tmp"),
                        ],
                    ),
                ],
            ),
        ];

        let ignored = ignored_paths(root, &tree, &[project("root", "", true, true)]);

        assert_eq!(
            ignored,
            vec![
                "!literal",
                "#literal",
                ".gitignore",
                "draft.tmp",
                "logs",
                "logs/.gitignore",
                "logs/output.txt",
                "src/.gitignore",
                "src/data.gen",
                "src/generated/deep.gen",
                "src/generated/note.tmp",
            ]
        );
    }

    #[test]
    fn resets_rules_at_nested_explicit_and_implicit_project_boundaries() {
        let directory = tempdir().expect("temp directory");
        let root = directory.path();
        fs::create_dir_all(root.join("outer/nested")).expect("nested project");
        fs::create_dir_all(root.join("workspace/child")).expect("implicit project");
        fs::write(root.join("outer/.gitignore"), "*.log\nnested/\n").expect("outer ignore");
        fs::write(root.join("outer/nested/.gitignore"), "*.tmp\n").expect("nested ignore");
        fs::write(root.join("workspace/child/.gitignore"), "*.cache\n").expect("child ignore");
        let tree = vec![
            folder(
                "outer",
                vec![
                    file("outer/outer.log"),
                    folder(
                        "outer/nested",
                        vec![
                            file("outer/nested/kept.log"),
                            file("outer/nested/ignored.tmp"),
                        ],
                    ),
                ],
            ),
            folder(
                "workspace",
                vec![folder(
                    "workspace/child",
                    vec![file("workspace/child/data.cache")],
                )],
            ),
        ];

        let ignored = ignored_paths(
            root,
            &tree,
            &[
                project("outer", "outer", true, true),
                project("nested", "outer/nested", true, true),
                project("implicit", "workspace/child", true, false),
            ],
        );

        assert_eq!(
            ignored,
            vec![
                "outer/nested/ignored.tmp",
                "outer/outer.log",
                "workspace/child/data.cache",
            ]
        );
    }

    #[test]
    fn unavailable_roots_and_workspace_markers_do_not_contribute_rules() {
        let directory = tempdir().expect("temp directory");
        let root = directory.path();
        fs::create_dir_all(root.join("available")).expect("available");
        fs::create_dir_all(root.join("container")).expect("container");
        fs::write(root.join("available/.gitignore"), "*.tmp\n").expect("available ignore");
        fs::write(root.join("container/.gitignore"), "*.tmp\n").expect("workspace ignore");
        let tree = vec![
            folder("available", vec![file("available/ignored.tmp")]),
            folder("container", vec![file("container/kept.tmp")]),
        ];

        let ignored = ignored_paths(
            root,
            &tree,
            &[
                project("available", "available", true, true),
                project("missing", "missing", false, true),
            ],
        );

        assert_eq!(ignored, vec!["available/ignored.tmp"]);
    }

    #[test]
    fn ignored_parent_stops_nested_reinclude_and_ignore_loading() {
        let directory = tempdir().expect("temp directory");
        let root = directory.path();
        fs::create_dir_all(root.join("build/deep")).expect("deep");
        fs::write(root.join(".gitignore"), "build/\n!build/deep/keep.txt\n").expect("root ignore");
        fs::write(root.join("build/.gitignore"), "!deep/keep.txt\n").expect("nested ignore");
        let tree = vec![folder(
            "build",
            vec![folder(
                "build/deep",
                vec![file("build/deep/keep.txt"), file("build/deep/drop.txt")],
            )],
        )];

        let ignored = ignored_paths(root, &tree, &[project("root", "", true, true)]);

        assert_eq!(
            ignored,
            vec![
                "build",
                "build/deep",
                "build/deep/drop.txt",
                "build/deep/keep.txt"
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn skips_symlinked_ignore_files_and_does_not_enter_symlinked_folders() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().expect("temp directory");
        let root = directory.path();
        let external = root.join("external-ignore");
        fs::write(&external, "*.tmp\n").expect("external ignore");
        symlink(&external, root.join(".gitignore")).expect("ignore symlink");
        let target = root.join("target");
        fs::create_dir_all(&target).expect("target");
        fs::write(target.join(".gitignore"), "*.tmp\n").expect("target ignore");
        symlink(&target, root.join("linked")).expect("folder symlink");
        let tree = vec![
            file("kept.tmp"),
            folder("linked", vec![file("linked/also-kept.tmp")]),
        ];

        let ignored = ignored_paths(root, &tree, &[project("root", "", true, true)]);

        assert!(ignored.is_empty());
    }

    #[test]
    fn invalid_oversized_and_deleted_files_fail_open() {
        let directory = tempdir().expect("temp directory");
        let root = directory.path();
        let ignore_path = root.join(".gitignore");

        fs::write(&ignore_path, [0xff, 0xfe]).expect("invalid utf8");
        assert!(load_gitignore(root).is_none());

        fs::write(&ignore_path, vec![b'x'; (MAX_GITIGNORE_BYTES + 1) as usize]).expect("oversized");
        assert!(load_gitignore(root).is_none());

        fs::write(&ignore_path, "*.tmp\n").expect("deletion race");
        assert!(
            load_gitignore_with(root, |path| fs::remove_file(path).expect("delete ignore"))
                .is_none()
        );
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_ignore_file_fails_open() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempdir().expect("temp directory");
        let path = directory.path().join(".gitignore");
        fs::write(&path, "*.tmp\n").expect("ignore");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).expect("permissions");
        let loaded = load_gitignore(directory.path());
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).expect("restore permissions");

        assert!(loaded.is_none());
    }

    #[test]
    fn malformed_rules_do_not_discard_valid_rules_from_the_same_file() {
        let directory = tempdir().expect("temp directory");
        let root = directory.path();
        fs::write(root.join(".gitignore"), "*.tmp\n[z-a]\n*.log\n").expect("ignore");
        let tree = vec![file("before.tmp"), file("kept.txt"), file("after.log")];

        let ignored = ignored_paths(root, &tree, &[project("root", "", true, true)]);

        assert_eq!(ignored, vec!["after.log", "before.tmp"]);
    }

    #[test]
    fn scoped_traversal_loads_ancestor_rules_and_skips_unrelated_subtrees() {
        let directory = tempdir().expect("temp directory");
        let root = directory.path();
        fs::create_dir_all(root.join("app/deep")).expect("scoped directory");
        fs::create_dir_all(root.join("other/deep")).expect("unrelated directory");
        fs::write(root.join("app/.gitignore"), "*.tmp\n").expect("app ignore");
        fs::write(root.join("app/deep/.gitignore"), "*.log\n").expect("deep ignore");
        fs::write(root.join("other/.gitignore"), "*\n").expect("unrelated ignore");
        let tree = vec![
            folder(
                "app",
                vec![folder(
                    "app/deep",
                    vec![file("app/deep/a.tmp"), file("app/deep/b.log")],
                )],
            ),
            folder(
                "other",
                vec![folder(
                    "other/deep",
                    vec![file("other/deep/not-visited.tmp")],
                )],
            ),
        ];
        let scopes = vec!["app/deep".to_string()];
        let mut visited = Vec::new();

        let ignored = ignored_paths_in_scopes_with(
            root,
            &tree,
            &[
                project("app", "app", true, true),
                project("other", "other", true, true),
            ],
            &scopes,
            &mut |path| visited.push(path.to_string()),
        );

        assert_eq!(ignored, vec!["app/deep/a.tmp", "app/deep/b.log"]);
        assert_eq!(
            visited,
            vec!["app/deep", "app/deep/a.tmp", "app/deep/b.log"]
        );
    }

    #[test]
    fn scoped_traversal_respects_ignored_ancestors_and_nested_project_boundaries() {
        let directory = tempdir().expect("temp directory");
        let root = directory.path();
        fs::create_dir_all(root.join("build/deep")).expect("ignored directory");
        fs::create_dir_all(root.join("outer/deep")).expect("outer directory");
        fs::create_dir_all(root.join("outer/nested/deep")).expect("nested project");
        fs::write(root.join(".gitignore"), "build/\n").expect("root ignore");
        fs::write(root.join("outer/.gitignore"), "*.tmp\n").expect("outer ignore");
        fs::write(root.join("outer/nested/.gitignore"), "*.cache\n").expect("nested ignore");
        let tree = vec![
            folder(
                "build",
                vec![
                    folder("build/deep", vec![file("build/deep/ignored.txt")]),
                    folder("build/unrelated", vec![file("build/unrelated/skipped.txt")]),
                ],
            ),
            folder(
                "outer",
                vec![
                    folder("outer/deep", vec![file("outer/deep/ignored.tmp")]),
                    folder(
                        "outer/nested",
                        vec![folder(
                            "outer/nested/deep",
                            vec![
                                file("outer/nested/deep/kept.tmp"),
                                file("outer/nested/deep/ignored.cache"),
                            ],
                        )],
                    ),
                ],
            ),
        ];
        let scopes = vec![
            "build/deep".to_string(),
            "outer/deep".to_string(),
            "outer/nested/deep".to_string(),
        ];

        let ignored = ignored_paths_in_scopes(
            root,
            &tree,
            &[
                project("root", "", true, true),
                project("outer", "outer", true, true),
                project("nested", "outer/nested", true, true),
            ],
            &scopes,
        );

        assert_eq!(
            ignored,
            vec![
                "build/deep",
                "build/deep/ignored.txt",
                "outer/deep/ignored.tmp",
                "outer/nested/deep/ignored.cache",
            ]
        );
    }

    #[test]
    fn empty_scope_entry_requests_the_full_tree() {
        let directory = tempdir().expect("temp directory");
        let root = directory.path();
        fs::create_dir(root.join("deep")).expect("deep directory");
        fs::write(root.join(".gitignore"), "*.tmp\n").expect("ignore");
        let tree = vec![file("one.tmp"), folder("deep", vec![file("deep/two.tmp")])];
        let projects = [project("root", "", true, true)];

        assert_eq!(
            ignored_paths_in_scopes(root, &tree, &projects, &["".to_string()]),
            ignored_paths(root, &tree, &projects)
        );
    }
}
