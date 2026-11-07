use super::*;
use axum::{
    body::{to_bytes, Body},
    http::Request,
};
use tower::ServiceExt;

fn db_path() -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "townpass-plan-{}-{}.sqlite3",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}
fn plan() -> Value {
    json!({"v":1,"target":"self","planIds":["CT-0113"],"docChecks":{},"stepDone":{},"catalogVersion":"catalog-v1-demo","rulesVersion":null,"engineVersion":null})
}
fn router(path: &Path) -> Router {
    let mut state = crate::state_from_str(crate::EMBEDDED_DATA).unwrap();
    state.demo = Some(std::sync::Arc::new(DemoStore::open(path).unwrap()));
    crate::app(state)
}
async fn call(
    router: Router,
    method: &str,
    body: Option<Value>,
    origin: Option<&str>,
) -> (StatusCode, axum::http::HeaderMap, Value) {
    let mut request = Request::builder()
        .uri("/api/action-plan")
        .method(method)
        .header("host", "127.0.0.1:8080");
    if let Some(origin) = origin {
        request = request.header("origin", origin);
    }
    if method == "OPTIONS" {
        request = request.header("access-control-request-method", "PUT");
    }
    let request = if let Some(body) = body {
        request
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    } else {
        request.body(Body::empty()).unwrap()
    };
    let response = router.oneshot(request).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    assert_eq!(headers[header::CACHE_CONTROL], "no-store");
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    (status, headers, value)
}

