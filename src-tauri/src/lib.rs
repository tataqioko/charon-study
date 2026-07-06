// Charon-Study API 后端
// base_url 锁死为指定站点,用户仅提供 key。
// 开发环境（debug_assertions）支持运行时自定义站点。
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use std::io::{Read, Write};
use std::process::Command;

/// 默认 API 站点
const DEFAULT_API_BASE_URL: &str = "https://api.nktp.top/v1";

/// keyring 服务名与账户名,用于本地安全存储 API key。
const KEYRING_SERVICE: &str = "charon-study";
const KEYRING_ACCOUNT: &str = "api-key";
const KEYRING_CUSTOM_URL: &str = "custom-base-url"; // 自定义站点存储（仅 debug）

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

/// 读取 API 站点（生产环境锁死，开发环境支持自定义）
fn get_base_url() -> String {
    #[cfg(debug_assertions)]
    {
        // 开发模式：尝试读取自定义站点
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_CUSTOM_URL) {
            if let Ok(url) = entry.get_password() {
                if !url.is_empty() {
                    return url;
                }
            }
        }
    }
    // 生产环境或开发环境未设置自定义站点时，使用默认站点
    DEFAULT_API_BASE_URL.to_string()
}

/// 暴露站点地址给前端展示
#[tauri::command]
fn get_api_base_url() -> String {
    get_base_url()
}

/// 保存自定义站点（仅开发模式）
#[cfg(debug_assertions)]
#[tauri::command]
fn set_custom_base_url(url: String) -> Result<()> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_CUSTOM_URL)
        .map_err(|e| AppError::Keyring(e.to_string()))?;
    entry
        .set_password(&url)
        .map_err(|e| AppError::Keyring(e.to_string()))
}

/// 清除自定义站点（仅开发模式）
#[cfg(debug_assertions)]
#[tauri::command]
fn clear_custom_base_url() -> Result<()> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_CUSTOM_URL)
        .map_err(|e| AppError::Keyring(e.to_string()))?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Keyring(e.to_string())),
    }
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

/// 共享:向站点拉取模型列表
async fn fetch_models(key: &str) -> Result<Vec<ModelInfo>> {
    let base_url = get_base_url();
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/models", base_url))
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
    let base_url = get_base_url();
    let client = reqwest::Client::new();

    let body = serde_json::json!({
        "model": model,
        "messages": messages.iter().map(|m| serde_json::json!({
            "role": m.role, "content": m.content
        })).collect::<Vec<_>>(),
        "stream": true,
    });

    let resp = client
        .post(format!("{}/chat/completions", base_url))
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
    let base_url = get_base_url();
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
        .post(format!("{}/chat/completions", base_url))
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

/// 解析 .doc 文件（旧版 Word 格式）
/// 接收 base64 编码的文件内容，保存到临时文件，调用转换工具
#[tauri::command]
async fn parse_doc_file(file_name: String, file_content_base64: String) -> Result<String> {
    use base64::{Engine as _, engine::general_purpose};

    // 安全检查：防止 base64 内存炸弹（100MB base64 ≈ 75MB 解码后）
    if file_content_base64.len() > 100_000_000 {
        return Err(AppError::Http("文件过大（超过 75MB），请使用较小的文件".to_string()));
    }

    // 解码 base64
    let file_data = general_purpose::STANDARD.decode(&file_content_base64)
        .map_err(|e| AppError::Http(format!("Base64 解码失败: {}", e)))?;

    // 创建带 .doc 后缀的临时文件（自动清理）；后缀让 LibreOffice/pandoc 能按扩展名识别格式
    let mut temp_input = tempfile::Builder::new()
        .suffix(".doc")
        .tempfile()
        .map_err(|e| AppError::Http(format!("创建临时文件失败: {}", e)))?;

    temp_input.write_all(&file_data)
        .map_err(|e| AppError::Http(format!("写入临时文件失败: {}", e)))?;
    temp_input.flush()
        .map_err(|e| AppError::Http(format!("刷新临时文件失败: {}", e)))?;

    // 归一化文件名：只取最后一段的 stem 并剔除路径分隔符，防止 file_name 带 ../ 造成
    // 路径穿越（旧实现直接把它拼进 temp_dir 后又 remove_file，可删除任意文件）。
    let safe_stem = std::path::Path::new(&file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.replace(['/', '\\', ':'], "_"))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "document".to_string());

    // 尝试多种转换方法（输出路径均锚定在临时目录内，安全名由 safe_stem/输入 stem 推导）
    try_convert_doc(temp_input.path(), &safe_stem)
}

