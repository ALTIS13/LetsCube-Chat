//! Starting LETSCUBE when Windows signs the person in, and deciding whether
//! that launch opens a window or waits in the tray.
//!
//! A closed application cannot ring for an incoming call and should not — the
//! desktop clients people compare us to behave the same way. The answer is not
//! to apologise for it in the interface; it is to let the application be
//! running. Windows is the one shell in this product that can both ring and
//! *stop* ringing, because `RemoveGroupedTagWithId` retracts a toast, so a
//! running Windows client is worth more here than anywhere else.
//!
//! The mechanism is one string value under
//! `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` whose data is the
//! command line Windows runs at sign-in. Two measured facts decided the shape
//! of this module, and both are reasons not to use the obvious dependency.
//!
//! **`tauri-plugin-autostart` does not fit, and its backend has a defect.**
//! The plugin fixes the launch arguments at `init` time — `Builder::args` is
//! read once inside the plugin's own `setup` — so "start minimised", which is
//! an argument on that command line and nothing else, cannot be turned on and
//! off while the application runs. Its `auto-launch` 0.5.0 backend also writes
//! the value as `format!("{} {}", app_path, args.join(" "))` with the program
//! path **unquoted** (`auto-launch-0.5.0/src/windows.rs`), while the NSIS
//! installer here is `installMode: currentUser` and puts the client under
//! `%LOCALAPPDATA%`. Any account whose Windows user name contains a space —
//! `C:\Users\Ivan Petrov\AppData\Local\LETSCUBE\LETSCUBE.exe` — therefore gets
//! a command line Windows truncates at the space. This module quotes, and
//! refuses a path it cannot quote.
//!
//! **The state is read, never assumed.** Windows keeps a second opinion in
//! `...\Explorer\StartupApproved\Run`: that is the switch behind Task Manager's
//! "Startup apps" tab, and when it says no, the `Run` value is present and
//! simply never runs. A setting that reported "on" from its own last write
//! would be a lie in exactly that case, and in the case of a person who removed
//! the value with any of a dozen Windows tools. So every answer this module
//! gives is derived from what is on disk at the moment it is asked, and the
//! command that writes re-reads before it returns.
//!
//! `winreg` is named directly in `Cargo.toml` for the same reason `sha2` is:
//! it is already in the lock file — `reqwest`'s `system-proxy` feature pulls it
//! on Windows — so naming it adds no new code to the build.

use serde::Serialize;

/// Marks a launch as the one Windows performed at sign-in.
///
/// Not part of the decision to start hidden — that is `START_MINIMIZED_FLAG`
/// alone, so a shortcut can ask for a hidden start too. This flag is how the
/// reader recognises an entry this build wrote, which is what separates "the
/// person turned it on here" from "something else put a LETSCUBE entry there".
pub const AUTOSTART_FLAG: &str = "--autostart";

/// Asks a launch to stay in the tray instead of opening a window.
pub const START_MINIMIZED_FLAG: &str = "--start-minimized";

/// The command line Windows runs at sign-in.
pub const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

/// Task Manager's "Startup apps" switch. An entry disabled there keeps its
/// `Run` value and never runs.
pub const APPROVED_KEY: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

const SHIPPED_RUN_VALUE_NAME: &str = "LETSCUBE";

/// A debug build never writes the shipped name.
///
/// This deliberately diverges from `windows_app_id()`, which suffixes only
/// under the QA isolation flag because it has to *match* the installed
/// client's shortcuts to be useful at all. A registry write has the opposite
/// requirement: `cargo tauri dev` writing `LETSCUBE` would point the installed
/// client's own sign-in entry at `target\debug`, and it would stay pointed
/// there after the developer closed the debug build. So the divergence is the
/// point, and it is not conditional on anything a run can forget to set.
const DEV_RUN_VALUE_NAME: &str = "LETSCUBE (dev)";

/// The twelve bytes Windows writes for an entry the person has left enabled.
/// A disabled entry carries a set low bit and an eight-byte FILETIME of when it
/// was switched off, which is why the read below looks at the trailing eight.
const APPROVED_ENABLED: [u8; 12] = [0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

/// Longer than any command line Windows will run, and bounded on purpose: this
/// string is parsed and its program half can reach the settings panel.
const MAX_RUN_VALUE_LEN: usize = 8 * 1024;

/// What the registry says right now — never what the application last wrote.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct AutostartState {
    /// Windows will start LETSCUBE at the next sign-in.
    pub enabled: bool,
    /// That launch carries `--start-minimized`.
    pub start_minimized: bool,
    /// A `Run` value under our name exists, whatever it points at.
    pub entry_present: bool,
    /// Its program is this executable.
    pub entry_matches_install: bool,
    /// The value is there and Task Manager has switched it off.
    pub blocked_by_windows: bool,
}

