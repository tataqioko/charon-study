// Charon-Study API 后端
// base_url 锁死为指定站点,用户仅提供 key。
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

/// 锁死的 API 站点(用户改不了)。集中一处配置。
const API_BASE_URL: &str = "https://api.nktp.top/v1";
/// keyring 服务名与账户名,用于本地安全存储 API key。
const KEYRING_SERVICE: &str = "charon-study";
const KEYRING_ACCOUNT: &str = "api-key";

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("网络请求失败: {0}")]
    Http(String),
    #[error("未设置 API Key")]
    NoKey,
    #[error("密钥存储错误: {0}")]
    Keyring(String),
    #[error("接口返回错误 {status}: {message}")]
    Api { status: u16, message: String },
}

// 让错误能序列化回前端
impl Serialize for AppError {
    fn serialize<S>(&self, s: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        s.serialize_str(&self.to_string())
    }
}

type Result<T> = std::result::Result<T, AppError>;

fn keyring_entry() -> Result<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| AppError::Keyring(e.to_string()))
}

/// 保存 API key 到系统凭据管理器
#[tauri::command]
fn save_api_key(key: String) -> Result<()> {
    let entry = keyring_entry()?;
    entry
        .set_password(&key)
        .map_err(|e| AppError::Keyring(e.to_string()))
}

/// 是否已保存 key(不返回明文)
#[tauri::command]
fn has_api_key() -> bool {
    keyring_entry()
        .and_then(|e| e.get_password().map_err(|e| AppError::Keyring(e.to_string())))
        .map(|k| !k.is_empty())
        .unwrap_or(false)
}

/// 删除已保存的 key
#[tauri::command]
fn delete_api_key() -> Result<()> {
    let entry = keyring_entry()?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Keyring(e.to_string())),
    }
}

fn read_key() -> Result<String> {
    let entry = keyring_entry()?;
    match entry.get_password() {
        Ok(k) if !k.is_empty() => Ok(k),
        Ok(_) => Err(AppError::NoKey),
        Err(keyring::Error::NoEntry) => Err(AppError::NoKey),
        Err(e) => Err(AppError::Keyring(e.to_string())),
    }
}

/// 暴露锁死的站点地址给前端展示
#[tauri::command]
fn get_api_base_url() -> String {
    API_BASE_URL.to_string()
}

#[derive(Serialize)]
pub struct ModelInfo {
    pub id: String,
}

/// 拉取模型列表 GET /v1/models(用已保存的 key)
#[tauri::command]
async fn list_models() -> Result<Vec<ModelInfo>> {
    let key = read_key()?;
    fetch_models(&key).await
}

/// 用传入的 key 校验并拉模型(首启实时校验用,不预先保存)
#[tauri::command]
async fn list_models_with_key(key: String) -> Result<Vec<ModelInfo>> {
    if key.trim().is_empty() {
        return Err(AppError::NoKey);
    }
    fetch_models(key.trim()).await
}

/// 共享:向锁定站点拉取模型列表
async fn fetch_models(key: &str) -> Result<Vec<ModelInfo>> {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/models", API_BASE_URL))
        .bearer_auth(key)
        .send()
        .await
        .map_err(|e| AppError::Http(e.to_string()))?;

    let status = resp.status();
    if !status.is_success() {
        let message = resp.text().await.unwrap_or_default();
        return Err(AppError::Api {
            status: status.as_u16(),
            message,
        });
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Http(e.to_string()))?;

    let mut models: Vec<ModelInfo> = json
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(|v| v.as_str()))
                .map(|id| ModelInfo { id: id.to_string() })
                .collect()
        })
        .unwrap_or_default();

    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(models)
}

#[derive(Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// 流式事件(推给前端)
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum StreamEvent {
    Chunk { content: String },
    Done,
    Error { message: String },
}

