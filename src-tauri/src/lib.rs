use image::{imageops::FilterType, ImageFormat};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::{
    fs::{self, File, OpenOptions},
    io::{Cursor, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const STATE_FILE_NAME: &str = "state.json";
const DELETED_STACK_FILE_NAME: &str = "deleted-stack.json";
const SEARCH_INDEX_FILE_NAME: &str = "search-index.json";
const NOTES_DIR_NAME: &str = "notes";
const IMAGES_DIR_NAME: &str = "images";
const LEGACY_IMAGES_DIR_NAME: &str = "otternote-assets";
const ATTACHMENT_QUARANTINE_DIR_NAME: &str = ".quarantine";
const PENDING_TRANSACTION_FILE_NAME: &str = ".pending-write.json";
const CURRENT_DATA_VERSION: u32 = 1;
const ATTACHMENT_CLEANUP_DELAY_MS: u64 = 1_500;
const ATTACHMENT_QUARANTINE_RETENTION_MS: u128 = 30 * 24 * 60 * 60 * 1_000;

struct AttachmentCleanupScheduler {
    generation: AtomicU64,
    latest_state: Mutex<Option<String>>,
}

static ATTACHMENT_CLEANUP_SCHEDULER: OnceLock<AttachmentCleanupScheduler> = OnceLock::new();
static STATE_WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Default, Deserialize, Serialize)]
struct StorageConfig {
    storage_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageInfo {
    path: String,
    default_path: String,
    custom_path: Option<String>,
    other_windows: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageAttachmentInfo {
    file_name: String,
    original_file_name: String,
    path: String,
    size: u64,
    modified_at: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeletedSnapshot {
    #[serde(rename = "type")]
    snapshot_type: String,
    #[serde(default)]
    note: Option<Value>,
    #[serde(default)]
    entry: Option<Value>,
    #[serde(default)]
    todo: Option<Value>,
    #[serde(default)]
    entries: Vec<Value>,
    #[serde(default)]
    todos: Vec<Value>,
    #[serde(default)]
    recent_note_ids: Vec<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteBundle {
    #[serde(default = "default_schema_version")]
    schema_version: u32,
    note: Value,
    entries: Vec<Value>,
    todos: Vec<Value>,
}

#[derive(Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchIndexRecord {
    note_id: String,
    title: String,
    updated_at: String,
    search_text: String,
    preview: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct VersionedDeletedStack {
    data_version: u32,
    items: Vec<DeletedSnapshot>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct VersionedSearchIndex {
    data_version: u32,
    records: Vec<SearchIndexRecord>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum DeletedStackFile {
    Versioned(VersionedDeletedStack),
    Legacy(Vec<DeletedSnapshot>),
}

#[derive(Deserialize)]
#[serde(untagged)]
enum SearchIndexFile {
    Versioned(VersionedSearchIndex),
    Legacy(Vec<SearchIndexRecord>),
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingTransaction {
    data_version: u32,
    files: Vec<String>,
    deletions: Vec<String>,
}

struct PendingFileWrite {
    target: PathBuf,
    content: Vec<u8>,
}

fn default_schema_version() -> u32 {
    1
}

fn sanitize_window_label(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect()
}

fn current_millis_label() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_storage_info,
            read_app_state,
            write_app_state,
            read_note_bundle,
            search_notes,
            save_image_attachment,
            save_image_attachment_bytes,
            read_image_attachment_bytes,
            list_image_attachments,
            delete_image_attachment,
            write_export_file,
            validate_storage_path,
            set_storage_path,
            pin_note_window,
            pin_new_note_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running OtterNote");
}

#[tauri::command]
fn get_storage_info(app: AppHandle) -> Result<StorageInfo, String> {
    storage_info(&app)
}

#[tauri::command]
fn pin_note_window(app: AppHandle, note_id: String, title: String) -> Result<(), String> {
    let label = format!("pinned-{}", sanitize_window_label(&note_id));
    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        window
            .set_always_on_top(true)
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    let url = WebviewUrl::App(format!("index.html?pinnedNoteId={note_id}").into());
    WebviewWindowBuilder::new(&app, label, url)
        .title(format!("Pinned - {title}"))
        .inner_size(360.0, 420.0)
        .min_inner_size(260.0, 220.0)
        .resizable(true)
        .always_on_top(true)
        .focused(true)
        .build()
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
fn pin_new_note_window(app: AppHandle) -> Result<(), String> {
    let label = format!("pinned-new-{}", current_millis_label());
    let url = WebviewUrl::App("index.html?pinnedNew=1".into());
    WebviewWindowBuilder::new(&app, label, url)
        .title("Pinned - New Note")
        .inner_size(360.0, 420.0)
        .min_inner_size(260.0, 220.0)
        .resizable(true)
        .always_on_top(true)
        .focused(true)
        .build()
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
fn read_app_state(app: AppHandle) -> Result<Option<String>, String> {
    let _write_guard = state_write_lock()
        .lock()
        .map_err(|_| "State write lock is poisoned.".to_string())?;
    let storage_root = active_storage_root(&app)?;
    ensure_storage_layout(&storage_root)?;
    recover_pending_transaction(&storage_root)?;
    let state_path = state_file_path(&app)?;
    if state_path.exists() || backup_file_path(&state_path).exists() {
        return read_full_app_state(&app, &state_path).map(Some);
    }

    let legacy_path = legacy_state_file_path(&app)?;
    if let Some(path) = legacy_path {
        if path.exists() {
            return fs::read_to_string(path)
                .map(Some)
                .map_err(|error| error.to_string());
        }
    }

    Ok(None)
}

#[tauri::command]
fn write_app_state(app: AppHandle, value: String) -> Result<(), String> {
    let _write_guard = state_write_lock()
        .lock()
        .map_err(|_| "State write lock is poisoned.".to_string())?;
    let state_path = state_file_path(&app)?;
    let storage_root = active_storage_root(&app)?;
    ensure_storage_layout(&storage_root)?;
    ensure_legacy_image_migration(&storage_root)?;
    recover_pending_transaction(&storage_root)?;

    let parsed = serde_json::from_str::<Value>(&value).map_err(|error| error.to_string())?;
    let (root_state, note_bundles, deleted_stack) = split_app_state(&parsed);
    write_app_state_transaction(
        &storage_root,
        &state_path,
        root_state,
        &note_bundles,
        &deleted_stack,
        None,
    )?;
    let stable_state = read_full_app_state(&app, &state_path)?;
    schedule_orphan_attachment_cleanup(app, stable_state);
    Ok(())
}

#[tauri::command]
fn read_note_bundle(app: AppHandle, note_id: String) -> Result<Option<String>, String> {
    if !is_valid_note_id(&note_id) {
        return Err("Note id is invalid.".to_string());
    }

    let storage_root = active_storage_root(&app)?;
    let bundle_path = note_bundle_path(&storage_root, &note_id);
    ensure_inside_storage_root(&storage_root, &bundle_path)?;
    if !bundle_path.exists() && !backup_file_path(&bundle_path).exists() {
        return Ok(None);
    }

    let bundle = read_json_file_with_recovery::<NoteBundle>(&bundle_path)?;
    let Some(bundle) = bundle else {
        return Ok(None);
    };
    let (bundle, migrated) = migrate_note_bundle(bundle)?;
    if migrated {
        write_json_file(&bundle_path, &bundle)?;
    }
    serde_json::to_string(&bundle)
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn search_notes(app: AppHandle, query: String) -> Result<Vec<Value>, String> {
    let index_path = search_index_path(&active_storage_root(&app)?);
    if !index_path.exists() && !backup_file_path(&index_path).exists() {
        return Ok(Vec::new());
    }

    let index_file = read_json_file_with_recovery::<SearchIndexFile>(&index_path)?;
    let records = match index_file {
        Some(SearchIndexFile::Versioned(mut file)) => {
            validate_data_version(file.data_version, &index_path)?;
            if file.data_version < CURRENT_DATA_VERSION {
                file.data_version = CURRENT_DATA_VERSION;
                write_json_file(&index_path, &file)?;
            }
            file.records
        }
        Some(SearchIndexFile::Legacy(records)) => records,
        None => Vec::new(),
    };
    let normalized = query.trim().to_lowercase();

    let mut results: Vec<Value> = records
        .into_iter()
        .filter(|record| {
            normalized.is_empty()
                || record.search_text.to_lowercase().contains(&normalized)
                || record.title.to_lowercase().contains(&normalized)
        })
        .map(|record| {
            serde_json::json!({
                "noteId": record.note_id,
                "title": record.title,
                "updatedAt": record.updated_at,
                "preview": record.preview,
            })
        })
        .collect();

    results.sort_by(|a, b| {
        let left = a
            .get("updatedAt")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let right = b
            .get("updatedAt")
            .and_then(Value::as_str)
            .unwrap_or_default();
        right.cmp(left)
    });

    Ok(results)
}

#[tauri::command]
fn validate_storage_path(storage_path: String) -> Result<(), String> {
    validate_custom_path(&storage_path)
}

#[tauri::command]
fn set_storage_path(app: AppHandle, storage_path: String) -> Result<StorageInfo, String> {
    let _write_guard = state_write_lock()
        .lock()
        .map_err(|_| "State write lock is poisoned.".to_string())?;
    if !storage_path.trim().is_empty() {
        validate_custom_path(&storage_path)?;
    }
    let old_state_path = state_file_path(&app)?;
    let old_storage_root = active_storage_root(&app)?;
    let old_attachment_dir = legacy_images_dir_for_storage_root(&old_storage_root);
    let old_notes_dir = notes_dir_for_storage_root(&old_storage_root);
    let old_deleted_stack = deleted_stack_file_path(&old_storage_root);
    let next_custom_path = normalize_custom_path(&storage_path);
    let config_path = storage_config_path(&app)?;
    ensure_parent_directory(&config_path)?;

    write_json_file(
        &config_path,
        &StorageConfig {
            storage_path: next_custom_path.clone(),
        },
    )?;

    let new_storage_root = active_storage_root(&app)?;
    ensure_storage_layout(&new_storage_root)?;
    let new_state_path = state_file_path_from_root(&new_storage_root);
    let new_attachment_dir = images_dir_for_storage_root(&new_storage_root);
    let new_notes_dir = notes_dir_for_storage_root(&new_storage_root);

    if old_state_path.exists() && old_state_path != new_state_path && !new_state_path.exists() {
        if let Some(parent) = new_state_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::copy(&old_state_path, &new_state_path).map_err(|error| error.to_string())?;
    }

    if old_notes_dir.exists() && old_notes_dir != new_notes_dir {
        copy_dir_recursive(&old_notes_dir, &new_notes_dir)?;
    }

    if old_attachment_dir.exists() && old_attachment_dir != new_attachment_dir {
        copy_dir_recursive(&old_attachment_dir, &new_attachment_dir)?;
    }

    let old_search_index = search_index_path(&old_storage_root);
    let new_search_index = search_index_path(&new_storage_root);
    if old_search_index.exists()
        && old_search_index != new_search_index
        && !new_search_index.exists()
    {
        if let Some(parent) = new_search_index.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::copy(&old_search_index, &new_search_index).map_err(|error| error.to_string())?;
    }

    let new_deleted_stack = deleted_stack_file_path(&new_storage_root);
    if old_deleted_stack.exists()
        && old_deleted_stack != new_deleted_stack
        && !new_deleted_stack.exists()
    {
        if let Some(parent) = new_deleted_stack.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::copy(&old_deleted_stack, &new_deleted_stack).map_err(|error| error.to_string())?;
    }

    let info = storage_info(&app)?;
    if new_storage_root != old_storage_root {
        // Sibling windows hold the previous data set in memory; tell them to
        // rehydrate from the new root before they flush a stale snapshot.
        let _ = app.emit(
            STORAGE_CHANGED_EVENT,
            serde_json::json!({ "path": info.path }),
        );
    }
    Ok(info)
}

#[tauri::command]
fn save_image_attachment(
    app: AppHandle,
    source_path: String,
    attachment_base_name: String,
) -> Result<String, String> {
    let source = PathBuf::from(&source_path);
    if !source.exists() {
        return Err("Image file not found.".to_string());
    }

    let source_file_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("image");

    let storage_root = active_storage_root(&app)?;
    ensure_legacy_image_migration(&storage_root)?;
    let bytes = fs::read(&source).map_err(|error| error.to_string())?;
    store_optimized_attachment(
        &storage_root,
        source_file_name,
        &attachment_base_name,
        &bytes,
    )
}

#[tauri::command]
fn save_image_attachment_bytes(
    app: AppHandle,
    bytes: Vec<u8>,
    source_file_name: String,
    attachment_base_name: String,
) -> Result<String, String> {
    let storage_root = active_storage_root(&app)?;
    ensure_legacy_image_migration(&storage_root)?;
    store_optimized_attachment(
        &storage_root,
        &source_file_name,
        &attachment_base_name,
        &bytes,
    )
}

#[tauri::command]
fn read_image_attachment_bytes(app: AppHandle, file_name: String) -> Result<Vec<u8>, String> {
    let safe_name = sanitize_attachment_name(&file_name);
    if safe_name.is_empty() || safe_name != file_name {
        return Err("Attachment name is invalid.".to_string());
    }

    let storage_root = active_storage_root(&app)?;
    ensure_legacy_image_migration(&storage_root)?;
    let attachment_dir = images_dir_for_storage_root(&storage_root);
    let target = attachment_dir.join(&safe_name);
    ensure_inside_storage_root(&storage_root, &target)?;
    if !target.exists() {
        restore_attachment_group_from_quarantine(
            &attachment_dir,
            &attachment_group_key(&safe_name),
        )?;
    }
    if !target.exists() {
        return Err("Image file not found.".to_string());
    }

    fs::read(target).map_err(|error| error.to_string())
}

#[tauri::command]
fn list_image_attachments(app: AppHandle) -> Result<Vec<ImageAttachmentInfo>, String> {
    let storage_root = active_storage_root(&app)?;
    ensure_legacy_image_migration(&storage_root)?;
    let attachment_dir = images_dir_for_storage_root(&storage_root);
    if !attachment_dir.exists() {
        return Ok(Vec::new());
    }

    let mut preview_items: HashMap<String, (String, u64, String)> = HashMap::new();
    let mut original_names: HashMap<String, String> = HashMap::new();
    for entry in fs::read_dir(&attachment_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().into_owned();
        if !is_image_file_name(&file_name) {
            continue;
        }

        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs().to_string())
            .unwrap_or_default();
        let group_key = attachment_group_key(&file_name);

        if is_preview_attachment_name(&file_name) {
            preview_items.insert(group_key, (file_name.clone(), metadata.len(), modified_at));
        } else if file_name.contains(".original.") {
            original_names.insert(group_key, file_name.clone());
        }
    }

    let mut items: Vec<ImageAttachmentInfo> = preview_items
        .into_iter()
        .map(|(group_key, (preview_file_name, size, modified_at))| {
            let original_file_name = original_names
                .get(&group_key)
                .cloned()
                .unwrap_or_else(|| preview_file_name.clone());

            ImageAttachmentInfo {
                file_name: preview_file_name.clone(),
                original_file_name,
                path: path_to_string(&attachment_dir.join(&preview_file_name)),
                size,
                modified_at,
            }
        })
        .collect();

    items.sort_by(|a, b| {
        b.modified_at
            .cmp(&a.modified_at)
            .then_with(|| a.file_name.cmp(&b.file_name))
    });
    Ok(items)
}

#[tauri::command]
fn delete_image_attachment(app: AppHandle, file_name: String) -> Result<(), String> {
    let safe_name = sanitize_attachment_name(&file_name);
    if safe_name.is_empty() || safe_name != file_name {
        return Err("Attachment name is invalid.".to_string());
    }

    let storage_root = active_storage_root(&app)?;
    ensure_legacy_image_migration(&storage_root)?;
    let attachment_dir = images_dir_for_storage_root(&storage_root);
    let group_key = attachment_group_key(&safe_name);

    if !attachment_dir.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(&attachment_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let entry_name = entry.file_name().to_string_lossy().into_owned();
        if attachment_group_key(&entry_name) == group_key
            && entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_file()
        {
            fs::remove_file(entry.path()).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn write_export_file(file_path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(file_path);
    write_text_file(&path, &content)
}

fn storage_info(app: &AppHandle) -> Result<StorageInfo, String> {
    let config = read_storage_config(app)?;
    let default_path = default_storage_root(app)?;
    let path = active_storage_root(app)?;

    Ok(StorageInfo {
        path: path_to_string(&path),
        default_path: path_to_string(&default_path),
        custom_path: config
            .storage_path
            .map(|value| path_to_string(&resolve_storage_root(&value))),
        other_windows: app.webview_windows().len().saturating_sub(1),
    })
}

fn note_bundle_path(storage_root: &Path, note_id: &str) -> PathBuf {
    notes_dir_for_storage_root(storage_root).join(format!("{note_id}.json"))
}

/// Note ids are used as file names, so anything that could escape the notes
/// directory is rejected before the path is built.
fn is_valid_note_id(note_id: &str) -> bool {
    !note_id.is_empty()
        && !note_id.contains('/')
        && !note_id.contains('\\')
        && note_id != "."
        && note_id != ".."
}

fn search_index_path(storage_root: &Path) -> PathBuf {
    storage_root.join(SEARCH_INDEX_FILE_NAME)
}

fn state_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config = read_storage_config(app)?;
    match config.storage_path {
        Some(path) => {
            let expanded = expand_home_path(&path);
            if is_legacy_state_file_path(&expanded) {
                Ok(expanded)
            } else {
                Ok(state_file_path_from_root(&resolve_storage_root(&path)))
            }
        }
        None => Ok(state_file_path_from_root(&default_storage_root(app)?)),
    }
}

fn legacy_state_file_path(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let config = read_storage_config(app)?;
    Ok(config.storage_path.and_then(|path| {
        let expanded = expand_home_path(&path);
        if is_legacy_state_file_path(&expanded) {
            Some(expanded)
        } else {
            None
        }
    }))
}

fn active_storage_root(app: &AppHandle) -> Result<PathBuf, String> {
    // An explicit scratch directory wins and is trusted: whoever sets it means
    // to use exactly that path. The bootstrap config is not even read.
    if let Some(root) = data_dir_override() {
        return Ok(root);
    }

    choose_storage_root(
        read_storage_config(app)?.storage_path.as_deref(),
        default_storage_root(app)?,
        std::env::var_os("HOME").as_deref().map(Path::new),
        cfg!(debug_assertions),
    )
}

/// Where the notes live: the configured path if there is one, otherwise the
/// platform default, with a debug build refused off the release data directory.
fn choose_storage_root(
    configured: Option<&str>,
    default_root: PathBuf,
    home: Option<&Path>,
    debug_build: bool,
) -> Result<PathBuf, String> {
    let root = match configured {
        Some(path) => resolve_storage_root(path),
        None => default_root,
    };

    guard_storage_root(&root, home, debug_build)?;

    Ok(root)
}

fn default_storage_root(app: &AppHandle) -> Result<PathBuf, String> {
    // Development builds keep their data in the "data" folder of the checkout
    // so that running a fresh clone does not write into the user's home
    // directory. Release builds are not affected by the working directory at
    // all and live in ~/OtterNote.
    #[cfg(debug_assertions)]
    let root = {
        let _ = app;
        development_data_root(Path::new(env!("CARGO_MANIFEST_DIR")))
            .ok_or_else(|| "could not locate the project directory".to_string())?
    };

    #[cfg(not(debug_assertions))]
    let root = match std::env::var_os("HOME") {
        Some(home) => PathBuf::from(home).join("OtterNote"),
        None => app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("OtterNote"),
    };

    Ok(root)
}

/// Development builds store their data in `<checkout>/data`.
///
/// The path is derived from the crate directory at compile time instead of
/// `std::env::current_dir()`, because a debug build started from Finder or
/// `open` runs with `/` as its working directory, which would put the notes in
/// `/data` (or fail to create it).
#[cfg(debug_assertions)]
fn development_data_root(crate_dir: &Path) -> Option<PathBuf> {
    crate_dir.parent().map(|checkout| checkout.join("data"))
}

/// Environment variable that relocates every file the app writes into one
/// scratch directory. Tests and development runs set it instead of pretending
/// `HOME` points elsewhere, which is fragile because `open(1)` and Finder do not
/// inherit the shell environment.
const DATA_DIR_ENV: &str = "OTTERNOTE_DATA_DIR";

/// Broadcast to every window after the active storage root moved.
const STORAGE_CHANGED_EVENT: &str = "otter:storage-changed";

fn data_dir_override() -> Option<PathBuf> {
    parse_data_dir_override(std::env::var_os(DATA_DIR_ENV).as_deref())
}

/// An empty or blank value counts as unset, so a stray `export OTTERNOTE_DATA_DIR=`
/// cannot make the app write to an empty path.
fn parse_data_dir_override(raw: Option<&std::ffi::OsStr>) -> Option<PathBuf> {
    let raw = raw?;
    if raw.to_string_lossy().trim().is_empty() {
        return None;
    }

    Some(PathBuf::from(raw))
}

/// Where a release build puts its data when nothing else is configured.
fn release_default_root_in_home(home: &Path) -> PathBuf {
    home.join("OtterNote")
}

fn root_is_release_default(root: &Path, home: Option<&Path>) -> bool {
    home.is_some_and(|home| root == release_default_root_in_home(home))
}

/// Keeps a debug build away from the directory that holds the user's real notes.
///
/// Debug builds keep their bootstrap config under `com.otternote.desktop.dev`,
/// so the folder chosen in the installed app is not even visible to them. This
/// guard covers the remaining path: a release-style default root (`~/OtterNote`)
/// reached through the debug default or a hand-edited config. An explicit
/// `OTTERNOTE_DATA_DIR` is not checked here because setting it is deliberate.
fn guard_storage_root(root: &Path, home: Option<&Path>, debug_build: bool) -> Result<(), String> {
    if debug_build && root_is_release_default(root, home) {
        return Err(format!(
            "refusing to use {} from a debug build: that is the release app's data \
             directory. Debug builds keep their data in the checkout's data/ folder; \
             set {}=<scratch directory> to use this path on purpose.",
            root.display(),
            DATA_DIR_ENV
        ));
    }

    Ok(())
}

fn state_file_path_from_root(storage_root: &Path) -> PathBuf {
    storage_root.join(STATE_FILE_NAME)
}

fn deleted_stack_file_path(storage_root: &Path) -> PathBuf {
    storage_root.join(DELETED_STACK_FILE_NAME)
}

fn notes_dir_for_storage_root(storage_root: &Path) -> PathBuf {
    storage_root.join(NOTES_DIR_NAME)
}

fn images_dir_for_storage_root(storage_root: &Path) -> PathBuf {
    storage_root.join(IMAGES_DIR_NAME)
}

fn legacy_images_dir_for_storage_root(storage_root: &Path) -> PathBuf {
    storage_root.join(LEGACY_IMAGES_DIR_NAME)
}

fn ensure_legacy_image_migration(storage_root: &Path) -> Result<(), String> {
    let legacy_dir = legacy_images_dir_for_storage_root(storage_root);
    if !legacy_dir.exists() {
        return Ok(());
    }

    let new_dir = images_dir_for_storage_root(storage_root);
    copy_dir_recursive(&legacy_dir, &new_dir)
}

fn migrate_legacy_storage_file(app: &AppHandle, legacy_state_path: &Path) -> Result<(), String> {
    if !legacy_state_path.exists() {
        return Ok(());
    }

    let storage_root = default_storage_root(app)?;
    ensure_storage_layout(&storage_root)?;

    let state_content = fs::read_to_string(legacy_state_path).map_err(|error| error.to_string())?;
    let parsed =
        serde_json::from_str::<Value>(&state_content).map_err(|error| error.to_string())?;
    let (root_state, note_bundles, deleted_stack) = split_app_state(&parsed);

    write_json_file(&state_file_path_from_root(&storage_root), &root_state)?;
    write_note_bundles(&storage_root, &note_bundles)?;
    write_deleted_stack(&storage_root, &deleted_stack)?;

    let legacy_root = legacy_state_path.parent().unwrap_or(legacy_state_path);
    let legacy_notes_dir = notes_dir_for_storage_root(legacy_root);
    if legacy_notes_dir.exists() {
        copy_dir_recursive(
            &legacy_notes_dir,
            &notes_dir_for_storage_root(&storage_root),
        )?;
    }

    let legacy_images_dir = legacy_images_dir_for_storage_root(legacy_root);
    if legacy_images_dir.exists() {
        copy_dir_recursive(
            &legacy_images_dir,
            &images_dir_for_storage_root(&storage_root),
        )?;
    }

    let legacy_deleted_stack = deleted_stack_file_path(legacy_root);
    if legacy_deleted_stack.exists() {
        let new_deleted_stack = deleted_stack_file_path(&storage_root);
        if let Some(parent) = new_deleted_stack.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::copy(&legacy_deleted_stack, &new_deleted_stack).map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn storage_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    // The scratch directory keeps its own bootstrap config, so a sandboxed run
    // can neither read nor overwrite the config of the installed app.
    if let Some(root) = data_dir_override() {
        return Ok(root.join("storage.json"));
    }

    Ok(debug_bootstrapped(bootstrap_config_dir(app)?).join("storage.json"))
}

/// The platform config directory keyed by the bundle identifier.
fn bootstrap_config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|error| error.to_string())
}

/// Debug builds live under their own identifier so that switching the storage
/// folder in the installed app can never redirect development runs (and vice
/// versa). `tauri.conf.json` cannot express this per-profile, so the last path
/// segment is swapped here.
fn debug_bootstrapped(config_dir: PathBuf) -> PathBuf {
    #[cfg(debug_assertions)]
    {
        return config_dir.with_file_name(format!(
            "{}.dev",
            config_dir
                .file_name()
                .map_or(String::new(), |name| name.to_string_lossy().into_owned())
        ));
    }
    #[cfg(not(debug_assertions))]
    config_dir
}

/// `atomic_write_bytes` does not create missing directories, and a scratch
/// directory only exists once something has been written into it.
fn ensure_parent_directory(path: &Path) -> Result<(), String> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    if parent.as_os_str().is_empty() || parent.exists() {
        return Ok(());
    }

    fs::create_dir_all(parent).map_err(|error| error.to_string())
}

fn read_storage_config(app: &AppHandle) -> Result<StorageConfig, String> {
    let path = storage_config_path(app)?;
    let config = read_json_file_with_recovery::<StorageConfig>(&path)?.unwrap_or_default();

    if let Some(storage_path) = config.storage_path.as_deref() {
        let expanded = expand_home_path(storage_path);
        if is_legacy_state_file_path(&expanded) {
            migrate_legacy_storage_file(app, &expanded)?;
            let default_config = StorageConfig::default();
            let reset_path = storage_config_path(app)?;
            ensure_parent_directory(&reset_path)?;
            write_json_file(&reset_path, &default_config)?;
            return Ok(default_config);
        }
    }

    Ok(config)
}

fn write_json_file<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let content = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    write_text_file(path, &content)
}

fn state_write_lock() -> &'static Mutex<()> {
    STATE_WRITE_LOCK.get_or_init(|| Mutex::new(()))
}

fn backup_file_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(".bak");
    PathBuf::from(name)
}

fn temporary_file_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(".tmp");
    PathBuf::from(name)
}

fn write_and_sync_file(path: &Path, content: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(content).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())
}

fn sync_parent_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        if let Some(parent) = path.parent() {
            File::open(parent)
                .and_then(|directory| directory.sync_all())
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn replace_file(source: &Path, target: &Path) -> Result<(), String> {
    use std::iter;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source_wide = source
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();
    let target_wide = target
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            target_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file(source: &Path, target: &Path) -> Result<(), String> {
    fs::rename(source, target).map_err(|error| error.to_string())
}

fn atomic_write_bytes(path: &Path, content: &[u8], keep_backup: bool) -> Result<(), String> {
    let temp_path = temporary_file_path(path);
    if temp_path.exists() {
        fs::remove_file(&temp_path).map_err(|error| error.to_string())?;
    }

    if let Err(error) = write_and_sync_file(&temp_path, content) {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    if keep_backup && path.exists() {
        let previous = fs::read(path).map_err(|error| error.to_string())?;
        let is_json = path.extension().and_then(|extension| extension.to_str()) == Some("json");
        if !is_json || serde_json::from_slice::<Value>(&previous).is_ok() {
            atomic_write_bytes(&backup_file_path(path), &previous, false)?;
        }
    }

    replace_file(&temp_path, path)?;
    sync_parent_directory(path)
}

fn read_json_file_with_recovery<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    let backup_path = backup_file_path(path);
    if !path.exists() {
        if !backup_path.exists() {
            return Ok(None);
        }

        let backup_content = fs::read(&backup_path).map_err(|error| error.to_string())?;
        let parsed = serde_json::from_slice::<T>(&backup_content).map_err(|error| {
            format!(
                "Missing primary JSON and invalid backup {}: {error}",
                backup_path.display()
            )
        })?;
        atomic_write_bytes(path, &backup_content, false)?;
        return Ok(Some(parsed));
    }

    let content = fs::read(path).map_err(|error| error.to_string())?;
    match serde_json::from_slice::<T>(&content) {
        Ok(parsed) => Ok(Some(parsed)),
        Err(primary_error) => {
            if !backup_path.exists() {
                return Err(format!(
                    "Invalid JSON in {} and no backup is available: {primary_error}",
                    path.display()
                ));
            }

            let backup_content = fs::read(&backup_path).map_err(|error| error.to_string())?;
            let parsed = serde_json::from_slice::<T>(&backup_content).map_err(|backup_error| {
                format!(
                    "Invalid JSON in {} ({primary_error}) and backup {} ({backup_error})",
                    path.display(),
                    backup_path.display()
                )
            })?;
            atomic_write_bytes(path, &backup_content, false)?;
            Ok(Some(parsed))
        }
    }
}

fn validate_data_version(version: u32, path: &Path) -> Result<(), String> {
    if version > CURRENT_DATA_VERSION {
        return Err(format!(
            "{} uses data version {version}, but this app supports up to version {CURRENT_DATA_VERSION}.",
            path.display()
        ));
    }
    Ok(())
}

fn migrate_root_state(mut value: Value) -> Result<(Value, bool), String> {
    let map = value
        .as_object_mut()
        .ok_or_else(|| "State JSON root must be an object.".to_string())?;
    let version = map.get("dataVersion").and_then(Value::as_u64).unwrap_or(0) as u32;
    validate_data_version(version, Path::new(STATE_FILE_NAME))?;

    if version == CURRENT_DATA_VERSION {
        return Ok((value, false));
    }

    // Version 0 is the legacy unversioned Zustand payload. Version 1 only adds
    // the storage-level marker; the application state shape is unchanged.
    map.insert("dataVersion".to_string(), Value::from(CURRENT_DATA_VERSION));
    Ok((value, true))
}

fn migrate_note_bundle(mut bundle: NoteBundle) -> Result<(NoteBundle, bool), String> {
    if bundle.schema_version > CURRENT_DATA_VERSION {
        return Err(format!(
            "Note uses schema version {}, but this app supports up to version {}.",
            bundle.schema_version, CURRENT_DATA_VERSION
        ));
    }
    if bundle.schema_version == CURRENT_DATA_VERSION {
        return Ok((bundle, false));
    }

    bundle.schema_version = CURRENT_DATA_VERSION;
    Ok((bundle, true))
}

fn serialize_pretty<T: Serialize>(value: &T) -> Result<Vec<u8>, String> {
    serde_json::to_vec_pretty(value).map_err(|error| error.to_string())
}

fn transaction_relative_path(storage_root: &Path, path: &Path) -> Result<String, String> {
    let relative = path.strip_prefix(storage_root).map_err(|_| {
        format!(
            "Transaction target {} is outside storage root {}.",
            path.display(),
            storage_root.display()
        )
    })?;
    if relative
        .components()
        .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err(format!("Unsafe transaction path: {}", relative.display()));
    }
    Ok(relative.to_string_lossy().into_owned())
}

fn resolve_transaction_path(storage_root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err(format!("Unsafe transaction path: {relative}"));
    }
    let joined = storage_root.join(path);
    ensure_inside_storage_root(storage_root, &joined)?;

    Ok(joined)
}

/// Keeps every path built from stored data inside the storage directory.
///
/// Names are already screened for separators and `..`, but a symbolic link planted
/// inside the directory still redirects a read or a write somewhere else, so each
/// component below the root is inspected. The root itself is never resolved: on
/// macOS and Linux even a temporary directory legitimately lives behind a symlink,
/// and users are free to keep their notes where the link points.
fn ensure_inside_storage_root(storage_root: &Path, path: &Path) -> Result<(), String> {
    let relative = path.strip_prefix(storage_root).map_err(|_| {
        format!(
            "Refusing to use {} because it is outside the storage directory.",
            path.display()
        )
    })?;

    let mut current = storage_root.to_path_buf();
    for component in relative.components() {
        let std::path::Component::Normal(name) = component else {
            return Err(format!(
                "Refusing to use {} because it is not a plain path.",
                path.display()
            ));
        };
        current.push(name);

        // A missing component is fine: it is the file about to be created.
        let is_link = fs::symlink_metadata(&current)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(false);
        if is_link {
            return Err(format!(
                "Symbolic links are not supported inside the storage directory: {}",
                current.display()
            ));
        }
    }

    Ok(())
}

fn file_needs_write(path: &Path, content: &[u8]) -> Result<bool, String> {
    match fs::read(path) {
        Ok(existing) => Ok(existing != content),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(true),
        Err(error) => Err(error.to_string()),
    }
}

fn write_app_state_transaction(
    storage_root: &Path,
    state_path: &Path,
    root_state: Value,
    note_bundles: &[NoteBundle],
    deleted_stack: &[DeletedSnapshot],
    fail_after_staged_files: Option<usize>,
) -> Result<(), String> {
    let (root_state, _) = migrate_root_state(root_state)?;
    let notes_dir = notes_dir_for_storage_root(storage_root);
    let mut active_note_files = HashSet::new();
    let mut files = vec![PendingFileWrite {
        target: state_path.to_path_buf(),
        content: serialize_pretty(&root_state)?,
    }];

    // A secondary window can flush a stale snapshot that still contains a note
    // which another window has since deleted. The deletion record is
    // authoritative: never rewrite a pending-deleted note's bundle file, and
    // treat it as inactive so its on-disk file is removed below.
    let explicitly_deleted_files = deleted_stack
        .iter()
        .filter(|snapshot| snapshot.snapshot_type == "note")
        .filter_map(|snapshot| snapshot.note.as_ref())
        .filter_map(|note| note.get("id").and_then(Value::as_str))
        .map(|note_id| format!("{note_id}.json"))
        .collect::<HashSet<_>>();

    let mut surviving_bundles = Vec::new();
    for bundle in note_bundles {
        let note_id = bundle
            .note
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| "Note file is missing id.".to_string())?;
        if !is_valid_note_id(note_id) {
            return Err("Note id cannot be used as a file name.".to_string());
        }

        let file_name = format!("{note_id}.json");
        if explicitly_deleted_files.contains(&file_name) {
            continue;
        }
        active_note_files.insert(file_name.clone());
        let versioned_bundle = NoteBundle {
            schema_version: CURRENT_DATA_VERSION,
            note: bundle.note.clone(),
            entries: bundle.entries.clone(),
            todos: bundle.todos.clone(),
        };
        files.push(PendingFileWrite {
            target: notes_dir.join(file_name),
            content: serialize_pretty(&versioned_bundle)?,
        });
        surviving_bundles.push(versioned_bundle);
    }

    files.push(PendingFileWrite {
        target: search_index_path(storage_root),
        content: serialize_pretty(&VersionedSearchIndex {
            data_version: CURRENT_DATA_VERSION,
            records: build_search_index(&surviving_bundles),
        })?,
    });
    files.push(PendingFileWrite {
        target: deleted_stack_file_path(storage_root),
        content: serialize_pretty(&VersionedDeletedStack {
            data_version: CURRENT_DATA_VERSION,
            items: deleted_stack.to_vec(),
        })?,
    });

    for file in &files {
        ensure_inside_storage_root(storage_root, &file.target)?;
    }

    let mut deletions = Vec::new();
    if notes_dir.exists() {
        for entry in fs::read_dir(&notes_dir).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            if !entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_file()
            {
                continue;
            }
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if file_name.ends_with(".json") && !active_note_files.contains(&file_name) {
                deletions.push(entry.path());
            }
        }
    }

    if !deletions.is_empty() {
        let unexpected_deletions = deletions
            .iter()
            .filter_map(|path| path.file_name().and_then(|name| name.to_str()))
            .filter(|file_name| !explicitly_deleted_files.contains(*file_name))
            .collect::<Vec<_>>();
        if !unexpected_deletions.is_empty() {
            return Err(format!(
                "Refusing to remove note files without matching deletion snapshots: {}",
                unexpected_deletions.join(", ")
            ));
        }
    }

    files.sort_by(|left, right| left.target.cmp(&right.target));
    deletions.sort();
    files = files
        .into_iter()
        .filter_map(|file| match file_needs_write(&file.target, &file.content) {
            Ok(true) => Some(Ok(file)),
            Ok(false) => None,
            Err(error) => Some(Err(error)),
        })
        .collect::<Result<Vec<_>, _>>()?;

    if files.is_empty() && deletions.is_empty() {
        return Ok(());
    }

    let mut staged_paths = Vec::new();
    for (index, file) in files.iter().enumerate() {
        let temp_path = temporary_file_path(&file.target);
        if temp_path.exists() {
            fs::remove_file(&temp_path).map_err(|error| error.to_string())?;
        }
        if let Err(error) = write_and_sync_file(&temp_path, &file.content) {
            for staged in &staged_paths {
                let _ = fs::remove_file(staged);
            }
            let _ = fs::remove_file(&temp_path);
            return Err(error);
        }
        if let Err(error) = sync_parent_directory(&temp_path) {
            for staged in &staged_paths {
                let _ = fs::remove_file(staged);
            }
            let _ = fs::remove_file(&temp_path);
            return Err(error);
        }
        staged_paths.push(temp_path);

        if fail_after_staged_files == Some(index + 1) {
            for staged in &staged_paths {
                let _ = fs::remove_file(staged);
            }
            return Err("Simulated storage write failure.".to_string());
        }
    }

    let transaction = PendingTransaction {
        data_version: CURRENT_DATA_VERSION,
        files: files
            .iter()
            .map(|file| transaction_relative_path(storage_root, &file.target))
            .collect::<Result<Vec<_>, _>>()?,
        deletions: deletions
            .iter()
            .map(|path| transaction_relative_path(storage_root, path))
            .collect::<Result<Vec<_>, _>>()?,
    };
    let journal_path = storage_root.join(PENDING_TRANSACTION_FILE_NAME);
    atomic_write_bytes(&journal_path, &serialize_pretty(&transaction)?, false)?;
    commit_pending_transaction(storage_root, &transaction)?;
    fs::remove_file(&journal_path).map_err(|error| error.to_string())?;
    sync_parent_directory(&journal_path)
}

fn commit_staged_file(path: &Path) -> Result<(), String> {
    let temp_path = temporary_file_path(path);
    if !temp_path.exists() {
        // The rename may already have completed before a crash. Validation is
        // performed by the normal startup readers after journal recovery.
        if path.exists() {
            return Ok(());
        }
        return Err(format!(
            "Transaction is missing both staged and target file: {}",
            path.display()
        ));
    }

    if path.exists() {
        let previous = fs::read(path).map_err(|error| error.to_string())?;
        atomic_write_bytes(&backup_file_path(path), &previous, false)?;
    }
    replace_file(&temp_path, path)?;
    sync_parent_directory(path)
}

fn commit_pending_transaction(
    storage_root: &Path,
    transaction: &PendingTransaction,
) -> Result<(), String> {
    validate_data_version(
        transaction.data_version,
        &storage_root.join(PENDING_TRANSACTION_FILE_NAME),
    )?;
    for relative in &transaction.files {
        let path = resolve_transaction_path(storage_root, relative)?;
        commit_staged_file(&path)?;
    }
    for relative in &transaction.deletions {
        let path = resolve_transaction_path(storage_root, relative)?;
        if !path.exists() {
            continue;
        }
        let previous = fs::read(&path).map_err(|error| error.to_string())?;
        atomic_write_bytes(&backup_file_path(&path), &previous, false)?;
        fs::remove_file(&path).map_err(|error| error.to_string())?;
        sync_parent_directory(&path)?;
    }
    Ok(())
}

fn recover_pending_transaction(storage_root: &Path) -> Result<(), String> {
    let journal_path = storage_root.join(PENDING_TRANSACTION_FILE_NAME);
    let Some(transaction) = read_json_file_with_recovery::<PendingTransaction>(&journal_path)?
    else {
        return Ok(());
    };
    commit_pending_transaction(storage_root, &transaction)?;
    fs::remove_file(&journal_path).map_err(|error| error.to_string())?;
    sync_parent_directory(&journal_path)
}

fn ensure_storage_layout(storage_root: &Path) -> Result<(), String> {
    fs::create_dir_all(storage_root).map_err(|error| error.to_string())?;
    fs::create_dir_all(notes_dir_for_storage_root(storage_root))
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(images_dir_for_storage_root(storage_root))
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn write_deleted_stack(
    storage_root: &Path,
    deleted_stack: &[DeletedSnapshot],
) -> Result<(), String> {
    write_json_file(
        &deleted_stack_file_path(storage_root),
        &VersionedDeletedStack {
            data_version: CURRENT_DATA_VERSION,
            items: deleted_stack.to_vec(),
        },
    )
}

fn read_deleted_stack(storage_root: &Path) -> Result<Vec<DeletedSnapshot>, String> {
    let path = deleted_stack_file_path(storage_root);
    match read_json_file_with_recovery::<DeletedStackFile>(&path)? {
        Some(DeletedStackFile::Versioned(mut file)) => {
            validate_data_version(file.data_version, &path)?;
            if file.data_version < CURRENT_DATA_VERSION {
                file.data_version = CURRENT_DATA_VERSION;
                write_json_file(&path, &file)?;
            }
            Ok(file.items)
        }
        Some(DeletedStackFile::Legacy(items)) => {
            write_deleted_stack(storage_root, &items)?;
            Ok(items)
        }
        None => Ok(Vec::new()),
    }
}

fn write_note_bundles(storage_root: &Path, note_bundles: &[NoteBundle]) -> Result<(), String> {
    let notes_dir = notes_dir_for_storage_root(storage_root);
    fs::create_dir_all(&notes_dir).map_err(|error| error.to_string())?;

    let mut active_files = HashSet::new();
    for bundle in note_bundles {
        let note_id = bundle
            .note
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| "Note file is missing id.".to_string())?;
        if !is_valid_note_id(note_id) {
            return Err("Note id cannot be used as a file name.".to_string());
        }

        let file_name = format!("{note_id}.json");
        active_files.insert(file_name.clone());
        let bundle_path = notes_dir.join(&file_name);
        ensure_inside_storage_root(storage_root, &bundle_path)?;
        let next_bundle = NoteBundle {
            schema_version: CURRENT_DATA_VERSION,
            note: bundle.note.clone(),
            entries: bundle.entries.clone(),
            todos: bundle.todos.clone(),
        };
        write_json_file(&bundle_path, &next_bundle)?;
    }

    if notes_dir.exists() {
        for entry in fs::read_dir(&notes_dir).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            if !entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_file()
            {
                continue;
            }

            let file_name = entry.file_name().to_string_lossy().into_owned();
            if file_name.ends_with(".json") && !active_files.contains(&file_name) {
                fs::remove_file(entry.path()).map_err(|error| error.to_string())?;
            }
        }
    }

