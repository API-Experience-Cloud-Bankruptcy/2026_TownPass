// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
use axum::{
    body::{to_bytes, Body},
    http::Request,
};
use matcher::{evaluate, Fit};
use tower::ServiceExt;

#[tokio::test]
async fn optional_web_serves_built_files_and_preserves_api_and_missing_asset_errors() {
    let root = std::env::temp_dir().join(format!(
        "townpass-web-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(root.join("assets")).unwrap();
    std::fs::write(
        root.join("index.html"),
        "<!doctype html><title>福利通</title>",
    )
    .unwrap();
    std::fs::write(root.join("assets/app.js"), "export const ready = true;").unwrap();
    let router = with_web(app(state()), &root).unwrap();
    for (path, status, content_type) in [
        ("/", StatusCode::OK, Some("text/html")),
        ("/assets/app.js", StatusCode::OK, Some("javascript")),
        ("/assets/missing.js", StatusCode::NOT_FOUND, None),
        ("/%2e%2e/Cargo.toml", StatusCode::NOT_FOUND, None),
        ("/api/unknown", StatusCode::NOT_FOUND, None),
    ] {
        let response = router
            .clone()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), status, "{path}");
        if let Some(expected) = content_type {
            assert!(response.headers()["content-type"]
                .to_str()
                .unwrap()
                .contains(expected));
            assert_eq!(response.headers()["cache-control"], "no-cache");
        }
    }
    let (status, body) = request(router.clone(), "GET", "/api/catalog", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["items"].as_array().unwrap().len(), 217);
    let (status, body) = request(router, "GET", "/health", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["records"], 217);
    assert!(with_web(app(state()), &root.join("missing")).is_err());
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn form_pdfs_are_served_only_by_exact_hash_names() {
    let router = app(state());
    // every shipped form file is reachable under its own name and is a real PDF
    let dir = default_forms_dir();
    let name = std::fs::read_dir(&dir)
        .expect("data/forms")
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .find(|n| is_form_file_name(n))
        .expect("at least one form pdf");
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/forms/{name}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "application/pdf");
    assert_eq!(response.headers()["x-content-type-options"], "nosniff");
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert!(bytes.starts_with(b"%PDF-"));
    // anything else is 404, even when the path would resolve on disk
    for bad in [
        "..%2fCargo.toml",
        "..%2f..%2fCargo.toml",
        "%2e%2e%2fCargo.toml",
        "Cargo.toml",
        "000000000000.pdf",
        "0123456789AB.pdf",
        "0123456789ag.pdf",
        "0123456789abc.pdf",
        "0123456789ab.txt",
        "0123456789ab.pdf.pdf",
        "é12345678.pdf",
        "%C3%A9%C3%A9%C3%A9%C3%A9%C3%A9%C3%A9.pdf",
    ] {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/forms/{bad}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{bad}");
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        assert!(!bytes.starts_with(b"%PDF-"), "{bad} leaked a file");
    }
}

fn state() -> AppState {
    state_from_str(EMBEDDED_DATA).expect("embedded dataset")
}
fn records() -> Vec<Value> {
    serde_json::from_str(EMBEDDED_DATA).unwrap()
}
fn entry(id: &str) -> Entry {
    Entry::from_value(records().into_iter().find(|r| r["id"] == id).unwrap()).unwrap()
}
fn isolated_age(age: Value) -> Value {
    let mut raw = records().remove(0);
    raw["eligibility"] = json!({"age":[age]});
    raw["source_meta"] = json!({"verification_status":"verified"});
    raw["extensions"] = json!([]);
    raw
}
fn age_rule(subject: Value, unit: Value, min: Value, max: Value, raw: &str) -> Value {
    json!({"subject":subject,"unit":unit,"min":min,"max":max,"raw":raw})
}
fn fit(raw: Value, age: f64) -> Fit {
    evaluate(
        &Entry::from_value(raw).unwrap(),
        &Profile {
            age: Some(age),
            ..Default::default()
        },
    )
    .fit
}
async fn request(
    router: Router,
    method: &str,
    uri: &str,
    body: Option<&str>,
) -> (StatusCode, Value) {
    let mut req = Request::builder().method(method).uri(uri);
    if body.is_some() {
        req = req.header("content-type", "application/json");
    }
    let response = router
        .oneshot(req.body(Body::from(body.unwrap_or("").to_owned())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).expect("JSON API response"),
    )
}

#[test]
fn original_records_and_verification_status_are_preserved() {
    let st = state();
    assert_eq!(st.entries.len(), 217);
    assert_eq!(st.by_id.len(), 217);
    let mut status = BTreeMap::new();
    for (entry, raw) in st.entries.iter().zip(records()) {
        assert_eq!(entry.original, raw);
        assert_eq!(render(entry, &Some("full".into())), raw);
        *status
            .entry(entry.subsidy.source_meta.verification_status.as_str())
            .or_insert(0) += 1;
    }
    assert_eq!(
        status,
        BTreeMap::from([("verified", 125), ("partial", 90), ("unverified", 2)])
    );
    let raw = &entry("WEL-0001").original;
    for key in ["period", "year", "multiplier_base", "multiplier_value"] {
        assert!(raw["eligibility"]["income"][0].get(key).is_some(), "{key}");
    }
}