/// 流式对话 POST /v1/chat/completions (stream=true, SSE)
#[tauri::command]
async fn chat_stream(
    model: String,
    messages: Vec<ChatMessage>,
    on_event: Channel<StreamEvent>,
) -> Result<()> {
    let key = read_key()?;
    let client = reqwest::Client::new();

    let body = serde_json::json!({
        "model": model,
        "messages": messages.iter().map(|m| serde_json::json!({
            "role": m.role, "content": m.content
        })).collect::<Vec<_>>(),
        "stream": true,
    });

    let resp = client
        .post(format!("{}/chat/completions", API_BASE_URL))
        .bearer_auth(&key)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Http(e.to_string()))?;

    let status = resp.status();
    if !status.is_success() {
        let message = resp.text().await.unwrap_or_default();
        let _ = on_event.send(StreamEvent::Error {
            message: format!("{}: {}", status.as_u16(), message),
        });
        return Err(AppError::Api {
            status: status.as_u16(),
            message,
        });
    }

    // 逐块读取 SSE,按行拆 data: 前缀
    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| AppError::Http(e.to_string()))?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        // 按行处理,保留最后不完整的一行
        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim().to_string();
            buffer.drain(..=pos);

            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data == "[DONE]" {
                let _ = on_event.send(StreamEvent::Done);
                return Ok(());
            }
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(content) = json
                    .get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("delta"))
                    .and_then(|d| d.get("content"))
                    .and_then(|v| v.as_str())
                {
                    if !content.is_empty() {
                        let _ = on_event.send(StreamEvent::Chunk {
                            content: content.to_string(),
                        });
                    }
                }
            }
        }
    }

    let _ = on_event.send(StreamEvent::Done);
    Ok(())
}

/// 非流式对话:一次返回完整内容(生成结构化 JSON 用,如知识库/计划)
#[tauri::command]
async fn chat_once(
    model: String,
    messages: Vec<ChatMessage>,
    temperature: Option<f64>,
) -> Result<String> {
    let key = read_key()?;
    let client = reqwest::Client::new();

    let body = serde_json::json!({
        "model": model,
        "messages": messages.iter().map(|m| serde_json::json!({
            "role": m.role, "content": m.content
        })).collect::<Vec<_>>(),
        "stream": false,
        "temperature": temperature.unwrap_or(0.7),
    });

    let resp = client
        .post(format!("{}/chat/completions", API_BASE_URL))
        .bearer_auth(&key)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Http(e.to_string()))?;

    let status = resp.status();
    if !status.is_success() {
        let message = resp.text().await.unwrap_or_default();
        return Err(AppError::Api {
            status: status.as_u16(),
            message,
        });
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Http(e.to_string()))?;

    let content = json
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    Ok(content)
}

