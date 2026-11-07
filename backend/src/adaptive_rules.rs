// SPDX-License-Identifier: AGPL-3.0-only
//! Reviewed discovery associations; these never establish eligibility.
use crate::{
    questions,
    reviewed_rules::{source_fingerprint, Evidence},
};
use serde::Deserialize;
use serde_json::Value;
use std::sync::LazyLock;

#[derive(Debug, Deserialize)]
pub struct Facet {
    pub field: String,
    pub values: Vec<Value>,
    pub evidence: Vec<Evidence>,
    pub reason: String,
}
#[derive(Debug, Deserialize)]
pub struct DocumentOverride {
    pub evidence: Vec<Evidence>,
}
#[derive(Debug, Deserialize)]
pub struct AdaptiveRecord {
    pub id: String,
    pub name: String,
    pub source_fingerprint: String,
    pub facets: Vec<Facet>,
    pub manual_conditions: Vec<Evidence>,
    pub source_urls: Vec<String>,
    #[serde(default)]
    pub document_overrides: Vec<DocumentOverride>,
}
#[derive(Deserialize)]
struct Manifest {
    version: String,
    records: Vec<AdaptiveRecord>,
}
const RAW: &str = include_str!("../rules/adaptive-reviewed.json");
static MANIFEST: LazyLock<Manifest> =
    LazyLock::new(|| serde_json::from_str(RAW).expect("adaptive reviewed JSON"));
pub fn records() -> &'static [AdaptiveRecord] {
    &MANIFEST.records
}
pub fn version() -> String {
    let value: Value = serde_json::from_str(RAW).expect("adaptive reviewed JSON");
    format!("{}-{}", MANIFEST.version, source_fingerprint(&value))
}
pub fn bound(row: &AdaptiveRecord, value: &Value) -> bool {
    value["id"].as_str() == Some(row.id.as_str())
        && value["name"].as_str() == Some(row.name.as_str())
        && row.source_fingerprint == source_fingerprint(value)
        && row.manual_conditions.iter().all(|e| {
            !e.value.trim().is_empty()
                && value.pointer(&e.path).and_then(Value::as_str) == Some(e.value.as_str())
        })
        && row
            .document_overrides
            .iter()
            .flat_map(|document| &document.evidence)
            .all(|e| {
                !e.value.trim().is_empty()
                    && value.pointer(&e.path).and_then(Value::as_str) == Some(e.value.as_str())
            })
        && row.source_urls.iter().all(|url| {
            value["source_meta"]["sources"]
                .as_array()
                .is_some_and(|sources| {
                    sources.iter().any(|source| {
                        source["type"] == "official" && source["url"].as_str() == Some(url.as_str())
                    })
                })
        })
        && !row.facets.is_empty()
        && row.facets.iter().all(|facet| {
            !facet.values.is_empty()
                && !facet.reason.trim().is_empty()
                && facet
                    .values
                    .iter()
                    .all(|v| questions::valid_facet_value(&facet.field, v))
                && !facet.evidence.is_empty()
                && facet.evidence.iter().all(|e| {
                    !e.value.trim().is_empty()
                        && value.pointer(&e.path).and_then(Value::as_str) == Some(e.value.as_str())
                })
        })
}
pub fn review_for(value: &Value) -> Option<&'static AdaptiveRecord> {
    let id = value["id"].as_str()?;
    let mut rows = records().iter().filter(|row| row.id == id);
    let row = rows.next()?;
    // Duplicate review IDs are ambiguous and must never silently bind.
    (rows.next().is_none() && bound(row, value)).then_some(row)
}