/// 尝试多种工具转换 .doc 文件为纯文本。
/// 输出文件名不再用外部传入的原始文件名拼接，而是由“输入临时文件的真实 stem”
/// （LibreOffice 决定）或 safe_stem（pandoc）推导，全部落在临时目录内。
fn try_convert_doc(input: &std::path::Path, safe_stem: &str) -> Result<String> {
    let temp_dir = std::env::temp_dir();

    // 方法1: 尝试 LibreOffice (Windows 常见路径)
    // 关键：LibreOffice 把输出写成 <outdir>/<输入文件stem>.txt，名字由它自己按输入名决定，
    // 所以这里必须按输入临时文件的真实 stem 推导输出路径，否则永远读不到转换结果。
    let lo_output = input
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|stem| temp_dir.join(format!("{}.txt", stem)));

    let libreoffice_paths = [
        "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
        "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    ];

    for path in &libreoffice_paths {
        if let (true, Some(lo_output)) = (std::path::Path::new(path).exists(), lo_output.as_ref()) {
            let result = Command::new(path)
                .args([
                    "--headless",
                    "--convert-to", "txt:Text",
                    "--outdir", &temp_dir.to_string_lossy(),
                    &input.to_string_lossy(),
                ])
                .output();

            if let Ok(output_result) = result {
                if output_result.status.success() {
                    if let Ok(text) = std::fs::read_to_string(lo_output) {
                        let _ = std::fs::remove_file(lo_output);
                        let trimmed = text.trim().to_string();
                        if !trimmed.is_empty() {
                            return Ok(trimmed);
                        }
                    }
                }
            }
        }
    }

    // 方法2: 尝试 Pandoc（不再传无效的 `-f doc`——pandoc 没有 doc 输入格式，
    // 传了会直接报错；让 pandoc 按扩展名判断。对 .docx 有效，纯 .doc 会失败落到方法3）
    let pandoc_output = temp_dir.join(format!("{}_pandoc.txt", safe_stem));
    let pandoc_result = Command::new("pandoc")
        .args([
            "-t", "plain",
            &input.to_string_lossy(),
            "-o", &pandoc_output.to_string_lossy(),
        ])
        .output();

    if let Ok(output_result) = pandoc_result {
        if output_result.status.success() {
            if let Ok(text) = std::fs::read_to_string(&pandoc_output) {
                let _ = std::fs::remove_file(&pandoc_output);
                let trimmed = text.trim().to_string();
                if !trimmed.is_empty() {
                    return Ok(trimmed);
                }
            }
        }
    }

    // 方法3: 暴力提取文本（fallback）
    let mut file = std::fs::File::open(input)
        .map_err(|e| AppError::Http(format!("无法打开文件: {}", e)))?;

    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)
        .map_err(|e| AppError::Http(format!("读取文件失败: {}", e)))?;

    let text = extract_text_from_doc(&buffer);

    if text.trim().is_empty() || text.len() < 10 {
        return Err(AppError::Http(
            "无法转换 .doc 文件。请安装 LibreOffice 或用 Word 另存为 .docx".to_string()
        ));
    }

    Ok(text)
}

