// SPDX-License-Identifier: AGPL-3.0-only
//! Explicitly enabled, shared fictional demonstration account; this is not authentication.
use crate::{AppState, Shared};
use axum::{
    extract::{rejection::JsonRejection, DefaultBodyLimit, Request, State},
    http::{header, HeaderValue, Method, StatusCode, Uri},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashSet},
    path::Path,
    sync::Mutex,
};

const PROFILE: &str = include_str!("../../assets/mock_data/account.json");
const MAX_PLAN_IDS: usize = 217;
const MAX_CHECKS: usize = 512;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedPlan {
    v: u8,
    target: Option<Target>,
    plan_ids: Vec<String>,
    doc_checks: BTreeMap<String, bool>,
    step_done: BTreeMap<String, Vec<usize>>,
    catalog_version: Option<String>,
    rules_version: Option<String>,
    engine_version: Option<String>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Target {
    #[serde(rename = "self")]
    Self_,
    Other,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Update {
    plan: SavedPlan,
    revision: u64,
}

pub struct DemoStore {
    connection: Mutex<Connection>,
    user_id: String,
}
#[derive(Debug)]
enum StoreError {
    Conflict,
    Database,
}

impl DemoStore {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent).map_err(|_| "cannot create demo database directory")?;
        }
        let connection = Connection::open(path).map_err(|_| "cannot open demo database")?;
        connection
            .busy_timeout(std::time::Duration::from_secs(3))
            .map_err(|_| "cannot configure demo database")?;
        connection.execute_batch("PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, profile_json TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS action_plans (user_id TEXT PRIMARY KEY REFERENCES users(id), plan_json TEXT, revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0));").map_err(|_| "cannot initialize demo database")?;
        let profile: Value =
            serde_json::from_str(PROFILE).map_err(|_| "invalid demo profile seed")?;
        let profile = profile
            .get("data")
            .filter(|v| v.is_object())
            .ok_or("invalid demo profile seed")?;
        let user_id = profile["id"]
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or("missing demo profile id")?
            .to_owned();
        connection.execute("INSERT INTO users(id,profile_json) VALUES (?1,?2) ON CONFLICT(id) DO UPDATE SET profile_json=excluded.profile_json", params![user_id, profile.to_string()]).map_err(|_| "cannot seed demo user")?;
        connection
            .execute(
                "INSERT OR IGNORE INTO action_plans(user_id) VALUES (?1)",
                [&user_id],
            )
            .map_err(|_| "cannot seed demo plan")?;
        Ok(Self {
            connection: Mutex::new(connection),
            user_id,
        })
    }

    fn read(&self) -> Result<Value, StoreError> {
        let connection = self.connection.lock().map_err(|_| StoreError::Database)?;
        Self::read_from(&connection, &self.user_id)
    }
    fn read_from(connection: &Connection, id: &str) -> Result<Value, StoreError> {
        let (profile, plan, revision): (String, Option<String>, i64) = connection.query_row(
            "SELECT u.profile_json,p.plan_json,p.revision FROM users u JOIN action_plans p ON p.user_id=u.id WHERE u.id=?1", [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).map_err(|_| StoreError::Database)?;
        let profile: Value = serde_json::from_str(&profile).map_err(|_| StoreError::Database)?;
        let plan: Option<SavedPlan> = plan
            .map(|p| serde_json::from_str(&p))
            .transpose()
            .map_err(|_| StoreError::Database)?;
        Ok(json!({"mode":"demo", "profile":profile, "plan":plan, "revision":revision}))
    }
    fn update(&self, update: Update) -> Result<Value, StoreError> {
        let mut connection = self.connection.lock().map_err(|_| StoreError::Database)?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|_| StoreError::Database)?;
        let revision = i64::try_from(update.revision).map_err(|_| StoreError::Conflict)?;
        if revision == i64::MAX {
            return Err(StoreError::Conflict);
        }
        let plan = serde_json::to_string(&update.plan).map_err(|_| StoreError::Database)?;
        let changed = transaction.execute("UPDATE action_plans SET plan_json=?1,revision=revision+1 WHERE user_id=?2 AND revision=?3", params![plan, self.user_id, revision]).map_err(|_| StoreError::Database)?;
        if changed != 1 {
            return Err(StoreError::Conflict);
        }
        let result = Self::read_from(&transaction, &self.user_id)?;
        transaction.commit().map_err(|_| StoreError::Database)?;
        Ok(result)
    }
}

