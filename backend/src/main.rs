mod matcher;
mod models;
mod questions;
mod reviewed_rules;

use axum::{
    extract::{
        rejection::{JsonRejection, QueryRejection},
        Path, Query, State,
    },
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use matcher::{filter_list, run_match, ListQuery, Profile};
use models::{Entry, Subsidy};
use serde_json::{json, Value};
use std::{collections::BTreeMap, collections::HashMap, net::SocketAddr, sync::Arc};
use tower_http::cors::CorsLayer;

const EMBEDDED_DATA: &str = include_str!("../data/subsidies.json");
const DEFAULT_LIMIT: usize = 20;
const MAX_LIMIT: usize = 200;

pub struct AppState {
    entries: Vec<Entry>,
    by_id: HashMap<String, usize>,
    version: String,
    questions: Vec<questions::Question>,
}

type Shared = Arc<AppState>;

fn load_state() -> Result<AppState, String> {
    // SUBSIDY_DATA overrides the embedded snapshot so data can be refreshed without a rebuild.
    let raw = match std::env::var("SUBSIDY_DATA") {
        Ok(path) => std::fs::read_to_string(&path).map_err(|e| format!("read {path}: {e}"))?,
        Err(_) => EMBEDDED_DATA.to_string(),
    };
    state_from_str(&raw)
}

fn state_from_str(raw: &str) -> Result<AppState, String> {
    let records: Vec<Value> =
        serde_json::from_str(raw).map_err(|e| format!("parse subsidies: {e}"))?;
    let entries: Vec<Entry> = records
        .into_iter()
        .map(Entry::from_value)
        .collect::<Result<_, _>>()
        .map_err(|e| format!("index subsidies: {e}"))?;
    let mut by_id = HashMap::new();
    for (i, e) in entries.iter().enumerate() {
        if e.subsidy.id.trim().is_empty() {
            return Err("empty resource id".into());
        }
        if by_id.insert(e.subsidy.id.clone(), i).is_some() {
            return Err(format!("duplicate id {}", e.subsidy.id));
        }
    }
    // Stable content fingerprint, not a cryptographic integrity claim.
    let hash = raw.bytes().fold(0xcbf29ce484222325_u64, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x100000001b3)
    });
    let version = format!("catalog-v1-{hash:016x}");
    let questions = questions::build_questions(&entries);
    Ok(AppState {
        entries,
        by_id,
        version,
        questions,
    })
}

fn summary(s: &Subsidy) -> Value {
    json!({
        "id": s.id,
        "name": s.name,
        "scope": s.scope,
        "provider": s.provider,
        "classification": s.classification,
        "benefit": { "kind": s.benefit.get("kind"), "raw": s.benefit.get("raw") },
        "applicant_types": s.search.facets.applicant_types,
        "methods": s.application.methods,
        "deadline": s.application.deadline,
        "has_documents": !s.application.required_documents.is_empty(),
        "verification_status": s.source_meta.verification_status,
    })
}

fn render(e: &Entry, view: &Option<String>) -> Value {
    if view.as_deref() == Some("full") {
        e.original.clone()
    } else {
        summary(&e.subsidy)
    }
}

fn page(limit: Option<usize>, offset: Option<usize>) -> (usize, usize) {
    (
        limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT),
        offset.unwrap_or(0),
    )
}

async fn health(State(st): State<Shared>) -> Json<Value> {
    Json(json!({ "status": "ok", "records": st.entries.len() }))
}

type ApiError = (StatusCode, Json<Value>);
fn bad_input(message: &str) -> ApiError {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"error":"invalid_input", "message":message})),
    )
}

async fn catalog(State(st): State<Shared>) -> Json<Value> {
    Json(
        json!({"version": st.version, "items": st.entries.iter().map(|e| &e.original).collect::<Vec<_>>()}),
    )
}

async fn question_bank(State(st): State<Shared>) -> Json<Value> {
    Json(
        json!({"version": format!("questions-v2/{}/{}", st.version, reviewed_rules::version()), "questions": st.questions}),
    )
}

async fn list(
    State(st): State<Shared>,
    query: Result<Query<ListQuery>, QueryRejection>,
) -> Result<Json<Value>, ApiError> {
    let Query(q) = query.map_err(|_| bad_input("查詢參數格式或欄位無效"))?;
    q.validate().map_err(|message| bad_input(&message))?;
    let hits = filter_list(&st.entries, &q);
    let (limit, offset) = page(q.limit, q.offset);
    let items: Vec<Value> = hits
        .iter()
        .skip(offset)
        .take(limit)
        .map(|e| render(e, &q.view))
        .collect();
    Ok(Json(
        json!({ "total": hits.len(), "limit": limit, "offset": offset, "items": items }),
    ))
}

