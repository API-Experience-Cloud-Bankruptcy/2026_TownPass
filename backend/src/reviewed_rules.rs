// SPDX-License-Identifier: AGPL-3.0-only
//! Shared source-bound necessary conditions, explicitly reviewed per resource.
use crate::matcher::Profile;
use serde::Deserialize;
use serde_json::Value;
use std::sync::LazyLock;

#[derive(Debug, Deserialize)]
pub struct Evidence {
    pub path: String,
    pub value: String,
}
#[derive(Debug, Deserialize)]
pub struct Requirement {
    pub field: String,
    pub label: String,
    pub evidence: Vec<Evidence>,
    pub basis: Option<String>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub min_inclusive: Option<bool>,
    pub max_inclusive: Option<bool>,
    pub birth_year_min: Option<i32>,
    pub birth_year_max: Option<i32>,
    pub reference_year: Option<i32>,
    pub reference_date: Option<String>,
    pub required_boolean: Option<bool>,
    pub values: Option<Vec<String>>,
}
#[derive(Debug, Deserialize)]
pub struct ReviewedRecord {
    pub id: String,
    pub source_fingerprint: String,
    pub age_review: String,
    pub review_note: String,
    pub source_urls: Vec<String>,
    pub requirements: Vec<Requirement>,
}
#[derive(Deserialize)]
struct Manifest {
    version: String,
    records: Vec<ReviewedRecord>,
}
const RAW: &str = include_str!("../rules/eligibility-reviewed.json");
static MANIFEST: LazyLock<Manifest> =
    LazyLock::new(|| serde_json::from_str(RAW).expect("reviewed rules JSON"));
