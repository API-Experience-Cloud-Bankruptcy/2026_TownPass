//! Filtering (`GET /api/subsidies`) and profile matching (`POST /api/match`).
//!
//! Matching is deliberately conservative. Only two things can rule a subsidy out:
//! a region mismatch and a typed age range that clearly excludes the applicant.
//! Everything else (income, household type, student status) only produces warnings or
//! positive reasons, because the source conditions are often household-level or
//! have exceptions that the typed fields cannot express.

use crate::models::{Age, Entry, Income};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct ListQuery {
    pub q: Option<String>,
    pub scope: Option<String>,
    pub region: Option<String>,
    pub category: Option<String>,
    pub benefit_type: Option<String>,
    /// Comma separated, matches any.
    pub applicant_type: Option<String>,
    pub verification_status: Option<String>,
    pub method: Option<String>,
    pub has_documents: Option<bool>,
    /// Applicant age; drops records whose typed applicant age range excludes it.
    pub age: Option<f64>,
    /// Extension key, e.g. `vehicle_type`.
    pub extension: Option<String>,
    /// `summary` (default) or `full`.
    pub view: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct Profile {
    pub age: Option<f64>,
    /// e.g. "臺北市"
    pub region: Option<String>,
    pub annual_income: Option<f64>,
    pub monthly_income: Option<f64>,
    pub is_student: Option<bool>,
    /// "low_income" | "mid_low_income" | "general"
    pub household_type: Option<String>,
    pub applicant_types: Vec<String>,
    pub q: Option<String>,
    pub include_ineligible: bool,
    pub view: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

fn norm_region(s: &str) -> String {
    s.replace('台', "臺")
}

fn contains_any(haystack: &[String], wanted: &str) -> bool {
    wanted.split(',').map(str::trim).filter(|w| !w.is_empty()).any(|w| haystack.iter().any(|h| h == w))
}

fn tokens(q: &str) -> Vec<String> {
    q.split_whitespace().map(|t| t.to_lowercase()).collect()
}

/// Returns a relevance score if the entry matches all tokens (0 when `q` is empty).
fn keyword_score(e: &Entry, q: &Option<String>) -> Option<u32> {
    let Some(q) = q else { return Some(0) };
    let toks = tokens(q);
    if toks.is_empty() {
        return Some(0);
    }
    let mut score = 0;
    for t in &toks {
        if !e.blob.contains(t.as_str()) {
            return None;
        }
        score += if e.name_lc.contains(t.as_str()) { 10 } else { 1 };
    }
    Some(score)
}

fn is_applicant(a: &Age) -> bool {
    let s = a.subject.as_deref().unwrap_or("申請人");
    s.contains("申請人") && !["子女", "兒童", "配偶", "父母", "幼"].iter().any(|w| s.contains(w))
}

/// "未滿X歲" is stored as max=X with the wording in `raw`, so it is exclusive.
pub fn age_ok(a: &Age, age: f64) -> bool {
    if a.unit.as_deref() == Some("month") {
        return true; // not comparable to an age in years
    }
    let exclusive_max = a.raw.as_deref().map(|r| r.contains("未滿")).unwrap_or(false);
    let min_ok = a.min.map_or(true, |m| age >= m);
    let max_ok = a.max.map_or(true, |m| if exclusive_max { age < m } else { age <= m });
    min_ok && max_ok
}

/// `Some(false)` only when the record has typed applicant age ranges and none include `age`.
fn age_verdict(e: &Entry, age: f64) -> Option<bool> {
    let items: Vec<&Age> = e
        .subsidy
        .eligibility
        .age
        .iter()
        .filter(|a| is_applicant(a) && (a.min.is_some() || a.max.is_some()) && a.unit.as_deref() != Some("month"))
        .collect();
    if items.is_empty() {
        return None;
    }
    Some(items.iter().any(|a| age_ok(a, age)))
}

pub fn filter_list<'a>(entries: &'a [Entry], q: &ListQuery) -> Vec<&'a Entry> {
    let mut hits: Vec<(u32, &Entry)> = entries
        .iter()
        .filter_map(|e| {
            let s = &e.subsidy;
            let score = keyword_score(e, &q.q)?;
            if let Some(v) = &q.scope {
                if s.scope.level != *v {
                    return None;
                }
            }
            if let Some(v) = &q.region {
                let v = norm_region(v);
                if !s.scope.regions.iter().any(|r| norm_region(r) == v) {
                    return None;
                }
            }
            if let Some(v) = &q.category {
                if !s.classification.category.as_deref().unwrap_or("").contains(v.as_str()) {
                    return None;
                }
            }
            if let Some(v) = &q.benefit_type {
                if !s.classification.benefit_type.as_deref().unwrap_or("").contains(v.as_str()) {
                    return None;
                }
            }
            if let Some(v) = &q.applicant_type {
                if !contains_any(&s.search.facets.applicant_types, v) {
                    return None;
                }
            }
            if let Some(v) = &q.verification_status {
                if s.source_meta.verification_status != *v {
                    return None;
                }
            }
            if let Some(v) = &q.method {
                if !contains_any(&s.application.methods, v) {
                    return None;
                }
            }
            if let Some(v) = q.has_documents {
                if s.application.required_documents.is_empty() == v {
                    return None;
                }
            }
            if let Some(age) = q.age {
                if age_verdict(e, age) == Some(false) {
                    return None;
                }
            }
            if let Some(k) = &q.extension {
                let has = s.extensions.iter().any(|x| x.get("key").and_then(Value::as_str) == Some(k.as_str()));
                if !has {
                    return None;
                }
            }
            Some((score, e))
        })
        .collect();
    hits.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.subsidy.id.cmp(&b.1.subsidy.id)));
    hits.into_iter().map(|(_, e)| e).collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Fit {
    /// No conflicts and at least one typed condition matched the profile.
    Likely,
    /// No hard conflict, but nothing typed confirmed a match.
    Possible,
    /// Region mismatch or typed age range excludes the applicant.
    Ineligible,
}