    Ok(())
}

fn write_search_index(storage_root: &Path, note_bundles: &[NoteBundle]) -> Result<(), String> {
    let index = build_search_index(note_bundles);

    write_json_file(
        &search_index_path(storage_root),
        &VersionedSearchIndex {
            data_version: CURRENT_DATA_VERSION,
            records: index,
        },
    )
}

fn build_search_index(note_bundles: &[NoteBundle]) -> Vec<SearchIndexRecord> {
    note_bundles
        .iter()
        .filter_map(|bundle| {
            let note_id = bundle.note.get("id").and_then(Value::as_str)?.to_string();
            let title = bundle
                .note
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("Untitled Note")
                .to_string();
            let updated_at = bundle
                .note
                .get("updatedAt")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let search_text = build_note_search_text(&bundle.note, &title, &bundle.todos);
            let preview = build_note_preview(&bundle.note, &bundle.todos);

            Some(SearchIndexRecord {
                note_id,
                title,
                updated_at,
                search_text,
                preview,
            })
        })
        .collect()
}

fn validate_or_rebuild_search_index(
    storage_root: &Path,
    note_bundles: &[NoteBundle],
) -> Result<(), String> {
    let path = search_index_path(storage_root);
    match read_json_file_with_recovery::<SearchIndexFile>(&path) {
        Ok(Some(SearchIndexFile::Versioned(mut file))) => {
            validate_data_version(file.data_version, &path)?;
            let expected_records = build_search_index(note_bundles);
            if file.data_version < CURRENT_DATA_VERSION || file.records != expected_records {
                file.data_version = CURRENT_DATA_VERSION;
                file.records = expected_records;
                write_json_file(&path, &file)?;
            }
            Ok(())
        }
        Ok(Some(SearchIndexFile::Legacy(_))) | Ok(None) | Err(_) => {
            write_search_index(storage_root, note_bundles)
        }
    }
}

