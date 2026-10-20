// Skin picker shared by Settings → Giao diện and the music Tuỳ chỉnh sheet: live previews
// (a miniature player painted with each skin's tokens and fonts), per-module override,
// import/export of skin JSON.
import { allSkins, getSkin, skinVars, previewFonts, exportSkin, importSkin, deleteSkin, loadCustomSkins, currentSkinId, moduleOverrides } from './skins.js';
import { setSkin, setModuleSkin, modeOf, allThemes, currentTheme } from './theme.js';
import { listModules } from './registry.js';
import { icon } from './icons.js';
import { esc, toast, saveJson, pickJson, confirmBox } from './ui.js';

async function mode() {
  const cur = await currentTheme();
  const th = (await allThemes()).find(t => t.id === cur.id) || { base: 'auto' };
  return modeOf(th);
}

function card(s, m, on, { follow = false } = {}) {
  const v = skinVars(s, m, {});
  const pv = s.preview?.[m] || s.preview?.dark || ['#eee', '#fff', '#1d6f8f', '#111'];
  const style = [`--p-bg:${pv[0]}`, `--p-sf:${pv[1]}`, `--p-ac:${pv[2]}`, `--p-fg:${pv[3]}`, `--p-ac2:${(s.palette || getSkin(s.extends)?.palette)?.[m]?.['--accent-2'] || pv[2]}`,
    `--p-r:${v['--radius']}`, `--p-font:${v['--font-body']}`, `--p-dfont:${v['--font-display']}`, `--p-glow:${v['--page-glow'] && v['--page-glow'] !== 'none' ? 1 : 0}`].join(';');
  return `<button class="skin-card${on ? ' on' : ''}" role="radio" aria-checked="${on}" data-skin-pick="${follow ? '' : s.id}">
    <span class="skin-prev" style="${esc(style)}" aria-hidden="true"><span class="sp-art"></span><span class="sp-body"><span class="sp-t">Đường về</span><span class="sp-s">Nhạc · ${esc(s.name)}</span>
      <span class="sp-row"><i></i><i></i><i></i></span><span class="sp-bar"><i></i></span></span></span>
    <b>${follow ? 'Theo skin của app' : esc(s.name)}</b><small>${follow ? 'Dùng skin đang chọn ở Cài đặt' : esc(s.desc || '')}${s.ref && !follow ? `<br><i>Dựa trên: ${esc(s.ref)}</i>` : ''}</small>
    ${s.custom && !follow ? '<span class="pill">Của bạn</span>' : ''}</button>`;
}

// scope: null = the app skin; a module id = that module's override.
export async function skinPickerHtml(scope = null) {
  await loadCustomSkins();
  previewFonts();
  const m = await mode();
  const appSkin = await currentSkinId();
  const over = (await moduleOverrides())[scope] || '';
  const active = scope ? over : appSkin;
  return `<div class="skin-grid" role="radiogroup" aria-label="Skin" data-skin-scope="${scope || ''}">
    ${scope ? card(getSkin(appSkin), m, !over, { follow: true }) : ''}
    ${allSkins().map(s => card(s, m, s.id === active)).join('')}</div>`;
}

export async function skinSectionHtml() {
  const mods = (await listModules()).filter(x => x.route && x.nav !== false && x.status !== 'planned' && (x.core || x.state?.enabled) && x.id !== 'settings');
  const over = await moduleOverrides();
  const cur = await currentSkinId();
  const opts = (sel) => `<option value="">Theo app</option>${allSkins().map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}`;
  return `<h3 class="eyebrow">Skin</h3>
    ${await skinPickerHtml(null)}
    <p class="hint">Skin đổi phông chữ, bo góc, hiệu ứng kính, chuyển động và kiểu Đang phát. Skin có bảng màu riêng: theme bên dưới chỉ chọn sáng/tối; Màu nhấn vẫn áp dụng.</p>
    <details class="panel"><summary><b>Skin riêng cho từng mục</b></summary>
      <div class="skin-over">${mods.map(x => `<label>${esc(x.name)}<select data-skin-mod="${x.id}">${opts(over[x.id])}</select></label>`).join('')}</div></details>
    <div class="skin-tools">
      <button class="btn" data-skin-act="export">${icon('download')}Xuất skin JSON</button>
      <button class="btn" data-skin-act="import">${icon('upload')}Nhập skin JSON</button>
      ${getSkin(cur).custom ? `<button class="btn danger-ghost" data-skin-act="delete">${icon('trash')}Xoá skin này</button>` : ''}
    </div>
    <h3 class="eyebrow">Theme màu</h3>`;
}

export function bindSkins(root, rerender) {
  root.querySelectorAll('.skin-grid').forEach(g => g.querySelectorAll('[data-skin-pick]').forEach(b => b.onclick = async () => {
    const scope = g.dataset.skinScope, id = b.dataset.skinPick;
    // Cross-fade the whole page into the new skin when the browser can.
    const go = async () => { if (scope) await setModuleSkin(scope, id || null); else await setSkin(id); };
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) await document.startViewTransition(go).finished.catch(() => {});
    else await go();
    rerender?.();
  }));
  root.querySelectorAll('[data-skin-mod]').forEach(s => s.onchange = async () => { await setModuleSkin(s.dataset.skinMod, s.value || null); toast('Đã đổi skin cho mục này'); });
  const act = (k, f) => root.querySelector(`[data-skin-act="${k}"]`)?.addEventListener('click', f);
  act('export', async () => { const id = await currentSkinId(); saveJson(`skin-${id}.json`, exportSkin(id)); });
  act('import', async () => {
    const json = await pickJson('Nhập skin');
    if (!json) return;
    try { const s = await importSkin(json); await setSkin(s.id); toast('Đã nhập skin ' + s.name); rerender?.(); } catch (e) { toast(e.message, 'error'); }
  });
  act('delete', async () => {
    const id = await currentSkinId();
    if (!(await confirmBox('Xoá skin?', 'Skin “' + getSkin(id).name + '” sẽ bị xoá khỏi máy này.', 'Xoá'))) return;
    await deleteSkin(id); await setSkin('classic'); rerender?.();
  });
}