/// The two halves of a `Run` command line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RunEntry<'a> {
    pub program: &'a str,
    pub arguments: &'a str,
}

/// Splits a `Run` value into the program and the rest.
///
/// Our own entries are always quoted, so the quoted branch is the one that
/// matters. The unquoted branch exists because other writers — `auto-launch`
/// among them — do not quote, and Windows itself then stops the program name at
/// the first space. Reproducing that rule rather than guessing is what makes an
/// unquoted entry over a spaced path read as *not ours*, which is the correct
/// answer: it is an entry that does not work.
pub fn split_run_command_line(value: &str) -> RunEntry<'_> {
    let trimmed = value.trim();
    if let Some(rest) = trimmed.strip_prefix('"') {
        return match rest.split_once('"') {
            Some((program, arguments)) => RunEntry {
                program,
                arguments: arguments.trim(),
            },
            // An opening quote with no closing one is not a command line
            // Windows can run; nothing of it is a program name.
            None => RunEntry {
                program: "",
                arguments: "",
            },
        };
    }
    match trimmed.split_once(' ') {
        Some((program, arguments)) => RunEntry {
            program,
            arguments: arguments.trim(),
        },
        None => RunEntry {
            program: trimmed,
            arguments: "",
        },
    }
}

/// Whether a whitespace-separated argument list carries `flag`.
pub fn has_flag(arguments: &str, flag: &str) -> bool {
    arguments.split_whitespace().any(|argument| argument == flag)
}

/// Whether two Windows paths name the same file as far as a string can tell.
///
/// Case-insensitive, and `/` is folded to `\` because Windows accepts both.
/// This is not a canonicalisation — it cannot see through a junction or an
/// 8.3 name — and it is not asked to be: a mismatch only downgrades the entry
/// to "points somewhere else", which the panel reports and the next enable
/// corrects.
pub fn paths_equal(left: &str, right: &str) -> bool {
    let normalize = |value: &str| {
        value
            .trim()
            .replace('/', "\\")
            .to_lowercase()
            .trim_end_matches('\\')
            .to_owned()
    };
    !left.trim().is_empty() && normalize(left) == normalize(right)
}

/// The command line to register, or why it cannot be built.
///
/// A Windows file name cannot contain `"`, so a path that does is either not a
/// path or something we have no business quoting. Refusing beats writing a
/// command line that would be re-parsed into a different program.
pub fn format_run_command_line(
    executable: &str,
    start_minimized: bool,
) -> Result<String, &'static str> {
    let path = executable.trim();
    if path.is_empty() || path.contains('"') {
        return Err("autostart_path_unsupported");
    }
    let mut command = format!("\"{path}\" {AUTOSTART_FLAG}");
    if start_minimized {
        command.push(' ');
        command.push_str(START_MINIMIZED_FLAG);
    }
    if command.len() > MAX_RUN_VALUE_LEN {
        return Err("autostart_path_unsupported");
    }
    Ok(command)
}

/// Whether Task Manager's record permits this entry to run.
///
/// The blob is a leading state byte followed by an eight-byte FILETIME of when
/// the person switched the entry off. The state byte carries the answer in its
/// low bit — `0x02`/`0x06` enabled, `0x03`/`0x07` disabled — and the timestamp
/// is a record of *when*, not of *whether*.
///
/// **`auto-launch` reads the timestamp instead**, calling an entry enabled
/// whenever its trailing eight bytes are zero, and that is wrong. Measured on
/// this workstation, over the 23 entries a real profile had accumulated:
///
/// | blob | count |
/// |---|---|
/// | `0x02`, zero tail | 13 |
/// | `0x03`, non-zero tail | 9 |
/// | **`0x03`, zero tail** | **1** |
///
/// The last row is the disagreement, and it is not hypothetical — it is one of
/// this machine's own startup entries, disabled with no switch-off time
/// recorded. The timestamp rule reports it as enabled. The state byte does not.
///
/// A blob of an unexpected length is an opinion we cannot read, and an
/// unreadable opinion must not become "blocked": that would report a person's
/// autostart as broken on the strength of a byte pattern we did not recognise.
pub fn approval_permits_start(bytes: &[u8]) -> bool {
    match bytes.first() {
        Some(state) if bytes.len() >= 12 => state & 0x01 == 0,
        _ => true,
    }
}