fn read_full_app_state(app: &AppHandle, state_path: &Path) -> Result<String, String> {
    let root_value = read_json_file_with_recovery::<Value>(state_path)?
        .ok_or_else(|| format!("State file is missing: {}", state_path.display()))?;
    let (root_value, root_migrated) = migrate_root_state(root_value)?;
    if root_migrated {
        write_json_file(state_path, &root_value)?;
    }
    let storage_root = active_storage_root(app)?;
    let notes_dir = notes_dir_for_storage_root(&storage_root);
    let deleted_stack = read_deleted_stack(&storage_root)?;

    let (stripped_root, legacy_note_bundles, legacy_deleted_stack) = split_app_state(&root_value);
    let effective_deleted_stack = if deleted_stack.is_empty() {
        legacy_deleted_stack.clone()
    } else {
        deleted_stack.clone()
    };

    if stripped_root != root_value {
        write_json_file(state_path, &stripped_root)?;
        if !legacy_note_bundles.is_empty() {
            write_note_bundles(&storage_root, &legacy_note_bundles)?;
            write_search_index(&storage_root, &legacy_note_bundles)?;
        }
        if !legacy_deleted_stack.is_empty() {
            write_deleted_stack(&storage_root, &legacy_deleted_stack)?;
        }
    }

    let deleted_note_files: HashSet<String> = effective_deleted_stack
        .iter()
        .filter(|snapshot| snapshot.snapshot_type == "note")
        .filter_map(|snapshot| snapshot.note.as_ref())
        .filter_map(|note| note.get("id").and_then(Value::as_str))
        .map(|note_id| format!("{note_id}.json"))
        .collect();

    let note_bundles = read_note_bundles(&notes_dir, &deleted_note_files)?;
    validate_or_rebuild_search_index(&storage_root, &note_bundles)?;

    if note_bundles.is_empty() && effective_deleted_stack.is_empty() {
        return serde_json::to_string(&stripped_root).map_err(|error| error.to_string());
    }

    let merged = merge_root_state_with_notes(root_value, note_bundles, effective_deleted_stack);
    serde_json::to_string(&merged).map_err(|error| error.to_string())
}

