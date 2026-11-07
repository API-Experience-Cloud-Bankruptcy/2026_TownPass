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
    /// `application.deadline.end` when it is before the query date and the deadline is a
    /// single fixed window; such items are hidden unless `include_ineligible` is set.
    pub closed_on: Option<String>,
}

/// Identity groups a programme may be limited to; any member of a group satisfies it.
const IDENTITIES: [(&[&str], &[&str]); 5] = [
    (&["農保"], &["農保被保險人"]),
    (&["榮民", "退除役"], &["榮民／退除役官兵"]),
    (&["原住民"], &["原住民"]),
    (&["身心障礙"], &["身心障礙者"]),
    (&["低收入"], &["低收入戶", "中低收入戶"]),
];

/// Identity limits stated in the name, summary or structured employment/disability
/// conditions that the profile does not declare.
fn missing_identities(e: &Entry, p: &Profile) -> Vec<String> {
    let s = &e.subsidy;
    let el = &e.original["eligibility"];
    let mut text = format!(
        "{} {}",
        s.name,
        el["raw_summary"].as_str().unwrap_or_default()
    );
    for job in el["employment"].as_array().into_iter().flatten() {
        for key in ["statuses", "insurance_types"] {
            for v in job[key].as_array().into_iter().flatten() {
                text.push(' ');
                text.push_str(v.as_str().unwrap_or_default());
            }
        }
    }
    if !s.eligibility.disability.is_empty() {
        text.push_str(" 身心障礙");
    }
    let mut declared = p.applicant_types.clone();
    match p.household_type.as_deref() {
        Some("low_income") => declared.push("低收入戶".into()),
        Some("mid_low_income") => declared.push("中低收入戶".into()),
        _ => {}
    }
    IDENTITIES
        .iter()
        .filter(|(keys, _)| keys.iter().any(|k| text.contains(k)))
        .filter(|(_, labels)| !labels.iter().any(|l| declared.iter().any(|d| d == l)))
        .map(|(_, labels)| labels.join("或"))
        .collect()
}

/// Recorded deadline end if it has passed on `today` (both `YYYY-MM-DD`).
fn passed_end(e: &Entry, today: &str) -> Option<String> {
    let end = e.subsidy.application.deadline.get("end")?.as_str()?;
    crate::reviewed_rules::date_parts(end)?;
    crate::reviewed_rules::date_parts(today)?;
    (end < today).then(|| end.to_string())
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
    let missing = missing_identities(e, p);
    if !missing.is_empty() {
        warnings.push(format!(
            "可能限定身分，自述未提供：{}；請備妥身分證明向機關確認",
            missing.join("、")
        ));
    }
    // Only a single fixed window closes the whole programme; other types may keep
    // later periods or other applicant groups open. `partial` means some period,
    // channel or group has already closed even when the recorded `end` is ahead.
    let passed = passed_end(e, today);
    let kind = &e.subsidy.application.deadline["type"];
    let closed = passed.clone().filter(|_| kind == "fixed");
    if let Some(end) = &closed {
        warnings.push(format!("已截止：申請期限 {end}，請留意下一期公告"));
    } else if passed.is_some() || kind == "partial" {
        warnings.push("部分申請期間已截止，請確認仍開放的管道".into());
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
        closed_on: closed,
    }
}

pub fn run_match<'a>(entries: &'a [Entry], p: &Profile) -> Vec<(&'a Entry, MatchResult)> {
    run_match_at(entries, p, &crate::reviewed_rules::taipei_today())
}

pub fn run_match_at<'a>(
    entries: &'a [Entry],
    p: &Profile,
    today: &str,
) -> Vec<(&'a Entry, MatchResult)> {
    let mut out: Vec<(u32, &Entry, MatchResult, bool)> = entries
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
            let r = evaluate_at(e, p, today);
            if (r.fit == Fit::Ineligible || r.closed_on.is_some()) && !p.include_ineligible {
                return None;
            }
            let limited = !missing_identities(e, p).is_empty();
            Some((score, e, r, limited))
        })
        .collect();
    let rank = |f: Fit| match f {
        Fit::Likely => 0,
        Fit::Possible => 1,
        Fit::Ineligible => 2,
    };
    out.sort_by(|a, b| {
        (a.2.closed_on.is_some(), rank(a.2.fit), a.3)
            .cmp(&(b.2.closed_on.is_some(), rank(b.2.fit), b.3))
            .then(b.0.cmp(&a.0))
            .then_with(|| a.1.subsidy.id.cmp(&b.1.subsidy.id))
    });
    out.into_iter().map(|(_, e, r, _)| (e, r)).collect()
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