/// 从 .doc 二进制数据中暴力提取文本（fallback 方法）
fn extract_text_from_doc(data: &[u8]) -> String {
    let mut result = String::new();
    let mut i = 0;

    while i < data.len() {
        if i + 1 < data.len() {
            let b1 = data[i];
            let b2 = data[i + 1];

            // UTF-16LE 模式检测：低字节是可打印ASCII，高字节是0
            if b2 == 0 && b1 >= 0x20 && b1 <= 0x7E {
                result.push(b1 as char);
                i += 2;
                continue;
            }

            // 中文 UTF-16LE 范围
            if b2 >= 0x4E && b2 <= 0x9F {
                let code_point = u16::from_le_bytes([b1, b2]);
                if let Some(c) = char::from_u32(code_point as u32) {
                    result.push(c);
                    i += 2;
                    continue;
                }
            }
        }

        // 单字节 ASCII 可打印字符
        if data[i] >= 0x20 && data[i] <= 0x7E {
            result.push(data[i] as char);
        } else if data[i] == 0x0D || data[i] == 0x0A {
            result.push('\n');
        }

        i += 1;
    }

    // 清理重复的空白和换行
    let lines: Vec<&str> = result
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();

    lines.join("\n")
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
    }, Migration {
        version: 8,
        description: "create_knowledge_base_tables",
        sql: r#"
        CREATE TABLE IF NOT EXISTS knowledge_units (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id INTEGER NOT NULL,
            unit_id TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT,
            prerequisites TEXT,
            can_generate_lecture INTEGER NOT NULL DEFAULT 1,
            can_generate_quiz INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS source_locations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            unit_id INTEGER NOT NULL,
            file_name TEXT NOT NULL,
            material_index INTEGER NOT NULL,
            page_start INTEGER,
            page_end INTEGER,
            char_count INTEGER,
            content_preview TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(unit_id) REFERENCES knowledge_units(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_units_course ON knowledge_units(course_id);
        CREATE INDEX IF NOT EXISTS idx_source_locations_unit ON source_locations(unit_id);
        "#,
        kind: MigrationKind::Up,
    }, Migration {
        version: 9,
        description: "add_suggested_questions_to_lectures",
        sql: r#"
        ALTER TABLE lectures ADD COLUMN suggested_questions TEXT;
        "#,
        kind: MigrationKind::Up,
    }, Migration {
        version: 10,
        description: "create_material_management_tables",
        sql: r#"
        -- 示例库：预提取的示例
        CREATE TABLE IF NOT EXISTS examples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id INTEGER NOT NULL,
            unit_id TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            source_ref TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_examples_course ON examples(course_id);
        CREATE INDEX IF NOT EXISTS idx_examples_unit ON examples(unit_id);

        -- 习题候选库：预提取的习题
        CREATE TABLE IF NOT EXISTS exercise_candidates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id INTEGER NOT NULL,
            unit_id TEXT NOT NULL,
            question TEXT NOT NULL,
            options_json TEXT,
            answer TEXT NOT NULL,
            explanation TEXT,
            difficulty TEXT,
            source_ref TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_exercise_candidates_course ON exercise_candidates(course_id);
        CREATE INDEX IF NOT EXISTS idx_exercise_candidates_unit ON exercise_candidates(unit_id);

        -- 材料覆盖率跟踪：跟踪哪些知识单元被用于哪一天
        CREATE TABLE IF NOT EXISTS material_coverage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id INTEGER NOT NULL,
            day_index INTEGER NOT NULL,
            unit_id TEXT NOT NULL,
            usage_type TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_material_coverage_course ON material_coverage(course_id);
        CREATE INDEX IF NOT EXISTS idx_material_coverage_day ON material_coverage(course_id, day_index);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_material_coverage_unique ON material_coverage(course_id, day_index, unit_id, usage_type);
        "#,
        kind: MigrationKind::Up,
    }, Migration {
        version: 11,
        description: "add_daily_plan_unit_layer_to_steps",
        sql: r#"
        -- 一天可含多个学习单元，每个 unit 落成一行 step，携带以下元数据。
        -- need_lecture / need_exercise：该单元是否需要讲义 / 练习。
        ALTER TABLE steps ADD COLUMN need_lecture INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE steps ADD COLUMN need_exercise INTEGER NOT NULL DEFAULT 0;
        -- related_units：关联的知识单元 unit_id（JSON 数组，如 ["u1","u2"]）
        ALTER TABLE steps ADD COLUMN related_units TEXT;
        -- source_refs：材料引用（JSON 数组，如 ["material:u1"]）
        ALTER TABLE steps ADD COLUMN source_refs TEXT;
        -- prerequisites：前置单元（JSON 数组，unit 标题或 id）
        ALTER TABLE steps ADD COLUMN prerequisites TEXT;
        "#,
        kind: MigrationKind::Up,
    }, Migration {
        version: 12,
        description: "add_material_segments_and_seg_refs",
        sql: r#"
        -- 入库时切段：把每个上传文件按字符边界切成有界小段，
        -- 每段一个稳定 ref（material:<material_index>:seg_<seg_index>），
        -- 讲义/测验生成时只注入知识单元真正绑定的那几段原文，
        -- 从而让单次模型调用的上下文有界，资料再大也不会撑爆上下文。
        CREATE TABLE IF NOT EXISTS material_segments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id INTEGER NOT NULL,
            material_index INTEGER NOT NULL,   -- 第几个上传文件（0 起）
            file_name TEXT NOT NULL,
            seg_index INTEGER NOT NULL,         -- 文件内第几段（0 起）
            char_start INTEGER NOT NULL,        -- 该段在文件正文中的起始字符偏移
            char_end INTEGER NOT NULL,          -- 结束偏移（不含）
            content TEXT NOT NULL,              -- 该段原文
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_material_segments_course ON material_segments(course_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_material_segments_ref
            ON material_segments(course_id, material_index, seg_index);

        -- source_locations 增加 seg_refs：该知识单元绑定了哪几段（JSON 数组，
        -- 元素形如 "material:0:seg_3"）。旧数据为 NULL，解析时回退到整文件注入。
        ALTER TABLE source_locations ADD COLUMN seg_refs TEXT;
        "#,
        kind: MigrationKind::Up,
    }, Migration {
        version: 13,
        description: "materials_and_course_preferences",
        sql: r#"
        -- 材料表：统一管理所有上传文件
        CREATE TABLE IF NOT EXISTS materials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id INTEGER NOT NULL,
            file_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,  -- image/png, application/pdf, text/plain, etc.
            kind TEXT NOT NULL,  -- image, pdf, document, text
            file_size INTEGER,
            preview_url TEXT,  -- 图片缩略图 base64 或路径
            ocr_text TEXT,  -- 图片/PDF 的 OCR 文本
            status TEXT DEFAULT 'pending',  -- pending, processing, processed, failed
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_materials_course ON materials(course_id);

        -- 扩展 source_locations：关联 material_id，记录来源类型（添加外键约束防止孤立引用）
        ALTER TABLE source_locations ADD COLUMN material_id INTEGER REFERENCES materials(id) ON DELETE CASCADE;
        ALTER TABLE source_locations ADD COLUMN mime_type TEXT;
        ALTER TABLE source_locations ADD COLUMN kind TEXT;
        ALTER TABLE source_locations ADD COLUMN preview_url TEXT;
        ALTER TABLE source_locations ADD COLUMN status TEXT DEFAULT 'processed';

        -- 知识层级图谱：显式 parent-child 关系
        CREATE TABLE IF NOT EXISTS knowledge_hierarchy (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id INTEGER NOT NULL,
            parent_unit_id TEXT NOT NULL,
            child_unit_id TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
            UNIQUE(course_id, parent_unit_id, child_unit_id)
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_hierarchy_course ON knowledge_hierarchy(course_id);

        -- 课程偏好：细粒度偏好设置
        CREATE TABLE IF NOT EXISTS course_preferences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id INTEGER NOT NULL UNIQUE,
            is_exam_prep INTEGER NOT NULL DEFAULT 0,
            exam_material_ids TEXT,  -- JSON 数组
            learning_goal_option TEXT,  -- quick_start, systematic, exam_prep, hobby
            learning_goal_custom_text TEXT,
            teaching_style_option TEXT,  -- beginner_friendly, concise, rigorous
            teaching_style_custom_text TEXT,
            ppt_scope_mode TEXT,  -- all, selected, custom
            ppt_scope_option TEXT,
            ppt_focus_text TEXT,
            diagnostic_custom_focus TEXT,  -- JSON 数组：用户自定义的诊断重点
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
        );

        -- 扩展 diagnostics：支持自定义补充
        ALTER TABLE diagnostics ADD COLUMN custom_answers_json TEXT;
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
            parse_doc_file,
            #[cfg(debug_assertions)]
            set_custom_base_url,
            #[cfg(debug_assertions)]
            clear_custom_base_url,
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
