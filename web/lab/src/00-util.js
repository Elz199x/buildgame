/* ============================================================
   MODULE 00 — util : ตัวช่วยกลาง + "ค่าที่ขยายตามเลเวลได้" (Scalable value, เรียกว่า S)
   S มี 3 รูปแบบ:  ตัวเลขคงที่ | {base, step} (เส้นตรง: base + step*(Lv-1)) | {table:[...]} (ระบุทุกเลเวล)
   โมดูลอื่นเรียกใช้ผ่าน SL.util เท่านั้น
============================================================ */
(function(g){
  const SL = g.SL = g.SL || {};

  function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }
  function val(S, lv){
    if(S === undefined || S === null || S === '') return 0;
    if(typeof S === 'number') return S;
    if(Array.isArray(S)) return S.length ? S[clamp(lv,1,S.length)-1] : 0;
    if(typeof S === 'object'){
      if(Array.isArray(S.table) && S.table.length) return S.table[clamp(lv,1,S.table.length)-1];
      return (Number(S.base)||0) + (Number(S.step)||0) * (Math.max(1, lv) - 1);
    }
    return Number(S) || 0;
  }
  const lin = (v) => ({ base: v, step: v });            // "ต่อเลเวล" : Lv1 = v, Lv2 = 2v ...
  function sMode(S){
    if(S === undefined || S === null || typeof S === 'number') return 'const';
    return (S && S.table) ? 'table' : 'linear';
  }
  function clone(x){ return JSON.parse(JSON.stringify(x)); }
  function fmt(n, d){
    d = d === undefined ? 0 : d;
    if(!isFinite(n)) return '∞';
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  }
  // แสดงตัวอย่างค่าทุกเลเวลแบบย่อ เช่น "130 → 400"
  function preview(S, maxLv, scale, d){
    scale = scale || 1; d = d === undefined ? 2 : d;
    const arr = [];
    for(let l = 1; l <= maxLv; l++) arr.push(+(val(S, l) * scale).toFixed(d));
    if(arr.length <= 6) return arr.join(' / ');
    return arr[0] + ' / ' + arr[1] + ' / … / ' + arr[arr.length-2] + ' / ' + arr[arr.length-1];
  }
  function slug(s){ return String(s||'').trim().replace(/[^A-Za-z0-9_]+/g,'_').replace(/^_+|_+$/g,''); }

  SL.util = { clamp, val, lin, sMode, clone, fmt, preview, slug };
})(typeof window !== 'undefined' ? window : globalThis);
