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
    assert_eq!(status, BTreeMap::from([("verified", 129), ("partial", 88)]));
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
    assert_eq!(qs["questions"].as_array().unwrap().len(), 4);
    let (_, facet) = request(router.clone(), "GET", "/api/facets", None).await;
    assert_eq!(
        facet["verification_status"],
        json!({"verified":129,"partial":88})
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

fn elder_profile() -> Profile {
    Profile {
        age: Some(78.0),
        region: Some("臺北市".into()),
        monthly_income: Some(12000.0),
        applicant_types: vec!["長者".into(), "中低收入戶".into()],
        ..Default::default()
    }
}

fn warns(r: &matcher::MatchResult, text: &str) -> bool {
    r.warnings.iter().any(|w| w.contains(text))
}

#[tokio::test]
async fn elder_mid_low_income_repro_has_no_likely_identity_gaps_or_closed_items() {
    let st = state();
    let matched = matcher::run_match_at(&st.entries, &elder_profile(), "2026-11-07");
    let by_id: HashMap<_, _> = matched
        .iter()
        .map(|(e, r)| (e.subsidy.id.as_str(), r))
        .collect();
    assert_eq!(matched.len(), 37);
    assert!(matched
        .iter()
        .all(|(_, r)| r.fit == Fit::Possible && r.closed_on.is_none()));
    assert!(warns(by_id["CT-0034"], "農保被保險人"));
    assert!(warns(by_id["CT-0099"], "榮民／退除役官兵"));
    let region_only = by_id["CT-0003"];
    assert!(region_only.reasons.is_empty());
    assert!(warns(region_only, "身心障礙者"));
    for id in ["WEL-0028", "WEL-0073", "WEL-0074", "WEL-0077"] {
        assert!(!by_id.contains_key(id), "{id}");
    }
    // Declared mid-low income satisfies the low-income identity group.
    assert!(!warns(by_id["CT-0104"], "低收入戶或中低收入戶"));
    let (status, _) = request(
        app(state()),
        "POST",
        "/api/match",
        Some(r#"{"age":78,"region":"臺北市","household_type":"獨居"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[test]
fn identity_limited_items_warn_until_the_identity_is_declared() {
    let today = "2026-11-07";
    let farmer = entry("CT-0034");
    let r = matcher::evaluate_at(&farmer, &elder_profile(), today);
    assert_eq!(r.fit, Fit::Possible);
    assert!(warns(&r, "可能限定身分，自述未提供：農保被保險人"));
    let mut declared = elder_profile();
    declared.applicant_types.push("農保被保險人".into());
    assert!(!warns(
        &matcher::evaluate_at(&farmer, &declared, today),
        "可能限定身分"
    ));
    let low = entry("CT-0023");
    assert!(warns(
        &matcher::evaluate_at(&low, &Profile::default(), today),
        "低收入戶或中低收入戶"
    ));
    let household = Profile {
        household_type: Some("low_income".into()),
        ..Default::default()
    };
    assert!(!warns(
        &matcher::evaluate_at(&low, &household, today),
        "可能限定身分"
    ));
}

#[tokio::test]
async fn closed_deadlines_are_hidden_by_default_and_marked_when_included() {
    let e = entry("WEL-0028");
    let open = matcher::evaluate_at(&e, &Profile::default(), "2026-09-30");
    assert_eq!(open.closed_on, None);
    let closed = matcher::evaluate_at(&e, &Profile::default(), "2026-10-01");
    assert_eq!(closed.closed_on.as_deref(), Some("2026-09-30"));
    assert_eq!(closed.fit, Fit::Possible);
    assert!(warns(&closed, "已截止：申請期限 2026-09-30"));
    let st = state();
    let all = Profile {
        include_ineligible: true,
        ..Default::default()
    };
    let included = matcher::run_match_at(&st.entries, &all, "2026-11-07");
    assert_eq!(included.len(), 217);
    assert_eq!(
        included
            .iter()
            .filter(|(_, r)| r.closed_on.is_some())
            .count(),
        25
    );
    assert!(included
        .iter()
        .skip_while(|(_, r)| r.closed_on.is_none())
        .all(|(_, r)| r.closed_on.is_some()));
    let default = matcher::run_match_at(&st.entries, &Profile::default(), "2026-11-07");
    assert_eq!(default.len(), 192);
    let (_, body) = request(
        app(state()),
        "POST",
        "/api/match",
        Some(r#"{"q":"感恩基金會","include_ineligible":true,"limit":200}"#),
    )
    .await;
    let item = body["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["id"] == "WEL-0028")
        .unwrap();
    assert_eq!(item["match"]["closed_on"], "2026-09-30");
    let (_, hidden) = request(
        app(state()),
        "POST",
        "/api/match",
        Some(r#"{"q":"感恩基金會","limit":200}"#),
    )
    .await;
    assert!(!hidden["items"]
        .as_array()
        .unwrap()
        .iter()
        .any(|i| i["id"] == "WEL-0028"));
}
