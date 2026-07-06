use image::{imageops::FilterType, ImageFormat};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::{atomic::{AtomicU64, Ordering}, Mutex, OnceLock},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const STATE_FILE_NAME: &str = "state.json";
const DELETED_STACK_FILE_NAME: &str = "deleted-stack.json";
const SEARCH_INDEX_FILE_NAME: &str = "search-index.json";
const NOTES_DIR_NAME: &str = "notes";
const IMAGES_DIR_NAME: &str = "images";
const LEGACY_IMAGES_DIR_NAME: &str = "otternote-assets";
const ATTACHMENT_CLEANUP_DELAY_MS: u64 = 1_500;

struct AttachmentCleanupScheduler {
    generation: AtomicU64,
    latest_state: Mutex<Option<String>>,
}

static ATTACHMENT_CLEANUP_SCHEDULER: OnceLock<AttachmentCleanupScheduler> = OnceLock::new();

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

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchIndexRecord {
    note_id: String,
    title: String,
    updated_at: String,
    search_text: String,
    preview: String,
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
    let state_path = state_file_path(&app)?;
    if state_path.exists() {
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
    let state_path = state_file_path(&app)?;
    let storage_root = active_storage_root(&app)?;
    ensure_storage_layout(&storage_root)?;
    ensure_legacy_image_migration(&storage_root)?;

    let parsed = serde_json::from_str::<Value>(&value).map_err(|error| error.to_string())?;
    let (root_state, note_bundles, deleted_stack) = split_app_state(&parsed);
    write_json_file(&state_path, &root_state)?;
    write_note_bundles(&storage_root, &note_bundles)?;
    write_search_index(&storage_root, &note_bundles)?;
    write_deleted_stack(&storage_root, &deleted_stack)?;
    let stable_state = read_full_app_state(&app, &state_path)?;
    schedule_orphan_attachment_cleanup(app, stable_state);
    Ok(())
}

#[tauri::command]
fn read_note_bundle(app: AppHandle, note_id: String) -> Result<Option<String>, String> {
    let bundle_path = note_bundle_path(&active_storage_root(&app)?, &note_id);
    if !bundle_path.exists() {
        return Ok(None);
    }

    fs::read_to_string(bundle_path)
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn search_notes(app: AppHandle, query: String) -> Result<Vec<Value>, String> {
    let index_path = search_index_path(&active_storage_root(&app)?);
    if !index_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(index_path).map_err(|error| error.to_string())?;
    let records = serde_json::from_str::<Vec<SearchIndexRecord>>(&content)
        .map_err(|error| error.to_string())?;
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

    write_json_file(
        &config_path,
        &StorageConfig {
            storage_path: next_custom_path.clone(),
        },
    )?;

    let new_storage_root = active_storage_root(&app)?;
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

    storage_info(&app)
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
    })
}

fn note_bundle_path(storage_root: &Path, note_id: &str) -> PathBuf {
    notes_dir_for_storage_root(storage_root).join(format!("{note_id}.json"))
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
    let config = read_storage_config(app)?;
    match config.storage_path {
        Some(path) => Ok(resolve_storage_root(&path)),
        None => default_storage_root(app),
    }
}

fn default_storage_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(home) = std::env::var_os("HOME") {
        return Ok(PathBuf::from(home).join("OtterNote"));
    }

    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("OtterNote"))
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
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join("storage.json"))
}

fn read_storage_config(app: &AppHandle) -> Result<StorageConfig, String> {
    let path = storage_config_path(app)?;
    if !path.exists() {
        return Ok(StorageConfig::default());
    }

    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let config =
        serde_json::from_str::<StorageConfig>(&content).map_err(|error| error.to_string())?;

    if let Some(storage_path) = config.storage_path.as_deref() {
        let expanded = expand_home_path(storage_path);
        if is_legacy_state_file_path(&expanded) {
            migrate_legacy_storage_file(app, &expanded)?;
            let default_config = StorageConfig::default();
            write_json_file(&storage_config_path(app)?, &default_config)?;
            return Ok(default_config);
        }
    }

    Ok(config)
}

fn write_json_file<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let content = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    write_text_file(path, &content)
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
    write_json_file(&deleted_stack_file_path(storage_root), &deleted_stack)
}