/// Whether this launch should stay in the tray.
///
/// Reads the flag and nothing else. `--autostart` is deliberately not required:
/// a person who puts `--start-minimized` on a shortcut of their own means it,
/// and tying the behaviour to the marker would make a hand-made shortcut behave
/// differently from the registered one for no reason anybody could see.
pub fn launch_starts_hidden<S: AsRef<str>>(arguments: &[S]) -> bool {
    arguments
        .iter()
        .any(|argument| argument.as_ref() == START_MINIMIZED_FLAG)
}

/// Everything the panel is told, derived from the two registry values.
///
/// `run_value` is `None` when no value under our name exists, and `approval` is
/// `None` when Task Manager has never recorded an opinion — which is the
/// ordinary case on a machine where nobody has opened that tab.
pub fn resolve_state(
    run_value: Option<&str>,
    approval: Option<&[u8]>,
    executable: &str,
) -> AutostartState {
    let Some(value) = run_value else {
        return AutostartState::default();
    };
    let entry = split_run_command_line(value);
    let permitted = approval.map(approval_permits_start).unwrap_or(true);
    let matches_install = paths_equal(entry.program, executable);
    AutostartState {
        enabled: permitted,
        // Only an entry we recognise can be asked what it will do. A foreign or
        // truncated command line is reported as "not minimised" rather than
        // guessed at, and the panel says the entry points elsewhere.
        start_minimized: matches_install
            && has_flag(entry.arguments, AUTOSTART_FLAG)
            && has_flag(entry.arguments, START_MINIMIZED_FLAG),
        entry_present: true,
        entry_matches_install: matches_install,
        blocked_by_windows: !permitted,
    }
}

/// The value name this build owns.
///
/// `cfg!` rather than two `#[cfg]` blocks: both names then stay compiled into
/// every build, so the shipped one cannot rot unnoticed behind a debug cursor
/// — which is exactly what it did, as a dead-code warning, in the first draft.
/// The branch is a compile-time constant and folds away.
pub fn run_value_name() -> &'static str {
    if cfg!(debug_assertions) {
        DEV_RUN_VALUE_NAME
    } else {
        SHIPPED_RUN_VALUE_NAME
    }
}

#[cfg(windows)]
mod registry {
    use super::{
        format_run_command_line, resolve_state, run_value_name, AutostartState, APPROVED_ENABLED,
        APPROVED_KEY, MAX_RUN_VALUE_LEN, RUN_KEY,
    };
    use std::io::ErrorKind;
    use winreg::enums::{RegType, HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};
    use winreg::{RegKey, RegValue};

    fn missing(error: &std::io::Error) -> bool {
        error.kind() == ErrorKind::NotFound
    }

    pub fn read_state(executable: &str) -> Result<AutostartState, &'static str> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let name = run_value_name();

        // The Run key itself always exists on a live profile. Failing to open
        // it is "I could not look", which must not be reported as "off".
        let run = hkcu
            .open_subkey_with_flags(RUN_KEY, KEY_READ)
            .map_err(|_| "autostart_unavailable")?;
        let run_value = match run.get_value::<String, _>(name) {
            Ok(value) if value.len() <= MAX_RUN_VALUE_LEN => Some(value),
            // A value too long to be a command line is not one; treat it as a
            // foreign entry rather than parsing it.
            Ok(_) => Some(String::new()),
            Err(error) if missing(&error) => None,
            Err(_) => return Err("autostart_unavailable"),
        };

        // Absent on a profile where nobody has opened Task Manager's Startup
        // tab, which is the common case and means "no objection".
        let approval = hkcu
            .open_subkey_with_flags(APPROVED_KEY, KEY_READ)
            .ok()
            .and_then(|key| key.get_raw_value(name).ok())
            .map(|value| value.bytes);

