window.__ModuleLoader__.load({
  id: 'dsh-wardrobe',
  factory(require) {
    const { createElement: h, useState, useEffect, useCallback } = require('react');
    const API = '/dsh-wardrobe/api';
    const IMAGE = '/dsh-wardrobe/image';

    async function request(url, options) {
      let response;
      try { response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options }); }
      catch { throw Object.assign(new Error('连不上 DSH'), { code: 'NETWORK', hint: '确认 DSH 还在运行，然后刷新页面。' }); }
      let data;
      try { data = await response.json(); }
      catch { throw Object.assign(new Error('DSH 返回了无效响应'), { code: `HTTP_${response.status}`, hint: '重新登录并刷新；若仍失败，看服务端日志。' }); }
      if (!response.ok || !data?.ok) throw Object.assign(new Error(data?.error || '请求失败'), { code: data?.code, hint: data?.hint });
      return data;
    }

    const emptyDraft = { id: '', title: '', type: '', body: '', tags: '', description: '', prompt: '', image: '' };

    function Field({ label, hint, children }) {
      return h('label', { className: 'dw-field' },
        h('span', { className: 'dw-label' }, label, hint ? h('em', null, hint) : null),
        children);
    }

    function Form({ draft, onChange, onSave, onCancel, busy, error }) {
      const [uploading, setUploading] = useState(false);
      const [uploadError, setUploadError] = useState(null);
      const pickImage = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setUploading(true); setUploadError(null);
        try {
          const bytes = await file.arrayBuffer();
          const data = await request(IMAGE, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
          onChange({ ...draft, image: data.image });
        } catch (e) { setUploadError(e); }
        finally { setUploading(false); event.target.value = ''; }
      };
      return h('div', { className: 'dw-form' },
        h(Field, { label: '标题' },
          h('input', { value: draft.title, maxLength: 120, disabled: busy, placeholder: '比如：米白色针织开衫',
            onChange: (e) => onChange({ ...draft, title: e.target.value }) })),
        h('div', { className: 'dw-grid2' },
          h(Field, { label: '种类', hint: '连衣裙 / 外套 / 上衣；她能按这里的词模糊搜' },
            h('input', { value: draft.type, maxLength: 60, disabled: busy, placeholder: '针织连衣裙',
              onChange: (e) => onChange({ ...draft, type: e.target.value }) })),
          h(Field, { label: '部位', hint: '多个用逗号分隔' },
            h('input', { value: draft.body, maxLength: 60, disabled: busy, placeholder: '颈、腰、腿',
              onChange: (e) => onChange({ ...draft, body: e.target.value }) }))),
        h(Field, { label: '标签', hint: '关键词，逗号分隔；她能按这些词搜到' },
          h('textarea', { rows: 2, value: draft.tags, maxLength: 600, disabled: busy, placeholder: '冰蓝色，吊带裙，蕾丝拼接，甜美风',
            onChange: (e) => onChange({ ...draft, tags: e.target.value }) })),
        h(Field, { label: '给 AI 的描述', hint: '她怎么理解这件衣服：材质、场合、给人的感觉' },
          h('textarea', { rows: 4, value: draft.description, disabled: busy, placeholder: '厚实的米白针织，落肩，袖口卷一圈。适合天冷时窝在家里，也适合套在衬衫外面出门。',
            onChange: (e) => onChange({ ...draft, description: e.target.value }) })),
        h(Field, { label: '绘图提示词', hint: '给 Qwen 用的，写画面而不是写感觉' },
          h('textarea', { rows: 4, value: draft.prompt, disabled: busy, placeholder: 'a girl wearing a cream knit cardigan, dropped shoulders, rolled cuffs, soft window light, upper body, anime style',
            onChange: (e) => onChange({ ...draft, prompt: e.target.value }) })),
        h(Field, { label: '图片' },
          h('div', { className: 'dw-image-row' },
            draft.image
              ? h('img', { className: 'dw-thumb-lg', src: `${IMAGE}?name=${encodeURIComponent(draft.image)}`, alt: draft.title || '衣服图片' })
              : h('div', { className: 'dw-thumb-lg dw-thumb-empty' }, '还没有图'),
            h('div', { className: 'dw-image-actions' },
              h('label', { className: 'dw-btn' },
                uploading ? '上传中…' : (draft.image ? '换一张' : '选择图片'),
                h('input', { type: 'file', className: 'dw-file', accept: 'image/png,image/jpeg,image/webp,image/gif', disabled: busy || uploading, onChange: pickImage })),
              draft.image ? h('button', { type: 'button', className: 'dw-btn', disabled: busy, onClick: () => onChange({ ...draft, image: '' }) }, '移除图片') : null))),
        uploadError ? h('div', { className: 'dw-error', role: 'alert' },
          h('strong', null, uploadError.message), h('code', null, uploadError.code), h('p', null, uploadError.hint)) : null,
        error ? h('div', { className: 'dw-error', role: 'alert' },
          h('strong', null, '没有保存'), h('p', null, error.message), h('code', null, error.code), h('p', null, error.hint)) : null,
        h('div', { className: 'dw-row dw-form-actions' },
          h('button', { className: 'dw-btn dw-primary', disabled: busy || uploading || !draft.title.trim(), onClick: onSave }, busy ? '保存中…' : (draft.id ? '保存修改' : '收进衣柜')),
          h('button', { className: 'dw-btn', disabled: busy, onClick: onCancel }, '取消')));
    }

    function Card({ item, onEdit, onDelete, onWear, isWorn, wornParts, busy }) {
      return h('li', { className: 'dw-card' + (isWorn ? ' dw-worn' : '') },
        item.image
          ? h('img', { className: 'dw-thumb', src: `${IMAGE}?name=${encodeURIComponent(item.image)}`, alt: item.title })
          : h('div', { className: 'dw-thumb dw-thumb-empty' }, '无图'),
        h('div', { className: 'dw-card-body' },
          h('h4', { className: 'dw-card-title' }, item.title),
          (item.type || item.body) ? h('div', { className: 'dw-tags' },
            item.type ? h('span', { className: 'dw-tag' }, item.type) : null,
            ...String(item.body || '').split(/[,，、/|]+/).map((x) => x.trim()).filter(Boolean).map((part) => h('span', { key: part, className: 'dw-tag dw-tag-dim' }, part))) : null,
          item.tags ? h('div', { className: 'dw-tags dw-taglist' },
            String(item.tags).split(/[,，、]/).map((x) => x.trim()).filter(Boolean).slice(0, 8)
              .map((tag) => h('span', { key: tag, className: 'dw-tag dw-tag-soft' }, tag)),
            String(item.tags).split(/[,，、]/).map((x) => x.trim()).filter(Boolean).length > 8
              ? h('span', { className: 'dw-tag dw-tag-soft' }, `+${String(item.tags).split(/[,，、]/).map((x) => x.trim()).filter(Boolean).length - 8}`) : null) : null,
          item.description ? h('p', { className: 'dw-text' }, item.description) : h('p', { className: 'dw-muted' }, '还没有给 AI 的描述'),
          item.prompt ? h('details', null, h('summary', null, '绘图提示词'), h('p', { className: 'dw-text dw-mono' }, item.prompt)) : h('p', { className: 'dw-muted' }, '还没有绘图提示词'),
          h('div', { className: 'dw-row' },
            h('button', { className: 'dw-btn', disabled: busy, onClick: () => onWear(item) }, isWorn ? '脱下' : '穿上'),
            h('button', { className: 'dw-btn', disabled: busy, onClick: () => onEdit(item) }, '编辑'),
            h('button', { className: 'dw-btn', disabled: busy, onClick: () => onDelete(item) }, '删掉'))));
    }

    function Wardrobe() {
      const [items, setItems] = useState(null);
      const [worn, setWorn] = useState([]);
      const [draft, setDraft] = useState(null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      const [notice, setNotice] = useState(null);
      const load = useCallback(async () => {
        setBusy(true);
        try { const data = await request(API); setItems(data.items); setWorn(data.worn ?? []); setError(null); }
        catch (e) { setError(e); }
        finally { setBusy(false); }
      }, []);
      useEffect(() => { void load(); }, [load]);

      const save = async () => {
        setBusy(true); setError(null); setNotice(null);
        try {
          const action = draft.id ? 'update' : 'create';
          const data = await request(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, action }) });
          setItems((list) => {
            const rest = (list ?? []).filter((x) => x.id !== data.item.id);
            return [...rest, data.item].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
          });
          setDraft(null); setNotice(`${action === 'create' ? '收进来了' : '改好了'}：${data.item.title}`);
        } catch (e) { setError(e); }
        finally { setBusy(false); }
      };
      const wear = async (item) => {
        setBusy(true); setError(null); setNotice(null);
        const already = worn.some((w) => w.id === item.id);
        try {
          const data = await request(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: already ? 'unwear' : 'wear', id: item.id }) });
          setWorn(data.worn ?? []);
          setNotice(already ? `脱下了：${item.title}` : `穿上了：${item.title}（${(data.parts ?? []).join('、')}）`);
        } catch (e) { setError(e); }
        finally { setBusy(false); }
      };
      const remove = async (item) => {
        if (!window.confirm(`删掉「${item.title}」？`)) return;
        setBusy(true); setError(null);
        try {
          await request(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id: item.id }) });
          setItems((list) => (list ?? []).filter((x) => x.id !== item.id));
          setWorn((list) => (list ?? []).filter((w) => w.id !== item.id));
          setNotice(`删掉了：${item.title}`);
        } catch (e) { setError(e); }
        finally { setBusy(false); }
      };

      return h('div', { className: 'dw-root' },
        h('style', null, css),
        h('div', { className: 'dw-head' },
          h('h2', { className: 'dw-title' }, '衣柜', items ? h('span', { className: 'dw-count' }, `${items.length} 件`) : null),
          h('div', { className: 'dw-row' },
            worn.length ? h('div', { className: 'dw-wornline' }, '穿着：',
              worn.map((w) => h('span', { key: w.id, className: 'dw-wornchip', title: w.parts.join('、') },
                h('em', null, w.parts.join('/')), ' ', h('strong', null, w.title)))) : null,
            h('button', { className: 'dw-btn', disabled: busy, onClick: () => void load() }, busy ? '读取中…' : '刷新'),
            h('button', { className: 'dw-btn dw-primary', disabled: busy || !!draft, onClick: () => { setDraft({ ...emptyDraft }); setNotice(null); setError(null); } }, '添一件'))),
        notice ? h('p', { className: 'dw-notice', role: 'status' }, notice) : null,
        error && !draft ? h('div', { className: 'dw-error', role: 'alert' },
          h('strong', null, '读取失败'), h('p', null, error.message), h('code', null, error.code), h('p', null, error.hint)) : null,
        draft ? h(Form, { draft, onChange: setDraft, onSave: save, onCancel: () => { setDraft(null); setError(null); }, busy, error }) : null,
        items === null ? h('p', { className: 'dw-muted' }, '读取中…')
          : items.length === 0 && !draft ? h('p', { className: 'dw-empty' }, '还是空的。点「添一件」开始。')
            : h('ul', { className: 'dw-list' }, items.map((item) => h(Card, { key: item.id, item, busy, isWorn: worn.some((w) => w.id === item.id), wornParts: worn.find((w) => w.id === item.id)?.parts ?? [], onWear: wear, onEdit: (x) => { setDraft({ ...x }); setError(null); setNotice(null); }, onDelete: remove }))));
    }

    const css = `
.dw-root{padding:4px 2px 32px;font-size:14px;line-height:1.55;color:inherit}
.dw-head{display:flex;align-items:center;justify-content:space-between;gap:16px}
.dw-title{margin:0;font-size:17px;font-weight:600;letter-spacing:.01em}
.dw-count{margin-left:8px;font-size:11px;font-weight:500;opacity:.45;font-variant-numeric:tabular-nums}
.dw-row{display:flex;align-items:center;gap:8px}
.dw-btn{font:inherit;font-size:12.5px;line-height:1.2;padding:6px 13px;border-radius:8px;cursor:pointer;color:inherit;
  background:rgba(128,128,128,.09);border:1px solid rgba(128,128,128,.18);transition:background .15s}
.dw-btn:hover:not(:disabled){background:rgba(128,128,128,.16)}
.dw-btn:disabled{opacity:.55;cursor:default}
.dw-primary{background:rgba(128,128,128,.18);border-color:rgba(128,128,128,.28)}
.dw-notice{margin:12px 0 0;font-size:12.5px;opacity:.6}
.dw-error{margin-top:14px;padding:12px 14px;border-radius:12px;background:rgba(220,60,60,.08);border:1px solid rgba(220,60,60,.22);color:#b3261e}
.dw-error p{margin:6px 0 0;font-size:12.5px}
.dw-error code{font-size:11px;opacity:.6}
@media (prefers-color-scheme:dark){.dw-error{color:#f2a4a0}}
.dw-form{margin-top:18px;padding:16px;border-radius:14px;background:rgba(128,128,128,.05);border:1px solid rgba(128,128,128,.1);display:flex;flex-direction:column;gap:14px}
.dw-field{display:flex;flex-direction:column;gap:6px}
.dw-label{font-size:12px;letter-spacing:.04em;opacity:.62}
.dw-label em{font-style:normal;margin-left:8px;opacity:.6}
.dw-field input[type=text],.dw-field input:not([type]),.dw-field textarea{font:inherit;font-size:13.5px;padding:9px 11px;border-radius:9px;
  color:inherit;background:rgba(128,128,128,.07);border:1px solid rgba(128,128,128,.16);resize:vertical}
.dw-field input:focus,.dw-field textarea:focus{outline:none;border-color:rgba(128,128,128,.42)}
.dw-image-row{display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap}
.dw-image-actions{display:flex;flex-direction:column;align-items:flex-start;gap:8px}
.dw-file{display:none}
.dw-form-actions{margin-top:2px}
.dw-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.dw-tags{display:flex;flex-wrap:wrap;gap:6px}
.dw-tag{font-size:11px;padding:1px 7px;border-radius:999px;background:rgba(128,128,128,.135);opacity:.85}
.dw-tag-dim{opacity:.55}
.dw-tag-soft{opacity:.45;background:transparent;border:1px solid rgba(128,128,128,.18)}
.dw-taglist{margin-top:-3px}
.dw-worn{border-color:rgba(128,128,128,.34)}
.dw-wornline{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12px;opacity:.7;margin-right:6px}
.dw-wornline>strong{font-weight:600;opacity:.9}
.dw-wornchip{display:inline-flex;align-items:baseline;gap:4px;padding:1px 8px;border-radius:999px;background:rgba(128,128,128,.13);font-size:11.5px}
.dw-wornchip em{font-style:normal;opacity:.55;font-size:10.5px}
.dw-wornchip strong{font-weight:600}
.dw-thumb{width:96px;height:96px;flex:none;object-fit:cover;border-radius:10px;background:rgba(128,128,128,.08)}
.dw-thumb-lg{width:132px;height:132px;object-fit:cover;border-radius:12px;background:rgba(128,128,128,.08)}
.dw-thumb-empty{display:flex;align-items:center;justify-content:center;font-size:11.5px;opacity:.4;border:1px dashed rgba(128,128,128,.25)}
.dw-list{margin:20px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px}
.dw-card{display:flex;gap:16px;padding:14px;border-radius:14px;background:rgba(128,128,128,.05);border:1px solid rgba(128,128,128,.085)}
.dw-card-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:7px}
.dw-card-title{margin:0;font-size:14.5px;font-weight:600;overflow-wrap:anywhere}
.dw-text{margin:0;font-size:13px;opacity:.78;overflow-wrap:anywhere;white-space:pre-wrap}
.dw-mono{font-family:var(--dsh-font-family-code-default,ui-monospace,monospace);font-size:12px;opacity:.6}
.dw-muted{margin:0;font-size:12.5px;opacity:.4}
.dw-empty{margin-top:24px;font-size:13px;opacity:.45}
.dw-card details summary{cursor:pointer;font-size:12px;opacity:.5}
`;

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register(
          { name: 'settings.section', id: 'dsh-wardrobe', order: 10, label: () => '衣柜' }, Wardrobe)));
      },
    };
  },
});