fn read_deleted_stack(storage_root: &Path) -> Result<Vec<DeletedSnapshot>, String> {
    let path = deleted_stack_file_path(storage_root);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str::<Vec<DeletedSnapshot>>(&content).map_err(|error| error.to_string())
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
        let file_name = format!("{note_id}.json");
        active_files.insert(file_name.clone());
        let next_bundle = NoteBundle {
            schema_version: 1,
            note: bundle.note.clone(),
            entries: bundle.entries.clone(),
            todos: bundle.todos.clone(),
        };
        write_json_file(&notes_dir.join(&file_name), &next_bundle)?;
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
    let index: Vec<SearchIndexRecord> = note_bundles
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
            let search_text = build_note_search_text(&title, &bundle.entries, &bundle.todos);
            let preview = build_note_preview(&bundle.entries, &bundle.todos);

            Some(SearchIndexRecord {
                note_id,
                title,
                updated_at,
                search_text,
                preview,
            })
        })
        .collect();

    write_json_file(&search_index_path(storage_root), &index)
}

fn read_full_app_state(app: &AppHandle, state_path: &Path) -> Result<String, String> {
    let root_content = fs::read_to_string(state_path).map_err(|error| error.to_string())?;
    let root_value =
        serde_json::from_str::<Value>(&root_content).map_err(|error| error.to_string())?;
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

    let note_bundles = read_note_bundles(&notes_dir)?;

    if note_bundles.is_empty() && effective_deleted_stack.is_empty() {
        return serde_json::to_string(&stripped_root).map_err(|error| error.to_string());
    }

    let merged = merge_root_state_with_notes(root_value, note_bundles, effective_deleted_stack);
    serde_json::to_string(&merged).map_err(|error| error.to_string())
}

fn read_note_bundles(notes_dir: &Path) -> Result<Vec<NoteBundle>, String> {
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
        if !file_name.ends_with(".json") {
            continue;
        }

        let content = fs::read_to_string(entry.path()).map_err(|error| error.to_string())?;
        let bundle =
            serde_json::from_str::<NoteBundle>(&content).map_err(|error| error.to_string())?;
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
    for todo in todos {
        if let Some(note_id) = todo.get("noteId").and_then(Value::as_str) {
            todos_by_note
                .entry(note_id.to_string())
                .or_default()
                .push(todo);
        }
    }

    let mut note_bundles = Vec::new();
    for note in notes {
        let Some(note_id) = note.get("id").and_then(Value::as_str).map(str::to_string) else {
            continue;
        };

        note_bundles.push(NoteBundle {
            schema_version: 1,
            note,
            entries: entries_by_note.remove(&note_id).unwrap_or_default(),
            todos: todos_by_note.remove(&note_id).unwrap_or_default(),
        });
    }

    let mut root_map = map.clone();
    root_map.remove("notes");
    root_map.remove("entries");
    root_map.remove("todos");
    root_map.remove("deletedStack");
    root_map.remove("activities");

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

fn build_note_search_text(title: &str, entries: &[Value], todos: &[Value]) -> String {
    let mut parts = Vec::new();
    parts.push(title.to_string());
    for entry in entries {
        if let Some(content) = entry.get("content").and_then(Value::as_str) {
            parts.push(content.to_string());
        }
    }
    for todo in todos {
        if let Some(text) = todo.get("title").and_then(Value::as_str) {
            parts.push(text.to_string());
        }
    }
    parts.join("\n")
}

fn build_note_preview(entries: &[Value], todos: &[Value]) -> String {
    if let Some(entry) = entries
        .first()
        .and_then(|value| value.get("content").and_then(Value::as_str))
    {
        return preview_text(entry, 140);
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
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::write(path, value).map_err(|error| error.to_string())
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

    let referenced = collect_attachment_reference_groups(&state);
    let mut deleted_files = Vec::new();
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
        if !referenced.contains(&attachment_group_key(&file_name)) {
            fs::remove_file(entry.path()).map_err(|error| error.to_string())?;
            deleted_files.push(file_name);
        }
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
        thread::sleep(std::time::Duration::from_millis(ATTACHMENT_CLEANUP_DELAY_MS));

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
    fs::write(&original_path, bytes).map_err(|error| error.to_string())?;

    let preview_file_name = match build_preview_attachment(bytes, &source_ext, &safe_base) {
        Ok((preview_file_name, preview_bytes)) => {
            let preview_path = attachment_dir.join(&preview_file_name);
            fs::write(&preview_path, preview_bytes).map_err(|error| error.to_string())?;
            preview_file_name
        }
        Err(_) => {
            let preview_file_name = format!("{safe_base}.preview.{source_ext}");
            let preview_path = attachment_dir.join(&preview_file_name);
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
