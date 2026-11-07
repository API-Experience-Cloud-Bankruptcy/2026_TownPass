//! Typed view of `data/subsidies.json` (schema: `data/subsidies.schema.json`).
//! Typed fields are an internal index only. Entry.original is the lossless API record.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Subsidy {
    pub api_version: String,
    pub id: String,
    pub name: String,
    pub scope: Scope,
    #[serde(default)]
    pub provider: Value,
    pub classification: Classification,
    pub eligibility: Eligibility,
    #[serde(default)]
    pub benefit: Value,
    pub application: Application,
    pub search: Search,
    #[serde(default)]
    pub extensions: Vec<Value>,
    pub source_meta: SourceMeta,
    #[serde(default)]
    pub merge: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Scope {
    pub level: String,
    #[serde(default)]
    pub regions: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Classification {
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub benefit_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Eligibility {
    #[serde(default)]
    pub age: Vec<Age>,
    #[serde(default)]
    pub income: Vec<Income>,
    #[serde(default)]
    pub residence: Vec<Value>,
    #[serde(default)]
    pub student: Vec<Value>,
    #[serde(default)]
    pub employment: Vec<Value>,
    #[serde(default)]
    pub disability: Vec<Value>,
    #[serde(default)]
    pub household: Vec<Value>,
    #[serde(default)]
    pub property: Vec<Value>,
    #[serde(default)]
    pub nationality: Vec<Value>,
    #[serde(default)]
    pub exclusions: Vec<String>,
    #[serde(default)]
    pub raw_summary: Option<String>,
    #[serde(default)]
    pub taipei_applicability: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Age {
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub min: Option<f64>,
    #[serde(default)]
    pub max: Option<f64>,
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub raw: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Income {
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub metric: Option<String>,
    #[serde(default)]
    pub operator: Option<String>,
    #[serde(default)]
    pub value: Option<f64>,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub raw: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Application {
    #[serde(default)]
    pub methods: Vec<String>,
    #[serde(default)]
    pub agency: Option<String>,
    #[serde(default)]
    pub channel_text: Option<String>,
    #[serde(default)]
    pub process_text: Option<String>,
    #[serde(default)]
    pub required_documents: Vec<Value>,
    #[serde(default)]
    pub deadline: Value,
    #[serde(default)]
    pub urls: Value,
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub form_fields: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Search {
    #[serde(default)]
    pub keywords: Vec<String>,
    pub facets: Facets,
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Facets {
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub regions: Vec<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub benefit_type: Option<String>,
    #[serde(default)]
    pub applicant_types: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SourceMeta {
    pub verification_status: String,
    #[serde(flatten)]
    pub other: Map<String, Value>,
}

/// A record plus precomputed lowercase text used for keyword search.
pub struct Entry {
    pub subsidy: Subsidy,
    pub original: Value,
    pub reviewed: Option<&'static crate::reviewed_rules::ReviewedRecord>,
    pub adaptive: Option<&'static crate::adaptive_rules::AdaptiveRecord>,
    pub blob: String,
    pub name_lc: String,
}

impl Entry {
    pub fn from_value(original: Value) -> Result<Self, serde_json::Error> {
        let s: Subsidy = serde_json::from_value(original.clone())?;
        let mut blob = String::new();
        let mut push = |t: &str| {
            blob.push_str(&t.to_lowercase());
            blob.push('\n');
        };
        push(&s.name);
        if let Some(c) = &s.classification.category {
            push(c);
        }
        if let Some(c) = &s.classification.benefit_type {
            push(c);
        }
        for k in &s.search.keywords {
            push(k);
        }
        if let Some(t) = &s.search.text {
            push(t);
        }
        if let Some(t) = &s.eligibility.raw_summary {
            push(t);
        }
        if let Some(n) = s.provider.get("name").and_then(Value::as_str) {
            push(n);
        }
        let name_lc = s.name.to_lowercase();
        let reviewed = crate::reviewed_rules::review_for(&original);
        let adaptive = crate::adaptive_rules::review_for(&original);
        Ok(Entry {
            subsidy: s,
            reviewed,
            adaptive,
            original,
            blob,
            name_lc,
        })
    }
}
