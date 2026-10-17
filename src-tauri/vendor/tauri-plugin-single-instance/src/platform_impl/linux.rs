// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

#[cfg(feature = "semver")]
use crate::semver_compat::semver_compat_string;

use crate::SingleInstanceCallback;
use tauri::{
    plugin::{self, TauriPlugin},
    AppHandle, Manager, RunEvent, Runtime,
};
use zbus::{interface, names::WellKnownName, Connection};

fn block_on<F, T>(future: F) -> zbus::Result<T>
where
    F: std::future::Future<Output = zbus::Result<T>> + Send,
    T: Send,
{
    // Keep the connection on Tauri's persistent runtime without nesting Tokio.
    std::thread::scope(|scope| {
        std::thread::Builder::new()
            .name("single-instance-dbus".into())
            .spawn_scoped(scope, || tauri::async_runtime::block_on(future))?
            .join()
            .map_err(|_| std::io::Error::other("Single-instance D-Bus worker panicked"))?
    })
}

struct ConnectionHandle(Connection);

struct SingleInstanceDBus<R: Runtime> {
    callback: Box<SingleInstanceCallback<R>>,
    app_handle: AppHandle<R>,
}

#[interface(name = "org.SingleInstance.DBus")]
impl<R: Runtime> SingleInstanceDBus<R> {
    fn execute_callback(&mut self, argv: Vec<String>, cwd: String) {
        (self.callback)(&self.app_handle, argv, cwd);
    }
}

struct DBusName(String);

pub fn init<R: Runtime>(
    callback: Box<SingleInstanceCallback<R>>,
    dbus_id: Option<String>,
) -> TauriPlugin<R> {
    plugin::Builder::new("single-instance")
        .setup(move |app, _api| {
            let mut dbus_name = dbus_id.unwrap_or_else(|| app.config().identifier.clone());
            dbus_name.push_str(".SingleInstance");

            #[cfg(feature = "semver")]
            {
                dbus_name.push('_');
                dbus_name.push_str(semver_compat_string(&app.package_info().version).as_str());
            }

            let mut dbus_path = dbus_name.replace('.', "/").replace('-', "_");
            if !dbus_path.starts_with('/') {
                dbus_path = format!("/{dbus_path}");
            }

            let single_instance_dbus = SingleInstanceDBus {
                callback,
                app_handle: app.clone(),
            };

            match block_on(
                zbus::connection::Builder::session()
                    .name(dbus_name.as_str())
                    .replace_existing_names(false)
                    .allow_name_replacements(false)
                    .serve_at(dbus_path.as_str(), single_instance_dbus)
                    .build(),
            ) {
                Ok(connection) => {
                    app.manage(ConnectionHandle(connection));
                }
                Err(zbus::Error::NameTaken) => {
                    let cwd = std::env::current_dir()?.to_string_lossy().into_owned();
                    block_on(async {
                        let connection = Connection::session().await?;
                        connection
                            .call_method(
                                Some(dbus_name.as_str()),
                                dbus_path.as_str(),
                                Some("org.SingleInstance.DBus"),
                                "ExecuteCallback",
                                &(std::env::args().collect::<Vec<String>>(), cwd),
                            )
                            .await?;
                        Ok(())
                    })?;
                    app.cleanup_before_exit();
                    std::process::exit(0);
                }
                Err(error) => return Err(error.into()),
            }

            app.manage(DBusName(dbus_name));

            Ok(())
        })
        .on_event(move |app, event| {
            if let RunEvent::Exit = event {
                destroy(app);
            }
        })
        .build()
}

pub fn destroy<R: Runtime, M: Manager<R>>(manager: &M) {
    if let Some(connection) = manager.try_state::<ConnectionHandle>() {
        if let Some(dbus_name) = manager
            .try_state::<DBusName>()
            .and_then(|name| WellKnownName::try_from(name.0.clone()).ok())
        {
            if let Err(error) = block_on(connection.0.release_name(dbus_name)) {
                eprintln!("Unable to release the single-instance D-Bus name: {error}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{sync::mpsc, time::Duration};

    use super::*;

    #[test]
    fn linux_backport_keeps_serving_and_releases_ownership() {
        assert_eq!(
            std::env::var("DENOTE_TEST_DBUS").expect("Use an isolated dbus-run-session"),
            "1"
        );
        let id = format!("org.denote.Synthetic{}", std::process::id());
        let name = format!("{id}.SingleInstance");
        let path = format!("/{}", name.replace('.', "/"));
        let (sent, received) = mpsc::channel();
        let app = tauri::test::mock_builder()
            .plugin(init(
                Box::new(move |_, args, cwd| sent.send((args, cwd)).unwrap()),
                Some(id),
            ))
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();

        assert!(matches!(
            block_on(
                zbus::connection::Builder::session()
                    .name(name.as_str())
                    .replace_existing_names(false)
                    .allow_name_replacements(false)
                    .build()
            ),
            Err(zbus::Error::NameTaken)
        ));

        for nested in [false, true] {
            let call = async {
                let connection = Connection::session().await?;
                connection
                    .call_method(
                        Some(name.as_str()),
                        path.as_str(),
                        Some("org.SingleInstance.DBus"),
                        "ExecuteCallback",
                        &(
                            vec!["denote-test", "denote:///synthetic/note.md"],
                            "/synthetic/workspace",
                        ),
                    )
                    .await?;
                Ok(())
            };
            if nested {
                tauri::async_runtime::block_on(async { block_on(call) }).unwrap();
            } else {
                block_on(call).unwrap();
            }
            assert_eq!(
                received.recv_timeout(Duration::from_secs(5)).unwrap(),
                (
                    vec![
                        "denote-test".to_string(),
                        "denote:///synthetic/note.md".to_string()
                    ],
                    "/synthetic/workspace".to_string()
                )
            );
        }

        destroy(app.handle());
        let replacement = block_on(
            zbus::connection::Builder::session()
                .name(name.as_str())
                .replace_existing_names(false)
                .allow_name_replacements(false)
                .build(),
        )
        .unwrap();
        assert!(block_on(replacement.release_name(name.as_str())).unwrap());
    }

    #[test]
    fn linux_backport_propagates_invalid_bus_names() {
        assert!(block_on(
            zbus::connection::Builder::session()
                .name("not-a-bus-name")
                .build()
        )
        .is_err());
    }
}
