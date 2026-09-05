//! Where the desktop app keeps what it has downloaded, and how much of it.
//!
//! The WebView2 profile holds everything the shell has cached — pictures,
//! scripts, and the signed-in session — and until now nothing measured it,
//! bounded it, or let anyone put it somewhere else. On a machine with a small
//! system drive that is the difference between the messenger being welcome and
//! not.
//!
//! Three rules shape this module, and each of them cost something to learn:
//!
//! 1. **A live profile cannot be moved.** WebView2 holds exclusive locks on
//!    files inside it for as long as a window is open, so a relocation is
//!    recorded now and performed at the next launch, before any window exists.
//! 2. **The move must never be a rename.** The session lives in the same
//!    folder, a different drive makes `rename` fail outright, and a half-moved
//!    profile signs the person out. Everything is copied, verified, and only
//!    then is the old copy removed.
//! 3. **A limit is not enforceable directly.** Chromium sizes its own cache, so
//!    the limit is passed to the engine *and* honoured on our side by clearing
//!    the cache directories at launch when they are over budget — the one
//!    moment nothing holds them open.

use std::fs;
use std::io::{self, Read, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};

/// Settings are tiny; anything larger than this is not ours.
const MAX_SETTINGS_FILE_BYTES: u64 = 4096;

/// Below this a cache stops being useful and starts being a stutter.
pub const MIN_CACHE_LIMIT_BYTES: u64 = 128 * 1024 * 1024;
/// Above this the setting stops meaning anything on a normal machine.
pub const MAX_CACHE_LIMIT_BYTES: u64 = 20 * 1024 * 1024 * 1024;
pub const DEFAULT_CACHE_LIMIT_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// Subdirectories of the profile that hold only re-downloadable bytes.
///
/// Deliberately excludes `Local Storage`, `Network` and anything else carrying
/// the session: clearing those signs the person out, which is not what a cache
/// limit is for.
pub const CACHE_SUBDIRECTORIES: &[&str] = &[
    "EBWebView/Default/Cache",
    "EBWebView/Default/Code Cache",
    "EBWebView/Default/GPUCache",
    "EBWebView/Default/DawnGraphiteCache",
    "EBWebView/Default/DawnWebGPUCache",
    "EBWebView/GrShaderCache",
    "EBWebView/ShaderCache",
    "EBWebView/component_crx_cache",
    "EBWebView/Subresource Filter",
];

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StorageSettings {
    /// Where the profile should live. `None` means the default location.
    #[serde(default)]
    pub location: Option<String>,
    /// Recorded when a move is requested and cleared once it has happened.
    #[serde(default)]
    pub pending_location: Option<String>,
    #[serde(default = "default_limit")]
    pub cache_limit_bytes: u64,
}

fn default_limit() -> u64 {
    DEFAULT_CACHE_LIMIT_BYTES
}

impl Default for StorageSettings {
    fn default() -> Self {
        Self {
            location: None,
            pending_location: None,
            cache_limit_bytes: DEFAULT_CACHE_LIMIT_BYTES,
        }
    }
}

impl StorageSettings {
    /// Clamps a requested limit into what is meaningful, rather than refusing.
    pub fn with_limit(mut self, bytes: u64) -> Self {
        self.cache_limit_bytes = bytes.clamp(MIN_CACHE_LIMIT_BYTES, MAX_CACHE_LIMIT_BYTES);
        self
    }
}