async fn get_one(
    State(st): State<Shared>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    match st.by_id.get(&id) {
        Some(&i) => Ok(Json(st.entries[i].original.clone())),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "not_found", "id": id })),
        )),
    }
}

async fn facets(State(st): State<Shared>) -> Json<Value> {
    let mut scope: BTreeMap<String, usize> = BTreeMap::new();
    let mut region: BTreeMap<String, usize> = BTreeMap::new();
    let mut category: BTreeMap<String, usize> = BTreeMap::new();
    let mut benefit_type: BTreeMap<String, usize> = BTreeMap::new();
    let mut applicant: BTreeMap<String, usize> = BTreeMap::new();
    let mut status: BTreeMap<String, usize> = BTreeMap::new();
    let mut method: BTreeMap<String, usize> = BTreeMap::new();
    let mut ext: BTreeMap<String, usize> = BTreeMap::new();
    for e in &st.entries {
        let s = &e.subsidy;
        *scope.entry(s.scope.level.clone()).or_default() += 1;
        for r in &s.scope.regions {
            *region.entry(r.clone()).or_default() += 1;
        }
        if let Some(c) = &s.classification.category {
            *category.entry(c.clone()).or_default() += 1;
        }
        if let Some(c) = &s.classification.benefit_type {
            *benefit_type.entry(c.clone()).or_default() += 1;
        }
        for a in &s.search.facets.applicant_types {
            *applicant.entry(a.clone()).or_default() += 1;
        }
        *status
            .entry(s.source_meta.verification_status.clone())
            .or_default() += 1;
        for m in &s.application.methods {
            *method.entry(m.clone()).or_default() += 1;
        }
        for x in &s.extensions {
            if let Some(k) = x.get("key").and_then(Value::as_str) {
                *ext.entry(k.to_string()).or_default() += 1;
            }
        }
    }
    Json(json!({
        "scope": scope, "region": region, "category": category, "benefit_type": benefit_type,
        "applicant_type": applicant, "verification_status": status, "method": method,
        "extension_keys": ext,
    }))
}

async fn match_profile(
    State(st): State<Shared>,
    body: Result<Json<Value>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    // Reject without echoing the submitted personal values or logging the body.
    let Json(value) =
        body.map_err(|_| bad_input("JSON 格式、型別或欄位無效；請使用 application/json"))?;
    if !value.is_object() {
        return Err(bad_input("match 輸入必須是 JSON 物件"));
    }
    let p: Profile = serde_json::from_value(value).map_err(|_| bad_input("JSON 型別或欄位無效"))?;
    p.validate().map_err(|message| bad_input(&message))?;
    let hits = run_match(&st.entries, &p);
    let (limit, offset) = page(p.limit, p.offset);
    let items: Vec<Value> = hits
        .iter()
        .skip(offset)
        .take(limit)
        .map(|(e, r)| {
            let mut v = render(e, &p.view);
            v["match"] = serde_json::to_value(r).unwrap_or(Value::Null);
            v
        })
        .collect();
    Ok(Json(
        json!({ "total": hits.len(), "limit": limit, "offset": offset, "items": items }),
    ))
}

pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/subsidies", get(list))
        .route("/api/subsidies/{id}", get(get_one))
        .route("/api/facets", get(facets))
        .route("/api/catalog", get(catalog))
        .route("/api/questions", get(question_bank))
        .route("/api/match", post(match_profile))
        .layer(CorsLayer::permissive())
        .with_state(Arc::new(state))
}

#[tokio::main]
async fn main() {
    let state = load_state().unwrap_or_else(|e| {
        eprintln!("failed to load data: {e}");
        std::process::exit(1);
    });
    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".into());
    let addr: SocketAddr = format!("{host}:{port}").parse().unwrap_or_else(|e| {
        eprintln!("bad HOST/PORT: {e}");
        std::process::exit(1);
    });
    println!(
        "loaded {} records, listening on http://{addr}",
        state.entries.len()
    );
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|e| {
            eprintln!("bind {addr}: {e}");
            std::process::exit(1);
        });
    if let Err(e) = axum::serve(listener, app(state)).await {
        eprintln!("server error: {e}");
    }
}

#[cfg(test)]
mod tests;