pub fn records() -> &'static [ReviewedRecord] {
    &MANIFEST.records
}
pub fn version() -> String {
    let value: Value = serde_json::from_str(RAW).expect("reviewed rules JSON");
    format!("{}-{}", MANIFEST.version, source_fingerprint(&value))
}
fn canonical(value: &Value) -> String {
    match value {
        Value::Array(items) => format!(
            "[{}]",
            items.iter().map(canonical).collect::<Vec<_>>().join(",")
        ),
        Value::Object(map) => {
            let mut keys: Vec<_> = map.keys().collect();
            keys.sort();
            format!(
                "{{{}}}",
                keys.iter()
                    .map(|key| format!(
                        "{}:{}",
                        serde_json::to_string(key).unwrap(),
                        canonical(&map[*key])
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
        Value::Number(n) => n
            .as_f64()
            .map(|f| f.to_string())
            .unwrap_or_else(|| n.to_string()),
        _ => serde_json::to_string(value).expect("JSON primitive"),
    }
}
pub fn source_fingerprint(value: &Value) -> String {
    let hash = canonical(value)
        .bytes()
        .fold(0xcbf29ce484222325_u64, |h, b| {
            (h ^ u64::from(b)).wrapping_mul(0x100000001b3)
        });
    format!("{hash:016x}")
}
pub fn review_for(value: &Value) -> Option<&'static ReviewedRecord> {
    let row = records()
        .iter()
        .find(|r| Some(r.id.as_str()) == value["id"].as_str())?;
    if row.source_fingerprint != source_fingerprint(value) {
        return None;
    }
    if !row.requirements.is_empty()
        && (row.source_urls.is_empty()
            || row.source_urls.iter().any(|url| {
                !value["source_meta"]["sources"]
                    .as_array()
                    .is_some_and(|sources| {
                        sources.iter().any(|s| {
                            s["type"] == "official" && s["url"].as_str() == Some(url.as_str())
                        })
                    })
            }))
    {
        return None;
    }

    if row.requirements.iter().any(|r| {
        r.evidence
            .iter()
            .any(|e| value.pointer(&e.path).and_then(Value::as_str) != Some(e.value.as_str()))
    }) {
        return None;
    }
    Some(row)
}
fn within(n: f64, r: &Requirement) -> bool {
    r.min.is_none_or(|v| {
        if r.min_inclusive == Some(false) {
            n > v
        } else {
            n >= v
        }
    }) && r.max.is_none_or(|v| {
        if r.max_inclusive == Some(false) {
            n < v
        } else {
            n <= v
        }
    })
}
fn consensus(values: &[bool]) -> Option<bool> {
    if values.iter().all(|v| *v) {
        Some(true)
    } else if values.iter().all(|v| !v) {
        Some(false)
    } else {
        None
    }
}
pub fn date_parts(s: &str) -> Option<(i32, u32, u32)> {
    if s.len() != 10
        || s.as_bytes()[4] != b'-'
        || s.as_bytes()[7] != b'-'
        || !s
            .bytes()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
    {
        return None;
    }
    let (y, m, d) = (
        s[0..4].parse().ok()?,
        s[5..7].parse().ok()?,
        s[8..10].parse().ok()?,
    );
    if !(1900..=2200).contains(&y) || !(1..=12).contains(&m) {
        return None;
    }
    let days = if m == 2 {
        if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) {
            29
        } else {
            28
        }
    } else if [4, 6, 9, 11].contains(&m) {
        30
    } else {
        31
    };
    if d < 1 || d > days {
        None
    } else {
        Some((y, m, d))
    }
}
pub fn taipei_today() -> String {
    // Gregorian civil date from days since Unix epoch; UTC+08:00 has no DST.
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let z = ((seconds + 8 * 3600) / 86400) as i64 + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let y = y + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}")
}
pub fn verdict(r: &Requirement, p: &Profile, today: &str) -> Option<bool> {
    match r.field.as_str() {
        "is_student" => return p.is_student.map(|v| Some(v) == r.required_boolean),
        "household_type" => {
            return p
                .household_type
                .as_ref()
                .map(|v| r.values.as_ref().is_some_and(|xs| xs.contains(v)))
        }
        "region" => {
            let region = p.region.as_deref()?.trim().replace('台', "臺");
            let counties = [
                "臺北市",
                "新北市",
                "桃園市",
                "臺中市",
                "臺南市",
                "高雄市",
                "基隆市",
                "新竹市",
                "嘉義市",
                "新竹縣",
                "苗栗縣",
                "彰化縣",
                "南投縣",
                "雲林縣",
                "嘉義縣",
                "屏東縣",
                "宜蘭縣",
                "花蓮縣",
                "臺東縣",
                "澎湖縣",
                "金門縣",
                "連江縣",
            ];
            if region == "其他縣市" {
                return if r
                    .values
                    .as_ref()
                    .is_some_and(|v| v.len() == 1 && v[0] == "臺北市")
                {
                    Some(false)
                } else {
                    None
                };
            }
            if !counties.contains(&region.as_str()) {
                return None;
            }
            return Some(r.values.as_ref().is_some_and(|xs| xs.contains(&region)));
        }
        "age" => {}
        field => {
            if !crate::questions::qualification_field(field) {
                return None;
            }
            let value = p.extra.get(field)?;
            if !crate::questions::valid_extra_value(field, value) {
                return None;
            }
            return if let Some(required) = r.required_boolean {
                value.as_bool().map(|actual| actual == required)
            } else {
                let allowed = r.values.as_ref().filter(|values| {
                    !values.is_empty()
                        && values.iter().all(|v| {
                            crate::questions::valid_extra_value(field, &Value::String(v.clone()))
                        })
                })?;
                value
                    .as_str()
                    .map(|actual| allowed.iter().any(|expected| expected == actual))
            };
        }
    }
    let age = p.age?;
    if !age.is_finite() || !(0.0..=130.0).contains(&age) {
        return None;
    }
    if r.basis.as_deref() == Some("current_age") {
        return Some(within(age, r));
    }
    if r.basis.as_deref() == Some("future_event") {
        return if r.max.is_some_and(|v| {
            if r.max_inclusive == Some(false) {
                age >= v
            } else {
                age > v
            }
        }) {
            Some(false)
        } else {
            None
        };
    }
    let (year, month, day) = date_parts(today)?;
    if age.fract() != 0.0 {
        return None;
    }
    let birth_years = if month == 12 && day == 31 {
        vec![year - age as i32]
    } else {
        vec![year - age as i32 - 1, year - age as i32]
    };
    match r.basis.as_deref()? {
        "birth_year" if r.reference_year.is_some_and(|y| (1900..=2200).contains(&y)) => consensus(
            &birth_years
                .iter()
                .map(|y| {
                    r.birth_year_min.is_none_or(|v| *y >= v)
                        && r.birth_year_max.is_none_or(|v| *y <= v)
                })
                .collect::<Vec<_>>(),
        ),
        "calendar_age" => consensus(
            &birth_years
                .iter()
                .map(|y| within((year - y) as f64, r))
                .collect::<Vec<_>>(),
        ),
        "reference_date" => {
            let (y, m, d) = date_parts(r.reference_date.as_deref()?)?;
            let youngest = y - birth_years.iter().max()? - if m == 12 && d == 31 { 0 } else { 1 };
            let oldest = y - birth_years.iter().min()?;
            consensus(
                &(youngest..=oldest)
                    .map(|a| within(a as f64, r))
                    .collect::<Vec<_>>(),
            )
        }
        _ => None,
    }
}