fn read_note_bundles(
    notes_dir: &Path,
    deleted_note_files: &HashSet<String>,
) -> Result<Vec<NoteBundle>, String> {
    if !notes_dir.exists() {
        return Ok(Vec::new());
    }

    let mut bundles = Vec::new();
    for entry in fs::read_dir(notes_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().into_owned();
        let primary_name = file_name
            .strip_suffix(".json.bak")
            .map(|name| format!("{name}.json"))
            .unwrap_or_else(|| file_name.clone());

        // A pending-deleted note must never be resurrected: skip both its
        // primary file and its backup, and purge any leftover copies.
        if deleted_note_files.contains(&primary_name) {
            if file_name.ends_with(".json") || file_name.ends_with(".json.bak") {
                let _ = fs::remove_file(entry.path());
            }
            continue;
        }

        let path = if file_name.ends_with(".json") {
            entry.path()
        } else if let Some(primary_name) = file_name.strip_suffix(".json.bak") {
            let primary_path = notes_dir.join(format!("{primary_name}.json"));
            if primary_path.exists() {
                continue;
            }
            primary_path
        } else {
            continue;
        };
        let Some(bundle) = read_json_file_with_recovery::<NoteBundle>(&path)? else {
            continue;
        };
        let (bundle, migrated) = migrate_note_bundle(bundle)?;
        if migrated {
            write_json_file(&path, &bundle)?;
        }
        bundles.push(bundle);
    }

    Ok(bundles)
}

fn split_app_state(value: &Value) -> (Value, Vec<NoteBundle>, Vec<DeletedSnapshot>) {
    let Some(map) = value.as_object() else {
        return (value.clone(), Vec::new(), Vec::new());
    };

    let Some(state_value) = map.get("state") else {
        return split_inner_state(value.clone());
    };

    let (next_state, note_bundles, deleted_stack) = split_inner_state(state_value.clone());

    let mut root_map = map.clone();
    root_map.insert("state".to_string(), next_state);

    (Value::Object(root_map), note_bundles, deleted_stack)
}

