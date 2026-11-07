// SPDX-License-Identifier: AGPL-3.0-only
//! Shared, bounded question templates with source-bound resource support.
use crate::models::Entry;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::LazyLock;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Question {
    pub id: String,
    pub field: String,
    pub kind: String,
    pub title: String,
    pub description: String,
    #[serde(default = "default_burden")]
    pub burden: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<u16>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub situations: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depends_on: Option<BTreeMap<String, Vec<Value>>>,
    #[serde(default)]
    pub resource_ids: Vec<String>,
    #[serde(default)]
    pub purpose: String,
}
fn default_burden() -> u8 {
    1
}
#[derive(Deserialize)]
struct Templates {
    version: String,
    questions: Vec<Question>,
}
const RAW: &str = include_str!("../rules/question-templates.json");
static TEMPLATES: LazyLock<Templates> =
    LazyLock::new(|| serde_json::from_str(RAW).expect("question templates JSON"));

pub fn templates() -> &'static [Question] {
    &TEMPLATES.questions
}
pub fn version() -> String {
    let value: Value = serde_json::from_str(RAW).expect("question templates JSON");
    format!(
        "{}-{}",
        TEMPLATES.version,
        crate::reviewed_rules::source_fingerprint(&value)
    )
}
pub fn legacy_field(field: &str) -> bool {
    matches!(field, "age" | "region" | "is_student" | "household_type")
}
pub fn qualification_field(field: &str) -> bool {
    legacy_field(field)
        || matches!(
            field,
            "education_level"
                | "is_unemployed"
                | "is_renting"
                | "owns_home"
                | "disability_certificate"
        )
}
/// No free text or unbounded custom data is admitted into the personal profile.
pub fn valid_extra_value(field: &str, value: &Value) -> bool {
    !legacy_field(field) && valid_template_value(field, value)
}
/// Discovery sidecars use string labels, including "true"/"false" for booleans.
pub fn valid_facet_value(field: &str, value: &Value) -> bool {
    let Some(value) = value.as_str() else {
        return false;
    };
    templates()
        .iter()
        .find(|q| q.field == field)
        .and_then(|q| q.options.as_ref())
        .is_some_and(|options| {
            options.iter().any(|option| {
                option.get("value").is_some_and(|v| match v {
                    Value::String(s) => s == value,
                    Value::Bool(b) => b.to_string() == value,
                    Value::Number(n) => n.to_string() == value,
                    _ => false,
                })
            })
        })
}
pub fn valid_template_value(field: &str, value: &Value) -> bool {
    let Some(template) = templates().iter().find(|q| q.field == field) else {
        return false;
    };
    match template.kind.as_str() {
        "single" | "boolean" => {
            (if template.kind == "boolean" {
                value.is_boolean()
            } else {
                value.is_string()
            }) && template.options.as_ref().is_some_and(|options| {
                options
                    .iter()
                    .any(|option| option.get("value") == Some(value))
            })
        }
        "number" => value.as_f64().is_some_and(|n| {
            n.is_finite()
                && template.min.is_some_and(|min| n >= f64::from(min))
                && template.max.is_some_and(|max| n <= f64::from(max))
        }),
        _ => false,
    }
}

pub fn build_questions(entries: &[Entry]) -> Vec<Question> {
    templates()
        .iter()
        .filter_map(|template| {
            let field = template.field.as_str();
            let has_gate = entries.iter().any(|entry| {
                entry
                    .reviewed
                    .is_some_and(|row| row.requirements.iter().any(|rule| rule.field == field))
            });
            let mut resource_ids: Vec<String> = entries
                .iter()
                .filter(|entry| {
                    entry
                        .reviewed
                        .is_some_and(|row| row.requirements.iter().any(|rule| rule.field == field))
                        || entry.adaptive.is_some_and(|row| {
                            matches!(field, "need_area" | "explore_context" | "expense_priority")
                                || row.facets.iter().any(|facet| facet.field == field)
                        })
                })
                .map(|entry| entry.subsidy.id.clone())
                .collect();
            resource_ids.sort();
            resource_ids.dedup();
            if resource_ids.is_empty() {
                return None;
            }
            let mut question = template.clone();
            question.resource_ids = resource_ids;
            question.purpose = if has_gate {
                "qualification"
            } else {
                "discovery"
            }
            .into();
            Some(question)
        })
        .collect()
}