#[derive(Debug, Serialize)]
pub struct MatchResult {
    pub fit: Fit,
    pub reasons: Vec<String>,
    pub warnings: Vec<String>,
    pub blocked_by: Vec<String>,
}

fn compare(op: &str, lhs: f64, rhs: f64) -> Option<bool> {
    Some(match op {
        "<" => lhs < rhs,
        "<=" => lhs <= rhs,
        "==" => (lhs - rhs).abs() < f64::EPSILON,
        ">=" => lhs >= rhs,
        ">" => lhs > rhs,
        _ => return None,
    })
}

fn income_check(i: &Income, p: &Profile) -> Option<(bool, String)> {
    let value = i.value?;
    if matches!(i.currency.as_deref(), Some(c) if c != "TWD") {
        return None;
    }
    let mine = match i.metric.as_deref()? {
        "annual_income" => p.annual_income?,
        "monthly_income" => p.monthly_income?,
        _ => return None,
    };
    let ok = compare(i.operator.as_deref()?, mine, value)?;
    Some((ok, i.raw.clone().unwrap_or_default()))
}

pub fn evaluate(e: &Entry, p: &Profile) -> MatchResult {
    let s = &e.subsidy;
    let (mut reasons, mut warnings, mut blocked) = (vec![], vec![], vec![]);

    if let Some(region) = &p.region {
        let region = norm_region(region);
        let regions: Vec<String> = s.scope.regions.iter().map(|r| norm_region(r)).collect();
        if regions.iter().any(|r| r == &region) || regions.iter().any(|r| r == "全國") {
            reasons.push(format!("適用地區包含 {region}"));
        } else {
            blocked.push(format!("僅適用 {}", regions.join("、")));
        }
    }

    if let Some(age) = p.age {
        match age_verdict(e, age) {
            Some(true) => reasons.push(format!("年齡 {age} 歲符合年齡條件")),
            Some(false) => blocked.push(format!("年齡 {age} 歲不在資格範圍內")),
            None => {}
        }
    }

    for i in &s.eligibility.income {
        if let Some((ok, raw)) = income_check(i, p) {
            if ok {
                reasons.push(format!("所得符合：{raw}"));
            } else {
                warnings.push(format!("所得可能超過門檻（門檻可能以家戶計算）：{raw}"));
            }
        }
    }

    if let Some(h) = &p.household_type {
        let want = match h.as_str() {
            "low_income" => Some("低收入戶"),
            "mid_low_income" => Some("中低收入戶"),
            _ => None,
        };
        let required: Vec<&str> = s
            .eligibility
            .household
            .iter()
            .filter_map(|x| x.get("types").and_then(Value::as_array))
            .flatten()
            .filter_map(Value::as_str)
            .filter(|t| t.contains("低收入戶"))
            .collect();
        if !required.is_empty() {
            match want {
                Some(w) if required.contains(&w) => reasons.push(format!("符合 {w} 身分條件")),
                _ => warnings.push(format!("需要 {} 身分", required.join("／"))),
            }
        }
    }

    if let Some(is_student) = p.is_student {
        let needs_enrolment = s
            .eligibility
            .student
            .iter()
            .any(|x| x.get("enrollment_required").and_then(Value::as_bool) == Some(true));
        if needs_enrolment {
            if is_student {
                reasons.push("符合在學條件".into());
            } else {
                warnings.push("需具在學身分".into());
            }
        }
    }

    let fit = if !blocked.is_empty() {
        Fit::Ineligible
    } else if !reasons.is_empty() && warnings.is_empty() {
        Fit::Likely
    } else {
        Fit::Possible
    };
    MatchResult { fit, reasons, warnings, blocked_by: blocked }
}

pub fn run_match<'a>(entries: &'a [Entry], p: &Profile) -> Vec<(&'a Entry, MatchResult)> {
    let mut out: Vec<(u32, &Entry, MatchResult)> = entries
        .iter()
        .filter_map(|e| {
            let score = keyword_score(e, &p.q)?;
            if !p.applicant_types.is_empty() {
                let ok = p.applicant_types.iter().any(|t| e.subsidy.search.facets.applicant_types.contains(t));
                if !ok {
                    return None;
                }
            }
            let r = evaluate(e, p);
            if r.fit == Fit::Ineligible && !p.include_ineligible {
                return None;
            }
            Some((score, e, r))
        })
        .collect();
    let rank = |f: Fit| match f {
        Fit::Likely => 0,
        Fit::Possible => 1,
        Fit::Ineligible => 2,
    };
    out.sort_by(|a, b| {
        rank(a.2.fit)
            .cmp(&rank(b.2.fit))
            .then(b.0.cmp(&a.0))
            .then_with(|| a.1.subsidy.id.cmp(&b.1.subsidy.id))
    });
    out.into_iter().map(|(_, e, r)| (e, r)).collect()
}