fn split_inner_state(value: Value) -> (Value, Vec<NoteBundle>, Vec<DeletedSnapshot>) {
    let Some(map) = value.as_object() else {
        return (value, Vec::new(), Vec::new());
    };

    let notes = map
        .get("notes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let entries = map
        .get("entries")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let todos = map
        .get("todos")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let deleted_stack = map
        .get("deletedStack")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| serde_json::from_value::<DeletedSnapshot>(value).ok())
        .collect::<Vec<_>>();

    let mut entries_by_note: HashMap<String, Vec<Value>> = HashMap::new();
    for entry in entries {
        if let Some(note_id) = entry.get("noteId").and_then(Value::as_str) {
            entries_by_note
                .entry(note_id.to_string())
                .or_default()
                .push(entry);
        }
    }

    let mut todos_by_note: HashMap<String, Vec<Value>> = HashMap::new();
    let mut standalone_todos: Vec<Value> = Vec::new();
    for todo in todos {
        match todo.get("noteId").and_then(Value::as_str) {
            Some(note_id) => todos_by_note
                .entry(note_id.to_string())
                .or_default()
                .push(todo),
            // A todo without a note is owned by no bundle, so it stays in the
            // root state instead of being dropped with the notes array.
            None => standalone_todos.push(todo),
        }
    }

    let mut note_bundles = Vec::new();
    for note in notes {
        let Some(note_id) = note.get("id").and_then(Value::as_str).map(str::to_string) else {
            continue;
        };

        note_bundles.push(NoteBundle {
            schema_version: CURRENT_DATA_VERSION,
            note,
            entries: entries_by_note.remove(&note_id).unwrap_or_default(),
            todos: todos_by_note.remove(&note_id).unwrap_or_default(),
        });
    }

    let mut root_map = map.clone();
    root_map.remove("notes");
    root_map.remove("entries");
    root_map.remove("deletedStack");
    root_map.remove("activities");
    // Standalone todos have no bundle to live in; keep them on the root so a
    // restart can restore them.
    if standalone_todos.is_empty() {
        root_map.remove("todos");
    } else {
        root_map.insert("todos".to_string(), Value::Array(standalone_todos));
    }

    (Value::Object(root_map), note_bundles, deleted_stack)
}

fn merge_root_state_with_notes(
    mut root_state: Value,
    note_bundles: Vec<NoteBundle>,
    deleted_stack: Vec<DeletedSnapshot>,
) -> Value {
    let Some(root_map) = root_state.as_object_mut() else {
        return root_state;
    };

    let Some(state_value) = root_map.get_mut("state") else {
        return merge_inner_state(root_state, note_bundles, deleted_stack);
    };

    let next_state = merge_inner_state(state_value.clone(), note_bundles, deleted_stack);
    root_map.insert("state".to_string(), next_state);
    root_state
}

fn merge_inner_state(
    mut inner_state: Value,
    note_bundles: Vec<NoteBundle>,
    deleted_stack: Vec<DeletedSnapshot>,
) -> Value {
    let Some(root_map) = inner_state.as_object_mut() else {
        return inner_state;
    };

    let mut notes = Vec::new();
    let mut entries = Vec::new();
    let mut todos = Vec::new();

    // Todos that belong to no bundle live on the root state; carry them over
    // before folding in the per-note todos.
    if let Some(existing) = root_map.get("todos").and_then(Value::as_array) {
        todos.extend(existing.iter().cloned());
    }

    for bundle in note_bundles {
        notes.push(bundle.note);
        entries.extend(bundle.entries);
        todos.extend(bundle.todos);
    }

    notes.sort_by(|a, b| compare_json_field_desc(a, b, "updatedAt"));
    entries.sort_by(|a, b| compare_json_field_desc(a, b, "updatedAt"));
    todos.sort_by(|a, b| compare_json_field_desc(a, b, "updatedAt"));

    root_map.insert("notes".to_string(), Value::Array(notes));
    root_map.insert("entries".to_string(), Value::Array(entries));
    root_map.insert("todos".to_string(), Value::Array(todos));
    let deleted_stack_value =
        serde_json::to_value(deleted_stack).unwrap_or(Value::Array(Vec::new()));
    root_map.insert("deletedStack".to_string(), deleted_stack_value);
    root_map.remove("activities");
    inner_state
}

fn note_content(note: &Value) -> Option<&str> {
    note.get("content").and_then(Value::as_str)
}

fn build_note_search_text(note: &Value, title: &str, todos: &[Value]) -> String {
    let mut parts = vec![title.to_string()];
    if let Some(content) = note_content(note) {
        parts.push(content.to_string());
    }
    for todo in todos {
        if let Some(text) = todo.get("title").and_then(Value::as_str) {
            parts.push(text.to_string());
        }
    }
    parts.join("\n")
}

fn build_note_preview(note: &Value, todos: &[Value]) -> String {
    if let Some(content) = note_content(note) {
        let preview = preview_text(content, 140);
        if !preview.is_empty() {
            return preview;
        }
    }

    if let Some(todo) = todos
        .first()
        .and_then(|value| value.get("title").and_then(Value::as_str))
    {
        return preview_text(todo, 140);
    }

    String::new()
}

fn preview_text(text: &str, max_len: usize) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= max_len {
        return collapsed;
    }

    let truncated: String = collapsed.chars().take(max_len).collect();
    format!("{truncated}...")
}

fn compare_json_field_desc(left: &Value, right: &Value, key: &str) -> std::cmp::Ordering {
    let left_value = left.get(key).and_then(Value::as_str).unwrap_or_default();
    let right_value = right.get(key).and_then(Value::as_str).unwrap_or_default();
    right_value.cmp(left_value)
}

fn write_text_file(path: &Path, value: &str) -> Result<(), String> {
    atomic_write_bytes(path, value.as_bytes(), true)
}

fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), String> {
    if !from.exists() {
        return Ok(());
    }

    fs::create_dir_all(to).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(from).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let target_path = to.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| error.to_string())?;

        if file_type.is_dir() {
            copy_dir_recursive(&source_path, &target_path)?;
        } else if !target_path.exists() {
            fs::copy(&source_path, &target_path).map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

fn cleanup_orphan_attachments(app: &AppHandle, state_json: &str) -> Result<(), String> {
    let state = match serde_json::from_str::<Value>(state_json) {
        Ok(value) => value,
        Err(_) => return Ok(()),
    };

    let attachment_dir = images_dir_for_storage_root(&active_storage_root(app)?);
    if !attachment_dir.exists() {
        return Ok(());
    }

    cleanup_orphan_attachments_in_dir(&attachment_dir, &state, current_millis_label())
}

fn attachment_quarantine_dir(attachment_dir: &Path) -> PathBuf {
    attachment_dir.join(ATTACHMENT_QUARANTINE_DIR_NAME)
}

fn restore_attachment_group_from_quarantine(
    attachment_dir: &Path,
    group_key: &str,
) -> Result<(), String> {
    let quarantine_dir = attachment_quarantine_dir(attachment_dir);
    if !quarantine_dir.exists() {
        return Ok(());
    }

    for batch in fs::read_dir(&quarantine_dir).map_err(|error| error.to_string())? {
        let batch = batch.map_err(|error| error.to_string())?;
        if !batch
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            continue;
        }
        for entry in fs::read_dir(batch.path()).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            if !entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_file()
            {
                continue;
            }
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if attachment_group_key(&file_name) != group_key {
                continue;
            }
            let target = attachment_dir.join(&file_name);
            if !target.exists() {
                // `exists` follows links, so a dangling symbolic link has to be
                // detected separately before it is turned into a real file.
                if fs::symlink_metadata(&target).is_ok() {
                    continue;
                }
                fs::rename(entry.path(), &target).map_err(|error| error.to_string())?;
                sync_parent_directory(&target)?;
            }
        }
        remove_directory_if_empty(&batch.path())?;
    }
    remove_directory_if_empty(&quarantine_dir)
}

fn restore_referenced_quarantined_attachments(
    attachment_dir: &Path,
    referenced: &HashSet<String>,
) -> Result<(), String> {
    for group_key in referenced {
        restore_attachment_group_from_quarantine(attachment_dir, group_key)?;
    }
    Ok(())
}

fn remove_directory_if_empty(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let mut entries = fs::read_dir(path).map_err(|error| error.to_string())?;
    if entries.next().is_none() {
        fs::remove_dir(path).map_err(|error| error.to_string())?;
        sync_parent_directory(path)?;
    }
    Ok(())
}

fn prune_expired_attachment_quarantine(
    attachment_dir: &Path,
    now_millis: u128,
) -> Result<(), String> {
    let quarantine_dir = attachment_quarantine_dir(attachment_dir);
    if !quarantine_dir.exists() {
        return Ok(());
    }

    for batch in fs::read_dir(&quarantine_dir).map_err(|error| error.to_string())? {
        let batch = batch.map_err(|error| error.to_string())?;
        if !batch
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            continue;
        }
        let created_at = batch.file_name().to_string_lossy().parse::<u128>().ok();
        if created_at.is_some_and(|created_at| {
            now_millis.saturating_sub(created_at) >= ATTACHMENT_QUARANTINE_RETENTION_MS
        }) {
            fs::remove_dir_all(batch.path()).map_err(|error| error.to_string())?;
        }
    }
    remove_directory_if_empty(&quarantine_dir)
}

fn cleanup_orphan_attachments_in_dir(
    attachment_dir: &Path,
    state: &Value,
    now_millis: u128,
) -> Result<(), String> {
    let referenced = collect_attachment_reference_groups(state);
    restore_referenced_quarantined_attachments(attachment_dir, &referenced)?;
    prune_expired_attachment_quarantine(attachment_dir, now_millis)?;

    let quarantine_batch = attachment_quarantine_dir(attachment_dir).join(now_millis.to_string());
    let mut quarantined_any = false;
    for entry in fs::read_dir(attachment_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().into_owned();
        if !referenced.contains(&attachment_group_key(&file_name)) {
            fs::create_dir_all(&quarantine_batch).map_err(|error| error.to_string())?;
            let target = quarantine_batch.join(&file_name);
            if !target.exists() {
                fs::rename(entry.path(), &target).map_err(|error| error.to_string())?;
                sync_parent_directory(&target)?;
                sync_parent_directory(&entry.path())?;
                quarantined_any = true;
            }
        }
    }
    if quarantined_any {
        sync_parent_directory(&quarantine_batch)?;
    }
    Ok(())
}

fn attachment_cleanup_scheduler() -> &'static AttachmentCleanupScheduler {
    ATTACHMENT_CLEANUP_SCHEDULER.get_or_init(|| AttachmentCleanupScheduler {
        generation: AtomicU64::new(0),
        latest_state: Mutex::new(None),
    })
}

fn schedule_orphan_attachment_cleanup(app: AppHandle, state_json: String) {
    let scheduler = attachment_cleanup_scheduler();
    let generation = scheduler.generation.fetch_add(1, Ordering::SeqCst) + 1;

    if let Ok(mut latest_state) = scheduler.latest_state.lock() {
        *latest_state = Some(state_json);
    } else {
        return;
    }

    thread::spawn(move || {
        thread::sleep(std::time::Duration::from_millis(
            ATTACHMENT_CLEANUP_DELAY_MS,
        ));

        let scheduler = attachment_cleanup_scheduler();
        let Ok(state_guard) = scheduler.latest_state.lock() else {
            return;
        };

        if scheduler.generation.load(Ordering::SeqCst) != generation {
            return;
        }

        if let Some(state_json) = state_guard.as_ref() {
            let _ = cleanup_orphan_attachments(&app, state_json);
        }
    });
}

fn collect_attachment_references(value: &Value) -> HashSet<String> {
    let mut refs = HashSet::new();
    collect_attachment_references_recursive(value, &mut refs);
    refs
}

fn collect_attachment_reference_groups(value: &Value) -> HashSet<String> {
    collect_attachment_references(value)
        .into_iter()
        .map(|file_name| attachment_group_key(&file_name))
        .collect()
}

fn collect_attachment_references_recursive(value: &Value, refs: &mut HashSet<String>) {
    match value {
        Value::String(text) => {
            for reference in extract_attachment_references(text) {
                refs.insert(reference);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_attachment_references_recursive(item, refs);
            }
        }
        Value::Object(map) => {
            for item in map.values() {
                collect_attachment_references_recursive(item, refs);
            }
        }
        _ => {}
    }
}

