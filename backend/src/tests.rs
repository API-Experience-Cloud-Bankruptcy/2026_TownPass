// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
use axum::{
    body::{to_bytes, Body},
    http::Request,
};
use matcher::{evaluate, Fit};
use tower::ServiceExt;

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
fn clear_age_boundaries_are_the_only_hard_exclusions() {
    let min = isolated_age(age_rule(
        json!("申請人"),
        json!("year"),
        json!(65),
        Value::Null,
        "年滿65歲",
    ));
    assert_eq!(fit(min.clone(), 64.99), Fit::Ineligible);
    assert_eq!(fit(min.clone(), 65.0), Fit::Possible);
    let max = isolated_age(age_rule(
        json!("申請人"),
        json!("year"),
        Value::Null,
        json!(25),
        "未滿25歲",
    ));
    assert_eq!(fit(max.clone(), 24.99), Fit::Possible);
    assert_eq!(fit(max, 25.0), Fit::Ineligible);
    let inclusive = isolated_age(age_rule(
        json!("申請人"),
        json!("year"),
        Value::Null,
        json!(65),
        "65歲以下",
    ));
    assert_eq!(fit(inclusive.clone(), 65.0), Fit::Possible);
    assert_eq!(fit(inclusive, 65.01), Fit::Ineligible);
    let range = isolated_age(age_rule(
        json!("申請人"),
        json!("year"),
        json!(55),
        json!(65),
        "年滿55歲且未滿65歲",
    ));
    assert_eq!(fit(range.clone(), 55.0), Fit::Possible);
    assert_eq!(fit(range, 65.0), Fit::Ineligible);
    let e = Entry::from_value(min).unwrap();
    assert!(filter_list(
        &[e],
        &ListQuery {
            age: Some(10.0),
            ..Default::default()
        }
    )
    .is_empty());
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
        "CT-0113", "CT-0099", "WEL-0032", "WEL-0042", "WEL-0090", "WEL-0092", "WEL-0100",
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
fn fixed_questions_are_supported_by_actual_conditions_and_skips_are_absent() {
    let st = state();
    let questions = serde_json::to_value(&st.questions).unwrap();
    assert_eq!(questions.as_array().unwrap().len(), 4);
    for q in questions.as_array().unwrap() {
        assert_eq!(q["id"], q["field"]);
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
        json!([{"label":"臺北市","value":"臺北市"},{"label":"其他縣市","value":"其他縣市"}])
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
        .ends_with(cat["version"].as_str().unwrap()));
    assert_eq!(qs["questions"].as_array().unwrap().len(), 4);
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
        Some(r#"{"region":"高雄市","is_student":false,"view":"full","limit":200}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(matched["total"], 217);
    assert!(matched["items"]
        .as_array()
        .unwrap()
        .iter()
        .all(|item| item["match"]["fit"] == "possible"));
}
