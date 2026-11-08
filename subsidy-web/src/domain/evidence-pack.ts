// A bounded per-resource packet for a future local model; never a model eligibility decision.
import { adaptiveReviewFor } from './adaptive';
import { reviewFor } from './reviewed-rules';
import type { Subsidy } from './types';
export function buildEvidencePack(item: Subsidy, maxEvidenceChars = 10000) {
  const review=adaptiveReviewFor(item);
  const manual=review?.manual_conditions??[];
  let used=0;
  const evidence=manual.filter(entry=> {
    const size=entry.value.length+entry.reason.length+entry.path.length;
    if(used+size>Math.max(0,maxEvidenceChars)) return false;
    used+=size;return true;
  });
  return {
    id:item.id,name:item.name,
    source_fingerprint:review?.source_fingerprint??null,
    current_policy_verified:false,
    summary:item.eligibility.raw_summary,
    qualification:reviewFor(item)?.requirements??[],
    discovery:review?.facets??[],
    alternatives:review?.alternatives_note??'尚無適用的逐筆審閱，請核對完整來源。',
    evidence, omitted_manual_count:manual.length-evidence.length,
    sources:item.source_meta.sources,
    attachment_urls:review?.attachment_urls??[],
    missing_fields:review?.missing_fields??item.source_meta.missing_fields??[],
    deadline:item.application.deadline,
    source_status:item.source_meta.application_status??null,
    document_overrides:review?.document_overrides??[],
    limitation:'原始資料的來源狀態不代表本輪重新查核；未編碼、被省略及例外條件仍需承辦單位確認。',
  };
}