fn extract_attachment_references(text: &str) -> Vec<String> {
    let mut refs = Vec::new();
    let mut remaining = text;

    while let Some(index) = remaining.find("attachment://") {
        let after = &remaining[index + "attachment://".len()..];
        let candidate: String = after
            .chars()
            .take_while(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
            .collect();
        let candidate_len = candidate.len();

        if !candidate.is_empty() {
            refs.push(candidate);
        }

        if after.len() <= candidate_len {
            break;
        }

        remaining = &after[candidate_len..];
    }

    refs
}

fn sanitize_attachment_name(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
        .collect()
}

fn attachment_group_key(file_name: &str) -> String {
    if let Some(index) = file_name.find(".preview.") {
        return file_name[..index].to_string();
    }

    if let Some(index) = file_name.find(".original.") {
        return file_name[..index].to_string();
    }

    if let Some(index) = file_name.rfind('.') {
        return file_name[..index].to_string();
    }

    file_name.to_string()
}

fn is_preview_attachment_name(file_name: &str) -> bool {
    file_name.contains(".preview.")
}

fn is_image_file_name(file_name: &str) -> bool {
    matches!(
        file_name.rsplit('.').next().map(|ext| ext.to_lowercase()),
        Some(ext) if matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "svg")
    )
}

fn store_optimized_attachment(
    storage_root: &Path,
    source_file_name: &str,
    attachment_base_name: &str,
    bytes: &[u8],
) -> Result<String, String> {
    let safe_base = sanitize_attachment_name(attachment_base_name);
    if safe_base.is_empty() {
        return Err("Attachment name is invalid.".to_string());
    }

    let source_ext = source_file_extension(source_file_name);
    let attachment_dir = images_dir_for_storage_root(storage_root);
    fs::create_dir_all(&attachment_dir).map_err(|error| error.to_string())?;

    let source_ext = if source_ext.is_empty() {
        "png".to_string()
    } else {
        source_ext
    };
    let original_file_name = format!("{safe_base}.original.{source_ext}");
    let original_path = attachment_dir.join(&original_file_name);
    ensure_inside_storage_root(storage_root, &original_path)?;
    fs::write(&original_path, bytes).map_err(|error| error.to_string())?;

    let preview_file_name = match build_preview_attachment(bytes, &source_ext, &safe_base) {
        Ok((preview_file_name, preview_bytes)) => {
            let preview_path = attachment_dir.join(&preview_file_name);
            ensure_inside_storage_root(storage_root, &preview_path)?;
            fs::write(&preview_path, preview_bytes).map_err(|error| error.to_string())?;
            preview_file_name
        }
        Err(_) => {
            let preview_file_name = format!("{safe_base}.preview.{source_ext}");
            let preview_path = attachment_dir.join(&preview_file_name);
            ensure_inside_storage_root(storage_root, &preview_path)?;
            fs::write(&preview_path, bytes).map_err(|error| error.to_string())?;
            preview_file_name
        }
    };

    Ok(preview_file_name)
}

fn source_file_extension(file_name: &str) -> String {
    if let Some(index) = file_name.rfind('.') {
        if index < file_name.len() - 1 {
            return file_name[index + 1..].to_lowercase();
        }
    }

    String::new()
}

fn build_preview_attachment(
    bytes: &[u8],
    source_ext: &str,
    safe_base: &str,
) -> Result<(String, Vec<u8>), String> {
    if matches!(source_ext, "svg" | "gif") {
        return Err("Skip optimization for vector/animated images.".to_string());
    }

    let decoded = image::load_from_memory(bytes).map_err(|error| error.to_string())?;
    let max_size = 1280;
    let width = decoded.width();
    let height = decoded.height();
    let scale = f32::min(1.0, max_size as f32 / width.max(height) as f32);
    let resized = if scale < 1.0 {
        let next_width = (width as f32 * scale).round().max(1.0) as u32;
        let next_height = (height as f32 * scale).round().max(1.0) as u32;
        decoded.resize(next_width, next_height, FilterType::Lanczos3)
    } else {
        decoded
    };

    let has_alpha = resized.color().has_alpha();
    let mut output = Cursor::new(Vec::new());
    let preview_ext = if has_alpha { "png" } else { "jpg" };
    if has_alpha {
        resized
            .write_to(&mut output, ImageFormat::Png)
            .map_err(|error| error.to_string())?;
    } else {
        resized
            .write_to(&mut output, ImageFormat::Jpeg)
            .map_err(|error| error.to_string())?;
    }

    Ok((
        format!("{safe_base}.preview.{preview_ext}"),
        output.into_inner(),
    ))
}

fn normalize_custom_path(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    Some(path_to_string(&resolve_storage_root(trimmed)))
}

fn validate_custom_path(value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Storage path cannot be empty.".to_string());
    }

    let expanded = expand_home_path(trimmed);
    if expanded.as_os_str().is_empty() {
        return Err("Storage path is invalid.".to_string());
    }

    if !expanded.is_absolute() {
        return Err("Storage path must be absolute or start with ~/.".to_string());
    }

    if trimmed.to_lowercase().ends_with(".json") {
        return Err("Storage path must be a folder, not a .json file.".to_string());
    }

    Ok(())
}

fn resolve_storage_root(value: &str) -> PathBuf {
    let expanded = expand_home_path(value);
    if is_legacy_state_file_path(&expanded) {
        expanded.parent().unwrap_or(&expanded).to_path_buf()
    } else {
        expanded
    }
}

fn is_legacy_state_file_path(path: &Path) -> bool {
    matches!(path.extension().and_then(|ext| ext.to_str()), Some("json"))
}