#[tokio::test]
async fn catalog_detail_full_list_and_match_preserve_unknown_fields_at_every_depth() {
    let mut raw = records().remove(0);
    for pointer in [
        "",
        "/scope",
        "/classification",
        "/eligibility",
        "/eligibility/income/0",
        "/application",
        "/search",
        "/search/facets",
        "/source_meta",
        "/provider",
        "/merge",
    ] {
        raw.pointer_mut(pointer)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert(
                "future_field".into(),
                json!({"verbatim":"保留原文", "array":[null,false,12.5]}),
            );
    }
    let encoded = serde_json::to_string(&vec![raw.clone()]).unwrap();
    let router = app(state_from_str(&encoded).unwrap());
    let (_, cat) = request(router.clone(), "GET", "/api/catalog", None).await;
    assert_eq!(cat["items"][0], raw);
    let (_, detail) = request(
        router.clone(),
        "GET",
        &format!("/api/subsidies/{}", raw["id"].as_str().unwrap()),
        None,
    )
    .await;
    assert_eq!(detail, raw);
    let (_, list) = request(router.clone(), "GET", "/api/subsidies?view=full", None).await;
    assert_eq!(list["items"][0], raw);
    let (_, matched) = request(router, "POST", "/api/match", Some(r#"{"view":"full"}"#)).await;
    let mut returned = matched["items"][0].clone();
    assert_eq!(
        returned.as_object_mut().unwrap().remove("match").unwrap()["fit"],
        "possible"
    );
    assert_eq!(returned, raw);
}

#[test]
fn content_versions_are_repeatable_and_change_with_input() {
    assert_eq!(state().version, state().version);
    let changed = EMBEDDED_DATA.replacen("WEL-0001", "TEST-0001", 1);
    assert_ne!(state().version, state_from_str(&changed).unwrap().version);
    let mut duplicate = records();
    duplicate.push(duplicate[0].clone());
    assert!(state_from_str(&serde_json::to_string(&duplicate).unwrap()).is_err());
    let mut missing_id = records();
    missing_id[0].as_object_mut().unwrap().remove("id");
    assert!(state_from_str(&serde_json::to_string(&missing_id).unwrap()).is_err());
    let mut blank_id = records();
    blank_id[0]["id"] = json!(" ");
    assert!(state_from_str(&serde_json::to_string(&blank_id).unwrap()).is_err());
    assert!(state_from_str("{}").is_err());
}

#[test]
fn reviewed_real_boundaries_exclude_independently_of_unknown_income() {
    for (id, age, expected) in [
        ("WEL-0055", 64.0, Fit::Ineligible),
        ("WEL-0055", 65.0, Fit::Possible),
        ("WEL-0106", 24.0, Fit::Ineligible),
        ("WEL-0106", 25.0, Fit::Possible),
        ("WEL-0106", 65.0, Fit::Possible),
        ("WEL-0106", 66.0, Fit::Ineligible),
        ("CT-0129", 17.0, Fit::Ineligible),
        ("CT-0129", 18.0, Fit::Possible),
        ("CT-0129", 24.0, Fit::Possible),
        ("CT-0129", 25.0, Fit::Ineligible),
        ("CT-0069", 55.0, Fit::Possible),
        ("CT-0069", 65.0, Fit::Ineligible),
    ] {
        assert_eq!(
            matcher::evaluate_at(
                &entry(id),
                &Profile {
                    age: Some(age),
                    ..Default::default()
                },
                "2026-11-07"
            )
            .fit,
            expected,
            "{id} {age}"
        );
    }
    let unreviewed = isolated_age(age_rule(
        json!("申請人"),
        json!("year"),
        json!(65),
        Value::Null,
        "年滿65歲",
    ));
    assert_eq!(fit(unreviewed, 10.0), Fit::Possible);
}

#[test]
fn age_subject_units_exceptions_alternatives_and_unknowns_never_exclude() {
    for subject in [
        json!("兒童"),
        json!("子女"),
        json!("配偶"),
        json!("申請人、配偶或戶籍內直系親屬之至少1人"),
        Value::Null,
    ] {
        let raw = isolated_age(age_rule(
            subject,
            json!("year"),
            json!(65),
            Value::Null,
            "年滿65歲",
        ));
        assert_eq!(fit(raw, 20.0), Fit::Possible);
    }
    for unit in [json!("month"), json!("day"), json!("unknown"), Value::Null] {
        let raw = isolated_age(age_rule(
            json!("申請人"),
            unit,
            json!(65),
            Value::Null,
            "年滿65歲",
        ));
        assert_eq!(fit(raw, 20.0), Fit::Possible);
    }
    for text in [
        "年滿65歲；身心障礙者例外",
        "以116年計算65歲",
        "65歲以上（按接種年減出生年）",
        "未滿65歲",
        "年滿65歲或其他資格",
    ] {
        assert_eq!(
            fit(
                isolated_age(age_rule(
                    json!("申請人"),
                    json!("year"),
                    json!(65),
                    Value::Null,
                    text
                )),
                20.0
            ),
            Fit::Possible
        );
    }
    let base = isolated_age(age_rule(
        json!("申請人"),
        json!("year"),
        json!(65),
        Value::Null,
        "年滿65歲",
    ));
    for (pointer, value) in [
        ("/eligibility/raw_summary", json!("身障者亦可申請")),
        ("/eligibility/future_rule", json!({"anyOf":["exception"]})),
        ("/source_meta/notes", json!("年齡可放寬")),
        (
            "/extensions",
            json!([{"namespace":"eligibility","raw":"另有適用對象"}]),
        ),
    ] {
        let mut raw = base.clone();
        let (parent, key) = pointer.rsplit_once('/').unwrap();
        raw.pointer_mut(parent)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert(key.into(), value);
        assert_eq!(fit(raw, 20.0), Fit::Possible);
    }
    let mut multi = base.clone();
    multi["eligibility"]["age"]
        .as_array_mut()
        .unwrap()
        .push(age_rule(
            json!("原住民"),
            json!("year"),
            json!(55),
            Value::Null,
            "55歲以上",
        ));
    assert_eq!(fit(multi, 55.0), Fit::Possible);
    for id in [
        "CT-0113", "CT-0099", "WEL-0032", "WEL-0042", "WEL-0090", "WEL-0092",
    ] {
        assert_eq!(
            evaluate(
                &entry(id),
                &Profile {
                    age: Some(20.0),
                    ..Default::default()
                }
            )
            .fit,
            Fit::Possible,
            "{id}"
        );
    }
}

#[test]
fn no_profile_can_turn_partial_facts_or_raw_conditions_into_likely() {
    let st = state();
    for profile in [
        Profile::default(),
        Profile {
            age: Some(72.0),
            region: Some("臺北市".into()),
            is_student: Some(true),
            household_type: Some("low_income".into()),
            annual_income: Some(1.0),
            monthly_income: Some(1.0),
            ..Default::default()
        },
    ] {
        for e in &st.entries {
            let result = evaluate(e, &profile);
            assert_ne!(result.fit, Fit::Likely, "{}", e.subsidy.id);
            assert!(!result.warnings.is_empty());
        }
    }
    for id in ["WEL-0001", "CT-0020", "WEL-0004"] {
        let result = evaluate(
            &entry(id),
            &Profile {
                is_student: Some(true),
                household_type: Some("low_income".into()),
                annual_income: Some(0.0),
                ..Default::default()
            },
        );
        assert_eq!(result.fit, Fit::Possible);
        assert!(result
            .reasons
            .iter()
            .all(|s| !s.contains("所得符合") && !s.contains("符合 低收入戶")));
    }
}

#[test]
fn scope_never_excludes_cross_region_school_or_work_routes() {
    for region in ["高雄市", "其他縣市", "台北市"] {
        let result = evaluate(
            &entry("WEL-0098"),
            &Profile {
                region: Some(region.into()),
                ..Default::default()
            },
        );
        assert_eq!(result.fit, Fit::Possible);
        assert!(result.blocked_by.is_empty());
        assert!(result.warnings.iter().any(|s| s.contains("就學")));
    }
    let st = state();
    let matched = run_match(
        &st.entries,
        &Profile {
            region: Some("高雄市".into()),
            ..Default::default()
        },
    );
    assert!(matched.iter().any(|(e, _)| e.subsidy.id == "WEL-0098"));
}

#[test]
fn shared_questions_are_supported_by_reviewed_conditions_and_discovery() {
    let st = state();
    let questions = serde_json::to_value(&st.questions).unwrap();
    assert!(questions.as_array().unwrap().len() >= 4);
    for q in questions.as_array().unwrap() {
        assert_eq!(
            q["id"],
            format!("q-{}", q["field"].as_str().unwrap().replace('_', "-"))
        );
        assert!(q["burden"].as_u64().is_some_and(|n| n > 0));
        assert!(["qualification", "discovery"].contains(&q["purpose"].as_str().unwrap()));
        assert!(!q["resource_ids"].as_array().unwrap().is_empty());
        for id in q["resource_ids"].as_array().unwrap() {
            assert!(st.by_id.contains_key(id.as_str().unwrap()));
        }
    }
    let region = questions
        .as_array()
        .unwrap()
        .iter()
        .find(|q| q["field"] == "region")
        .unwrap();
    assert!(region["title"].as_str().unwrap().contains("戶籍"));
    assert_eq!(
        region["options"],
        json!([{"label":"臺北市","value":"臺北市"},{"label":"臺北市以外","value":"其他縣市"}])
    );
    let student = questions
        .as_array()
        .unwrap()
        .iter()
        .find(|q| q["field"] == "is_student")
        .unwrap();
    assert_eq!(student["options"][1]["value"], false);
    let unknown: Profile = serde_json::from_value(json!({})).unwrap();
    let negative: Profile = serde_json::from_value(json!({"is_student":false})).unwrap();
    assert_eq!(unknown.is_student, None);
    assert_eq!(negative.is_student, Some(false));
    let empty = Entry::from_value(isolated_age(age_rule(
        json!("子女"),
        json!("month"),
        Value::Null,
        json!(3),
        "出生3個月內",
    )))
    .unwrap();
    assert!(questions::build_questions(&[empty]).is_empty());
    assert!(questions::build_questions(&[]).is_empty());
}

#[tokio::test]
async fn http_health_catalog_questions_and_facets_are_complete() {
    let router = app(state());
    let (status, health) = request(router.clone(), "GET", "/health", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(health["records"], 217);
    let (_, cat) = request(router.clone(), "GET", "/api/catalog", None).await;
    assert_eq!(cat["items"], json!(records()));
    let (_, qs) = request(router.clone(), "GET", "/api/questions", None).await;
    assert!(qs["version"]
        .as_str()
        .unwrap()
        .contains(cat["version"].as_str().unwrap()));
    assert_eq!(
        qs["questions"],
        serde_json::to_value(questions::build_questions(&state().entries)).unwrap()
    );
    for version in [
        reviewed_rules::version(),
        adaptive_rules::version(),
        questions::version(),
    ] {
        assert!(qs["version"].as_str().unwrap().contains(&version));
    }
    let (_, facet) = request(router.clone(), "GET", "/api/facets", None).await;
    assert_eq!(
        facet["verification_status"],
        json!({"verified":125,"partial":90,"unverified":2})
    );
    let (status, error) = request(router, "GET", "/api/subsidies/does-not-exist", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error["error"], "not_found");
}

#[tokio::test]
async fn api_rejects_invalid_queries_and_personal_input_without_echoing_values() {
    let router = app(state());
    for uri in [
        "/api/subsidies?age=NaN",
        "/api/subsidies?age=inf",
        "/api/subsidies?age=-1",
        "/api/subsidies?age=131",
        "/api/subsidies?limit=-1",
        "/api/subsidies?offset=bad",
        "/api/subsidies?view=unknown",
        "/api/subsidies?scope=unknown",
        "/api/subsidies?verification_status=unknown",
        "/api/subsidies?birth_year=2000",
    ] {
        let (status, body) = request(router.clone(), "GET", uri, None).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
        assert_eq!(body["error"], "invalid_input");
    }
    for body in [
        "{",
        "null",
        "[]",
        r#"{"age":"20"}"#,
        r#"{"age":-1}"#,
        r#"{"age":131}"#,
        r#"{"annual_income":-1}"#,
        r#"{"monthly_income":-1}"#,
        r#"{"is_student":"false"}"#,
        r#"{"household_type":"unknown"}"#,
        r#"{"region":" "}"#,
        r#"{"view":"unknown"}"#,
        r#"{"real_name":"PRIVATE_TEST_VALUE"}"#,
        r#"{"extra":{"unknown":"PRIVATE_TEST_VALUE"}}"#,
        r#"{"extra":{"education_level":"doctorate"}}"#,
        r#"{"extra":{"disability_certificate":"false"}}"#,
        r#"{"extra":{"education_level":["college"]}}"#,
        r#"{"extra":{"education_level":null}}"#,
        r#"{"extra":{"age":20}}"#,
        r#"{"extra":{"housing_status":{"value":"renting"}}}"#,
    ] {
        let (status, error) = request(router.clone(), "POST", "/api/match", Some(body)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert!(!error.to_string().contains("PRIVATE_TEST_VALUE"));
    }
}

#[tokio::test]
async fn pagination_search_and_explicit_match_remain_available() {
    let router = app(state());
    let (_, body) = request(
        router.clone(),
        "GET",
        "/api/subsidies?view=full&limit=500",
        None,
    )
    .await;
    assert_eq!(body["limit"], 200);
    assert_eq!(body["total"], 217);
    assert_eq!(body["items"].as_array().unwrap().len(), 200);
    let (_, tail) = request(
        router.clone(),
        "GET",
        "/api/subsidies?view=full&limit=200&offset=200",
        None,
    )
    .await;
    assert_eq!(tail["items"].as_array().unwrap().len(), 17);
    let (_, empty) = request(router.clone(), "GET", "/api/subsidies?offset=999999", None).await;
    assert_eq!(empty["items"], json!([]));
    let st = state();
    let found = filter_list(
        &st.entries,
        &ListQuery {
            q: Some("敬老卡".into()),
            ..Default::default()
        },
    );
    assert!(found.iter().any(|e| e.subsidy.id == "CT-0113"));
    let (status, matched) = request(
        router,
        "POST",
        "/api/match",
        Some(r#"{"region":"高雄市","is_student":false,"view":"full","limit":200,"include_ineligible":true}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(matched["total"], 217);
    assert!(matched["items"]
        .as_array()
        .unwrap()
        .iter()
        .all(|item| item["match"]["fit"] != "likely"));
}

#[test]
fn all_real_records_bind_and_all_required_profile_age_matrices_run() {
    let st = state();
    assert_eq!(reviewed_rules::records().len(), 217);
    assert_eq!(
        st.entries.iter().filter(|e| e.reviewed.is_some()).count(),
        217
    );
    assert_eq!(
        reviewed_rules::records()
            .iter()
            .filter(|r| r.age_review == "required")
            .count(),
        27
    );
    assert_eq!(
        reviewed_rules::records()
            .iter()
            .filter(|r| r.age_review == "deferred")
            .count(),
        43
    );
    for age in [0., 17., 18., 29., 40., 41., 65., 99.] {
        for e in &st.entries {
            let result = matcher::evaluate_at(
                e,
                &Profile {
                    age: Some(age),
                    ..Default::default()
                },
                "2026-11-07",
            );
            assert_ne!(result.fit, Fit::Likely, "{} age={age}", e.subsidy.id);
        }
    }
    let expected = [
        "WEL-0031", "WEL-0058", "WEL-0082", "WEL-0099", "WEL-0100", "WEL-0101", "WEL-0106",
        "WEL-0110", "WEL-0111", "WEL-0122", "WEL-0125", "WEL-0126", "WEL-0128", "WEL-0137",
        "CT-0027", "CT-0069", "CT-0076", "CT-0129", "CT-0130",
    ];
    let actual: std::collections::BTreeSet<_> = st
        .entries
        .iter()
        .filter(|e| {
            matcher::evaluate_at(
                e,
                &Profile {
                    age: Some(99.),
                    ..Default::default()
                },
                "2026-11-07",
            )
            .fit == Fit::Ineligible
        })
        .map(|e| e.subsidy.id.as_str())
        .collect();
    assert_eq!(actual, expected.into_iter().collect());
    for id in [
        "CT-0019", "CT-0148", "WEL-0032", "WEL-0042", "WEL-0077", "CT-0150", "CT-0151", "CT-0099",
        "CT-0113", "WEL-0102", "WEL-0093", "WEL-0094", "CT-0093",
    ] {
        for age in [0., 17., 18., 29., 40., 41., 65., 99.] {
            assert_eq!(
                matcher::evaluate_at(
                    &entry(id),
                    &Profile {
                        age: Some(age),
                        ..Default::default()
                    },
                    "2026-11-07"
                )
                .fit,
                Fit::Possible,
                "{id} {age}"
            );
        }
    }
}

#[test]
fn birth_years_reference_dates_and_missing_dates_are_conservative() {
    let e = entry("WEL-0082");
    let rule = &e.reviewed.unwrap().requirements[0];
    for (age, result) in [
        (15., Some(false)),
        (16., None),
        (17., Some(true)),
        (18., Some(true)),
        (38., Some(true)),
        (39., None),
        (40., Some(false)),
        (99., Some(false)),
    ] {
        assert_eq!(
            reviewed_rules::verdict(
                rule,
                &Profile {
                    age: Some(age),
                    ..Default::default()
                },
                "2026-11-07"
            ),
            result,
            "age {age}"
        );
    }
    assert_eq!(
        reviewed_rules::verdict(
            rule,
            &Profile {
                age: Some(99.),
                ..Default::default()
            },
            "unknown"
        ),
        None
    );
    assert_eq!(
        reviewed_rules::verdict(
            rule,
            &Profile {
                age: Some(99.),
                ..Default::default()
            },
            "2026-02-30"
        ),
        None
    );
    assert_eq!(
        reviewed_rules::verdict(
            rule,
            &Profile {
                age: Some(40.),
                ..Default::default()
            },
            "2027-11-07"
        ),
        None
    );
    assert_eq!(
        reviewed_rules::date_parts("2024-02-29"),
        Some((2024, 2, 29))
    );
    let e = entry("WEL-0128");
    let rule = &e.reviewed.unwrap().requirements[0];
    for (age, result) in [
        (15., None),
        (16., Some(true)),
        (31., None),
        (32., Some(false)),
    ] {
        assert_eq!(
            reviewed_rules::verdict(
                rule,
                &Profile {
                    age: Some(age),
                    ..Default::default()
                },
                "2026-11-07"
            ),
            result
        );
    }
}

#[test]
fn all_reviewed_numeric_boundaries_have_real_record_regressions() {
    for row in reviewed_rules::records() {
        for rule in row
            .requirements
            .iter()
            .filter(|r| r.field == "age" && r.basis.as_deref() == Some("current_age"))
        {
            if let Some(min) = rule.min {
                assert_eq!(
                    reviewed_rules::verdict(
                        rule,
                        &Profile {
                            age: Some(min - 1.),
                            ..Default::default()
                        },
                        "2026-11-07"
                    ),
                    Some(false),
                    "{} min",
                    row.id
                );
                assert_eq!(
                    reviewed_rules::verdict(
                        rule,
                        &Profile {
                            age: Some(min),
                            ..Default::default()
                        },
                        "2026-11-07"
                    ),
                    Some(true),
                    "{} min",
                    row.id
                );
            }
            if let Some(max) = rule.max {
                assert_eq!(
                    reviewed_rules::verdict(
                        rule,
                        &Profile {
                            age: Some(max + 1.),
                            ..Default::default()
                        },
                        "2026-11-07"
                    ),
                    Some(false),
                    "{} max",
                    row.id
                );
                assert_eq!(
                    reviewed_rules::verdict(
                        rule,
                        &Profile {
                            age: Some(max),
                            ..Default::default()
                        },
                        "2026-11-07"
                    ),
                    Some(rule.max_inclusive != Some(false)),
                    "{} max",
                    row.id
                );
            }
        }
    }
}

#[test]
fn student_false_household_and_region_are_distinct_from_unknown_and_other_subjects() {
    for id in ["WEL-0110", "WEL-0111"] {
        let e = entry(id);
        assert_eq!(
            matcher::evaluate_at(
                &e,
                &Profile {
                    is_student: Some(true),
                    ..Default::default()
                },
                "2026-11-07"
            )
            .fit,
            Fit::Ineligible
        );
        assert_eq!(
            matcher::evaluate_at(
                &e,
                &Profile {
                    is_student: Some(false),
                    ..Default::default()
                },
                "2026-11-07"
            )
            .fit,
            Fit::Possible
        );
        assert_eq!(evaluate(&e, &Profile::default()).fit, Fit::Possible);
    }
    for id in [
        "CT-0104", "CT-0123", "CT-0126", "CT-0144", "CT-0145", "WEL-0089",
    ] {
        assert_eq!(
            evaluate(
                &entry(id),
                &Profile {
                    region: Some("其他縣市".into()),
                    ..Default::default()
                }
            )
            .fit,
            Fit::Ineligible,
            "{id}"
        );
        assert_eq!(
            evaluate(&entry(id), &Profile::default()).fit,
            Fit::Possible,
            "{id}"
        );
    }
    for id in ["WEL-0098", "CT-0113", "WEL-0037"] {
        assert_eq!(
            evaluate(
                &entry(id),
                &Profile {
                    region: Some("其他縣市".into()),
                    ..Default::default()
                }
            )
            .fit,
            Fit::Possible,
            "{id}"
        );
    }
    assert_eq!(
        evaluate(
            &entry("CT-0129"),
            &Profile {
                household_type: Some("general".into()),
                ..Default::default()
            }
        )
        .fit,
        Fit::Ineligible
    );
    for id in ["CT-0132", "CT-0144", "CT-0145"] {
        assert_eq!(
            evaluate(
                &entry(id),
                &Profile {
                    household_type: Some("general".into()),
                    ..Default::default()
                }
            )
            .fit,
            Fit::Possible,
            "{id}"
        );
    }
}

#[test]
fn source_and_unknown_rule_mutations_invalidate_old_exclusions() {
    let raw = entry("WEL-0082").original;
    for (pointer, value) in [
        ("/eligibility/raw_summary", json!("新例外")),
        ("/source_meta/checked_date", json!("2030-01-01")),
        (
            "/source_meta/sources/0/url",
            json!("https://example.org/changed"),
        ),
    ] {
        let mut changed = raw.clone();
        *changed.pointer_mut(pointer).unwrap() = value;
        let e = Entry::from_value(changed).unwrap();
        assert!(e.reviewed.is_none());
        assert_eq!(
            evaluate(
                &e,
                &Profile {
                    age: Some(99.),
                    ..Default::default()
                }
            )
            .fit,
            Fit::Possible
        );
    }
    let mut changed = raw;
    changed["eligibility"]["unknown_exception"] = json!("另有專案途徑");
    assert!(Entry::from_value(changed).unwrap().reviewed.is_none());
}

#[test]
fn hidden_age_in_taipei_applicability_is_reviewed_and_asked() {
    let e = entry("WEL-0031");
    assert!(e.subsidy.eligibility.age.is_empty());
    for (age, expected) in [
        (19., Fit::Ineligible),
        (20., Fit::Possible),
        (45., Fit::Possible),
        (46., Fit::Ineligible),
        (99., Fit::Ineligible),
    ] {
        assert_eq!(
            matcher::evaluate_at(
                &e,
                &Profile {
                    age: Some(age),
                    ..Default::default()
                },
                "2026-11-07"
            )
            .fit,
            expected
        );
    }
    let questions = questions::build_questions(&[e]);
    assert!(questions
        .iter()
        .find(|q| q.field == "age")
        .unwrap()
        .resource_ids
        .contains(&"WEL-0031".into()));
    let r = evaluate(
        &entry("CT-0104"),
        &Profile {
            region: Some("其他縣市".into()),
            ..Default::default()
        },
    );
    assert!(!r.warnings.iter().any(|w| w.contains("不據 scope 排除")));
}

#[test]
fn additional_qualification_answers_are_bounded_and_unknown_is_not_false() {
    let profile: Profile = serde_json::from_value(json!({"age":12,"extra":{
        "education_level":"graduate", "employment_status":"unemployed",
        "housing_status":"renting", "care_context":"home_care", "disability_certificate":false,
        "need_area":"study", "education_support":"tuition"
    }}))
    .unwrap();
    assert!(profile.validate().is_ok());
    let requirement =
        |value: Value| -> reviewed_rules::Requirement { serde_json::from_value(value).unwrap() };
    for (field, values, expected) in [
        (
            "education_level",
            json!(["college", "graduate"]),
            Some(true),
        ),
        ("education_level", json!(["college"]), Some(false)),
        ("education_level", json!(["unsupported"]), None),
        ("education_level", json!(["graduate", "unsupported"]), None),
        ("employment_status", json!(["unemployed", "training"]), None),
        ("housing_status", json!(["owning"]), None),
        ("care_context", json!(["home_care"]), None),
        ("unknown", json!(["anything"]), None),
        ("education_support", json!(["tuition"]), None),
    ] {
        let rule = requirement(json!({"field":field,"label":"test","values":values,"evidence":[]}));
        assert_eq!(
            reviewed_rules::verdict(&rule, &profile, "2026-11-07"),
            expected,
            "{field}"
        );
        assert_eq!(
            reviewed_rules::verdict(&rule, &Profile::default(), "2026-11-07"),
            None
        );
    }
    let rule = requirement(
        json!({"field":"disability_certificate","label":"test","required_boolean":true,"evidence":[]}),
    );
    assert_eq!(
        reviewed_rules::verdict(&rule, &profile, "2026-11-07"),
        Some(false)
    );
    let unknown = requirement(
        json!({"field":"unknown","label":"test","min":65,"basis":"current_age","evidence":[]}),
    );
    assert_eq!(
        reviewed_rules::verdict(&unknown, &profile, "2026-11-07"),
        None
    );
    let mut invalid = profile;
    invalid
        .extra
        .insert("housing_status".into(), json!("unknown"));
    let rule = requirement(
        json!({"field":"housing_status","label":"test","values":["renting"],"evidence":[]}),
    );
    assert!(invalid.validate().is_err());
    assert_eq!(reviewed_rules::verdict(&rule, &invalid, "2026-11-07"), None);
}

#[test]
fn discovery_quotes_values_and_original_content_must_all_bind() {
    let original = records().remove(0);
    let row = json!({
        "id":original["id"], "name":original["name"],
        "source_fingerprint":reviewed_rules::source_fingerprint(&original),
        "manual_conditions":[{"path":"/name","value":original["name"],"reason":"test"}],
        "source_urls":[],
        "document_overrides":[{"index":0,"required":false,"condition":"test","notes":"test","evidence":[{"path":"/name","value":original["name"]}]}],
        "facets":[{"field":"need_area","values":["living"],"reason":"test review",
          "evidence":[{"path":"/name","value":original["name"]}]}]
    });
    let parse =
        |row: Value| -> adaptive_rules::AdaptiveRecord { serde_json::from_value(row).unwrap() };
    assert!(adaptive_rules::bound(&parse(row.clone()), &original));
    for (pointer, value) in [
        ("/facets/0/evidence/0/value", json!("fabricated quote")),
        ("/facets/0/evidence/0/path", json!("/missing")),
        ("/facets/0/evidence", json!([])),
        ("/facets/0/values", json!(["unsupported"])),
        ("/facets/0/field", json!("unsupported")),
        ("/facets/0/reason", json!("")),
        ("/facets", json!([])),
        ("/manual_conditions/0/value", json!("unproven quote")),
        (
            "/document_overrides/0/evidence/0/value",
            json!("unproven document quote"),
        ),
        ("/source_urls", json!(["https://example.org/unproven"])),
        ("/source_fingerprint", json!("old")),
    ] {
        let mut changed = row.clone();
        *changed.pointer_mut(pointer).unwrap() = value;
        assert!(
            !adaptive_rules::bound(&parse(changed), &original),
            "{pointer}"
        );
    }
    let mut changed = original.clone();
    changed["eligibility"]["new_exception"] = json!("新例外");
    assert!(!adaptive_rules::bound(&parse(row), &changed));
}

#[test]
fn adaptive_question_support_is_bound_and_never_an_eligibility_rule() {
    let st = state();
    for entry in &st.entries {
        if let Some(row) = entry.adaptive {
            assert!(adaptive_rules::bound(row, &entry.original));
            let need = st
                .questions
                .iter()
                .find(|question| question.field == "need_area")
                .unwrap();
            assert!(need.resource_ids.contains(&entry.subsidy.id));
        }
    }
    for question in &st.questions {
        let template = questions::templates()
            .iter()
            .find(|template| template.field == question.field)
            .unwrap();
        assert_eq!(question.description, template.description);
        assert_eq!(question.options, template.options);
        assert_eq!(question.depends_on, template.depends_on);
        let mut expected: Vec<_> = st
            .entries
            .iter()
            .filter(|entry| {
                entry.reviewed.is_some_and(|row| {
                    row.requirements
                        .iter()
                        .any(|rule| rule.field == question.field)
                }) || entry.adaptive.is_some_and(|row| {
                    matches!(
                        question.field.as_str(),
                        "need_area" | "explore_context" | "expense_priority"
                    ) || row.facets.iter().any(|facet| facet.field == question.field)
                })
            })
            .map(|entry| entry.subsidy.id.clone())
            .collect();
        expected.sort();
        expected.dedup();
        assert_eq!(question.resource_ids, expected);
    }
    let discovery: Profile = serde_json::from_value(
        json!({"extra":{"need_area":"study","education_support":"tuition"}}),
    )
    .unwrap();
    assert!(discovery.validate().is_ok());
    for entry in &st.entries {
        assert_eq!(evaluate(entry, &discovery).fit, Fit::Possible);
    }
}

#[tokio::test]
async fn http_extra_answers_are_accepted_without_echoing_profile() {
    let (status, body) = request(app(state()), "POST", "/api/match", Some(r#"{"extra":{"education_level":"college","disability_certificate":false,"work_support":"training"}}"#)).await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["total"].as_u64().unwrap() > 0);
    for item in body["items"].as_array().unwrap() {
        assert!(item.get("extra").is_none());
    }
}

#[test]
fn factual_boolean_gates_do_not_conflate_work_or_housing_preferences() {
    for field in ["is_unemployed", "is_renting", "owns_home"] {
        let rule: reviewed_rules::Requirement = serde_json::from_value(
            json!({"field":field,"label":"test","required_boolean":true,"evidence":[]}),
        )
        .unwrap();
        for (answer, expected) in [(true, Some(true)), (false, Some(false))] {
            let profile: Profile = serde_json::from_value(json!({"extra":{field:answer}})).unwrap();
            assert!(profile.validate().is_ok(), "{field}");
            assert_eq!(
                reviewed_rules::verdict(&rule, &profile, "2026-11-07"),
                expected,
                "{field}"
            );
        }
        assert_eq!(
            reviewed_rules::verdict(&rule, &Profile::default(), "2026-11-07"),
            None
        );
    }
    for field in ["employment_status", "housing_status", "care_context"] {
        assert!(!questions::qualification_field(field));
    }
    assert!(questions::valid_facet_value(
        "disability_certificate",
        &json!("true")
    ));
    assert!(!questions::valid_facet_value(
        "disability_certificate",
        &json!(true)
    ));
}

#[test]
fn complete_adaptive_review_binds_every_original_record_and_discovery_field() {
    let st = state();
    assert_eq!(adaptive_rules::records().len(), st.entries.len());
    assert_eq!(
        st.entries
            .iter()
            .filter(|entry| entry.adaptive.is_some())
            .count(),
        217
    );
    let unique: std::collections::BTreeSet<_> = adaptive_rules::records()
        .iter()
        .map(|row| row.id.as_str())
        .collect();
    assert_eq!(unique.len(), 217);
    for row in adaptive_rules::records() {
        let entry = &st.entries[st.by_id[row.id.as_str()]];
        assert!(adaptive_rules::bound(row, &entry.original), "{}", row.id);
        assert!(!row.manual_conditions.is_empty(), "{}", row.id);
        assert!(!row.source_urls.is_empty(), "{}", row.id);
    }
    let need = st
        .questions
        .iter()
        .find(|q| q.field == "need_area")
        .unwrap();
    assert_eq!(need.resource_ids.len(), 217);
    for field in ["explore_context", "expense_priority"] {
        assert_eq!(
            st.questions
                .iter()
                .find(|q| q.field == field)
                .unwrap()
                .resource_ids
                .len(),
            217
        );
    }
    for field in [
        "education_level",
        "is_unemployed",
        "is_renting",
        "owns_home",
        "disability_certificate",
    ] {
        let question = st.questions.iter().find(|q| q.field == field).unwrap();
        assert_eq!(question.purpose, "qualification", "{field}");
    }
}

#[test]
fn adopted_new_gates_have_real_record_or_and_factual_boolean_regressions() {
    for (id, field) in [
        ("WEL-0107", "is_unemployed"),
        ("WEL-0038", "is_renting"),
        ("WEL-0068", "owns_home"),
        ("WEL-0104", "disability_certificate"),
    ] {
        let e = entry(id);
        for (answer, expected) in [(false, Fit::Ineligible), (true, Fit::Possible)] {
            let p: Profile = serde_json::from_value(json!({"extra":{field:answer}})).unwrap();
            assert!(p.validate().is_ok());
            assert_eq!(
                matcher::evaluate_at(&e, &p, "2026-11-07").fit,
                expected,
                "{id} {answer}"
            );
        }
        assert_eq!(evaluate(&e, &Profile::default()).fit, Fit::Possible);
    }
    let e = entry("WEL-0028");
    for (value, expected) in [
        ("secondary", Fit::Possible),
        ("college", Fit::Possible),
        ("graduate", Fit::Possible),
        ("preschool", Fit::Ineligible),
    ] {
        let p: Profile =
            serde_json::from_value(json!({"extra":{"education_level":value}})).unwrap();
        assert_eq!(
            matcher::evaluate_at(&e, &p, "2026-11-07").fit,
            expected,
            "WEL-0028 {value}"
        );
    }
    // Admitted and already-enrolled routes cannot become a shared current-stage gate.
    assert!(!entry("WEL-0032")
        .reviewed
        .unwrap()
        .requirements
        .iter()
        .any(|r| r.field == "education_level"));
    let p: Profile = serde_json::from_value(
        json!({"extra":{"employment_status":"employed","is_unemployed":true}}),
    )
    .unwrap();
    assert_eq!(evaluate(&entry("WEL-0107"), &p).fit, Fit::Possible);
}

#[test]
fn original_verification_status_is_provenance_and_never_current_policy_approval() {
    let manifest: Value =
        serde_json::from_str(include_str!("../rules/adaptive-reviewed.json")).unwrap();
    for row in manifest["records"].as_array().unwrap() {
        assert_eq!(row["current_policy_verified"], false, "{}", row["id"]);
    }
    for e in &state().entries {
        let result = evaluate(e, &Profile::default());
        assert_eq!(result.fit, Fit::Possible);
        assert!(
            result
                .warnings
                .iter()
                .any(|message| message.contains("本次未重新查核")),
            "{}",
            e.subsidy.id
        );
        assert_eq!(
            e.original["source_meta"]["verification_status"],
            e.subsidy.source_meta.verification_status
        );
    }
}

#[test]
fn reviewed_elder_support_and_worker_role_are_discovery_only() {
    let st = state();
    for (field, count) in [("elder_support", 21), ("work_applicant", 36)] {
        let question = st.questions.iter().find(|q| q.field == field).unwrap();
        assert_eq!(question.resource_ids.len(), count, "{field}");
        assert_eq!(question.purpose, "discovery");
        assert!(!questions::qualification_field(field));
        assert!(st.entries.iter().all(|entry| !entry
            .reviewed
            .unwrap()
            .requirements
            .iter()
            .any(|rule| rule.field == field)));
    }
    assert!(!questions::qualification_field("work_support"));
    for value in ["wage_claim", "family_education", "family_leave"] {
        assert!(questions::valid_extra_value("work_support", &json!(value)));
    }
}

#[test]
fn current_disability_proof_does_not_disprove_pre_enrollment_historical_proof() {
    let e = entry("CT-0068");
    assert!(!e
        .reviewed
        .unwrap()
        .requirements
        .iter()
        .any(|rule| rule.field == "disability_certificate"));
    let profile: Profile =
        serde_json::from_value(json!({"extra":{"disability_certificate":false}})).unwrap();
    assert!(profile.validate().is_ok());
    assert_eq!(
        matcher::evaluate_at(&e, &profile, "2026-11-07").fit,
        Fit::Possible
    );
}

#[test]
fn county_specific_documents_keep_structured_regions() {
    let st = state();
    let entry = st
        .entries
        .iter()
        .find(|e| e.subsidy.id == "CT-0047")
        .expect("CT-0047");
    let regions: Vec<_> = entry
        .subsidy
        .application
        .required_documents
        .iter()
        .map(|d| d["regions"].clone())
        .collect();
    assert_eq!(
        regions,
        std::iter::repeat_n(json!(["新北市"]), 5)
            .chain(std::iter::repeat_n(json!(["宜蘭縣"]), 3))
            .collect::<Vec<_>>()
    );
    assert!(entry.reviewed.is_some());
}