fn text(value: &Value) -> String {
    value.as_str().unwrap_or("").trim().to_owned()
}
fn document_keys(st: &AppState, ids: &[String]) -> HashSet<String> {
    static MANIFEST: std::sync::LazyLock<Value> = std::sync::LazyLock::new(|| {
        serde_json::from_str(include_str!("../rules/adaptive-reviewed.json"))
            .expect("embedded adaptive rules")
    });
    let manifest = &*MANIFEST;
    let mut keys = HashSet::new();
    for id in ids {
        let entry = &st.entries[st.by_id[id]];
        for (index, original) in entry
            .subsidy
            .application
            .required_documents
            .iter()
            .enumerate()
        {
            let mut doc = original.clone();
            if crate::adaptive_rules::review_for(&entry.original).is_some() {
                if let Some(overlay) = manifest["records"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .find(|r| r["id"] == *id)
                    .and_then(|r| r["document_overrides"].as_array())
                    .into_iter()
                    .flatten()
                    .find(|o| o["index"].as_u64() == Some(index as u64))
                {
                    doc["required"] = overlay["required"].clone();
                    doc["condition"] = overlay["condition"].clone();
                    doc["notes"] = Value::String(
                        [text(&doc["notes"]), text(&overlay["notes"])]
                            .into_iter()
                            .filter(|s| !s.is_empty())
                            .collect::<Vec<_>>()
                            .join("；"),
                    );
                }
            }
            let name = text(&doc["name"]);
            if name.is_empty() {
                continue;
            }
            let condition = text(&doc["condition"]);
            let mut key = vec![
                json!(name),
                json!(if condition == name {
                    String::new()
                } else {
                    condition
                }),
                json!(text(&doc["notes"])),
                doc["required"]
                    .as_bool()
                    .map(Value::Bool)
                    .unwrap_or(Value::Null),
            ];
            if let Some(regions) = doc["regions"].as_array().filter(|r| !r.is_empty()) {
                let mut regions = regions.clone();
                regions.sort_by(|a, b| a.as_str().cmp(&b.as_str()));
                key.extend([
                    json!(regions),
                    json!(doc["region_basis"].as_str().unwrap_or("unknown")),
                    json!(doc["region_evidence"].as_str().unwrap_or("")),
                ]);
            }
            keys.insert(serde_json::to_string(&key).expect("document key"));
        }
    }
    keys
}
fn valid_plan(plan: &SavedPlan, st: &AppState) -> bool {
    if plan.v != 1
        || plan.plan_ids.len() > MAX_PLAN_IDS
        || plan.doc_checks.len() > MAX_CHECKS
        || plan.step_done.len() > MAX_PLAN_IDS
    {
        return false;
    }
    let ids: HashSet<&str> = plan.plan_ids.iter().map(String::as_str).collect();
    if ids.len() != plan.plan_ids.len()
        || ids
            .iter()
            .any(|id| id.len() > 80 || !st.by_id.contains_key(*id))
    {
        return false;
    }
    for version in [
        &plan.catalog_version,
        &plan.rules_version,
        &plan.engine_version,
    ]
    .into_iter()
    .flatten()
    {
        if version.is_empty()
            || version.len() > 256
            || !version
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_/.:".contains(&b))
        {
            return false;
        }
    }
    for (id, steps) in &plan.step_done {
        if !ids.contains(id.as_str()) {
            return false;
        }
        let process = st.entries[st.by_id[id]]
            .subsidy
            .application
            .process_text
            .as_deref()
            .unwrap_or("");
        let count = process
            .replace("->", "→")
            .replace('⇒', "→")
            .split('→')
            .filter(|s| !s.trim().is_empty())
            .count();
        if steps.len() > count
            || steps.iter().any(|n| *n >= count)
            || steps.iter().collect::<HashSet<_>>().len() != steps.len()
        {
            return false;
        }
    }
    let allowed = document_keys(st, &plan.plan_ids);
    plan.doc_checks
        .keys()
        .all(|key| key.len() <= 8192 && allowed.contains(key))
}

fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(json!({"error":code}))).into_response()
}
fn result_response(result: Result<Value, StoreError>) -> Response {
    match result {
        Ok(value) => Json(value).into_response(),
        Err(StoreError::Conflict) => error(StatusCode::CONFLICT, "revision_conflict"),
        Err(StoreError::Database) => {
            error(StatusCode::INTERNAL_SERVER_ERROR, "storage_unavailable")
        }
    }
}
async fn read(State(st): State<Shared>) -> Response {
    let Some(store) = st.demo.clone() else {
        return error(StatusCode::SERVICE_UNAVAILABLE, "demo_disabled");
    };
    match tokio::task::spawn_blocking(move || store.read()).await {
        Ok(result) => result_response(result),
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "storage_unavailable"),
    }
}
async fn update(State(st): State<Shared>, body: Result<Json<Update>, JsonRejection>) -> Response {
    let Some(store) = st.demo.clone() else {
        return error(StatusCode::SERVICE_UNAVAILABLE, "demo_disabled");
    };
    let Ok(Json(update)) = body else {
        return error(StatusCode::BAD_REQUEST, "invalid_input");
    };
    if !valid_plan(&update.plan, &st) {
        return error(StatusCode::BAD_REQUEST, "invalid_input");
    }
    match tokio::task::spawn_blocking(move || store.update(update)).await {
        Ok(result) => result_response(result),
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "storage_unavailable"),
    }
}
fn allowed_origin(request: &Request) -> bool {
    let Some(origin) = request.headers().get(header::ORIGIN) else {
        return true;
    };
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    let Ok(uri) = origin.parse::<Uri>() else {
        return false;
    };
    if !matches!(uri.scheme_str(), Some("http" | "https"))
        || uri.path() != "/"
        || uri.query().is_some()
    {
        return false;
    }
    let Some(authority) = uri.authority() else {
        return false;
    };
    if authority.as_str().contains('@') {
        return false;
    }
    if request
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|host| host.eq_ignore_ascii_case(authority.as_str()))
    {
        return true;
    }
    matches!(uri.host(), Some("localhost" | "127.0.0.1"))
        && matches!(uri.port_u16(), Some(5173 | 4173))
}
async fn guard(request: Request, next: Next) -> Response {
    let origin = request.headers().get(header::ORIGIN).cloned();
    let allowed = allowed_origin(&request);
    let preflight = request.method() == Method::OPTIONS;
    let mut response = if !allowed {
        error(StatusCode::FORBIDDEN, "origin_forbidden")
    } else if preflight {
        StatusCode::NO_CONTENT.into_response()
    } else {
        next.run(request).await
    };
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if allowed {
        if let Some(origin) = origin {
            response
                .headers_mut()
                .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
            response
                .headers_mut()
                .insert(header::VARY, HeaderValue::from_static("Origin"));
            response.headers_mut().insert(
                header::ACCESS_CONTROL_ALLOW_METHODS,
                HeaderValue::from_static("GET, PUT, OPTIONS"),
            );
            response.headers_mut().insert(
                header::ACCESS_CONTROL_ALLOW_HEADERS,
                HeaderValue::from_static("Content-Type"),
            );
        }
    }
    response
}
pub fn routes() -> Router<Shared> {
    Router::new()
        .route(
            "/api/action-plan",
            get(read)
                .put(update)
                .options(|| async { StatusCode::NO_CONTENT }),
        )
        .layer(DefaultBodyLimit::max(128 * 1024))
        .layer(middleware::from_fn(guard))
}

#[cfg(test)]
mod tests;
