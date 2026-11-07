/** First number and extension in a phone string such as 「1999（外縣市 02-2720-8889）轉 1609」. */
function phoneParts(phone: string) {
  const first = phone.match(/\d[\d-]*\d/)?.[0] ?? phone;
  const ext = phone.match(/轉\s*(\d+)/)?.[1];
  return { first, ext };
}

/** Digits to dial, with `,ext` for an extension, e.g. 「1999,1609」. */
export function dialNumber(phone: string): string {
  const { first, ext } = phoneParts(phone);
  return `${first.replace(/-/g, '')}${ext ? `,${ext}` : ''}`;
}

export function telHref(phone: string): string {
  return `tel:${dialNumber(phone)}`;
}

export function phoneLabel(phone: string): string {
  const { first, ext } = phoneParts(phone);
  return ext ? `${first} 轉 ${ext}` : first;
}
