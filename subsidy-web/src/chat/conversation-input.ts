/** Only the current correction may authorize changing the person; quoted history cannot. */
export function latestCorrectionInput(input: string): string {
  const marker = '這次補充或修正：';
  const index = input.lastIndexOf(marker);
  return (index < 0 ? input : input.slice(index + marker.length)).trim();
}

export function explicitlyChangesPerson(input: string): boolean {
  const current = latestCorrectionInput(input).normalize('NFKC');
  if (/[?？]|(?:嗎|能不能|可不可以|是否|要不要)/u.test(current)) return false;
  return /^(?:(?:我(?:現在)?(?:想|要)?)|這次|現在)?\s*(?:改幫|換幫|改替|換替|換查|改查|換個人|換一個人)/u.test(current);
}
