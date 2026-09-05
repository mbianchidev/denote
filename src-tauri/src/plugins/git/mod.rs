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