pub fn load_settings(path: &Path) -> StorageSettings {
    let Ok(file) = fs::File::open(path) else {
        return StorageSettings::default();
    };
    let Ok(metadata) = file.metadata() else {
        return StorageSettings::default();
    };
    if !metadata.is_file() || metadata.len() > MAX_SETTINGS_FILE_BYTES {
        return StorageSettings::default();
    }

    let mut bytes = Vec::with_capacity(MAX_SETTINGS_FILE_BYTES as usize + 1);
    if file
        .take(MAX_SETTINGS_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .is_err()
        || bytes.len() as u64 > MAX_SETTINGS_FILE_BYTES
    {
        return StorageSettings::default();
    }

    serde_json::from_slice::<StorageSettings>(&bytes)
        .map(|settings| {
            let limit = settings.cache_limit_bytes;
            settings.with_limit(limit)
        })
        .unwrap_or_default()
}

/// Writes settings through a temporary file, as the update channel does.
pub fn store_settings(path: &Path, settings: &StorageSettings) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("json.tmp");
    let _ = fs::remove_file(&temporary);
    let payload = serde_json::to_vec(settings)?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    file.write_all(&payload)?;
    file.sync_all()?;
    drop(file);

    if let Err(error) = crate::updater::replace_file_public(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

/// Bytes under `root`, following no links and swallowing what it cannot read.
///
/// A directory the process cannot open is counted as nothing rather than
/// failing the whole measurement: a size that is slightly low is far more
/// useful than an error where a number should be.
pub fn directory_size(root: &Path) -> u64 {
    fn walk(path: &Path, total: &mut u64, depth: u32) {
        if depth > 32 {
            return;
        }
        let Ok(entries) = fs::read_dir(path) else {
            return;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                walk(&entry.path(), total, depth + 1);
            } else if let Ok(metadata) = entry.metadata() {
                *total = total.saturating_add(metadata.len());
            }
        }
    }

    let mut total = 0;
    walk(root, &mut total, 0);
    total
}

/// The part of the profile that is only cache.
pub fn cache_size(profile: &Path) -> u64 {
    CACHE_SUBDIRECTORIES
        .iter()
        .map(|relative| directory_size(&profile.join(relative)))
        .fold(0u64, |sum, size| sum.saturating_add(size))
}

/// Empties the cache directories. Everything else in the profile is untouched.
pub fn clear_cache(profile: &Path) -> io::Result<u64> {
    let before = cache_size(profile);
    for relative in CACHE_SUBDIRECTORIES {
        let path = profile.join(relative);
        if !path.exists() {
            continue;
        }
        // A directory still held open by a previous run leaves this to the next
        // launch rather than failing the whole clear.
        let _ = fs::remove_dir_all(&path);
    }
    Ok(before.saturating_sub(cache_size(profile)))
}

/// Why a location cannot be used, in the caller's terms.
#[derive(Debug, PartialEq, Eq)]
pub enum LocationProblem {
    NotAbsolute,
    NotADirectory,
    NotWritable,
    InsideCurrentProfile,
    SystemDirectory,
}

impl LocationProblem {
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotAbsolute => "not_absolute",
            Self::NotADirectory => "not_a_directory",
            Self::NotWritable => "not_writable",
            Self::InsideCurrentProfile => "inside_current_profile",
            Self::SystemDirectory => "system_directory",
        }
    }
}

/// Directories the profile has no business being written into.
const FORBIDDEN_PREFIXES: &[&str] = &[
    "c:\\windows",
    "c:\\program files",
    "c:\\program files (x86)",
    "c:\\programdata\\microsoft\\windows",
];

/// Checks a chosen directory before anything is copied into it.
///
/// The write test is real rather than a permissions inspection: a network share
/// or a read-only volume answers correctly only when actually written to.
pub fn validate_location(candidate: &Path, current_profile: &Path) -> Result<(), LocationProblem> {
    if !candidate.is_absolute() {
        return Err(LocationProblem::NotAbsolute);
    }

    let lowered = candidate.to_string_lossy().to_lowercase().replace('/', "\\");
    if FORBIDDEN_PREFIXES
        .iter()
        .any(|prefix| lowered == *prefix || lowered.starts_with(&format!("{prefix}\\")))
    {
        return Err(LocationProblem::SystemDirectory);
    }

    // Moving a profile into itself would copy forever.
    if candidate.starts_with(current_profile) {
        return Err(LocationProblem::InsideCurrentProfile);
    }

    if fs::create_dir_all(candidate).is_err() {
        return Err(LocationProblem::NotWritable);
    }
    if !candidate.is_dir() {
        return Err(LocationProblem::NotADirectory);
    }

    let probe = candidate.join(".letscube-write-probe");
    let written = fs::write(&probe, b"letscube").is_ok();
    let _ = fs::remove_file(&probe);
    if !written {
        return Err(LocationProblem::NotWritable);
    }
    Ok(())
}

/// Copies a directory tree, returning the number of bytes written.
///
/// Never a rename: the destination is frequently on another volume, where
/// `rename` fails outright, and a partial rename of a profile takes the session
/// with it.
pub fn copy_tree(from: &Path, to: &Path) -> io::Result<u64> {
    let mut copied = 0u64;
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        let destination = to.join(entry.file_name());
        if file_type.is_dir() {
            copied = copied.saturating_add(copy_tree(&entry.path(), &destination)?);
        } else {
            copied = copied.saturating_add(fs::copy(entry.path(), &destination)?);
        }
    }
    Ok(copied)
}

/// Whether the destination holds at least what the source did.
///
/// The gate between copying and deleting, and the only thing standing between a
/// half-finished copy and a profile that no longer exists. It is a separate
/// function so that gate can be tested without having to make a real filesystem
/// fail halfway.
pub fn verify_copy(expected: u64, actual: u64) -> io::Result<()> {
    if actual < expected {
        // Leave both copies. The original is still the live one, and a partial
        // destination is evidence rather than something to hide.
        return Err(io::Error::new(
            io::ErrorKind::Other,
            format!("copied {actual} of {expected} bytes"),
        ));
    }
    Ok(())
}

