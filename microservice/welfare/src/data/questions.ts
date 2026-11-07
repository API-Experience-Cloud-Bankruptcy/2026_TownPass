import type { Question } from '../lib/questions-types';

/*
 * Short questionnaire. Order follows the New Taipei flow (birth date, months
 * registered, welfare identities, living situation, disability certificate),
 * then category-specific questions. Questions without `categories` are always asked.
 *
 * Answer values line up with the thresholds used in welfare-items.ts:
 * - residentMonths: 0 = not registered, 3 and 12 are the item thresholds.
 * - childrenUnder: each option stores the youngest age of its band, so an item's
 *   childAgeMax (1, 4, 14, 17) matches exactly the bands it covers.
 */
export const QUESTIONS: Question[] = [
  { id: 'birth', kind: 'birthYear', title: '你是哪一年出生的？' },
  {
    id: 'resident',
    kind: 'single',
    title: '你的戶籍在臺北市多久了？',
    field: 'residentMonths',
    options: [
      { label: '戶籍不在臺北市', patch: { residentMonths: 0 } },
      { label: '不到 3 個月', patch: { residentMonths: 1 } },
      { label: '3 個月到 1 年', patch: { residentMonths: 3 } },
      { label: '1 年以上', patch: { residentMonths: 12 } },
    ],
  },
  {
    id: 'identity',
    kind: 'identities',
    title: '你有下面哪些身分？可以選很多個',
    options: [
      { label: '低收入戶', identity: 'low_income' },
      { label: '中低收入戶', identity: 'mid_low_income' },
      { label: '單親或特殊境遇家庭', identity: 'single_parent' },
      { label: '原住民', identity: 'indigenous' },
      { label: '新住民', identity: 'new_resident' },
      { label: '榮民', identity: 'veteran' },
    ],
  },
  { id: 'disability', kind: 'identityYesNo', title: '你有身心障礙證明嗎？', identity: 'disability' },
  {
    id: 'living',
    kind: 'single',
    title: '你現在一個人住嗎？',
    field: 'livesAlone',
    categories: ['hardship', 'senior', 'care'],
    options: [
      { label: '一個人住', patch: { livesAlone: true } },
      { label: '和家人或別人一起住', patch: { livesAlone: false } },
    ],
  },
  {
    id: 'caregiver',
    kind: 'identityYesNo',
    title: '你在家照顧生病、失能或身障的家人嗎？',
    identity: 'caregiver',
    categories: ['senior', 'care'],
  },
  {
    id: 'children',
    kind: 'children',
    title: '家裡有幾歲的孩子？可以選很多個',
    categories: ['hardship', 'parenting', 'education'],
    options: [
      { label: '未滿 2 歲', age: 0 },
      { label: '2 到 4 歲', age: 2 },
      { label: '5 到 11 歲', age: 5 },
      { label: '12 到 14 歲', age: 12 },
      { label: '15 到 17 歲', age: 15 },
    ],
  },
  {
    id: 'work',
    kind: 'single',
    title: '你現在有工作嗎？',
    field: 'employed',
    categories: ['hardship', 'work'],
    options: [
      { label: '有工作', patch: { employed: true } },
      { label: '沒有工作，或正在找工作', patch: { employed: false } },
    ],
  },
  {
    id: 'student',
    kind: 'single',
    title: '你（或要申請的孩子）在讀書嗎？',
    field: 'student',
    categories: ['education'],
    options: [
      { label: '國小', patch: { student: 'elementary' } },
      { label: '國中', patch: { student: 'junior' } },
      { label: '高中職', patch: { student: 'senior' } },
      { label: '大學或專科', patch: { student: 'college' } },
      { label: '沒有在讀書', patch: { student: null } },
    ],
  },
  {
    id: 'renter',
    kind: 'single',
    title: '你住的房子是租的嗎？',
    field: 'renter',
    categories: ['hardship', 'housing'],
    options: [
      { label: '是，租房子住', patch: { renter: true } },
      { label: '不是，住自己或家人的房子', patch: { renter: false } },
    ],
  },
];
