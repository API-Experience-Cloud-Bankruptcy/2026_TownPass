//! Conservative search and explicit opt-in matching; no runtime AI.
//! Unparsed conditions never become evidence of complete eligibility.

use crate::models::Entry;
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

/// Only source-bound, individually reviewed necessary age conditions can exclude.
fn age_verdict(e: &Entry, age: f64) -> Option<bool> {
    let rule = e.reviewed?.requirements.iter().find(|r| r.field == "age")?;
    crate::reviewed_rules::verdict(
        rule,
        &Profile {
            age: Some(age),
            ..Default::default()
        },
        &crate::reviewed_rules::taipei_today(),
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
    #[allow(dead_code)] // Kept in the external contract; never emitted by partial evaluation.
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
    pub personal: Vec<PersonalNote>,
}

#[derive(Debug, Serialize)]
pub struct PersonalNote {
    pub list: String,
    pub text: String,
    pub field: String,
    pub neutral: Option<String>,
}

pub fn evaluate(e: &Entry, p: &Profile) -> MatchResult {
    evaluate_at(e, p, &crate::reviewed_rules::taipei_today())
}

pub fn evaluate_at(e: &Entry, p: &Profile, today: &str) -> MatchResult {
    let s = &e.subsidy;
    let (mut reasons, mut warnings, mut blocked, mut personal) = (vec![], vec![], vec![], vec![]);
    warnings.push(
        "僅初篩來源支持的必要條件；其他原文資格、例外、期間及證明仍待機關確認，非核准或送件證明"
            .into(),
    );
    if s.source_meta.verification_status != "verified" {
        warnings.push(format!(
            "資料原有查核狀態為 {}，本次未重新查核",
            s.source_meta.verification_status
        ));
    }
    if let Some(review) = e.reviewed {
        for rule in &review.requirements {
            let verdict = crate::reviewed_rules::verdict(rule, p, today);
            let (list, message) = match verdict {
                Some(true) => (
                    "reasons",
                    format!(
                        "自述條件與已審閱必要條件單項相符：{}；其他條件仍待確認",
                        rule.label
                    ),
                ),
                Some(false) => (
                    "blocked_by",
                    format!("依目前自述不符必要條件：{}", rule.label),
                ),
                None => {
                    warnings.push(format!(
                        "必要條件尚待確認（缺答、參考日期或出生年邊界不確定）：{}",
                        rule.label
                    ));
                    continue;
                }
            };
            personal.push(PersonalNote {
                list: list.into(),
                text: message.clone(),
                field: rule.field.clone(),
                neutral: None,
            });
            if list == "reasons" {
                reasons.push(message);
            } else {
                blocked.push(message);
            }
        }
        if review.age_review == "deferred" {
            warnings.push(format!("年齡未套本人排除：{}", review.review_note));
        }
    } else {
        warnings.push("資料已變更或沒有適用的來源綁定規則，原審閱規則已停用；請重新核對".into());
    }
    if (p.region.is_some() || !s.eligibility.residence.is_empty())
        && !e
            .reviewed
            .is_some_and(|row| row.requirements.iter().any(|r| r.field == "region"))
    {
        warnings.push(
            "scope 僅為資料範圍；未編碼的戶籍、實居、就學／就業及設籍期間仍待確認，不據 scope 排除"
                .into(),
        );
    }
    for income in &s.eligibility.income {
        warnings.push(format!(
            "所得條件未評估（主體：{}；年度、期間及家戶口徑待核對）：{}",
            income.subject.as_deref().unwrap_or("未知"),
            income.raw.as_deref().unwrap_or("請見原文")
        ));
    }
    if p.annual_income.is_some() || p.monthly_income.is_some() {
        warnings.push("個人收入未用於核算資格，不推定等於家戶所得".into());
    }
    for (present, label) in [
        (!s.eligibility.age.is_empty(), "年齡原文與基準日"),
        (
            !s.eligibility.student.is_empty(),
            "未編碼的在學／未就學主體、學制、成績與例外",
        ),
        (
            !s.eligibility.household.is_empty(),
            "未編碼的家庭成員、身分證明與替代途徑",
        ),
        (!s.eligibility.employment.is_empty(), "就業／保險"),
        (!s.eligibility.disability.is_empty(), "身心障礙"),
        (!s.eligibility.property.is_empty(), "財產"),
        (!s.eligibility.nationality.is_empty(), "國籍／居留"),
        (!s.eligibility.exclusions.is_empty(), "排除／重複補助"),
        (!s.extensions.is_empty(), "擴充原文"),
    ] {
        if present {
            warnings.push(format!("{label}仍須核對完整原文，不代表已完整評估"));
        }
    }
    MatchResult {
        fit: if blocked.is_empty() {
            Fit::Possible
        } else {
            Fit::Ineligible
        },
        reasons,
        warnings,
        blocked_by: blocked,
        personal,
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
