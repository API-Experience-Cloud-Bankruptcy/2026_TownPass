import { describe, expect, it } from 'vitest';
import { formResources, documentResource } from '../form-resources';
import { realItem, realItems } from './real-data';
import { formAvailability } from '../form-fields';

const entry = (label: string, source_url: string, status = 'scanned_image_pdf') => ({ label, source_url, status });
function fixture(entries: object[]) {
  const item = realItem('WEL-0005');
  item.application.form_fields = { ...entries[0], attachments: entries.slice(1) };
  item.application.urls.form = null;
  return item;
}
describe('表單附件與文件導覽', () => {
  it('不能填寫的附件仍可取得，重複網址去重，不接受不安全連結', () => {
    const item = fixture([
      entry('申請表', 'https://example.com/form.pdf'),
      entry('切結書', 'https://example.com/pledge.pdf'),
      entry('重複', 'https://example.com/pledge.pdf'),
      entry('不安全', 'javascript:alert(1)'),
      { status: 'office_file_only', office_files: ['https://example.com/a.docx', 'https://example.com/b.odt'] },
    ]);
    const resources = formResources(item);
    expect(resources).toHaveLength(4);
    expect(resources.every(r => !r.formId)).toBe(true);
    expect(documentResource('切結書', resources)?.url).toBe('https://example.com/pledge.pdf');
  });
  it('唯一明確名稱才配對，不把個人證件、合併清單或多份申請表猜成同一份', () => {
    const resources = formResources(fixture([
      entry('補助申請表.pdf', 'https://example.com/a.pdf'),
      entry('另一份申請表.pdf', 'https://example.com/b.pdf'),
      entry('切結書.pdf', 'https://example.com/c.pdf'),
    ]));
    expect(documentResource('申請表', resources)).toBeNull();
    expect(documentResource('補助申請表', resources)?.id).toBe('file-0');
    expect(documentResource('切結書', resources)?.id).toBe('file-2');
    expect(documentResource('身分證影本', resources)).toBeNull();
    expect(documentResource('切結書及申請表', resources)).toBeNull();
  });
  it('下載失敗和線上入口不冒充直接下載檔案', () => {
    const resources = formResources(fixture([
      entry('申請表', 'https://example.com/broken', 'download_failed'),
      entry('線上申請', 'https://example.com/apply', 'online_system'),
    ]));
    expect(resources.map(r => r.kind)).toEqual(['source', 'online']);
    expect(documentResource('申請表', resources)).toBeNull();
  });
  it('全部真實資料的可填寫表單都保留可操作入口與原 PDF URL', () => {
    for (const item of realItems) {
      const resources = formResources(item);
      const availability = formAvailability(item);
      if (availability.kind === 'fillable') {
        for (const form of availability.forms) {
          const resource = resources.find(r => r.formId === form.id);
          expect(resource, `${item.id}: ${form.id}`).toBeDefined();
          expect(resource?.url).toMatch(/\/api\/forms\/[0-9a-f]{12}\.pdf$/);
        }
      }
      expect(new Set(resources.map(r => r.url)).size).toBe(resources.length);
    }
  });
});
