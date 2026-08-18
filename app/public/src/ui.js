/* ===== UI 资产：线性图标 + 医生头像 + 二维码/海报/空态（皆为风格统一的占位 SVG） ===== */
window.UI = (function () {
  function hash(s){ let h=0; for(let i=0;i<(s||"").length;i++) h=(h*31+s.charCodeAt(i))>>>0; return h; }
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  /* 线性图标（24×24，描边 currentColor） */
  const P = {
    chat:'<path d="M21 11.5a8.3 8 0 0 1-11.7 7.3L4 20l1.3-4.1A8 8 0 1 1 21 11.5z"/>',
    plus:'<circle cx="12" cy="12" r="8.4"/><path d="M12 8.4v7.2M8.4 12h7.2"/>',
    bed:'<path d="M4 18V8M4 13h12a4 4 0 0 1 4 4v1M20 18v-3"/><circle cx="8" cy="10.6" r="1.6"/>',
    clock:'<circle cx="12" cy="12" r="8.4"/><path d="M12 7.6V12l3 2"/>',
    transfer:'<path d="M4 8.5h12l-3.2-3.2M20 15.5H8l3.2 3.2"/>',
    phone:'<path d="M6.6 4h3l1.4 4-2 1.4a11 11 0 0 0 5 5l1.4-2 4 1.4v3a2 2 0 0 1-2.1 2A16 16 0 0 1 4.6 6.1 2 2 0 0 1 6.6 4z"/>',
    book:'<path d="M5 5.5A2 2 0 0 1 7 3.5h11v15H7a2 2 0 0 0-2 2zM5 5.5v15"/><path d="M18 3.5v15"/>',
    bowl:'<path d="M4 11h16M5 11a7 7 0 0 0 14 0"/><path d="M9.6 4.2c0 1.4-1 2-1 3M14.4 4.2c0 1.4-1 2-1 3"/>',
    heart:'<path d="M12 20S4.6 15.4 2.9 10.6A4.6 4.6 0 0 1 12 8a4.6 4.6 0 0 1 9.1 2.6C19.4 15.4 12 20 12 20z" fill="currentColor" stroke="none"/>',
    profile:'<circle cx="12" cy="9" r="3.6"/><path d="M5.5 19.2a6.6 6.6 0 0 1 13 0"/>',
    video:'<rect x="3.4" y="6" width="13" height="12" rx="3"/><path d="M16.4 10l4.2-2.6v9.2L16.4 14"/>',
    image:'<rect x="4" y="5" width="16" height="14" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M7 17l3.5-3.8 2.7 2.5 2.2-2.2L19 17"/>',
    form:'<rect x="5" y="3.5" width="14" height="17" rx="3"/><path d="M9 8.5h6M9 12.5h6M9 16h4"/>',
    copy:'<rect x="8" y="8" width="11" height="12" rx="2.6"/><path d="M5 16V5.6A1.6 1.6 0 0 1 6.6 4H15"/>',
    help:'<circle cx="12" cy="12" r="8.4"/><path d="M9.6 9.6a2.5 2.5 0 0 1 4.6 1.4c0 1.7-2 2-2 3.2"/><circle cx="12" cy="16.8" r=".7" fill="currentColor" stroke="none"/>',
    check:'<path d="M5 12.6l4.6 4.4L19 7" stroke-width="2.2"/>',
    shield:'<path d="M12 3.2l7 2.8v5c0 4.4-3 7.4-7 8.8-4-1.4-7-4.4-7-8.8V6z"/><path d="M9 12l2 2 4-4"/>',
    info:'<circle cx="12" cy="12" r="8.4"/><path d="M12 11v5M12 7.8v.6"/>',
    warn:'<path d="M12 3.5l9.2 16H2.8z"/><path d="M12 9.5v4.2M12 16.7v.4"/>',
    arrow:'<path d="M9 6l6 6-6 6"/>',
    back:'<path d="M15 6l-6 6 6 6"/>',
    send:'<path d="M21 4L3 10.8l7 2.2 2.2 7z"/>',
    home:'<path d="M4 11l8-7 8 7M6 10v9h12v-9"/>',
    user:'<circle cx="12" cy="8.5" r="3.4"/><path d="M5.5 19.5a6.6 6.6 0 0 1 13 0"/>',
    az:'<text x="2.5" y="18" font-size="14" font-weight="700" fill="currentColor" stroke="none" font-family="sans-serif">A</text><text x="13" y="18" font-size="9" font-weight="700" fill="currentColor" stroke="none" font-family="sans-serif">A</text>',
    qr:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3M20 14v3M17 20h4"/>',
    sound:'<path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4z" fill="currentColor" stroke="none"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
    stop:'<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>'
  };
  function icon(name){
    // 默认 24×24，避免在未显式约束 svg 尺寸的容器里（如 .fix-note）因 svg{display:block} 撑满而变巨大；
    // 需要更大/更小的地方由 CSS 的 width/height 覆盖此默认值。
    return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name]||P.help}</svg>`;
  }

  /* 医生头像（渐变底 + 简洁医者图形 + 听诊器十字徽，非 emoji） */
  function avatar(name){
    const id="g"+(hash(name)%9999);
    return `<svg viewBox="0 0 76 76" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0A6E8C"/><stop offset="1" stop-color="#1FA6A0"/></linearGradient></defs>
      <rect width="76" height="76" rx="18" fill="url(#${id})"/>
      <circle cx="38" cy="31" r="12" fill="#fff" opacity=".95"/>
      <path d="M19 64a19 19 0 0 1 38 0z" fill="#fff" opacity=".95"/>
      <circle cx="38" cy="49" r="3.2" fill="#0A6E8C"/>
      <path d="M38 49v6a8 8 0 0 0 8 8" fill="none" stroke="#0A6E8C" stroke-width="2"/>
      <circle cx="49" cy="22" r="6" fill="#fff"/><path d="M49 19v6M46 22h6" stroke="#1FA6A0" stroke-width="2" stroke-linecap="round"/></svg>`;
  }
  /* 患者头像（首字色块） */
  function userAvatar(name){
    const palette=["#0A6E8C","#1FA6A0","#3f7fb3","#7b6cc4","#c4708f","#1E8E4E"];
    const c=palette[hash(name)%palette.length];
    const ch=(name||"友").trim().slice(-1);
    return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" rx="20" fill="${c}"/>
      <text x="20" y="26" font-size="17" fill="#fff" text-anchor="middle" font-family="sans-serif">${esc(ch)}</text></svg>`;
  }

  /* 伪二维码（确定性，占位） */
  function qrCode(seed){
    const s=hash(seed||"demo"), n=25, cell=128/n; let r=s, rects="";
    const rnd=()=>{ r=(r*1103515245+12345)&0x7fffffff; return r/0x7fffffff; };
    const finder=(x,y)=>{ rects+=`<rect x="${x*cell}" y="${y*cell}" width="${7*cell}" height="${7*cell}" fill="#0A6E8C"/>`+
      `<rect x="${(x+1)*cell}" y="${(y+1)*cell}" width="${5*cell}" height="${5*cell}" fill="#fff"/>`+
      `<rect x="${(x+2)*cell}" y="${(y+2)*cell}" width="${3*cell}" height="${3*cell}" fill="#0A6E8C"/>`; };
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){ if((x<8&&y<8)||(x>n-9&&y<8)||(x<8&&y>n-9))continue; if(rnd()>0.56)rects+=`<rect x="${x*cell}" y="${y*cell}" width="${cell}" height="${cell}" fill="#1A2B33"/>`; }
    finder(0,0);finder(n-7,0);finder(0,n-7);
    return `<svg viewBox="0 0 128 128" width="128" height="128" xmlns="http://www.w3.org/2000/svg"><rect width="128" height="128" fill="#fff"/>${rects}
      <rect x="52" y="52" width="24" height="24" rx="6" fill="#0A6E8C"/><path d="M58 64l4 4 8-8" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  /* 群活码白名单校验：只接受 png/jpeg 的 base64 data URI 且长度 ≤200KB；不合法一律当作无值。
     防「管理员可配内容」经 SVG 模板串注入的存储型 XSS——只有通过此校验的字符串才允许进 <image href>。 */
  function validGroupQr(s){
    if(typeof s!=="string" || s.length>200*1024) return "";
    return /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : "";
  }

  /* 海报真实图白名单：仅接受站内 /assets/ 下的相对路径 jpg/jpeg/png（甲方提供的真实设计海报，自带照片/简介/群活码）；
     防「管理员可配内容」经外链/协议/路径穿越注入的存储型 XSS 或跳出站外——不合法一律当作无值，回退生成 SVG 海报。 */
  function validPosterImage(s){
    return typeof s==="string" && /^\/assets\/[A-Za-z0-9_./-]+\.(jpg|jpeg|png)$/.test(s) ? s : "";
  }

  /* 合规版推广海报（无绝对化用语，含免责）；医生 content.groupQrImage 通过白名单校验时在底部嵌入真实群活码。
     若医生 content.posterImage 通过白名单校验（甲方提供的真实设计海报），直接渲染该图，不再生成占位 SVG——
     posterImage 优先于 groupQrImage/生成 SVG；无值/非法则保持原逻辑，渲染结果零变化。 */
  function poster(d){
    d = d||{};
    const realSrc = validPosterImage(d.posterImage);
    if(realSrc) return `<img src="${esc(realSrc)}" alt="医生推荐海报" style="width:100%;display:block" />`;
    const gq = validGroupQr(d.groupQrImage);
    // 有合法群活码 → 底部换成真实二维码 <image>（data URI 已白名单校验，非注入面）+ 合规说明；
    // 无值/非法 → 保持原占位二维码与文案，渲染结果零变化。
    const qrArea = gq
      ? `<image x="112" y="326" width="96" height="96" href="${gq}" preserveAspectRatio="xMidYMid meet"/>`
      : `<g transform="translate(112,326) scale(0.75)">${qrCode(d.name)}</g>`;
    const caption = gq ? "微信扫一扫 · 加入医生健康群" : "扫码加入医生的院外健康服务";
    return `<svg viewBox="0 0 320 460" xmlns="http://www.w3.org/2000/svg">
      <rect width="320" height="460" fill="#fff"/>
      <defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0A6E8C"/><stop offset="1" stop-color="#1FA6A0"/></linearGradient></defs>
      <rect width="320" height="172" fill="url(#pg)"/>
      <g transform="translate(122,40)">${avatar(d.name).replace('viewBox="0 0 76 76"','viewBox="0 0 76 76" width="76" height="76"')}</g>
      <rect x="122" y="40" width="76" height="76" rx="18" fill="none" stroke="#fff" stroke-width="3"/>
      <text x="160" y="210" font-size="26" font-weight="700" text-anchor="middle" fill="#1A2B33" font-family="sans-serif">${esc(d.name)} ${esc((d.title||"").split(/[\/ ]/)[0])}</text>
      <text x="160" y="236" font-size="14" text-anchor="middle" fill="#4C6272" font-family="sans-serif">${esc(d.hospital||"")} · ${esc(d.dept||"")}</text>
      <text x="160" y="262" font-size="13" text-anchor="middle" fill="#0A6E8C" font-family="sans-serif">${esc(d.specialty||"")}</text>
      <line x1="40" y1="284" x2="280" y2="284" stroke="#EAEEF0"/>
      <text x="160" y="312" font-size="14" text-anchor="middle" fill="#4C6272" font-family="sans-serif">${esc(caption)}</text>
      ${qrArea}
      <text x="160" y="446" font-size="11" text-anchor="middle" fill="#9aa7ad" font-family="sans-serif">健康科普与就医引导 · 不替代医生面诊（演示）</text></svg>`;
  }

  /* 空态线性插画 */
  function empty(){
    return `<svg viewBox="0 0 96 96" fill="none" stroke="#9DB2BC" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="22" y="14" width="48" height="64" rx="8"/><path d="M34 32h28M34 44h28M34 56h18"/>
      <circle cx="70" cy="68" r="14" fill="#F4F8FA"/><path d="M70 62v8M70 74v.5" stroke="#1FA6A0"/></svg>`;
  }

  return { icon, avatar, userAvatar, qrCode, poster, empty, esc };
})();
