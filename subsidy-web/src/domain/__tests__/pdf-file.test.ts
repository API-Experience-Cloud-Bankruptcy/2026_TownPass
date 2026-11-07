import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sharePdfFile } from '../pdf-file';
import { isInTownPass, sharePdf } from '../../townpass';
vi.mock('../../townpass', () => ({ isInTownPass: vi.fn(() => false), sharePdf: vi.fn() }));
const pdf = new File(['%PDF-1.7\n%%EOF'], '檢核表.pdf', { type: 'application/pdf' });
beforeEach(() => { vi.mocked(isInTownPass).mockReturnValue(false); vi.mocked(sharePdf).mockReset(); });
describe('PDF 檔案交付', () => {
  it('傳送實際檔案給系統，不以文字取代', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await sharePdfFile(pdf, { canShare: () => true, share })).toBe('presented');
    expect(share).toHaveBeenCalledWith({ files: [pdf], title: '福利資源申辦準備檢核表' });
  });
  it('無法分享檔案時不假裝成功', async () => {
    const share = vi.fn();
    expect(await sharePdfFile(pdf, { canShare: () => false, share })).toBe('unsupported');
    expect(await sharePdfFile(pdf, {})).toBe('unsupported');
    expect(share).not.toHaveBeenCalled();
  });
  it('取消與真正錯誤分開', async () => {
    expect(await sharePdfFile(pdf, { canShare: () => true, share: vi.fn().mockRejectedValue({ name: 'AbortError' }) })).toBe('cancelled');
    expect(await sharePdfFile(pdf, { canShare: () => true, share: vi.fn().mockRejectedValue(new Error('failed')) })).toBe('failed');
  });
  it('App 只走原生 PDF 橋接，且如實保留不確定與逾時', async () => {
    vi.mocked(isInTownPass).mockReturnValue(true);
    vi.mocked(sharePdf).mockResolvedValue({ status: 'presented' });
    expect(await sharePdfFile(pdf)).toBe('presented');
    const [bytes, name] = vi.mocked(sharePdf).mock.calls[0]!;
    expect(new TextDecoder().decode(bytes)).toContain('%PDF-');
    expect(name).toBe('檢核表.pdf');
    vi.mocked(sharePdf).mockResolvedValue({ status: 'cancelled_or_unavailable' });
    expect(await sharePdfFile(pdf)).toBe('cancelled');
    vi.mocked(sharePdf).mockRejectedValue(new Error('timeout'));
    expect(await sharePdfFile(pdf)).toBe('failed');
  });
});