        Ok(resolve_state(
            run_value.as_deref(),
            approval.as_deref(),
            executable,
        ))
    }

    pub fn write_state(
        executable: &str,
        enabled: bool,
        start_minimized: bool,
    ) -> Result<(), &'static str> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let name = run_value_name();

        if !enabled {
            // Off means no trace: the command line goes, and so does Task
            // Manager's opinion about it, so a later enable cannot inherit a
            // switched-off record written before the value was removed.
            if let Ok(run) = hkcu.open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE) {
                match run.delete_value(name) {
                    Ok(()) => {}
                    Err(error) if missing(&error) => {}
                    Err(_) => return Err("autostart_write_failed"),
                }
            }
            if let Ok(approved) = hkcu.open_subkey_with_flags(APPROVED_KEY, KEY_SET_VALUE) {
                let _ = approved.delete_value(name);
            }
            return Ok(());
        }

        let command = format_run_command_line(executable, start_minimized)?;
        hkcu.open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE)
            .and_then(|run| run.set_value(name, &command))
            .map_err(|_| "autostart_write_failed")?;

        // Clears a switch-off the person made in Task Manager: without this the
        // value would be rewritten and still never run, and the panel would
        // keep reporting blocked immediately after the person turned it on.
        // The key is absent until Windows has cause to create it, and its
        // absence already reads as "no objection", so nothing is created here.
        if let Ok(approved) = hkcu.open_subkey_with_flags(APPROVED_KEY, KEY_SET_VALUE) {
            let _ = approved.set_raw_value(
                name,
                &RegValue {
                    vtype: RegType::REG_BINARY,
                    bytes: APPROVED_ENABLED.to_vec(),
                },
            );
        }
        Ok(())
    }
}

#[cfg(windows)]
pub use registry::{read_state, write_state};

#[cfg(not(windows))]
pub fn read_state(_executable: &str) -> Result<AutostartState, &'static str> {
    Err("autostart_unavailable")
}

#[cfg(not(windows))]
pub fn write_state(
    _executable: &str,
    _enabled: bool,
    _start_minimized: bool,
) -> Result<(), &'static str> {
    Err("autostart_unavailable")
}

/// Drives the real `HKCU` under the debug value name, one step per test, so an
/// outside tool can read the key between the steps.
///
/// `#[ignore]` on purpose: these write to the registry of whoever runs them.
/// They exist because a registry mechanism verified only by the code that wrote
/// it is not verified — the evidence that matters is `reg query` run between
/// these calls, with a control value present in the same listing so that
/// "not found" cannot be mistaken for "the query failed".
///
///   cargo test --lib -- --ignored --exact autostart::live::step_1_enable_plain
#[cfg(all(test, windows))]
mod live {
    use super::*;

    fn executable() -> String {
        std::env::current_exe()
            .unwrap()
            .to_str()
            .unwrap()
            .to_owned()
    }

    #[test]
    #[ignore]
    fn step_1_enable_plain() {
        let exe = executable();
        write_state(&exe, true, false).unwrap();
        let state = read_state(&exe).unwrap();
        assert!(state.enabled);
        assert!(state.entry_present);
        assert!(state.entry_matches_install);
        assert!(!state.start_minimized);
    }

    #[test]
    #[ignore]
    fn step_2_enable_minimized() {
        let exe = executable();
        write_state(&exe, true, true).unwrap();
        let state = read_state(&exe).unwrap();
        assert!(state.enabled);
        assert!(state.start_minimized);
    }

    #[test]
    #[ignore]
    fn step_3_disable() {
        let exe = executable();
        write_state(&exe, false, false).unwrap();
        let state = read_state(&exe).unwrap();
        assert!(!state.enabled);
        assert!(!state.entry_present);
        assert!(!state.start_minimized);
    }