fn expand_home_path(value: &str) -> PathBuf {
    if value == "~" || value.starts_with("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            let suffix = value.trim_start_matches("~/");
            return PathBuf::from(home).join(suffix);
        }
    }

    PathBuf::from(value)
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct TestStorage {
        root: PathBuf,
    }

    impl TestStorage {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "otternote-{name}-{}-{}",
                std::process::id(),
                current_millis_label()
            ));
            fs::create_dir_all(&root).unwrap();
            ensure_storage_layout(&root).unwrap();
            Self { root }
        }
    }

    impl Drop for TestStorage {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn note_bundle(id: &str, title: &str) -> NoteBundle {
        NoteBundle {
            schema_version: CURRENT_DATA_VERSION,
            note: json!({
                "id": id,
                "title": title,
                "createdAt": "2026-01-01T00:00:00.000Z",
                "updatedAt": "2026-01-01T00:00:00.000Z"
            }),
            entries: vec![json!({
                "id": format!("entry-{id}"),
                "noteId": id,
                "content": title,
                "createdAt": "2026-01-01T00:00:00.000Z",
                "updatedAt": "2026-01-01T00:00:00.000Z"
            })],
            todos: Vec::new(),
        }
    }

    fn root_state(label: &str) -> Value {
        json!({
            "state": {
                "activeSection": "notes",
                "label": label
            },
            "version": 0
        })
    }

    #[test]
    fn standalone_todos_survive_a_split_and_merge_round_trip() {
        let state = json!({
            "state": {
                "notes": [{
                    "id": "note-1",
                    "title": "Note",
                    "createdAt": "2026-01-01T00:00:00.000Z",
                    "updatedAt": "2026-01-01T00:00:00.000Z"
                }],
                "todos": [
                    {
                        "id": "todo-note",
                        "noteId": "note-1",
                        "title": "belongs to a note",
                        "status": "todo",
                        "source": "note",
                        "createdAt": "2026-01-01T00:00:00.000Z",
                        "updatedAt": "2026-01-01T00:00:00.000Z"
                    },
                    {
                        "id": "todo-standalone",
                        "title": "no note at all",
                        "status": "todo",
                        "source": "standalone",
                        "createdAt": "2026-01-02T00:00:00.000Z",
                        "updatedAt": "2026-01-02T00:00:00.000Z"
                    }
                ]
            },
            "version": 0
        });

        let (root_state, note_bundles, deleted_stack) = split_app_state(&state);

        // The note-bound todo rides in the bundle; the standalone one stays on
        // the root state so it is not lost when only the bundle files persist.
        assert_eq!(note_bundles.len(), 1);
        assert_eq!(note_bundles[0].todos.len(), 1);
        assert_eq!(
            note_bundles[0].todos[0].get("id").and_then(Value::as_str),
            Some("todo-note")
        );
        let kept = root_state["state"]["todos"].as_array().unwrap();
        assert_eq!(kept.len(), 1);
        assert_eq!(
            kept[0].get("id").and_then(Value::as_str),
            Some("todo-standalone")
        );

        let merged = merge_root_state_with_notes(root_state, note_bundles, deleted_stack);
        let mut ids = merged["state"]["todos"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|todo| todo.get("id").and_then(Value::as_str).map(str::to_string))
            .collect::<Vec<_>>();
        ids.sort();
        assert_eq!(ids, vec!["todo-note", "todo-standalone"]);
    }

    #[test]
    fn standalone_todos_survive_a_full_disk_round_trip() {
        let storage = TestStorage::new("standalone-round-trip");
        let state_path = state_file_path_from_root(&storage.root);
        let state = json!({
            "dataVersion": CURRENT_DATA_VERSION,
            "state": {
                "todos": [{
                    "id": "todo-standalone",
                    "title": "no note at all",
                    "status": "todo",
                    "source": "standalone",
                    "createdAt": "2026-01-02T00:00:00.000Z",
                    "updatedAt": "2026-01-02T00:00:00.000Z"
                }]
            },
            "version": 0
        });

        let (root_state, note_bundles, deleted_stack) = split_app_state(&state);
        write_app_state_transaction(
            &storage.root,
            &state_path,
            root_state,
            &note_bundles,
            &deleted_stack,
            None,
        )
        .unwrap();

        // Simulate a cold start: read only what is on disk.
        let persisted = read_json_file_with_recovery::<Value>(&state_path)
            .unwrap()
            .unwrap();
        let (root_state, _, deleted_stack) = split_app_state(&persisted);
        let note_bundles = read_note_bundles(
            &notes_dir_for_storage_root(&storage.root),
            &HashSet::new(),
        )
        .unwrap();
        let merged = merge_root_state_with_notes(root_state, note_bundles, deleted_stack);

        let ids = merged["state"]["todos"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|todo| todo.get("id").and_then(Value::as_str).map(str::to_string))
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["todo-standalone"]);
    }

    #[test]
    fn interrupted_temp_write_keeps_primary_json_readable() {
        let storage = TestStorage::new("interrupted-temp");
        let path = storage.root.join("sample.json");
        write_json_file(&path, &json!({ "value": "stable" })).unwrap();

        write_and_sync_file(&temporary_file_path(&path), br#"{"value":"partial"#).unwrap();

        let recovered = read_json_file_with_recovery::<Value>(&path)
            .unwrap()
            .unwrap();
        assert_eq!(recovered["value"], "stable");
    }

    #[test]
    fn corrupted_json_is_restored_from_last_good_backup() {
        let storage = TestStorage::new("corrupt-recovery");
        let path = storage.root.join("sample.json");
        write_json_file(&path, &json!({ "value": "previous" })).unwrap();
        write_json_file(&path, &json!({ "value": "latest" })).unwrap();
        fs::write(&path, br#"{"value": "truncated"#).unwrap();

        let recovered = read_json_file_with_recovery::<Value>(&path)
            .unwrap()
            .unwrap();
        assert_eq!(recovered["value"], "previous");
        let restored = serde_json::from_slice::<Value>(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(restored["value"], "previous");
    }

    #[test]
    fn storage_failure_during_staging_does_not_replace_any_primary_file() {
        let storage = TestStorage::new("storage-full");
        let state_path = state_file_path_from_root(&storage.root);
        let original_notes = vec![note_bundle("note-1", "Original")];
        write_app_state_transaction(
            &storage.root,
            &state_path,
            root_state("original"),
            &original_notes,
            &[],
            None,
        )
        .unwrap();

        let tracked_paths = [
            state_path.clone(),
            note_bundle_path(&storage.root, "note-1"),
            search_index_path(&storage.root),
            deleted_stack_file_path(&storage.root),
        ];
        let before = tracked_paths
            .iter()
            .map(|path| fs::read(path).unwrap())
            .collect::<Vec<_>>();

        let result = write_app_state_transaction(
            &storage.root,
            &state_path,
            root_state("changed"),
            &[note_bundle("note-1", "Changed")],
            &[],
            Some(1),
        );

        assert!(result
            .unwrap_err()
            .contains("Simulated storage write failure"));
        for (path, expected) in tracked_paths.iter().zip(before) {
            assert_eq!(fs::read(path).unwrap(), expected);
        }
        assert!(!storage.root.join(PENDING_TRANSACTION_FILE_NAME).exists());
    }

    #[test]
    fn pending_multi_file_commit_is_completed_during_recovery() {
        let storage = TestStorage::new("pending-commit");
        let state_path = state_file_path_from_root(&storage.root);
        write_json_file(&state_path, &json!({ "dataVersion": 1, "value": "old" })).unwrap();
        let deleted_path = deleted_stack_file_path(&storage.root);
        write_json_file(
            &deleted_path,
            &VersionedDeletedStack {
                data_version: CURRENT_DATA_VERSION,
                items: Vec::new(),
            },
        )
        .unwrap();

        write_and_sync_file(
            &temporary_file_path(&state_path),
            &serialize_pretty(&json!({ "dataVersion": 1, "value": "new" })).unwrap(),
        )
        .unwrap();
        write_and_sync_file(
            &temporary_file_path(&deleted_path),
            &serialize_pretty(&VersionedDeletedStack {
                data_version: CURRENT_DATA_VERSION,
                items: Vec::new(),
            })
            .unwrap(),
        )
        .unwrap();

        let transaction = PendingTransaction {
            data_version: CURRENT_DATA_VERSION,
            files: vec![
                STATE_FILE_NAME.to_string(),
                DELETED_STACK_FILE_NAME.to_string(),
            ],
            deletions: Vec::new(),
        };
        let journal_path = storage.root.join(PENDING_TRANSACTION_FILE_NAME);
        atomic_write_bytes(
            &journal_path,
            &serialize_pretty(&transaction).unwrap(),
            false,
        )
        .unwrap();

        // Simulate a process crash after only the first rename.
        commit_staged_file(&state_path).unwrap();
        recover_pending_transaction(&storage.root).unwrap();

        let state = read_json_file_with_recovery::<Value>(&state_path)
            .unwrap()
            .unwrap();
        assert_eq!(state["value"], "new");
        assert!(!temporary_file_path(&deleted_path).exists());
        assert!(!journal_path.exists());
    }

    #[test]
    fn transaction_writes_only_files_whose_content_changed() {
        let storage = TestStorage::new("changed-files-only");
        let state_path = state_file_path_from_root(&storage.root);
        let notes = vec![note_bundle("note-1", "Unchanged note")];
        write_app_state_transaction(
            &storage.root,
            &state_path,
            root_state("before"),
            &notes,
            &[],
            None,
        )
        .unwrap();

        write_app_state_transaction(
            &storage.root,
            &state_path,
            root_state("after"),
            &notes,
            &[],
            None,
        )
        .unwrap();

        assert!(backup_file_path(&state_path).exists());
        assert!(!backup_file_path(&note_bundle_path(&storage.root, "note-1")).exists());
        assert!(!backup_file_path(&search_index_path(&storage.root)).exists());
        assert!(!backup_file_path(&deleted_stack_file_path(&storage.root)).exists());
    }

    #[test]
    fn backup_only_note_is_restored_during_startup_scan() {
        let storage = TestStorage::new("backup-only-note");
        let path = note_bundle_path(&storage.root, "note-1");
        let content = serialize_pretty(&note_bundle("note-1", "Recovered note")).unwrap();
        atomic_write_bytes(&backup_file_path(&path), &content, false).unwrap();

        let bundles =
            read_note_bundles(&notes_dir_for_storage_root(&storage.root), &HashSet::new()).unwrap();

        assert_eq!(bundles.len(), 1);
        assert_eq!(bundles[0].note["title"], "Recovered note");
        assert!(path.exists());
    }

    #[test]
    fn deleted_notes_are_never_resurrected_from_backups_at_startup() {
        let storage = TestStorage::new("no-bak-resurrection");
        let notes_dir = notes_dir_for_storage_root(&storage.root);
        let doomed = note_bundle_path(&storage.root, "doomed");
        let survivor = note_bundle_path(&storage.root, "survivor");
        write_json_file(&doomed, &note_bundle("doomed", "Doomed note")).unwrap();
        write_json_file(&survivor, &note_bundle("survivor", "Survivor")).unwrap();

        // Simulate the state left behind by a delete committed through the
        // transaction path: primary removed, backup retained.
        let _ = fs::copy(&doomed, backup_file_path(&doomed));
        fs::remove_file(&doomed).unwrap();

        let deleted: HashSet<String> = ["doomed.json".to_string()].into_iter().collect();
        let bundles = read_note_bundles(&notes_dir, &deleted).unwrap();

        assert_eq!(bundles.len(), 1);
        assert_eq!(bundles[0].note["id"], "survivor");
        assert!(!doomed.exists(), "deleted primary must stay removed");
        assert!(
            !backup_file_path(&doomed).exists(),
            "deleted backup must be purged so it cannot resurrect"
        );
        assert!(survivor.exists());
    }

    #[test]
    fn empty_snapshot_cannot_silently_delete_existing_notes() {
        let storage = TestStorage::new("reject-empty-snapshot");
        let state_path = state_file_path_from_root(&storage.root);
        write_app_state_transaction(
            &storage.root,
            &state_path,
            root_state("with-note"),
            &[note_bundle("note-1", "Protected note")],
            &[],
            None,
        )
        .unwrap();

        let result = write_app_state_transaction(
            &storage.root,
            &state_path,
            root_state("unexpected-empty"),
            &[],
            &[],
            None,
        );

        assert!(result
            .unwrap_err()
            .contains("Refusing to remove note files"));
        assert!(note_bundle_path(&storage.root, "note-1").exists());

        let deletion = DeletedSnapshot {
            snapshot_type: "note".to_string(),
            note: Some(json!({ "id": "note-1", "title": "Protected note" })),
            entry: None,
            todo: None,
            entries: Vec::new(),
            todos: Vec::new(),
            recent_note_ids: Vec::new(),
        };
        write_app_state_transaction(
            &storage.root,
            &state_path,
            root_state("explicit-empty"),
            &[],
            &[deletion],
            None,
        )
        .unwrap();
        assert!(!note_bundle_path(&storage.root, "note-1").exists());
    }

    #[test]
    fn stale_snapshot_cannot_resurrect_a_pending_deleted_note() {
        let storage = TestStorage::new("reject-stale-resurrection");
        let state_path = state_file_path_from_root(&storage.root);
        write_app_state_transaction(
            &storage.root,
            &state_path,
            root_state("with-notes"),
            &[
                note_bundle("note-1", "Doomed note"),
                note_bundle("note-2", "Survivor"),
            ],
            &[],
            None,
        )
        .unwrap();

        // A secondary window that has not yet synced the deletion flushes a
        // snapshot still containing note-1, alongside the deletion record.
        let deletion = DeletedSnapshot {
            snapshot_type: "note".to_string(),
            note: Some(json!({ "id": "note-1", "title": "Doomed note" })),
            entry: None,
            todo: None,
            entries: Vec::new(),
            todos: Vec::new(),
            recent_note_ids: Vec::new(),
        };
        write_app_state_transaction(
            &storage.root,
            &state_path,
            root_state("stale-with-deleted"),
            &[
                note_bundle("note-1", "Doomed note"),
                note_bundle("note-2", "Survivor"),
            ],
            &[deletion],
            None,
        )
        .unwrap();

        assert!(
            !note_bundle_path(&storage.root, "note-1").exists(),
            "pending-deleted note must stay removed even when present in the snapshot"
        );
        assert!(note_bundle_path(&storage.root, "note-2").exists());

        let index: VersionedSearchIndex =
            read_json_file_with_recovery(&search_index_path(&storage.root))
                .unwrap()
                .expect("search index should exist");
        let indexed_ids = index
            .records
            .iter()
            .map(|record| record.note_id.as_str())
            .collect::<Vec<_>>();
        assert!(!indexed_ids.contains(&"note-1"));
        assert!(indexed_ids.contains(&"note-2"));
    }

    #[test]
    fn orphan_attachments_are_quarantined_and_restored_when_referenced_again() {
        let storage = TestStorage::new("attachment-quarantine");
        let attachment_dir = images_dir_for_storage_root(&storage.root);
        let preview_name = "asset-1.preview.png";
        let original_name = "asset-1.original.png";
        fs::write(attachment_dir.join(preview_name), b"preview").unwrap();
        fs::write(attachment_dir.join(original_name), b"original").unwrap();

        cleanup_orphan_attachments_in_dir(&attachment_dir, &json!({ "state": {} }), 1_000).unwrap();

        assert!(!attachment_dir.join(preview_name).exists());
        assert!(!attachment_dir.join(original_name).exists());
        assert!(attachment_quarantine_dir(&attachment_dir)
            .join("1000")
            .join(preview_name)
            .exists());

        let referenced_state = json!({
            "state": {
                "entries": [{
                    "content": "![image](attachment://asset-1.preview.png)"
                }]
            }
        });
        cleanup_orphan_attachments_in_dir(&attachment_dir, &referenced_state, 1_001).unwrap();

        assert_eq!(
            fs::read(attachment_dir.join(preview_name)).unwrap(),
            b"preview"
        );
        assert_eq!(
            fs::read(attachment_dir.join(original_name)).unwrap(),
            b"original"
        );
        assert!(!attachment_quarantine_dir(&attachment_dir).exists());
    }

    #[test]
    fn quarantined_attachments_are_pruned_only_after_retention_period() {
        let storage = TestStorage::new("attachment-retention");
        let attachment_dir = images_dir_for_storage_root(&storage.root);
        let file_name = "asset-2.preview.png";
        fs::write(attachment_dir.join(file_name), b"preview").unwrap();

        cleanup_orphan_attachments_in_dir(&attachment_dir, &json!({}), 2_000).unwrap();
        let quarantined = attachment_quarantine_dir(&attachment_dir)
            .join("2000")
            .join(file_name);
        assert!(quarantined.exists());

        cleanup_orphan_attachments_in_dir(
            &attachment_dir,
            &json!({}),
            2_000 + ATTACHMENT_QUARANTINE_RETENTION_MS - 1,
        )
        .unwrap();
        assert!(quarantined.exists());

        cleanup_orphan_attachments_in_dir(
            &attachment_dir,
            &json!({}),
            2_000 + ATTACHMENT_QUARANTINE_RETENTION_MS,
        )
        .unwrap();
        assert!(!quarantined.exists());
    }

    #[test]
    fn legacy_root_state_is_migrated_to_current_data_version() {
        let (migrated, changed) = migrate_root_state(root_state("legacy")).unwrap();
        assert!(changed);
        assert_eq!(migrated["dataVersion"], CURRENT_DATA_VERSION);

        let (unchanged, changed_again) = migrate_root_state(migrated.clone()).unwrap();
        assert!(!changed_again);
        assert_eq!(unchanged, migrated);
    }

    #[test]
    fn note_ids_that_could_escape_the_notes_directory_are_rejected() {
        assert!(!is_valid_note_id(""));
        assert!(!is_valid_note_id("."));
        assert!(!is_valid_note_id(".."));
        assert!(!is_valid_note_id("../state"));
        assert!(!is_valid_note_id("notes/../../etc/passwd"));
        assert!(!is_valid_note_id("..\\secret"));
        assert!(!is_valid_note_id("nested/note"));
        assert!(!is_valid_note_id("nested\\note"));
    }

    #[test]
    fn generated_note_ids_are_accepted() {
        assert!(is_valid_note_id("b3f1c0de-1111-4222-8333-444455556666"));
        assert!(is_valid_note_id("note_m1b2c3d4e5f"));
    }

    #[test]
    fn paths_outside_the_storage_directory_are_rejected() {
        let storage = TestStorage::new("containment-outside");

        ensure_inside_storage_root(&storage.root, &storage.root.join("notes/note.json")).unwrap();

        let next_to_it = storage.root.parent().unwrap().join("elsewhere.json");
        let error = ensure_inside_storage_root(&storage.root, &next_to_it)
            .expect_err("a sibling of the storage root is not ours to write");
        assert!(
            error.contains("outside the storage directory"),
            "got: {error}"
        );

        // `Path::join` with a leading separator silently replaces everything
        // before it, which is what a note id or an attachment name must never be
        // able to do to a path we are about to write.
        let replaced = PathBuf::from("/etc/passwd");
        let error = ensure_inside_storage_root(&storage.root, &replaced)
            .expect_err("an absolute path is not inside the storage directory");
        assert!(
            error.contains("outside the storage directory"),
            "got: {error}"
        );
    }

    #[test]
    fn a_legacy_migration_may_not_use_a_note_id_as_a_path() {
        let storage = TestStorage::new("containment-migration");

        let error = write_note_bundles(&storage.root, &[note_bundle("../../escape", "x")])
            .expect_err("an id containing separators must never become a path");
        assert!(error.contains("file name"), "got: {error}");
        assert!(
            !storage.root.parent().unwrap().join("escape.json").exists(),
            "nothing may be written next to the storage directory"
        );
    }

    #[cfg(unix)]
    #[test]
    fn symbolic_links_below_the_storage_directory_are_rejected() {
        let storage = TestStorage::new("containment-symlink");
        let secret = std::env::temp_dir().join(format!(
            "otternote-symlink-target-{}.txt",
            std::process::id()
        ));
        fs::write(&secret, "not yours").unwrap();

        // A link standing in for a note file would leak or overwrite its target.
        let note = notes_dir_for_storage_root(&storage.root).join("planted.json");
        std::os::unix::fs::symlink(&secret, &note).unwrap();
        let error = ensure_inside_storage_root(&storage.root, &note)
            .expect_err("a note may not be a symbolic link");
        assert!(error.contains("Symbolic links"), "got: {error}");
        assert_eq!(fs::read_to_string(&secret).unwrap(), "not yours");

        // The same holds for a link that replaces the whole images directory.
        let elsewhere = storage.root.join("elsewhere");
        fs::create_dir_all(&elsewhere).unwrap();
        let images = images_dir_for_storage_root(&storage.root);
        fs::remove_dir_all(&images).unwrap();
        std::os::unix::fs::symlink(&elsewhere, &images).unwrap();
        assert!(ensure_inside_storage_root(&storage.root, &images.join("a.png")).is_err());

        fs::remove_file(&secret).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_note_that_is_a_symbolic_link_is_never_written_through() {
        let storage = TestStorage::new("write-through-note");
        let secret = std::env::temp_dir().join(format!(
            "otternote-write-through-note-{}.txt",
            std::process::id()
        ));
        fs::write(&secret, "untouched").unwrap();
        std::os::unix::fs::symlink(&secret, note_bundle_path(&storage.root, "planted")).unwrap();

        let error = write_app_state_transaction(
            &storage.root,
            &state_file_path_from_root(&storage.root),
            root_state("x"),
            &[note_bundle("planted", "Planted")],
            &[],
            None,
        )
        .expect_err("a note file may not be a link to somewhere else");
        assert!(error.contains("Symbolic links"), "got: {error}");
        assert_eq!(fs::read_to_string(&secret).unwrap(), "untouched");
        assert!(
            !state_file_path_from_root(&storage.root).exists(),
            "the whole transaction is refused, not just the offending file"
        );
        assert!(
            note_bundle_path(&storage.root, "planted")
                .symlink_metadata()
                .map(|metadata| metadata.file_type().is_symlink())
                .unwrap_or(false),
            "a refused transaction must not replace the link with a real file either"
        );
        assert!(
            !storage.root.join(PENDING_TRANSACTION_FILE_NAME).exists(),
            "the refusal must happen before anything is staged"
        );
        assert!(
            fs::read_dir(notes_dir_for_storage_root(&storage.root))
                .unwrap()
                .all(|entry| !entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".tmp")),
            "nothing may be staged for a path we refuse"
        );

        fs::remove_file(&secret).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn an_images_directory_behind_a_symbolic_link_is_never_written_through() {
        let storage = TestStorage::new("write-through-image");
        let elsewhere = std::env::temp_dir().join(format!(
            "otternote-write-through-image-{}",
            std::process::id()
        ));
        fs::create_dir_all(&elsewhere).unwrap();
        let images = images_dir_for_storage_root(&storage.root);
        fs::remove_dir_all(&images).unwrap();
        std::os::unix::fs::symlink(&elsewhere, &images).unwrap();

        let error = store_optimized_attachment(&storage.root, "pic.png", "pic", &[0u8; 4])
            .expect_err("attachments may not land outside the storage directory");
        assert!(error.contains("Symbolic links"), "got: {error}");
        assert_eq!(fs::read_dir(&elsewhere).unwrap().count(), 0);

        fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn note_bundle_paths_stay_inside_the_notes_directory() {
        let storage_root = Path::new("/tmp/otter-test");
        let path = note_bundle_path(storage_root, "b3f1c0de-1111-4222-8333-444455556666");

        assert!(path.starts_with(notes_dir_for_storage_root(storage_root)));
        assert_eq!(
            path.file_name().unwrap(),
            "b3f1c0de-1111-4222-8333-444455556666.json"
        );
    }

    #[test]
    fn transaction_paths_must_be_relative_and_normal() {
        let storage_root = Path::new("/tmp/otter-test");

        assert_eq!(
            resolve_transaction_path(storage_root, "notes/a.json").unwrap(),
            storage_root.join("notes/a.json")
        );

        for unsafe_path in [
            "/absolute.json",
            "../state.json",
            "notes/../../state.json",
            "./state.json",
        ] {
            assert!(
                resolve_transaction_path(storage_root, unsafe_path).is_err(),
                "expected {unsafe_path} to be rejected"
            );
        }

        // Redundant `.` components are normalized away by the path parser, so
        // they still resolve inside the storage root.
        assert!(resolve_transaction_path(storage_root, "notes/./a.json")
            .unwrap()
            .starts_with(storage_root));
    }

    #[test]
    fn attachment_names_lose_characters_that_are_not_file_safe() {
        assert_eq!(
            sanitize_attachment_name("asset-1.preview.png"),
            "asset-1.preview.png"
        );
        assert_eq!(sanitize_attachment_name("../etc/passwd"), "..etcpasswd");
        assert_eq!(sanitize_attachment_name("../../secret"), "....secret");
        assert_eq!(sanitize_attachment_name("asset 1.png"), "asset1.png");
        assert_eq!(sanitize_attachment_name("画像.png"), ".png");
        assert_eq!(sanitize_attachment_name(""), "");
    }

    #[test]
    fn sanitized_attachment_names_must_round_trip_to_be_accepted() {
        for rejected in ["../etc/passwd", "asset 1.png", "../../secret", "画像.png"] {
            let sanitized = sanitize_attachment_name(rejected);
            assert!(
                sanitized.is_empty() || sanitized != rejected,
                "expected {rejected} to fail the round trip check"
            );
        }

        assert_eq!(sanitize_attachment_name("asset-1.png"), "asset-1.png");
    }

    #[test]
    fn attachment_groups_are_keyed_by_the_asset_name() {
        assert_eq!(attachment_group_key("asset-1.preview.png"), "asset-1");
        assert_eq!(attachment_group_key("asset-1.original.png"), "asset-1");
        assert_eq!(attachment_group_key("asset-1.png"), "asset-1");
        assert_eq!(attachment_group_key("asset-1"), "asset-1");
    }

    #[test]
    fn custom_storage_paths_must_be_folders_and_absolute() {
        assert!(validate_custom_path("").is_err());
        assert!(validate_custom_path("   ").is_err());
        assert!(validate_custom_path("relative/folder").is_err());
        assert!(validate_custom_path("/tmp/notes/state.json").is_err());
        assert!(validate_custom_path("/tmp/notes").is_ok());
    }

    #[test]
    fn window_labels_use_only_safe_characters() {
        assert_eq!(sanitize_window_label("note-1"), "note-1");
        assert_eq!(sanitize_window_label("note_1"), "note_1");
        assert_eq!(sanitize_window_label("note 1/b"), "note-1-b");
        assert_eq!(sanitize_window_label("../../x"), "------x");
    }

    #[cfg(debug_assertions)]
    #[test]
    fn development_data_root_lives_in_the_checkout() {
        assert_eq!(
            development_data_root(Path::new("/checkout/src-tauri")),
            Some(PathBuf::from("/checkout/data"))
        );
    }

    #[cfg(debug_assertions)]
    #[test]
    fn development_data_root_never_becomes_the_filesystem_root() {
        // A debug build launched from Finder runs with "/" as its working
        // directory, which is why the crate directory is used instead of
        // std::env::current_dir().
        assert_eq!(development_data_root(Path::new("/")), None);

        let data_dir = development_data_root(Path::new(env!("CARGO_MANIFEST_DIR")));
        let data_dir = data_dir.expect("the crate directory has a parent");
        assert!(data_dir.ends_with("data"));
        assert_ne!(data_dir, PathBuf::from("/data"));
        assert!(data_dir.is_absolute());
    }

    #[test]
    fn blank_scratch_directory_overrides_count_as_unset() {
        use std::ffi::OsStr;

        assert_eq!(parse_data_dir_override(None), None);
        assert_eq!(parse_data_dir_override(Some(OsStr::new(""))), None);
        assert_eq!(parse_data_dir_override(Some(OsStr::new("   "))), None);

        let scratch = std::env::temp_dir().join("otternote-scratch");
        assert_eq!(
            parse_data_dir_override(Some(OsStr::new(&scratch))),
            Some(scratch)
        );
    }

    #[test]
    fn release_default_root_is_exactly_the_home_otter_note_directory() {
        let home = Path::new("/home/user");

        assert!(root_is_release_default(
            Path::new("/home/user/OtterNote"),
            Some(home)
        ));
        assert!(!root_is_release_default(
            Path::new("/home/user/OtterNote/notes"),
            Some(home)
        ));
        assert!(!root_is_release_default(
            Path::new("/home/user/OtherNotes"),
            Some(home)
        ));
        assert!(!root_is_release_default(
            Path::new("/elsewhere/OtterNote"),
            Some(home)
        ));
        assert!(!root_is_release_default(
            Path::new("/home/user/OtterNote"),
            None
        ));
    }

    #[test]
    fn debug_builds_refuse_the_release_data_directory() {
        let home = Path::new("/home/user");
        let release_root = Path::new("/home/user/OtterNote");

        let error = guard_storage_root(release_root, Some(home), true)
            .expect_err("a debug build must not write into the release data");
        assert!(error.contains("OTTERNOTE_DATA_DIR"), "got: {error}");

        // A release build may use it, and a debug build is free to use anywhere
        // else, including a scratch directory the developer picked.
        assert!(guard_storage_root(release_root, Some(home), false).is_ok());
        assert!(guard_storage_root(Path::new("/checkout/data"), Some(home), true).is_ok());
        assert!(guard_storage_root(Path::new("/home/user/MyNotes"), Some(home), true).is_ok());
    }

    #[test]
    fn storage_root_prefers_the_configured_path_over_the_default() {
        let home = Path::new("/home/user");
        let default_root = PathBuf::from("/checkout/data");

        assert_eq!(
            choose_storage_root(
                Some("/home/user/MyNotes"),
                default_root.clone(),
                Some(home),
                true,
            )
            .unwrap(),
            PathBuf::from("/home/user/MyNotes")
        );
        assert_eq!(
            choose_storage_root(None, default_root.clone(), Some(home), true).unwrap(),
            default_root
        );
    }

    #[test]
    fn a_configured_home_path_is_still_refused_in_debug_builds() {
        let Some(home_os) = std::env::var_os("HOME") else {
            return;
        };
        let home = Path::new(&home_os);
        let default_root = home.join("elsewhere");

        let error =
            choose_storage_root(Some("~/OtterNote"), default_root.clone(), Some(home), true)
                .expect_err(
                    "a stored \"~/OtterNote\" must not send a debug build into the live data",
                );
        assert!(error.contains("OTTERNOTE_DATA_DIR"), "got: {error}");

        // A release build is supposed to use exactly that directory.
        assert!(choose_storage_root(Some("~/OtterNote"), default_root, Some(home), false).is_ok());
    }

    #[test]
    fn debug_builds_use_their_own_bootstrap_config() {
        let config_dir =
            PathBuf::from("/Users/me/Library/Application Support/com.otternote.desktop");
        let bootstrapped = debug_bootstrapped(config_dir.clone());

        #[cfg(debug_assertions)]
        assert_eq!(
            bootstrapped,
            PathBuf::from("/Users/me/Library/Application Support/com.otternote.desktop.dev")
        );
        #[cfg(not(debug_assertions))]
        assert_eq!(bootstrapped, config_dir);
    }

    #[test]
    fn parent_directories_are_created_before_writing() {
        let storage = TestStorage::new("parent-dir");
        let nested = storage.root.join("nested").join("storage.json");

        ensure_parent_directory(&nested).unwrap();
        assert!(storage.root.join("nested").is_dir());

        ensure_parent_directory(&nested).unwrap();
        ensure_parent_directory(Path::new("storage.json")).unwrap();
    }
}
