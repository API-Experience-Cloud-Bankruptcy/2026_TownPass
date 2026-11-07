//! Conservative search and explicit opt-in matching; no runtime AI.
//! Unparsed conditions never become evidence of complete eligibility.

use crate::models::{Age, Entry};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
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
#[serde(default, deny_unknown_fields)]
pub struct Profile {
    pub age: Option<f64>,
    /// Household registration, not actual residence; e.g. "臺北市".
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
    wanted
        .split(',')
        .map(str::trim)
        .filter(|w| !w.is_empty())
        .any(|w| haystack.iter().any(|h| h == w))
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
        score += if e.name_lc.contains(t.as_str()) {
            10
        } else {
            1
        };
    }
    Some(score)
}

/// Age answers always refer to the applicant in completed/current years.
pub fn is_applicant_year(a: &Age) -> bool {
    a.subject.as_deref() == Some("申請人") && a.unit.as_deref() == Some("year")
}

/// Only accept an exact age-only phrase whose boundaries agree with the typed data.
/// Other wording, missing units, multiple subjects and reference dates remain unknown.
fn age_bounds(a: &Age) -> Option<(bool, bool)> {
    if !is_applicant_year(a) || a.min.is_none() && a.max.is_none() {
        return None;
    }
    if [a.min, a.max]
        .into_iter()
        .flatten()
        .any(|n| !n.is_finite() || n < 0.0)
        || matches!((a.min, a.max), (Some(lo), Some(hi)) if lo > hi)
    {
        return None;
    }
    let raw = a.raw.as_deref()?.trim();
    let mut phrases = Vec::new();
    match (a.min, a.max) {
        (Some(lo), None) => {
            for text in [
                format!("{lo}歲以上"),
                format!("年滿{lo}歲"),
                format!("年滿{lo}歲以上"),
            ] {
                phrases.push((text, false, false));
            }
            phrases.push((format!("超過{lo}歲"), true, false));
        }
        (None, Some(hi)) => {
            phrases.push((format!("{hi}歲以下"), false, false));
            phrases.push((format!("未滿{hi}歲"), false, true));
        }
        (Some(lo), Some(hi)) => {
            for text in [
                format!("{lo}至{hi}歲"),
                format!("{lo}歲至{hi}歲"),
                format!("{lo}–{hi}歲"),
            ] {
                phrases.push((text, false, false));
            }
            for text in [
                format!("年滿{lo}歲且未滿{hi}歲"),
                format!("{lo}歲以上未滿{hi}歲"),
                format!("{lo}至未滿{hi}歲"),
            ] {
                phrases.push((text, false, true));
            }
        }
        _ => return None,
    }
    phrases
        .into_iter()
        .find(|(text, _, _)| text == raw)
        .map(|(_, lo, hi)| (lo, hi))
}

