import { isInTownPass, sharePdf } from '../townpass';

export type PdfShareOutcome = 'presented' | 'cancelled' | 'unsupported' | 'failed';

/** 由使用者點擊後呼叫；交付實際 PDF 檔，不以文字分享冒充檔案分享。 */
export async function sharePdfFile(file: File, nav: Partial<Navigator> = globalThis.navigator ?? {}): Promise<PdfShareOutcome> {
  try {
    if (isInTownPass()) {
      const result = await sharePdf(new Uint8Array(await file.arrayBuffer()), file.name);
      return result.status === 'presented' ? 'presented' : result.status === 'cancelled_or_unavailable' ? 'cancelled' : 'failed';
    }
    if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function' || !nav.canShare({ files: [file] })) return 'unsupported';
    await nav.share({ files: [file], title: '福利行動檢核表' });
    return 'presented';
  } catch (error) {
    return (error as Error)?.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}