/// Performs a recorded relocation. Only ever called before a window exists.
///
/// Copy, verify by size, and only then remove the original. A failure at any
/// point leaves the original where it was, which is the state the app can still
/// start from.
pub fn apply_pending_move(current: &Path, target: &Path) -> io::Result<()> {
    apply_pending_move_with(current, target, copy_tree)
}

/// The body of a relocation, with the copy handed in.
///
/// The copy is a parameter for exactly one reason: no real filesystem can be
/// made to finish a copy successfully while writing fewer bytes than it was
/// given, so without this seam the step that decides whether the original may
/// be deleted could only be checked by reading the source for it. A test passes
/// a copy that stops short; the application passes `copy_tree`.
fn apply_pending_move_with(
    current: &Path,
    target: &Path,
    copy: impl FnOnce(&Path, &Path) -> io::Result<u64>,
) -> io::Result<()> {
    if !current.exists() {
        fs::create_dir_all(target)?;
        return Ok(());
    }

    let expected = directory_size(current);
    copy(current, target)?;
    verify_copy(expected, directory_size(target))?;
    fs::remove_dir_all(current)?;
    Ok(())
}

/// The browser argument that asks the engine to bound its own cache.
pub fn disk_cache_argument(limit_bytes: u64) -> String {
    let clamped = limit_bytes.clamp(MIN_CACHE_LIMIT_BYTES, MAX_CACHE_LIMIT_BYTES);
    format!("--disk-cache-size={clamped}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn a_limit_is_clamped_rather_than_refused() {
        assert_eq!(
            StorageSettings::default().with_limit(1).cache_limit_bytes,
            MIN_CACHE_LIMIT_BYTES
        );
        assert_eq!(
            StorageSettings::default().with_limit(u64::MAX).cache_limit_bytes,
            MAX_CACHE_LIMIT_BYTES
        );
    }

    #[test]
    fn the_cache_list_never_includes_the_session() {
        // Everything a WebView2 profile keeps that a person would have to sign
        // in again to replace.
        const SIGNS_YOU_OUT: &[&str] = &[
            "local storage",
            "session storage",
            "cookies",
            "network",
            "indexeddb",
            "login data",
            "web data",
            "preferences",
            "local state",
            "webstorage",
        ];
        for entry in CACHE_SUBDIRECTORIES {
            let lowered = entry.to_lowercase();
            for forbidden in SIGNS_YOU_OUT {
                assert!(!lowered.contains(forbidden), "{entry} contains {forbidden}");
            }
        }
    }

    #[test]
    fn a_relative_or_system_location_is_refused() {
        let profile = Path::new("C:\\Users\\x\\AppData\\Local\\ru.letscube.messenger\\p");
        assert_eq!(
            validate_location(Path::new("relative\\path"), profile),
            Err(LocationProblem::NotAbsolute)
        );
        assert_eq!(
            validate_location(Path::new("C:\\Windows\\System32"), profile),
            Err(LocationProblem::SystemDirectory)
        );
        assert_eq!(
            validate_location(&profile.join("inner"), profile),
            Err(LocationProblem::InsideCurrentProfile)
        );
    }

    fn temp_dir(name: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("letscube-storage-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).expect("temp dir");
        base
    }

    fn write(path: &Path, contents: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }

    #[test]
    fn a_move_copies_everything_and_only_then_removes_the_original() {
        // The session lives in the same folder as the cache, so a move that
        // deletes before it has verified signs the person out.
        let base = temp_dir("move");
        let from = base.join("from");
        let to = base.join("to");
        write(&from.join("EBWebView/Default/Local Storage/leveldb/CURRENT"), b"session");
        write(&from.join("EBWebView/Default/Cache/data_1"), &vec![7u8; 4096]);

        let before = directory_size(&from);
        apply_pending_move(&from, &to).expect("move");

        assert!(!from.exists(), "the original is removed once the copy is verified");
        assert_eq!(directory_size(&to), before, "every byte arrived");
        assert_eq!(
            fs::read(to.join("EBWebView/Default/Local Storage/leveldb/CURRENT")).unwrap(),
            b"session",
            "the session came with it"
        );
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_short_copy_is_refused_so_the_original_is_never_deleted() {
        // The step between copying and deleting. If it ever stops looking, a
        // move that ran out of disk takes the profile — and the session — with
        // it.
        assert!(verify_copy(1_000, 1_000).is_ok());
        assert!(verify_copy(1_000, 1_001).is_ok(), "a destination may be larger");
        assert!(verify_copy(1_000, 999).is_err(), "one byte short is short");
        assert!(verify_copy(1_000, 0).is_err());
        assert!(verify_copy(0, 0).is_ok(), "an empty profile moves fine");
    }

    #[test]
    fn a_copy_that_stops_short_leaves_the_original_and_its_session_in_place() {
        // `verify_copy` is tested for what it decides, above. This is the other
        // half — that the decision is acted on — and it is exercised rather than
        // read. An earlier version of this test scanned the source for the `?`,
        // which caught that one mutation and nothing else; the seam in
        // `apply_pending_move_with` lets the whole gate be run instead.
        let base = temp_dir("short-copy");
        let from = base.join("from");
        let to = base.join("to");
        write(&from.join("EBWebView/Default/Local Storage/leveldb/CURRENT"), b"session");
        write(&from.join("EBWebView/Default/Cache/data_1"), &vec![7u8; 4096]);

        // A copy that reports success having written everything except the part
        // that matters: a volume that filled, a share that dropped, a copy that
        // lied. This is the shape of failure `verify_copy` exists for.
        let result = apply_pending_move_with(&from, &to, |source, destination| {
            copy_tree(
                &source.join("EBWebView/Default/Cache"),
                &destination.join("EBWebView/Default/Cache"),
            )
        });

        assert!(result.is_err(), "a short copy must be refused, not accepted");
        assert!(from.exists(), "the original profile must survive a short copy");
        assert_eq!(
            fs::read(from.join("EBWebView/Default/Local Storage/leveldb/CURRENT")).unwrap(),
            b"session",
            "and the session inside it with it"
        );
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn the_cache_list_is_exactly_the_nine_directories_it_is_meant_to_be() {
        // An allowlist rather than a set of forbidden words: `Login Data`,
        // `Web Data` and `Preferences` all carry credentials and none of them
        // contains any of the words the test below looks for.
        assert_eq!(
            CACHE_SUBDIRECTORIES,
            &[
                "EBWebView/Default/Cache",
                "EBWebView/Default/Code Cache",
                "EBWebView/Default/GPUCache",
                "EBWebView/Default/DawnGraphiteCache",
                "EBWebView/Default/DawnWebGPUCache",
                "EBWebView/GrShaderCache",
                "EBWebView/ShaderCache",
                "EBWebView/component_crx_cache",
                "EBWebView/Subresource Filter",
            ],
            "adding a directory here empties it at every launch; the addition has to be deliberate"
        );
    }

    #[test]
    fn moving_a_profile_that_does_not_exist_yet_just_makes_the_target() {
        let base = temp_dir("absent");
        let from = base.join("missing");
        let to = base.join("target");
        apply_pending_move(&from, &to).expect("move");
        assert!(to.is_dir());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn clearing_the_cache_leaves_the_session_alone() {
        let base = temp_dir("clear");
        let profile = base.join("profile");
        let session = profile.join("EBWebView/Default/Local Storage/leveldb/CURRENT");
        write(&session, b"session");
        write(&profile.join("EBWebView/Default/Cache/data_1"), &vec![3u8; 8192]);
        write(&profile.join("EBWebView/GrShaderCache/shader"), &vec![3u8; 2048]);

        assert_eq!(cache_size(&profile), 8192 + 2048);
        let freed = clear_cache(&profile).expect("clear");

        assert_eq!(freed, 8192 + 2048, "it reports what it actually reclaimed");
        assert_eq!(cache_size(&profile), 0);
        assert!(session.exists(), "clearing a cache must not sign anyone out");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn settings_survive_a_round_trip_and_a_corrupt_file_is_not_fatal() {
        let base = temp_dir("settings");
        let path = base.join("storage-settings.json");

        let settings = StorageSettings::default().with_limit(512 * 1024 * 1024);
        store_settings(&path, &settings).expect("store");
        assert_eq!(load_settings(&path), settings);

        fs::write(&path, b"{ not json").unwrap();
        assert_eq!(
            load_settings(&path),
            StorageSettings::default(),
            "a damaged file falls back to the defaults rather than refusing to start"
        );
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_directory_size_is_not_defeated_by_depth() {
        let base = temp_dir("depth");
        write(&base.join("a/b/c/d/e/f/file"), &vec![1u8; 100]);
        assert_eq!(directory_size(&base), 100);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn the_disk_cache_argument_carries_the_clamped_limit() {
        assert_eq!(
            disk_cache_argument(0),
            format!("--disk-cache-size={MIN_CACHE_LIMIT_BYTES}")
        );
        assert!(disk_cache_argument(DEFAULT_CACHE_LIMIT_BYTES)
            .ends_with(&DEFAULT_CACHE_LIMIT_BYTES.to_string()));
    }
}