#[tokio::test]
async fn saved_plan_survives_database_reopen_and_checks_revision_and_clear() {
    let path = db_path();
    let app = router(&path);
    let (status, _, initial) = call(app.clone(), "GET", None, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(initial["mode"], "demo");
    assert_eq!(initial["revision"], 0);
    assert!(initial["plan"].is_null());
    let seed: Value = serde_json::from_str(PROFILE).unwrap();
    assert_eq!(initial["profile"], seed["data"]);
    let (status, _, saved) = call(
        app.clone(),
        "PUT",
        Some(json!({"plan":plan(),"revision":0})),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(saved["revision"], 1);
    assert_eq!(saved["plan"], plan());
    let (status, _, _) = call(
        app.clone(),
        "PUT",
        Some(json!({"plan":plan(),"revision":0})),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    drop(app);
    let app = router(&path);
    let (_, _, restored) = call(app.clone(), "GET", None, None).await;
    assert_eq!(restored, saved);
    let mut empty = plan();
    empty["planIds"] = json!([]);
    empty["target"] = Value::Null;
    let (status, _, cleared) = call(
        app.clone(),
        "PUT",
        Some(json!({"plan":empty,"revision":1})),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(cleared["revision"], 2);
    assert_eq!(cleared["plan"]["planIds"], json!([]));
    drop(app);
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn disabled_demo_rejects_read_and_write() {
    let app = crate::app(crate::state_from_str(crate::EMBEDDED_DATA).unwrap());
    for method in ["GET", "PUT"] {
        let (status, _, value) = call(
            app.clone(),
            method,
            Some(json!({"plan":plan(),"revision":0})),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(value["error"], "demo_disabled");
    }
}

#[tokio::test]
async fn strict_fields_and_limits_cannot_store_profile_answers_or_free_text() {
    let path = db_path();
    let app = router(&path);
    let mut cases = Vec::new();
    for (field, value) in [
        ("profile", json!({"id":"other"})),
        ("answers", json!({"age":20})),
        ("chat", json!("private sentence")),
        ("userId", json!("other")),
    ] {
        let mut p = plan();
        p[field] = value;
        cases.push(json!({"plan":p,"revision":0}));
    }
    let mut p = plan();
    p["planIds"] = json!(["UNKNOWN"]);
    cases.push(json!({"plan":p,"revision":0}));
    let mut p = plan();
    p["planIds"] = json!(["CT-0113", "CT-0113"]);
    cases.push(json!({"plan":p,"revision":0}));
    for steps in [json!([-1]), json!([999]), json!([0, 0]), json!([0.5])] {
        let mut p = plan();
        p["stepDone"] = json!({"CT-0113":steps});
        cases.push(json!({"plan":p,"revision":0}));
    }
    let mut p = plan();
    p["stepDone"] = json!({"UNKNOWN":[0]});
    cases.push(json!({"plan":p,"revision":0}));
    let mut p = plan();
    p["docChecks"] = json!({"private sentence":true});
    cases.push(json!({"plan":p,"revision":0}));
    let mut p = plan();
    p["engineVersion"] = json!("sensitive data");
    cases.push(json!({"plan":p,"revision":0}));
    let mut p = plan();
    p["target"] = json!("stranger");
    cases.push(json!({"plan":p,"revision":0}));
    let mut p = plan();
    p["v"] = json!(2);
    cases.push(json!({"plan":p,"revision":0}));
    cases.push(json!({"plan":plan(),"revision":0,"userId":"other"}));
    let mut p = plan();
    p["planIds"] = json!(["x".repeat(128 * 1024)]);
    cases.push(json!({"plan":p,"revision":0}));
    for body in cases {
        let (status, _, error) = call(app.clone(), "PUT", Some(body), None).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(error, json!({"error":"invalid_input"}));
    }
    let (_, _, state) = call(app.clone(), "GET", None, None).await;
    assert_eq!(state["revision"], 0);
    drop(app);
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn demo_origin_is_restricted_while_public_catalog_remains_public() {
    let path = db_path();
    let app = router(&path);
    for origin in [
        "https://evil.example",
        "null",
        "http://localhost:9999",
        "http://127.0.0.1:5173.evil.example",
        "http://user@127.0.0.1:8080",
    ] {
        for method in ["GET", "PUT", "OPTIONS"] {
            let (status, headers, _) = call(
                app.clone(),
                method,
                Some(json!({"plan":plan(),"revision":0})),
                Some(origin),
            )
            .await;
            assert_eq!(status, StatusCode::FORBIDDEN, "{origin} {method}");
            assert!(!headers.contains_key(header::ACCESS_CONTROL_ALLOW_ORIGIN));
        }
    }
    for origin in [
        "http://127.0.0.1:8080",
        "http://localhost:5173",
        "http://127.0.0.1:4173",
    ] {
        let (status, headers, _) = call(app.clone(), "GET", None, Some(origin)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(headers[header::ACCESS_CONTROL_ALLOW_ORIGIN], origin);
        let (status, headers, _) = call(app.clone(), "OPTIONS", None, Some(origin)).await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        assert_eq!(
            headers[header::ACCESS_CONTROL_ALLOW_METHODS],
            "GET, PUT, OPTIONS"
        );
    }
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/catalog")
                .header("origin", "https://evil.example")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
    let (_, _, state) = call(app.clone(), "GET", None, None).await;
    assert_eq!(state["revision"], 0);
    drop(app);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn document_keys_allow_catalog_progress_without_accepting_arbitrary_keys() {
    let state = crate::state_from_str(crate::EMBEDDED_DATA).unwrap();
    for entry in &state.entries {
        let mut plan: SavedPlan = serde_json::from_value(plan()).unwrap();
        plan.plan_ids = vec![entry.subsidy.id.clone()];
        for key in document_keys(&state, &plan.plan_ids) {
            plan.doc_checks.insert(key, true);
        }
        assert!(valid_plan(&plan, &state), "{}", entry.subsidy.id);
    }
}

#[tokio::test]
async fn failed_database_write_reports_failure_and_keeps_previous_revision() {
    let path = db_path();
    let store = DemoStore::open(&path).unwrap();
    store.connection.lock().unwrap().execute_batch(
        "CREATE TRIGGER refuse_plan_write BEFORE UPDATE ON action_plans BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;"
    ).unwrap();
    let mut state = crate::state_from_str(crate::EMBEDDED_DATA).unwrap();
    state.demo = Some(std::sync::Arc::new(store));
    let app = crate::app(state);
    let (status, _, value) = call(
        app.clone(),
        "PUT",
        Some(json!({"plan":plan(),"revision":0})),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(value, json!({"error":"storage_unavailable"}));
    let (_, _, state) = call(app.clone(), "GET", None, None).await;
    assert_eq!(state["revision"], 0);
    assert!(state["plan"].is_null());
    drop(app);
    std::fs::remove_file(path).unwrap();
}
