mod matcher;
mod models;

use axum::{
    extract::{Path, Query, State},
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
}

type Shared = Arc<AppState>;

fn load_state() -> Result<AppState, String> {
    // SUBSIDY_DATA overrides the embedded snapshot so data can be refreshed without a rebuild.
    let raw = match std::env::var("SUBSIDY_DATA") {
        Ok(path) => std::fs::read_to_string(&path).map_err(|e| format!("read {path}: {e}"))?,
        Err(_) => EMBEDDED_DATA.to_string(),
    };
    let records: Vec<Subsidy> = serde_json::from_str(&raw).map_err(|e| format!("parse subsidies: {e}"))?;
    let entries: Vec<Entry> = records.into_iter().map(Entry::new).collect();
    let mut by_id = HashMap::new();
    for (i, e) in entries.iter().enumerate() {
        if by_id.insert(e.subsidy.id.clone(), i).is_some() {
            return Err(format!("duplicate id {}", e.subsidy.id));
        }
    }
    Ok(AppState { entries, by_id })
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

fn render(s: &Subsidy, view: &Option<String>) -> Value {
    if view.as_deref() == Some("full") {
        serde_json::to_value(s).unwrap_or(Value::Null)
    } else {
        summary(s)
    }
}

fn page(limit: Option<usize>, offset: Option<usize>) -> (usize, usize) {
    (limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT), offset.unwrap_or(0))
}

async fn health(State(st): State<Shared>) -> Json<Value> {
    Json(json!({ "status": "ok", "records": st.entries.len() }))
}

async fn list(State(st): State<Shared>, Query(q): Query<ListQuery>) -> Json<Value> {
    let hits = filter_list(&st.entries, &q);
    let (limit, offset) = page(q.limit, q.offset);
    let items: Vec<Value> = hits.iter().skip(offset).take(limit).map(|e| render(&e.subsidy, &q.view)).collect();
    Json(json!({ "total": hits.len(), "limit": limit, "offset": offset, "items": items }))
}

async fn get_one(State(st): State<Shared>, Path(id): Path<String>) -> Result<Json<Subsidy>, (StatusCode, Json<Value>)> {
    match st.by_id.get(&id) {
        Some(&i) => Ok(Json(st.entries[i].subsidy.clone())),
        None => Err((StatusCode::NOT_FOUND, Json(json!({ "error": "not_found", "id": id })))),
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
        *status.entry(s.source_meta.verification_status.clone()).or_default() += 1;
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

async fn match_profile(State(st): State<Shared>, Json(p): Json<Profile>) -> Json<Value> {
    let hits = run_match(&st.entries, &p);
    let (limit, offset) = page(p.limit, p.offset);
    let items: Vec<Value> = hits
        .iter()
        .skip(offset)
        .take(limit)
        .map(|(e, r)| {
            let mut v = render(&e.subsidy, &p.view);
            v["match"] = serde_json::to_value(r).unwrap_or(Value::Null);
            v
        })
        .collect();
    Json(json!({ "total": hits.len(), "limit": limit, "offset": offset, "items": items }))
}

pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/subsidies", get(list))
        .route("/api/subsidies/{id}", get(get_one))
        .route("/api/facets", get(facets))
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
    println!("loaded {} records, listening on http://{addr}", state.entries.len());
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap_or_else(|e| {
        eprintln!("bind {addr}: {e}");
        std::process::exit(1);
    });
    if let Err(e) = axum::serve(listener, app(state)).await {
        eprintln!("server error: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> AppState {
        load_state().expect("embedded data loads")
    }

    #[test]
    fn loads_all_records() {
        let st = state();
        assert_eq!(st.entries.len(), 217);
        assert_eq!(st.by_id.len(), 217);
    }

    #[test]
    fn keyword_search_finds_by_name() {
        let st = state();
        let q = ListQuery { q: Some("敬老卡".into()), ..Default::default() };
        let hits = filter_list(&st.entries, &q);
        assert!(!hits.is_empty());
        assert!(hits.iter().any(|e| e.subsidy.name.contains("敬老卡")));
    }

    #[test]
    fn age_filter_excludes_out_of_range() {
        let st = state();
        let all = filter_list(&st.entries, &ListQuery::default()).len();
        let young = filter_list(&st.entries, &ListQuery { age: Some(10.0), ..Default::default() });
        assert!(young.len() < all, "age=10 should drop adult-only programmes");
    }

    #[test]
    fn region_blocks_taipei_only_programmes() {
        let st = state();
        let p = Profile { region: Some("高雄市".into()), include_ineligible: true, ..Default::default() };
        let res = run_match(&st.entries, &p);
        let blocked = res.iter().filter(|(_, r)| r.fit == matcher::Fit::Ineligible).count();
        assert!(blocked > 0);
        let visible = run_match(&st.entries, &Profile { region: Some("高雄市".into()), ..Default::default() });
        assert!(visible.iter().all(|(e, _)| e.subsidy.scope.regions.iter().any(|r| r == "全國")));
    }

    #[test]
    fn exclusive_max_age() {
        let a = models::Age { subject: Some("申請人".into()), min: None, max: Some(2.0), unit: Some("year".into()), raw: Some("未滿2歲".into()) };
        assert!(matcher::age_ok(&a, 1.9));
        assert!(!matcher::age_ok(&a, 2.0));
        let inclusive = models::Age { raw: Some("65歲以下".into()), max: Some(65.0), ..a };
        assert!(matcher::age_ok(&inclusive, 65.0));
    }
}
