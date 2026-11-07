import type { Answers } from './app-state';

/** 示範情境：獨居的陳阿嬤（78 歲、設籍臺北市 20 年、中低收入戶）. */
export function demoAnswers(now: Date = new Date()): Answers {
  return {
    profile: {
      birthYear: now.getFullYear() - 78,
      residentMonths: 20 * 12,
      identities: ['mid_low_income'],
      livesAlone: true,
    },
    unknownIdentities: [],
  };
}

export function isDemo(param: string | string[] | undefined): boolean {
  return (Array.isArray(param) ? param[0] : param) === '1';
}
