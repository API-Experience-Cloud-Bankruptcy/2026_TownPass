// SPDX-License-Identifier: AGPL-3.0-only
//! Fixed templates, emitted only when the loaded data supports the field.
use crate::{matcher::is_applicant_year, models::Entry};
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Debug, Serialize)]
pub struct Question {
    pub id: &'static str,
    pub field: &'static str,
    pub kind: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<u16>,
    pub resource_ids: Vec<String>,
}

pub fn build_questions(entries: &[Entry]) -> Vec<Question> {
    let templates = [
        (
            "age",
            "number",
            "受助者目前幾歲？",
            "填目前年齡（歲）；不是出生年。兒童、配偶、月齡及特定日期條件仍需另外確認。",
        ),
        (
            "region",
            "single",
            "受助者的戶籍地在哪個縣市？",
            "請選戶籍地，不是目前居住地。就學、就業、實際居住及設籍期間可能有不同規定。",
        ),
        (
            "is_student",
            "boolean",
            "受助者目前是否在學？",
            "僅確認目前在學與否；學制、學校、成績與其他原文要求仍待確認。",
        ),
        (
            "household_type",
            "single",
            "受助者目前有哪一種福利身分？",
            "依有效證明選擇。生活困難不等於具有低收入戶身分；不知道可略過。",
        ),
    ];
    let mut questions = Vec::new();
    for (field, kind, title, description) in templates {
        let mut resource_ids: Vec<String> = entries
            .iter()
            .filter(|e| {
                let el = &e.subsidy.eligibility;
                match field {
                    "age" => el.age.iter().any(is_applicant_year),
                    "region" => el
                        .residence
                        .iter()
                        .any(|r| r["registered_required"] == true),
                    "is_student" => !el.student.is_empty(),
                    "household_type" => el.household.iter().any(|h| {
                        h["types"].as_array().is_some_and(|types| {
                            types
                                .iter()
                                .any(|t| matches!(t.as_str(), Some("低收入戶" | "中低收入戶")))
                        })
                    }),
                    _ => false,
                }
            })
            .map(|e| e.subsidy.id.clone())
            .collect();
        resource_ids.sort();
        resource_ids.dedup();
        if resource_ids.is_empty() {
            continue;
        }
        let options = match field {
            "region" => {
                let mut regions: Vec<String> = entries
                    .iter()
                    .filter(|e| resource_ids.contains(&e.subsidy.id))
                    .flat_map(|e| &e.subsidy.eligibility.residence)
                    .filter(|r| r["registered_required"] == true)
                    .filter_map(|r| r["region"].as_str())
                    .filter(|r| r.ends_with('市') || r.ends_with('縣'))
                    .map(|r| r.replace('台', "臺"))
                    .collect();
                regions.sort();
                regions.dedup();
                regions.push("其他縣市".into());
                Some(
                    regions
                        .iter()
                        .map(|r| json!({"label":r,"value":r}))
                        .collect(),
                )
            }
            "is_student" => Some(vec![
                json!({"label":"是","value":true}),
                json!({"label":"否","value":false}),
            ]),
            "household_type" => Some(vec![
                json!({"label":"低收入戶","value":"low_income"}),
                json!({"label":"中低收入戶","value":"mid_low_income"}),
                json!({"label":"一般戶","value":"general"}),
            ]),
            _ => None,
        };
        questions.push(Question {
            id: field,
            field,
            kind,
            title,
            description,
            options,
            min: (field == "age").then_some(0),
            max: (field == "age").then_some(130),
            resource_ids,
        });
    }
    questions
}