/// None means the age condition cannot safely be evaluated.
fn age_verdict(e: &Entry, age: f64) -> Option<bool> {
    let ages = &e.subsidy.eligibility.age;
    if ages.len() != 1 || !age.is_finite() || age < 0.0 {
        return None;
    }
    let a = &ages[0];
    let (exclusive_min, exclusive_max) = age_bounds(a)?;
    // No expression tree exists in this dataset. Any additional, unparsed
    // eligibility context could encode an alternative age route. Do not guess
    // from a keyword blacklist: only an isolated, fully understood age rule can exclude.
    let raw = a.raw.as_deref()?.trim();
    for (key, value) in e.original["eligibility"].as_object()? {
        let understood = match key.as_str() {
            "age" => true,
            "raw_summary" => {
                value.is_null()
                    || value
                        .as_str()
                        .is_some_and(|s| s.trim().is_empty() || s.trim() == raw)
            }
            "taipei_applicability" => {
                value.is_null() || value.as_str().is_some_and(|s| s.trim().is_empty())
            }
            "income" | "residence" | "student" | "employment" | "disability" | "household"
            | "property" | "nationality" | "exclusions" => {
                value.as_array().is_some_and(Vec::is_empty)
            }
            _ => false,
        };
        if !understood {
            return None;
        }
    }
    if e.original["eligibility"]["age"][0]
        .as_object()?
        .keys()
        .any(|key| !["subject", "min", "max", "unit", "raw"].contains(&key.as_str()))
        || !e.subsidy.extensions.is_empty()
        || ["notes", "verification_note"].iter().any(|key| {
            e.original["source_meta"][key]
                .as_str()
                .is_some_and(|s| !s.trim().is_empty())
        })
    {
        return None;
    }
    Some(
        a.min
            .is_none_or(|min| if exclusive_min { age > min } else { age >= min })
            && a.max
                .is_none_or(|max| if exclusive_max { age < max } else { age <= max }),
    )
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
                if !s
                    .classification
                    .category
                    .as_deref()
                    .unwrap_or("")
                    .contains(v.as_str())
                {
                    return None;
                }
            }
            if let Some(v) = &q.benefit_type {
                if !s
                    .classification
                    .benefit_type
                    .as_deref()
                    .unwrap_or("")
                    .contains(v.as_str())
                {
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
                let has = s
                    .extensions
                    .iter()
                    .any(|x| x.get("key").and_then(Value::as_str) == Some(k.as_str()));
                if !has {
                    return None;
                }
            }
            Some((score, e))
        })
        .collect();
    hits.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| a.1.subsidy.id.cmp(&b.1.subsidy.id))
    });
    hits.into_iter().map(|(_, e)| e).collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Fit {
    /// Reserved for fully evaluated conditions; this implementation does not emit it.
    Likely,
    /// No proven exclusion; original conditions remain unevaluated.
    Possible,
    /// A single unambiguous applicant/year age condition excludes the applicant.
    Ineligible,
}

#[derive(Debug, Serialize)]
pub struct MatchResult {
    pub fit: Fit,
    pub reasons: Vec<String>,
    pub warnings: Vec<String>,
    pub blocked_by: Vec<String>,
}

pub fn evaluate(e: &Entry, p: &Profile) -> MatchResult {
    let s = &e.subsidy;
    let (mut reasons, mut warnings, mut blocked) = (vec![], vec![], vec![]);
    warnings.push(
        "此初篩未完整評估原文資格、排除條件、例外與受理時效；仍須向承辦單位確認，非核准或送件證明"
            .into(),
    );
    if s.source_meta.verification_status != "verified" {
        warnings.push(format!(
            "資料原有查核狀態為 {}，本次未重新查核",
            s.source_meta.verification_status
        ));
    }
    if let Some(region) = &p.region {
        let region = norm_region(region);
        let in_scope = s
            .scope
            .regions
            .iter()
            .any(|r| norm_region(r) == region || r == "全國");
        warnings.push(if in_scope {
            format!("戶籍地為 {region}；scope 僅是資料範圍，戶籍、實際居住、就學／就業地及期間條件仍待確認")
        } else {
            format!("戶籍地 {region} 與資料範圍不同；可能另有就學／就業地等途徑，不據此排除，請確認原文")
        });
    } else if !s.eligibility.residence.is_empty() {
        warnings.push("尚未提供戶籍地；居住、就學與設籍要求不可互相推定".into());
    }
    if let Some(age) = p.age {
        match age_verdict(e, age) {
            Some(true) => reasons.push(format!(
                "已填年齡 {age} 歲落在明確的申請人年齡範圍內；僅此單項相符"
            )),
            Some(false) => blocked.push(format!(
                "已填年齡 {age} 歲不在明確的申請人年齡範圍（{}）內",
                s.eligibility.age[0].raw.as_deref().unwrap_or("")
            )),
            None if !s.eligibility.age.is_empty() => warnings.push(
                "年齡條件含不同主體、單位、基準日、例外或未解析原文，無法以申請人歲數確認或排除"
                    .into(),
            ),
            None => {}
        }
    } else if !s.eligibility.age.is_empty() {
        warnings.push("年齡條件尚待確認；未回答不代表不符合".into());
    }
    for income in &s.eligibility.income {
        warnings.push(format!(
            "所得條件未評估（主體：{}；須確認年度、期間、家戶及計算口徑）：{}",
            income.subject.as_deref().unwrap_or("未知"),
            income.raw.as_deref().unwrap_or("請見原文")
        ));
    }
    if p.annual_income.is_some() || p.monthly_income.is_some() {
        warnings.push("已提供個人收入，但 API 未以此核算任何所得資格，不推定等於家戶所得".into());
    }
    if !s.eligibility.household.is_empty() {
        let label = match p.household_type.as_deref() {
            Some("low_income") => "自述低收入戶",
            Some("mid_low_income") => "自述中低收入戶",
            Some("general") => "自述一般戶",
            _ => "尚未回答福利身分",
        };
        warnings.push(format!(
            "{label}；家戶證明、扶養、子女及替代身分等原文條件仍待確認，不據此判定符合或排除"
        ));
    }
    if !s.eligibility.student.is_empty() {
        match p.is_student {
            Some(true) => {
                reasons.push("自述目前在學；學制、學校、成績及其他在學要求仍待確認".into())
            }
            Some(false) => {
                warnings.push("自述目前未在學；須確認原文是否有非在學或其他適用途徑".into())
            }
            None => warnings.push("在學條件尚未回答，仍待確認".into()),
        }
    }
    for (present, label) in [
        (!s.eligibility.employment.is_empty(), "就業／保險"),
        (!s.eligibility.disability.is_empty(), "身心障礙"),
        (!s.eligibility.property.is_empty(), "財產"),
        (!s.eligibility.nationality.is_empty(), "國籍／居留"),
        (!s.eligibility.exclusions.is_empty(), "排除／重複補助"),
        (!s.extensions.is_empty(), "擴充原文"),
    ] {
        if present {
            warnings.push(format!("{label}條件未評估，請查閱完整原文"));
        }
    }
    // The current dataset has no complete executable eligibility expression.
    // Reserve `likely` for a future fully evaluated contract; partial facts cannot earn it.
    let fit = if blocked.is_empty() {
        Fit::Possible
    } else {
        Fit::Ineligible
    };
    MatchResult {
        fit,
        reasons,
        warnings,
        blocked_by: blocked,
    }
}