/// SQLite 数据表结构(v1)
fn migrations() -> Vec<tauri_plugin_sql::Migration> {
    use tauri_plugin_sql::{Migration, MigrationKind};
    vec![Migration {
        version: 1,
        description: "create_core_tables",
        sql: r#"
        CREATE TABLE IF NOT EXISTS courses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            topic TEXT NOT NULL,
            mode TEXT NOT NULL DEFAULT 'daily',
            total_days INTEGER NOT NULL DEFAULT 7,
            daily_time TEXT DEFAULT '2小时',
            status TEXT NOT NULL DEFAULT 'active',
            knowledge_base TEXT,
            schedule TEXT,
            profile TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS steps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id INTEGER NOT NULL,
            day_index INTEGER NOT NULL,
            order_in_day INTEGER NOT NULL DEFAULT 1,
            kind TEXT NOT NULL DEFAULT 'lecture',
            title TEXT NOT NULL,
            objective TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS lectures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            step_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            content_md TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(step_id) REFERENCES steps(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS tests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            step_id INTEGER NOT NULL,
            day_index INTEGER NOT NULL,
            questions_json TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            FOREIGN KEY(step_id) REFERENCES steps(id) ON DELETE CASCADE
        );
        "#,
        kind: MigrationKind::Up,
    }, Migration {
        version: 2,
        description: "add_bookmark_and_notes",
        sql: r#"
        ALTER TABLE steps ADD COLUMN bookmarked INTEGER NOT NULL DEFAULT 0;
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            step_id INTEGER NOT NULL,
            kind TEXT NOT NULL DEFAULT 'highlight',
            anchor_text TEXT,
            body TEXT,
            color TEXT DEFAULT 'amber',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(step_id) REFERENCES steps(id) ON DELETE CASCADE
        );
        "#,
        kind: MigrationKind::Up,
    }, Migration {
        version: 3,
        description: "add_note_char_offsets",
        sql: r#"
        ALTER TABLE notes ADD COLUMN hl_start INTEGER;
        ALTER TABLE notes ADD COLUMN hl_end INTEGER;
        "#,
        kind: MigrationKind::Up,
    }, Migration {
        version: 4,
        description: "create_qa_table",
        sql: r#"
        CREATE TABLE IF NOT EXISTS qa (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            step_id INTEGER NOT NULL,
            question TEXT NOT NULL,
            answer TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(step_id) REFERENCES steps(id) ON DELETE CASCADE
        );
        "#,
        kind: MigrationKind::Up,
    }, Migration {
        version: 5,
        description: "create_fsrs_tables",
        sql: r#"
        CREATE TABLE IF NOT EXISTS cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            step_id INTEGER NOT NULL UNIQUE,
            state TEXT NOT NULL DEFAULT 'new',
            due TEXT NOT NULL DEFAULT (datetime('now')),
            stability REAL NOT NULL DEFAULT 0,
            difficulty REAL NOT NULL DEFAULT 0,
            elapsed_days INTEGER NOT NULL DEFAULT 0,
            scheduled_days INTEGER NOT NULL DEFAULT 0,
            reps INTEGER NOT NULL DEFAULT 0,
            lapses INTEGER NOT NULL DEFAULT 0,
            last_review TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(step_id) REFERENCES steps(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            card_id INTEGER NOT NULL,
            rating INTEGER NOT NULL,
            state TEXT NOT NULL,
            due TEXT NOT NULL,
            stability REAL NOT NULL,
            difficulty REAL NOT NULL,
            elapsed_days INTEGER NOT NULL,
            scheduled_days INTEGER NOT NULL,
            review_time TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(due);
        CREATE INDEX IF NOT EXISTS idx_cards_state ON cards(state);
        "#,
        kind: MigrationKind::Up,
    }, Migration {
        version: 6,
        description: "create_diagnostic_and_profile_tables",
        sql: r#"
        CREATE TABLE IF NOT EXISTS diagnostics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id INTEGER NOT NULL UNIQUE,
            questions_json TEXT NOT NULL,
            answers_json TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id INTEGER NOT NULL UNIQUE,
            profile_json TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
        );
        "#,
        kind: MigrationKind::Up,
    }, Migration {
        version: 7,
        description: "create_test_attempts_table",
        sql: r#"
        CREATE TABLE IF NOT EXISTS test_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            test_id INTEGER NOT NULL,
            question_index INTEGER NOT NULL,
            user_answer TEXT NOT NULL,
            is_correct INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(test_id) REFERENCES tests(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_test_attempts_test ON test_attempts(test_id);
        "#,
        kind: MigrationKind::Up,
    }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
        Manager, WindowEvent,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:charon.db", migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_api_base_url,
            save_api_key,
            has_api_key,
            delete_api_key,
            list_models,
            list_models_with_key,
            chat_stream,
            chat_once,
        ])
        .setup(|app| {
            // 系统托盘:显示/退出菜单 + 左键点击唤出窗口
            let show = MenuItem::with_id(app, "show", "显示 Charon-Study", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Charon-Study")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭窗口 = 隐藏到托盘,不退出
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