    /// Disabling something that was never enabled is not an error: a person can
    /// remove the value themselves, and the switch has to survive being turned
    /// off twice.
    #[test]
    #[ignore]
    fn step_4_disable_again_is_not_an_error() {
        let exe = executable();
        write_state(&exe, false, false).unwrap();
        write_state(&exe, false, false).unwrap();
        assert!(!read_state(&exe).unwrap().entry_present);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const INSTALLED: &str = r"C:\Users\Ivan Petrov\AppData\Local\LETSCUBE\LETSCUBE.exe";

    /// The defect in `auto-launch`, written as a test rather than as a note:
    /// the installer puts the client under `%LOCALAPPDATA%`, and a great many
    /// Windows accounts have a space in their name.
    #[test]
    fn a_path_with_a_space_survives_being_written_and_read_back() {
        let command = format_run_command_line(INSTALLED, false).unwrap();
        assert!(command.starts_with('"'));
        let entry = split_run_command_line(&command);
        assert_eq!(entry.program, INSTALLED);
        assert!(has_flag(entry.arguments, AUTOSTART_FLAG));
    }

    #[test]
    fn an_unquoted_spaced_entry_is_not_recognised_as_this_install() {
        // Exactly what `auto-launch` would have written.
        let legacy = format!("{INSTALLED} {AUTOSTART_FLAG}");
        let state = resolve_state(Some(&legacy), None, INSTALLED);
        assert!(state.entry_present);
        assert!(!state.entry_matches_install);
        assert!(!state.start_minimized);
    }

    /// The unquoted branch has to stop at the first space the way Windows does,
    /// and a test on a spaced path cannot see that: taking the whole string as
    /// the program name gives the same "not ours" answer for the wrong reason.
    /// A path with no space in it is where the two rules disagree — an entry
    /// another tool wrote unquoted over such a path does run, and is ours.
    ///
    /// Written after the mutation that deleted the split survived the test
    /// above.
    #[test]
    fn an_unquoted_entry_over_a_space_free_path_is_still_recognised() {
        let plain = r"C:\Apps\LETSCUBE.exe";
        let command = format!("{plain} {AUTOSTART_FLAG} {START_MINIMIZED_FLAG}");
        let entry = split_run_command_line(&command);
        assert_eq!(entry.program, plain);
        assert_eq!(
            entry.arguments,
            format!("{AUTOSTART_FLAG} {START_MINIMIZED_FLAG}")
        );

        let state = resolve_state(Some(&command), None, plain);
        assert!(state.entry_matches_install);
        assert!(state.start_minimized);
    }

    /// An opening quote with no closing one is not a command line Windows can
    /// run, so nothing in it is a program name — taking the remainder would
    /// make a broken entry look like ours.
    #[test]
    fn an_unterminated_quote_yields_no_program_at_all() {
        let command = format!("\"{INSTALLED} {AUTOSTART_FLAG}");
        let entry = split_run_command_line(&command);
        assert_eq!(entry.program, "");
        assert_eq!(entry.arguments, "");

        let state = resolve_state(Some(&command), None, INSTALLED);
        assert!(state.entry_present);
        assert!(!state.entry_matches_install);
        assert!(!state.start_minimized);
    }

    #[test]
    fn the_minimised_flag_is_only_written_when_it_was_asked_for() {
        let plain = format_run_command_line(INSTALLED, false).unwrap();
        let hidden = format_run_command_line(INSTALLED, true).unwrap();
        assert!(!has_flag(split_run_command_line(&plain).arguments, START_MINIMIZED_FLAG));
        assert!(has_flag(split_run_command_line(&hidden).arguments, START_MINIMIZED_FLAG));
    }

    #[test]
    fn a_path_that_cannot_be_quoted_is_refused_rather_than_mangled() {
        assert_eq!(
            format_run_command_line(r#"C:\a"b\LETSCUBE.exe"#, false),
            Err("autostart_path_unsupported")
        );
        assert_eq!(
            format_run_command_line("   ", false),
            Err("autostart_path_unsupported")
        );
    }

    #[test]
    fn an_absent_value_is_off_and_nothing_else() {
        let state = resolve_state(None, None, INSTALLED);
        assert_eq!(state, AutostartState::default());
        assert!(!state.enabled);
        assert!(!state.entry_present);
        assert!(!state.blocked_by_windows);
    }

    /// The case the panel exists to tell the truth about: the value is there,
    /// this build wrote it, and Windows will not run it.
    #[test]
    fn task_manager_switching_the_entry_off_is_reported_as_blocked_not_as_on() {
        let command = format_run_command_line(INSTALLED, true).unwrap();
        let disabled = [0x03, 0, 0, 0, 0x2a, 0x7b, 0x11, 0xd4, 0x9c, 0x4e, 0xdc, 0x01];
        let state = resolve_state(Some(&command), Some(&disabled), INSTALLED);

        assert!(state.entry_present);
        assert!(state.entry_matches_install);
        assert!(!state.enabled);
        assert!(state.blocked_by_windows);
        // Still true of the entry; the panel decides how to present it.
        assert!(state.start_minimized);
    }

    #[test]
    fn task_manager_leaving_the_entry_enabled_is_not_blocked() {
        let command = format_run_command_line(INSTALLED, false).unwrap();
        let state = resolve_state(Some(&command), Some(&APPROVED_ENABLED), INSTALLED);
        assert!(state.enabled);
        assert!(!state.blocked_by_windows);
        assert!(!state.start_minimized);
    }

    #[test]
    fn an_approval_blob_we_cannot_read_is_not_turned_into_blocked() {
        assert!(approval_permits_start(&[]));
        assert!(approval_permits_start(&[0x03, 0x00]));
        assert!(!approval_permits_start(&[
            0x03, 0, 0, 0, 0x01, 0, 0, 0, 0, 0, 0, 0
        ]));
    }

    /// The one shape `auto-launch`'s rule gets wrong, taken off a real profile:
    /// disabled, with no switch-off time recorded. Reading the trailing eight
    /// bytes calls this enabled; reading the state byte does not.
    #[test]
    fn a_disabled_entry_with_no_recorded_time_is_still_disabled() {
        let disabled_without_timestamp = [0x03u8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        assert!(disabled_without_timestamp[4..].iter().all(|byte| *byte == 0));
        assert!(!approval_permits_start(&disabled_without_timestamp));

        // And the two enabled state bytes Windows writes are both permitted.
        assert!(approval_permits_start(&APPROVED_ENABLED));
        assert!(approval_permits_start(&[0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
        assert!(!approval_permits_start(&[0x07, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    }

    #[test]
    fn an_entry_pointing_at_another_install_is_not_trusted_for_its_flags() {
        let elsewhere = format_run_command_line(r"D:\Old\LETSCUBE.exe", true).unwrap();
        let state = resolve_state(Some(&elsewhere), None, INSTALLED);
        assert!(state.entry_present);
        assert!(!state.entry_matches_install);
        assert!(!state.start_minimized);
        // Windows would still run *something* at sign-in, so this is not "off".
        assert!(state.enabled);
    }

    #[test]
    fn a_hidden_launch_is_decided_by_the_flag_alone() {
        let plain = ["LETSCUBE.exe".to_owned(), AUTOSTART_FLAG.to_owned()];
        let hidden = [
            "LETSCUBE.exe".to_owned(),
            AUTOSTART_FLAG.to_owned(),
            START_MINIMIZED_FLAG.to_owned(),
        ];
        let shortcut = ["LETSCUBE.exe".to_owned(), START_MINIMIZED_FLAG.to_owned()];

        assert!(!launch_starts_hidden(&plain));
        assert!(launch_starts_hidden(&hidden));
        assert!(launch_starts_hidden(&shortcut));
        assert!(!launch_starts_hidden::<String>(&[]));
    }

    /// A near-match must not pass: `--start-minimized-later` is not the flag,
    /// and neither is the flag as a substring of a path.
    #[test]
    fn a_near_match_is_not_the_flag() {
        assert!(!has_flag("--start-minimized-later", START_MINIMIZED_FLAG));
        assert!(!has_flag("--no-start-minimized", START_MINIMIZED_FLAG));
        assert!(has_flag(" --autostart   --start-minimized ", START_MINIMIZED_FLAG));
    }

    #[test]
    fn paths_compare_the_way_windows_does() {
        assert!(paths_equal(
            r"C:\Users\A\LETSCUBE.EXE",
            r"c:\users\a\letscube.exe"
        ));
        assert!(paths_equal(r"C:/Users/A/LETSCUBE.exe", r"C:\Users\A\LETSCUBE.exe"));
        assert!(!paths_equal("", r"C:\Users\A\LETSCUBE.exe"));
        assert!(!paths_equal(r"C:\Users\B\LETSCUBE.exe", r"C:\Users\A\LETSCUBE.exe"));
    }

    /// A debug build must never write the name the installed client owns.
    #[test]
    fn a_debug_build_owns_a_different_run_value_name() {
        if cfg!(debug_assertions) {
            assert_eq!(run_value_name(), DEV_RUN_VALUE_NAME);
            assert_ne!(run_value_name(), SHIPPED_RUN_VALUE_NAME);
        } else {
            assert_eq!(run_value_name(), SHIPPED_RUN_VALUE_NAME);
        }
    }
}