pub fn run_match<'a>(entries: &'a [Entry], p: &Profile) -> Vec<(&'a Entry, MatchResult)> {
    let mut out: Vec<(u32, &Entry, MatchResult)> = entries
        .iter()
        .filter_map(|e| {
            let score = keyword_score(e, &p.q)?;
            if !p.applicant_types.is_empty() {
                let ok = p
                    .applicant_types
                    .iter()
                    .any(|t| e.subsidy.search.facets.applicant_types.contains(t));
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

fn validate_age(age: Option<f64>) -> Result<(), String> {
    if age.is_some_and(|age| !age.is_finite() || !(0.0..=130.0).contains(&age)) {
        return Err("age 必須是 0 至 130 的有限數字（目前歲數）".into());
    }
    Ok(())
}

fn validate_view(view: &Option<String>) -> Result<(), String> {
    if view
        .as_deref()
        .is_some_and(|v| !matches!(v, "summary" | "full"))
    {
        return Err("view 僅接受 summary 或 full".into());
    }
    Ok(())
}

impl ListQuery {
    pub fn validate(&self) -> Result<(), String> {
        validate_age(self.age)?;
        validate_view(&self.view)?;
        if self
            .verification_status
            .as_deref()
            .is_some_and(|v| !matches!(v, "verified" | "partial" | "unverified"))
        {
            return Err("verification_status 無效".into());
        }
        if self
            .scope
            .as_deref()
            .is_some_and(|v| !matches!(v, "central" | "taipei" | "private_national" | "mixed"))
        {
            return Err("scope 無效".into());
        }
        Ok(())
    }
}

impl Profile {
    pub fn validate(&self) -> Result<(), String> {
        validate_age(self.age)?;
        validate_view(&self.view)?;
        if self
            .household_type
            .as_deref()
            .is_some_and(|v| !matches!(v, "low_income" | "mid_low_income" | "general"))
        {
            return Err(
                "household_type 僅接受 low_income、mid_low_income 或 general；未知請略過".into(),
            );
        }
        if [self.annual_income, self.monthly_income]
            .into_iter()
            .flatten()
            .any(|n| !n.is_finite() || n < 0.0)
        {
            return Err("收入必須為非負有限數字；收入不作資格核算".into());
        }
        if self
            .region
            .as_deref()
            .is_some_and(|region| region.trim().is_empty())
        {
            return Err("region 應為戶籍地縣市；未知請略過".into());
        }
        Ok(())
    }
}
