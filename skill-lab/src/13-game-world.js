/* ============================================================
   MODULE 13 — game-world : โลกผจญภัย 2.5D สไตล์ Cat Quest × Ragnarok Online
   - มุมมอง Top-Down 60° Fixed Camera (ไม่หมุนกล้อง เลื่อนตามตัวละครนุ่มนวล + ซูมได้)
   - ระบบโมเดล Rigged Chibi 2.5D แบบแยกชิ้นส่วนกระดูก (หัว/หู/หมวก/ตัว/แขน/ขา/อาวุธ/โล่/ผ้าคลุม)
     พร้อมสล็อตรองรับการโหลดสไปรท์และโมเดล 3D (.glb/.gltf) จากภายนอก
   - ระบบควบคุม: WASD / คลิกพื้นเพื่อเดิน, Spacebar กลิ้งหลบ (Dodge Roll อมตะชั่วคราว),
     คลิกมอนสเตอร์หรือกด F เพื่อล็อกเป้าตีตาม ASPD จริง, กด 1–9 ใช้สกิลจากที่เรียนไว้
   - ระบบวงแดงเตือนพื้นที่โจมตี (Cat Quest Telegraph: Circle / Cone / Line) ทั้งฝั่งผู้เล่นและมอนสเตอร์
============================================================ */
(function(g){
  const SL = g.SL = g.SL || {};
  const ui = SL.ui, h = ui.h, R = SL.rules, C = SL.calc;
  const { val, clamp, fmt } = SL.util;

  /* ============================================================
     1) RIGGED MODEL & ASSET REGISTRY (เตรียมพร้อมสำหรับใส่โมเดลภายนอก)
  ============================================================ */
  const imgCache = {};
  function getLoadedImage(url){
    if(!url) return null;
    if(imgCache[url]) return imgCache[url].complete && imgCache[url].naturalWidth > 0 ? imgCache[url] : null;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    imgCache[url] = img;
    return null;
  }

  const rigRenderer = SL.rigRenderer = {
    // วิเคราะห์รูปแบบท่าโจมตีตามค่าสเตตัส RO (STR/AGI/VIT/INT/DEX/LUK + ASPD/CRIT)
    getAttackProfile(rawStats, derivedSheet, weaponId, hasShield){
      const st = SL.state.get();
      const raw = rawStats || st.rawStats || { str: 40, agi: 40, vit: 30, int: 30, dex: 40, luk: 20 };
      const sh = derivedSheet || st.sheet || {};
      const str = Number(raw.str) || 1;
      const agi = Number(raw.agi) || 1;
      const vit = Number(raw.vit) || 1;
      const intStat = Number(raw.int) || 1;
      const dex = Number(raw.dex) || 1;
      const luk = Number(raw.luk) || 1;
      const aspd = Number(sh.aspd) || 156;
      const aps = 100 / Math.max(7, 200 - Math.min(193, aspd));

      // 1) AGI / ASPD -> ความเร็วอนิเมชัน, จำนวนขั้นคอมโบ (1 -> 2 -> 3 จังหวะหมุนตัว), และเงาภาพติดตา (Afterimage)
      const comboMax = (agi >= 65 || aspd >= 175) ? 3 : ((agi >= 38 || aspd >= 160) ? 2 : 1);
      const hasAfterimage = agi >= 60 || aspd >= 174;

      // 2) STR -> ขนาดอาวุธขยายตามพละกำลัง, ระยะก้าวพุ่งฟัน (Lunge), และคลื่นดาบอัดอากาศ 2 ชั้น (Heavy Shockwave)
      const weaponScale = 1 + clamp((str - 20) * 0.0045, 0, 0.36);
      const lungePx = 3 + clamp(str * 0.16, 0, 15);
      const heavyCleave = str >= 50;
      const groundSlam = str >= 75;

      // 3) INT / MATK -> ออร่าดาบเวทมนตร์ & ลูกแก้วรูนหมุนรอบตัวขณะโจมตี
      const arcaneEnchant = intStat >= 40 || weaponId === 'staff' || (Number(sh.matk) || 0) >= 220;
      const runeOrbs = intStat >= 75 ? 3 : (intStat >= 45 ? 2 : (arcaneEnchant ? 1 : 0));

      // 4) DEX -> ความเร็วลูกธนู/มีดพุ่ง และเส้นเลเซอร์ผ่าอากาศ (Sonic Pierce Trail)
      const projSpeed = 520 + dex * 4.5;
      const sonicPierce = dex >= 50;

      // 5) LUK / CRIT -> ท่ากระโดดม้วนตัวฟันผ่าสายฟ้า (Crit Jump X-Slash)
      const critJumpReady = luk >= 45 || (Number(sh.physCrit) || 0) >= 22;

      // 6) VIT -> ท่าตั้งการ์ดโล่กระแทกสวนกลับ (Shield Bash Guard Stance)
      const shieldGuard = vit >= 45 && !!(hasShield !== undefined ? hasShield : st.hasShield);

      const badges = [];
      badges.push({ stat: 'AGI/ASPD', text: comboMax === 3 ? '⚡ 3-Hit Spin Flurry + เงาติดตา (' + aps.toFixed(1) + '/s)' : (comboMax === 2 ? '⚡ 2-Hit Twin Slash (' + aps.toFixed(1) + '/s)' : '🗡️ Single Swing (' + aps.toFixed(1) + '/s)'), color: '#63b3ed' });
      if(heavyCleave) badges.push({ stat: 'STR', text: groundSlam ? '💥 Heavy Slam + คลื่นดาบยักษ์ (อาวุธ +' + Math.round((weaponScale - 1) * 100) + '%)' : '🔥 Heavy Cleave Wave (อาวุธ +' + Math.round((weaponScale - 1) * 100) + '%)', color: '#f6ad55' });
      if(arcaneEnchant) badges.push({ stat: 'INT', text: '✨ Arcane Enchant + รูนเวท ' + runeOrbs + ' ดวง', color: '#b794f4' });
      if(sonicPierce) badges.push({ stat: 'DEX', text: '🎯 Sonic Pierce เส้นแสงทะลวง (' + Math.round(projSpeed) + ' px/s)', color: '#68d391' });
      if(critJumpReady) badges.push({ stat: 'LUK', text: '🌟 Critical Jump X-Slash (กระโดดผ่าคริติคอล)', color: '#f6e05e' });
      if(shieldGuard) badges.push({ stat: 'VIT', text: '🛡️ Iron Guard Stance (ตั้งโล่กระแทกขณะฟัน)', color: '#4fd1c5' });

      return {
        str: str, agi: agi, vit: vit, int: intStat, dex: dex, luk: luk,
        aspd: aspd, aps: aps,
        comboMax: comboMax,
        hasAfterimage: hasAfterimage,
        weaponScale: weaponScale,
        lungePx: lungePx,
        heavyCleave: heavyCleave,
        groundSlam: groundSlam,
        arcaneEnchant: arcaneEnchant,
        runeOrbs: runeOrbs,
        projSpeed: projSpeed,
        sonicPierce: sonicPierce,
        critJumpReady: critJumpReady,
        shieldGuard: shieldGuard,
        badges: badges
      };
    },

    // วาดเงาพื้นแบบ 2.5D
    drawShadow(ctx, x, y, rx, ry, alpha){
      ctx.save();
      ctx.fillStyle = 'rgba(15, 20, 28, ' + (alpha || 0.32) + ')';
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },

    // วาดอาวุธตามรหัส weaponId บนมือขวาของ Rig (ปรับขนาดและออร่าตามค่า STR / INT / LUK)
    drawWeapon(ctx, weaponId, animState, animPhase, prof, isCritSwing){
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const wScale = (prof && prof.weaponScale) || 1;
      ctx.scale(wScale, wScale);

      // ออร่าอาวุธตามค่าสเตตัส (INT = ม่วงฟ้าเวทมนตร์, STR สูง = แดงเพลิง, Crit = ทองสายฟ้า)
      if(animState === 'attack' || animState === 'cast' || (prof && (prof.arcaneEnchant || prof.heavyCleave))){
        const glowCol = isCritSwing ? 'rgba(246, 224, 94, 0.55)' : (prof && prof.arcaneEnchant ? 'rgba(159, 122, 234, 0.45)' : (prof && prof.heavyCleave ? 'rgba(246, 173, 85, 0.38)' : ''));
        if(glowCol){
          ctx.save();
          ctx.strokeStyle = glowCol;
          ctx.lineWidth = 7;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, weaponId === 'sword_2h' ? -40 : -26); ctx.stroke();
          ctx.restore();
        }
      }

      // เซลเชดดิ้งสำหรับอาวุธ + ไฮไลต์
      const wcel = (base, bx, by, bw, bh) => {
        ctx.fillStyle = base; ctx.fill();
        ctx.save(); ctx.clip();
        const gr = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
        gr.addColorStop(0, 'rgba(255,255,255,0.3)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.3)');
        gr.addColorStop(0.5, 'rgba(6,8,26,0.3)'); gr.addColorStop(1, 'rgba(6,8,26,0.3)');
        ctx.fillStyle = gr; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
        ctx.restore();
      };
      const wink = (w) => { ctx.strokeStyle = '#10131b'; ctx.lineWidth = w || 1.5; ctx.stroke(); };
      const hot = animState === 'attack' || animState === 'cast' || (prof && (prof.arcaneEnchant || prof.heavyCleave));
      if(weaponId === 'sword_1h'){
        if(hot){ ctx.save(); ctx.shadowColor = isCritSwing ? '#ffe066' : '#7dd3fc'; ctx.shadowBlur = 8; }
        ctx.beginPath(); ctx.moveTo(-2.7, -4); ctx.lineTo(-2.3, -27); ctx.lineTo(0, -34); ctx.lineTo(2.3, -27); ctx.lineTo(2.7, -4); ctx.closePath();
        wcel('#dfe8f5', -3, -34, 6, 30); wink(1.6);
        if(hot) ctx.restore();
        ctx.strokeStyle = 'rgba(80,100,130,0.65)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(0, -28); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-8, -3.2); ctx.lineTo(-3.2, -5.6); ctx.lineTo(3.2, -5.6); ctx.lineTo(8, -3.2); ctx.lineTo(5.4, 0.6); ctx.lineTo(-5.4, 0.6); ctx.closePath();
        wcel('#e6b84f', -8, -6, 16, 7); wink(1.4);
        ctx.fillStyle = '#4a3326'; ctx.fillRect(-1.5, 0.6, 3, 6); wink(1);
        ctx.fillStyle = '#e6b84f'; ctx.beginPath(); ctx.arc(0, 8, 2.2, 0, Math.PI * 2); ctx.fill(); wink(1);
      } else if(weaponId === 'sword_2h'){
        if(hot){ ctx.save(); ctx.shadowColor = isCritSwing ? '#ffe066' : '#fb923c'; ctx.shadowBlur = 10; }
        ctx.beginPath(); ctx.moveTo(-4.2, -5); ctx.lineTo(-3.8, -38); ctx.lineTo(0, -48); ctx.lineTo(3.8, -38); ctx.lineTo(4.2, -5); ctx.closePath();
        wcel('#e4ebf7', -4, -48, 8, 44); wink(1.8);
        if(hot) ctx.restore();
        ctx.fillStyle = 'rgba(70,90,125,0.55)'; ctx.fillRect(0, -40, 4, 35);
        ctx.strokeStyle = '#e53e3e'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(0, -30); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-11, -2.4); ctx.lineTo(-4.4, -6.2); ctx.lineTo(4.4, -6.2); ctx.lineTo(11, -2.4); ctx.lineTo(7, 1.6); ctx.lineTo(-7, 1.6); ctx.closePath();
        wcel('#e6b84f', -11, -6, 22, 8); wink(1.5);
        ctx.fillStyle = '#ff4d4d'; ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(2, -2.4); ctx.lineTo(0, 0); ctx.lineTo(-2, -2.4); ctx.closePath(); ctx.fill(); wink(0.9);
        ctx.fillStyle = '#4a3326'; ctx.fillRect(-1.7, 1.6, 3.4, 8); wink(1);
        ctx.fillStyle = '#e6b84f'; ctx.beginPath(); ctx.arc(0, 11, 2.6, 0, Math.PI * 2); ctx.fill(); wink(1);
      } else if(weaponId === 'dagger'){
        if(hot){ ctx.save(); ctx.shadowColor = '#c084fc'; ctx.shadowBlur = 7; }
        ctx.beginPath(); ctx.moveTo(-2.4, -3); ctx.quadraticCurveTo(-4.6, -14, 1.2, -24); ctx.quadraticCurveTo(4.6, -13, 2.8, -3); ctx.closePath();
        wcel('#d7dfea', -4, -24, 8, 21); wink(1.5);
        if(hot) ctx.restore();
        ctx.beginPath(); ctx.moveTo(-5.4, -3.6); ctx.lineTo(5.4, -3.6); ctx.lineTo(4.2, -0.6); ctx.lineTo(-4.2, -0.6); ctx.closePath();
        wcel('#8b5cf6', -5, -4, 10, 4); wink(1.2);
        ctx.fillStyle = '#2f2338'; ctx.fillRect(-1.4, -0.6, 2.8, 5); wink(0.9);
      } else if(weaponId === 'axe'){
        ctx.strokeStyle = '#744210'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(0, -24); ctx.stroke();
        ctx.fillStyle = '#a0aec0'; ctx.strokeStyle = '#2d3748'; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.arc(2, -18, 10, -Math.PI * 0.45, Math.PI * 0.45); ctx.lineTo(0, -18); ctx.closePath();
        ctx.fill(); ctx.stroke();
      } else if(weaponId === 'mace'){
        ctx.strokeStyle = '#744210'; ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(0, -18); ctx.stroke();
        ctx.fillStyle = '#d69e2e'; ctx.strokeStyle = '#2d3748'; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.arc(0, -21, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else if(weaponId === 'bow'){
        // คันธนูโค้งปลายงอน
        ctx.strokeStyle = '#10131b'; ctx.lineWidth = 5.2;
        ctx.beginPath(); ctx.arc(5, -10, 15, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
        ctx.strokeStyle = '#c98a3a'; ctx.lineWidth = 3.4;
        ctx.beginPath(); ctx.arc(5, -10, 15, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
        ctx.strokeStyle = '#f0c27a'; ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.arc(5, -10, 15.9, -Math.PI * 0.42, Math.PI * 0.05); ctx.stroke();
        ctx.strokeStyle = '#10131b'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(5, -25); ctx.quadraticCurveTo(10, -28, 12, -25); ctx.moveTo(5, 5); ctx.quadraticCurveTo(10, 8, 12, 5); ctx.stroke();
        ctx.strokeStyle = '#c98a3a'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(5, -25); ctx.quadraticCurveTo(10, -28, 12, -25); ctx.moveTo(5, 5); ctx.quadraticCurveTo(10, 8, 12, 5); ctx.stroke();
        ctx.fillStyle = '#3a2a22'; ctx.fillRect(3, -14, 4.4, 8);
        ctx.strokeStyle = '#eef2f7'; ctx.lineWidth = 1.1;
        const pull = animState === 'attack' ? -7 * Math.sin(animPhase * Math.PI) : 0;
        ctx.beginPath(); ctx.moveTo(12, -25); ctx.lineTo(5 + pull, -10); ctx.lineTo(12, 5); ctx.stroke();
        if(animState === 'attack'){
          // ลูกธนูพร้อมยิง (เรืองแสงเขียวเมื่อ DEX สูง)
          const ac = (prof && prof.sonicPierce) ? '#68d391' : '#f6e05e';
          ctx.save(); ctx.shadowColor = ac; ctx.shadowBlur = 6;
          ctx.strokeStyle = ac; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(5 + pull, -10); ctx.lineTo(21 + pull * 0.5, -10); ctx.stroke();
          ctx.fillStyle = ac; ctx.beginPath(); ctx.moveTo(21 + pull * 0.5, -12.4); ctx.lineTo(25 + pull * 0.5, -10); ctx.lineTo(21 + pull * 0.5, -7.6); ctx.closePath(); ctx.fill();
          ctx.restore();
        }
      } else if(weaponId === 'staff'){
        // ไม้เท้าคริสตัลเรืองแสง
        ctx.strokeStyle = '#10131b'; ctx.lineWidth = 5.4; ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(0, -27); ctx.stroke();
        ctx.strokeStyle = '#7c4fd6'; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(0, -27); ctx.stroke();
        ctx.strokeStyle = '#b79bff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-0.9, 6); ctx.lineTo(-0.9, -25); ctx.stroke();
        ctx.fillStyle = '#e6b84f';
        [-8, -20].forEach(ry => { ctx.fillRect(-3, ry, 6, 2.2); });
        ctx.beginPath(); ctx.moveTo(-5, -26); ctx.quadraticCurveTo(0, -30, 5, -26); ctx.lineTo(3.4, -29); ctx.lineTo(-3.4, -29); ctx.closePath(); ctx.fill(); wink(1.1);
        const pulse = 0.5 + 0.5 * Math.sin((animPhase || 0) * 9 + (animState === 'cast' ? 3 : 0));
        ctx.save(); ctx.shadowColor = '#67e8f9'; ctx.shadowBlur = 8 + pulse * 6;
        ctx.beginPath(); ctx.moveTo(0, -42); ctx.lineTo(5.4, -35); ctx.lineTo(0, -27.5); ctx.lineTo(-5.4, -35); ctx.closePath();
        wcel('#6fd6ff', -5.4, -42, 11, 15); wink(1.4);
        ctx.restore();
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.moveTo(-1.2, -39); ctx.lineTo(-3, -35.4); ctx.lineTo(-0.6, -33); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    },

    // วาดตัวละครผู้เล่น (Rigged Chibi Cat/Hero ปรับเปลี่ยนท่าโจมตีตามค่าสเตตัสอัตโนมัติ)
    drawCharacter(ctx, x, y, o){
      o = o || {};
      const D = SL.store.get();
      const slot = ((D.modelSlots || {}).classes || {})[o.classId || 'swordman'] || {};
      const scale = (o.scale || 1) * (slot.scale || 1);
      const facing = o.facing || 1; // 1 = ขวา, -1 = ซ้าย
      const st = o.animState || 'idle';
      const t = o.animTime || 0;
      const prof = o.attackProfile || this.getAttackProfile(o.rawStats, o.sheet, o.weaponId || 'sword_1h', o.hasShield);

      // ออร่าบัฟ/สถานะใต้เท้า
      if(o.auras && o.auras.length){
        o.auras.forEach((col, idx) => {
          ctx.save();
          ctx.strokeStyle = col;
          ctx.lineWidth = 2.2;
          ctx.globalAlpha = 0.55 + 0.25 * Math.sin(t * 5 + idx);
          const rx = (22 + idx * 5) * scale, ry = (11 + idx * 2.5) * scale;
          ctx.beginPath(); ctx.ellipse(x, y + 2, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        });
      }

      // เงาภาพติดตาความเร็วสูง (AGI / ASPD Afterimage Ghost) เมื่อโจมตีหรือกลิ้ง
      if(!o.isGhost && (st === 'attack' || st === 'roll') && prof.hasAfterimage){
        ctx.save();
        ctx.globalAlpha = 0.26;
        this.drawCharacter(ctx, x - facing * 12 * scale, y, Object.assign({}, o, {
          isGhost: true,
          animTime: Math.max(0, t - 0.045),
          auras: null
        }));
        ctx.restore();
      }

      if(!o.isGhost){
        this.drawShadow(ctx, x, y + 3 * scale, 16 * scale, 8 * scale, st === 'roll' ? 0.18 : 0.35);
      }

      // ถ้าระบุ custom spriteUrl ไว้และโหลดเสร็จแล้ว ให้ใช้สไปรท์ภายนอกพร้อม Squash & Stretch
      const customImg = getLoadedImage(slot.spriteUrl);
      if(customImg){
        ctx.save();
        ctx.translate(x, y);
        if(st === 'dead') ctx.rotate(facing * Math.PI * 0.48);
        else if(st === 'roll') ctx.rotate(facing * t * Math.PI * 6);
        ctx.scale(facing * scale, scale);
        const bounce = st === 'walk' ? Math.abs(Math.sin(t * 11)) * 4 : Math.sin(t * 3.5) * 1.5;
        ctx.drawImage(customImg, -24, -48 - bounce, 48, 48);
        ctx.restore();
        return;
      }

      // คำนวณ Bone Kinematics ตามสถานะแอนิเมชัน + ค่าสเตตัสตัวละคร
      let bobY = 0, lungeX = 0, sqX = 1, sqY = 1, rot = 0, legSwing = 0, armSwing = 0, shieldForward = 0;
      let activeComboStep = o.comboStep !== undefined ? o.comboStep : 0;
      let isCritMotion = !!o.isCritSwing;

      if(st === 'idle'){
        const s = Math.sin(t * 3.8);
        bobY = -Math.abs(s) * 2;
        sqX = 1 + s * 0.03; sqY = 1 - s * 0.03;
        armSwing = 0.62 + s * 0.05; // ถืออาวุธเอียงออกด้านหน้า ไม่บังใบหน้า
      } else if(st === 'walk'){
        const walkFreq = 11 + clamp((prof.agi - 20) * 0.06, 0, 5);
        const s = Math.sin(t * walkFreq);
        bobY = -Math.abs(s) * 5.5;
        sqX = 1 - Math.abs(s) * 0.05; sqY = 1 + Math.abs(s) * 0.06;
        legSwing = s * 0.55;
        armSwing = -s * 0.4;
        rot = s * 0.06;
      } else if(st === 'roll'){
        bobY = -12 * Math.sin(Math.min(1, o.rollProg || 0.5) * Math.PI);
        rot = (o.rollProg || (t % 0.3) / 0.3) * Math.PI * 2;
        sqX = 1.12; sqY = 0.88;
      } else if(st === 'attack'){
        // ความเร็วโจมตีปรับตาม APS จริงของสเตตัส AGI/DEX
        const cycleRate = Math.max(1.6, prof.aps * 1.15);
        const rawPhase = o.attackProg !== undefined ? o.attackProg : ((t * cycleRate) % 1);
        const p = clamp(rawPhase, 0, 1);
        if(o.comboStep === undefined){
          activeComboStep = Math.floor(t * cycleRate) % prof.comboMax;
          if(prof.critJumpReady && Math.floor(t * cycleRate) % 4 === 3) isCritMotion = true;
        }

        const sinP = Math.sin(p * Math.PI);
        lungeX = sinP * prof.lungePx;
        legSwing = sinP * 0.52;

        if(o.weaponId === 'bow'){
          // ท่ายิงธนูตามค่า DEX: โน้มตัวนิ่ง ดึงสายธนูและดีดตัวตามแรงยิง
          armSwing = -1.45 + (p > 0.65 ? (p - 0.65) * 0.9 : -p * 0.25);
          lungeX = p > 0.6 ? -4 * sinP : 3 * sinP;
          rot = -0.06 * sinP;
        } else if(isCritMotion){
          // LUK / CRIT Jump Slash: กระโดดโน้มตัวฟันผ่าลงอย่างรุนแรง (ตัวตั้งตรง ไม่ตีลังกากลับหัว)
          bobY = -10 * sinP;
          rot = sinP * 0.22;
          armSwing = -1.55 + p * 2.95;
          sqX = 1 + sinP * 0.14;
          sqY = 1 - sinP * 0.10;
        } else if(activeComboStep === 1){
          // คอมโบขั้นที่ 2 (เมื่อ AGI/ASPD ถึงเกณฑ์): ท่าตวัดดาบเสยขึ้น (Backhand Uppercut Slash)
          armSwing = p < 0.4 ? 1.55 - (p / 0.4) * 2.65 : -1.1 + ((p - 0.4) / 0.6) * 1.5;
          bobY = -4 * sinP;
          rot = -sinP * 0.10;
          sqX = 1 - sinP * 0.06;
          sqY = 1 + sinP * 0.08;
        } else if(activeComboStep === 2){
          // คอมโบขั้นที่ 3 (เมื่อ AGI/ASPD สูง): พุ่งตวัดดาบกว้างต่อเนื่อง (ตัวตั้งตรง โน้มไปข้างหน้า ไม่หมุนตีลังกา)
          rot = sinP * 0.18;
          bobY = -6 * sinP;
          armSwing = -1.6 + p * 3.1;
          sqX = 1 + sinP * 0.12;
          sqY = 1 - sinP * 0.09;
        } else {
          // คอมโบขั้นที่ 1: ท่าฟันผ่าหน้า (Forehand Heavy Cleave - ขยายวงสวิงตามค่า STR)
          const strArc = 2.4 + clamp((prof.str - 30) * 0.012, 0, 0.75);
          armSwing = p < 0.35 ? -1.05 + (p / 0.35) * strArc : (-1.05 + strArc) - ((p - 0.35) / 0.65) * (strArc * 0.65);
          const strSquash = 0.09 + clamp(prof.str * 0.001, 0, 0.09);
          sqX = 1 + sinP * strSquash;
          sqY = 1 - sinP * (strSquash * 0.8);
          rot = sinP * (0.14 + clamp(prof.str * 0.0015, 0, 0.12));
        }

        if(prof.shieldGuard){
          shieldForward = sinP * 6;
        }
      } else if(st === 'cast'){
        bobY = -4 - Math.sin(t * 10) * 2;
        armSwing = -1.25 + Math.sin(t * 16) * 0.15;
      } else if(st === 'hurt'){
        // VIT สูงช่วยให้ตัวละครเซน้อยลงเมื่อโดนตี
        const vitSteadiness = clamp(1 - (prof.vit || 1) * 0.006, 0.35, 1);
        rot = -0.28 * vitSteadiness; bobY = -3 * vitSteadiness;
      } else if(st === 'dead'){
        rot = Math.PI * 0.47; bobY = 4;
      }

      ctx.save();
      ctx.translate(x + facing * lungeX * scale, y + bobY * scale);
      ctx.scale(facing * scale * sqX, scale * sqY);
      ctx.rotate(rot);

      const eq = o.equipped || (!o.isPeer && SL.state && SL.state.get() ? SL.state.get().equipped : null) || {};
      const eqHead = eq.headgear ? SL.store.find('equipItems', eq.headgear) : null;
      const eqArmor = eq.armor ? SL.store.find('equipItems', eq.armor) : null;
      const eqGarment = eq.garment ? SL.store.find('equipItems', eq.garment) : null;
      const stOvr = o.style || {};
      const bodyCol = o.isGhost ? '#63b3ed' : (slot.bodyColor || '#f4c98e');
      const tunicCol = o.isGhost ? '#3182ce' : (stOvr.tunic || (eqArmor && eqArmor.tunicColor) || slot.tunicColor || '#3c689c');
      const capeCol = o.isGhost ? '#90cdf4' : (stOvr.cape || (eqGarment && eqGarment.capeColor) || slot.capeColor || '#c9493b');
      const hatType = stOvr.hat || (eqHead && eqHead.hatType) || slot.hatType || 'helm';
      const earStyle = slot.earStyle || 'cat';

      const cls = o.classId || 'swordman';
      const G = !!o.isGhost;
      const OUT = G ? '#1a365d' : '#10131b';
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      // ผสมสีเข้าหาขาว(k>0)/ดำ(k<0)
      const shade = (hex, k) => {
        const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        if(!m) return hex;
        const n = parseInt(m[1], 16), f = k < 0 ? 0 : 255, a = Math.abs(k);
        const mix = c => Math.round(c + (f - c) * a);
        return 'rgb(' + mix(n >> 16) + ',' + mix((n >> 8) & 255) + ',' + mix(n & 255) + ')';
      };
      // เซลเชดดิ้ง: เติมสีฐาน แล้วคลิปเงาแข็งแนวทแยงด้านล่างขวา + ไฮไลต์ด้านบนซ้าย (path ปัจจุบันยังคงอยู่สำหรับ stroke)
      const cel = (base, bx, by, bw, bh) => {
        ctx.fillStyle = base; ctx.fill();
        if(G) return;
        ctx.save(); ctx.clip();
        const gr = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
        gr.addColorStop(0, 'rgba(255,255,255,0.16)'); gr.addColorStop(0.42, 'rgba(255,255,255,0.16)');
        gr.addColorStop(0.42, 'rgba(0,0,0,0)'); gr.addColorStop(0.62, 'rgba(0,0,0,0)');
        gr.addColorStop(0.62, 'rgba(6,8,26,0.34)'); gr.addColorStop(1, 'rgba(6,8,26,0.34)');
        ctx.fillStyle = gr; ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
        ctx.restore();
      };
      const ink = (w) => { ctx.strokeStyle = OUT; ctx.lineWidth = w || 1.6; ctx.stroke(); };
      const irisCol = isCritMotion ? '#ffe066' : ({ novice:'#7be26b', swordman:'#4fc3ff', thief:'#ffc83d', archer:'#5af0a0', mage:'#c4a1ff' }[cls] || '#4fc3ff');
      const STEEL = G ? '#90cdf4' : '#b3bdd0', GOLD = G ? '#bee3f8' : '#e6b84f', LEATHER = G ? '#63b3ed' : '#6a4a35', DARK = G ? '#2b6cb0' : '#2c3243';
      const walking = st === 'walk';
      const wv = Math.sin(t * (walking ? 10 : 3.2)), wv2 = Math.sin(t * (walking ? 10 : 3.2) - 1.2);

      // 1. ผ้าพันคอปลิวไสว (ด้านหลัง) + หางแมวลายเสือ
      ctx.save();
      const sL = cls === 'thief' ? 1.3 : (cls === 'mage' ? 0.85 : 1);
      const sx = -3, sy = -29;
      const m1 = { x: sx - 9 * sL, y: sy + (walking ? -1 : 3) + wv * 1.8 };
      const m2 = { x: sx - 18 * sL, y: sy + (walking ? -3 : 9) + wv2 * 3.4 };
      ctx.beginPath();
      ctx.moveTo(sx, sy - 2.5); ctx.quadraticCurveTo(m1.x, m1.y - 3.5, m2.x, m2.y - 2);
      ctx.lineTo(m2.x - 5 * sL, m2.y + 3.5 + wv * 1.5); ctx.lineTo(m2.x + 1.5, m2.y + 5.5);
      ctx.quadraticCurveTo(m1.x + 1, m1.y + 5, sx + 1, sy + 3.5); ctx.closePath();
      cel(shade(capeCol, 0.05), m2.x - 6, sy - 6, 22, 16); ink(1.5);
      const tw = Math.sin(t * (st === 'attack' ? 14 : 5.2)) * 0.28;
      const tail = () => { ctx.beginPath(); ctx.moveTo(-6, -12); ctx.bezierCurveTo(-21, -9 + tw * 12, -22, -22, -16 + tw * 6, -28 + tw * 8); };
      ctx.strokeStyle = OUT; ctx.lineWidth = 7.2; tail(); ctx.stroke();
      ctx.strokeStyle = bodyCol; ctx.lineWidth = 5; tail(); ctx.stroke();
      if(!G){ ctx.strokeStyle = shade(bodyCol, -0.24); ctx.lineWidth = 5; ctx.setLineDash([1.4, 3.8]); tail(); ctx.stroke(); ctx.setLineDash([]); }
      ctx.fillStyle = G ? bodyCol : shade(bodyCol, -0.55);
      ctx.beginPath(); ctx.arc(-16 + tw * 6, -28 + tw * 8, 2.9, 0, Math.PI * 2); ctx.fill();
      // อุปกรณ์สะพายหลังตามอาชีพ
      if(cls === 'archer'){
        ctx.save(); ctx.translate(-8, -20); ctx.rotate(-0.35);
        ctx.beginPath(); ctx.roundRect(-3.2, -13, 6.4, 18, 2); cel(LEATHER, -3, -13, 7, 18); ink(1.4);
        ctx.strokeStyle = GOLD; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-3.2, -3); ctx.lineTo(3.2, -3); ctx.stroke();
        [-1.8, 0.2, 2.1].forEach((ax, i) => { ctx.fillStyle = i === 1 ? '#f6e05e' : '#e2e8f0'; ctx.beginPath(); ctx.moveTo(ax - 1, -13); ctx.lineTo(ax, -17.5); ctx.lineTo(ax + 1, -13); ctx.closePath(); ctx.fill(); ink(0.9); });
        ctx.restore();
      } else if(cls === 'thief'){
        [-1, 1].forEach(sd => { ctx.save(); ctx.translate(-5, -15); ctx.rotate(sd * 0.95);
          ctx.beginPath(); ctx.roundRect(-1.2, -14, 2.4, 14, 1); cel('#cbd5e0', -1, -14, 3, 14); ink(1.1);
          ctx.fillStyle = '#805ad5'; ctx.fillRect(-2.4, -1, 4.8, 2.4); ctx.restore(); });
      } else if(cls === 'swordman'){
        const cwv = Math.sin(t * (walking ? 10 : 3.6) - 0.6) * 2;
        ctx.beginPath(); ctx.moveTo(-5, -27); ctx.quadraticCurveTo(-13 - cwv, -17, -14 - cwv * 1.4, -4); ctx.lineTo(-3, -9); ctx.closePath();
        cel(shade(capeCol, -0.2), -15, -27, 12, 22); ink(1.5);
      }
      ctx.restore();

      // 2. ขา (กางเกง + รองเท้าบูทหัวแหลม)
      [-4, 4].forEach((lx, idx) => {
        ctx.save();
        ctx.translate(lx, -11);
        ctx.rotate(idx === 0 ? legSwing : -legSwing);
        ctx.beginPath(); ctx.roundRect(-3.3, 0, 6.6, 12, 2.4); cel(DARK, -3, 0, 7, 12); ink(1.5);
        ctx.beginPath(); ctx.moveTo(-3.7, 5.6); ctx.lineTo(3.7, 5.6); ctx.lineTo(6.6, 12.4); ctx.lineTo(-3.7, 12.4); ctx.closePath();
        cel(cls === 'mage' ? shade(tunicCol, -0.3) : LEATHER, -4, 5, 11, 8); ink(1.5);
        ctx.fillStyle = GOLD; ctx.fillRect(-3.7, 5.4, 7.4, 1.6);
        ctx.restore();
      });

      // 3. ลำตัว: ชุดตามอาชีพ
      const mageRobe = cls === 'mage';
      if(mageRobe){
        const hemSway = Math.sin(t * (walking ? 10 : 2.6)) * 1.6;
        ctx.beginPath(); ctx.moveTo(-8, -28); ctx.lineTo(8, -28); ctx.quadraticCurveTo(10, -16, 12.5, -3 + hemSway * 0.3);
        ctx.quadraticCurveTo(0, -0.5 + hemSway, -12.5, -3 - hemSway * 0.3); ctx.quadraticCurveTo(-10, -16, -8, -28); ctx.closePath();
        cel(tunicCol, -12, -28, 25, 26); ink(1.8);
        ctx.fillStyle = GOLD; ctx.beginPath(); ctx.moveTo(-1.6, -27); ctx.lineTo(1.6, -27); ctx.lineTo(2.4, -2.5); ctx.lineTo(-2.4, -2.5); ctx.closePath(); ctx.fill(); ink(0.9);
        ctx.fillStyle = shade(capeCol, 0); ctx.fillRect(-9.2, -15.5, 18.4, 3.6); ctx.strokeStyle = OUT; ctx.lineWidth = 1; ctx.strokeRect(-9.2, -15.5, 18.4, 3.6);
      } else {
        ctx.beginPath(); ctx.moveTo(-8.5, -28); ctx.lineTo(8.5, -28); ctx.quadraticCurveTo(10.5, -18, 7.2, -10); ctx.lineTo(-7.2, -10); ctx.quadraticCurveTo(-10.5, -18, -8.5, -28); ctx.closePath();
        cel(tunicCol, -10, -28, 21, 18); ink(1.8);
        if(cls === 'swordman'){
          ctx.beginPath(); ctx.moveTo(-8, -28); ctx.lineTo(8, -28); ctx.lineTo(7, -16); ctx.lineTo(0, -12); ctx.lineTo(-7, -16); ctx.closePath();
          cel(STEEL, -8, -28, 16, 16); ink(1.6);
          ctx.strokeStyle = GOLD; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(0, -27); ctx.lineTo(0, -13); ctx.moveTo(-7, -22); ctx.lineTo(7, -22); ctx.stroke();
          ctx.fillStyle = G ? '#bee3f8' : '#ff5a5a'; ctx.beginPath(); ctx.moveTo(0, -24.4); ctx.lineTo(2.2, -22); ctx.lineTo(0, -19.6); ctx.lineTo(-2.2, -22); ctx.closePath(); ctx.fill(); ink(0.9);
        } else if(cls === 'thief'){
          ctx.beginPath(); ctx.moveTo(-8.5, -27); ctx.lineTo(-4, -28); ctx.lineTo(8.5, -14); ctx.lineTo(8, -10.5); ctx.closePath();
          cel(LEATHER, -9, -28, 18, 18); ink(1.3);
          ctx.fillStyle = GOLD; ctx.beginPath(); ctx.arc(0, -20, 1.9, 0, Math.PI * 2); ctx.fill(); ink(0.9);
          ctx.beginPath(); ctx.moveTo(-8.5, -28); ctx.lineTo(-5, -31.5); ctx.lineTo(-1.5, -28); ctx.moveTo(8.5, -28); ctx.lineTo(5, -31.5); ctx.lineTo(1.5, -28); ctx.strokeStyle = OUT; ctx.lineWidth = 1.4; ctx.stroke();
        } else if(cls === 'archer'){
          ctx.beginPath(); ctx.moveTo(-6, -28); ctx.lineTo(0, -19); ctx.lineTo(6, -28); ctx.lineTo(7.5, -12); ctx.lineTo(-7.5, -12); ctx.closePath();
          cel(LEATHER, -8, -28, 16, 16); ink(1.4);
          ctx.strokeStyle = GOLD; ctx.lineWidth = 1; ctx.beginPath();
          for(let i = 0; i < 3; i++){ const yy = -22 + i * 3.2; ctx.moveTo(-2.4, yy); ctx.lineTo(2.4, yy + 2.4); ctx.moveTo(2.4, yy); ctx.lineTo(-2.4, yy + 2.4); }
          ctx.stroke();
        } else {
          ctx.strokeStyle = LEATHER; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(-7, -27); ctx.lineTo(6.5, -12); ctx.stroke();
          ctx.fillStyle = GOLD; ctx.beginPath(); ctx.arc(-0.5, -19.5, 1.6, 0, Math.PI * 2); ctx.fill(); ink(0.8);
        }
        // เข็มขัด + หัวเข็มขัดทอง + ชายผ้า
        ctx.beginPath(); ctx.roundRect(-8.6, -13.2, 17.2, 3.6, 1); cel(LEATHER, -9, -13, 18, 4); ink(1.3);
        ctx.fillStyle = GOLD; ctx.beginPath(); ctx.roundRect(-2.4, -13.8, 4.8, 4.8, 1); ctx.fill(); ink(1);
        if(cls !== 'archer'){
          const fl = Math.sin(t * (walking ? 10 : 3) + 0.8) * 1.3;
          ctx.beginPath(); ctx.moveTo(2.4, -9.8); ctx.lineTo(7, -9.8); ctx.lineTo(7.6 + fl, -3); ctx.lineTo(4 + fl, -4.4); ctx.lineTo(2.4 + fl * 0.5, -3); ctx.closePath();
          cel(shade(capeCol, 0), 2, -10, 6, 7); ink(1.2);
        }
      }
      // ปกคอ
      ctx.beginPath(); ctx.moveTo(-6.5, -28.5); ctx.lineTo(0, -24.5); ctx.lineTo(6.5, -28.5); ctx.lineTo(4, -31); ctx.lineTo(-4, -31); ctx.closePath();
      cel(shade(capeCol, 0.1), -7, -31, 14, 7); ink(1.3);

      // 4. หัว (ย่อสัดส่วนให้ดูโตเต็มวัยขึ้น) + หู + ใบหน้าเท่ ๆ
      ctx.save();
      ctx.translate(0, -37);
      ctx.scale(0.92, 0.92);
      const furHi = shade(bodyCol, 0.22);
      // หูแหลมสูง
      if(earStyle === 'cat' || earStyle === 'fox'){
        const eh = earStyle === 'fox' ? 17 : 13;
        [-1, 1].forEach(sd => {
          const ex = sd * 7.6, tipX = ex + sd * 2.8, tipY = -7 - eh;
          ctx.beginPath(); ctx.moveTo(ex - 5, -4); ctx.lineTo(tipX, tipY); ctx.lineTo(ex + 5, -5.5); ctx.closePath();
          cel(bodyCol, ex - 6, tipY, 12, eh + 4); ink(1.7);
          ctx.beginPath(); ctx.moveTo(ex - 2.6, -5.5); ctx.lineTo(tipX * 0.9 + ex * 0.1, tipY + 5); ctx.lineTo(ex + 2.6, -6.5); ctx.closePath();
          ctx.fillStyle = G ? '#90cdf4' : '#d65a86'; ctx.fill();
          if(earStyle === 'fox' && !G){ ctx.fillStyle = shade(bodyCol, -0.6); ctx.beginPath(); ctx.moveTo(tipX - 2, tipY + 5); ctx.lineTo(tipX, tipY - 0.5); ctx.lineTo(tipX + 2, tipY + 5); ctx.closePath(); ctx.fill(); }
        });
        // รอยฉีกที่หูซ้าย
        ctx.fillStyle = OUT; ctx.beginPath(); ctx.moveTo(-12.2, -15.8); ctx.lineTo(-9.6, -14); ctx.lineTo(-11.6, -12.8); ctx.closePath(); if(cls === 'swordman' || cls === 'thief') ctx.fill();
      }
      // ขนแก้มแหลม
      [-1, 1].forEach(sd => { ctx.beginPath(); ctx.moveTo(sd * 10.2, 0); ctx.lineTo(sd * 15, 5.5); ctx.lineTo(sd * 9.4, 7); ctx.closePath(); cel(bodyCol, -15, 0, 30, 8); ink(1.3); });
      // ใบหน้า
      ctx.beginPath(); ctx.arc(0, 0, 11.5, 0, Math.PI * 2);
      cel(o.hurtFlash ? '#ffffff' : bodyCol, -11.5, -11.5, 23, 23); ink(1.9);
      if(!G){
        ctx.strokeStyle = shade(bodyCol, -0.34); ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(0, -7); ctx.moveTo(-3.6, -10.5); ctx.lineTo(-2.8, -7.6); ctx.moveTo(3.6, -10.5); ctx.lineTo(2.8, -7.6); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(0, 0, 9.7, Math.PI * 1.08, Math.PI * 1.5); ctx.stroke();
      }
      // แผลเป็น (นักดาบ/โจร)
      if(cls === 'swordman' || cls === 'thief'){
        ctx.strokeStyle = G ? '#bee3f8' : '#cf6a62'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(-8.4, -1.6); ctx.lineTo(-5.4, 4.6); ctx.moveTo(-8.4, 1.2); ctx.lineTo(-6.6, 0.8); ctx.moveTo(-7.2, 3.8); ctx.lineTo(-5.4, 3.2); ctx.stroke();
      }
      // ดวงตาแคบเรืองแสง + คิ้วดุ
      const slant = cls === 'mage' ? 0.55 : 1;
      const blink = st !== 'dead' && ((t * 1.1) % 4) > 3.9;
      [-2.4, 5.9].forEach(ex => {
        const d = ex < 1.7 ? 1 : -1;
        if(st === 'dead'){
          ctx.strokeStyle = '#2d3748'; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(ex - 2, -2); ctx.lineTo(ex + 2, 2); ctx.moveTo(ex + 2, -2); ctx.lineTo(ex - 2, 2); ctx.stroke();
          return;
        }
        if(blink || st === 'hurt'){
          ctx.strokeStyle = '#10131b'; ctx.lineWidth = 1.8;
          ctx.beginPath();
          if(st === 'hurt'){ ctx.moveTo(ex - d * 2.6, -2.4); ctx.lineTo(ex + d * 2, 0); ctx.lineTo(ex - d * 2.6, 2.2); }
          else { ctx.moveTo(ex - 3, 0.2); ctx.quadraticCurveTo(ex, 1.6, ex + 3, 0.2); }
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(ex - d * 4, -2.9 * slant - 0.3); ctx.quadraticCurveTo(ex - d * 0.2, -4.4, ex + d * 3.8, 1);
          ctx.quadraticCurveTo(ex + d * 0.4, 2.6, ex - d * 4, -2.9 * slant - 0.3); ctx.closePath();
          ctx.save();
          if(!G){ ctx.shadowColor = irisCol; ctx.shadowBlur = 7; }
          ctx.fillStyle = irisCol; ctx.fill();
          ctx.restore();
          ctx.save(); ctx.clip();
          if(!G){ const ig = ctx.createLinearGradient(0, -3.5, 0, 2.2); ig.addColorStop(0, shade(irisCol, 0.6)); ig.addColorStop(0.5, irisCol); ig.addColorStop(1, shade(irisCol, -0.3)); ctx.fillStyle = ig; ctx.fillRect(ex - 5, -4, 10, 7); }
          ctx.restore();
          ctx.strokeStyle = '#0c0f16'; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = '#0c0f16'; ctx.beginPath(); ctx.ellipse(ex + d * 0.4, -0.3, 0.6, 1.6, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex - d * 1.6, -1.6, 0.9, 0, Math.PI * 2); ctx.fill();
        }
        ctx.strokeStyle = OUT; ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.moveTo(ex - d * 4.6, -5.8 * slant - 1.4 * (1 - slant)); ctx.lineTo(ex + d * 3.4, -3.7 - (st === 'attack' ? 1.2 : 0)); ctx.stroke();
      });
      // จมูก ปาก (ยิ้มมุมปาก+เขี้ยว / อ้าปากตอนโจมตี)
      ctx.fillStyle = '#c95a6f'; ctx.beginPath(); ctx.moveTo(1, 2.4); ctx.lineTo(3.4, 2.4); ctx.lineTo(2.2, 3.6); ctx.closePath(); ctx.fill();
      if(st === 'attack' || st === 'cast' || st === 'hurt'){
        ctx.fillStyle = '#3d1620'; ctx.beginPath(); ctx.moveTo(-0.6, 4.6); ctx.lineTo(5.2, 4.6); ctx.quadraticCurveTo(2.4, 9, -0.6, 4.6); ctx.fill(); ink(0.9);
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, 4.7); ctx.lineTo(1.1, 4.7); ctx.lineTo(0.5, 6.2); ctx.moveTo(3.8, 4.7); ctx.lineTo(4.9, 4.7); ctx.lineTo(4.3, 6.2); ctx.fill();
      } else {
        ctx.strokeStyle = '#4a2b30'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(-0.2, 5.2); ctx.lineTo(3.4, 5.2); ctx.quadraticCurveTo(4.6, 5, 5.2, 3.9); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(2.2, 5.3); ctx.lineTo(3.5, 5.3); ctx.lineTo(2.9, 6.8); ctx.closePath(); ctx.fill(); ink(0.6);
      }
      if(!G){
        ctx.strokeStyle = 'rgba(16,19,27,0.45)'; ctx.lineWidth = 0.8; ctx.beginPath();
        ctx.moveTo(10.4, 3.4); ctx.lineTo(16, 2); ctx.moveTo(10.4, 5.2); ctx.lineTo(16, 6);
        ctx.stroke();
      }

      // หมวก/เครื่องศีรษะประจำอาชีพ
      const flap = Math.sin(t * (walking ? 10 : 3.4) - 0.4);
      if(hatType === 'bandana'){
        ctx.beginPath(); ctx.moveTo(-11.8, -2); ctx.quadraticCurveTo(0, -11, 11.8, -2); ctx.lineTo(11.4, -6.4); ctx.quadraticCurveTo(0, -15.6, -11.4, -6.4); ctx.closePath();
        cel(shade(capeCol, 0), -12, -15, 24, 12); ink(1.5);
        ctx.beginPath(); ctx.moveTo(-10.6, -5); ctx.quadraticCurveTo(-17, -4 + flap * 2, -22, -1 + flap * 4); ctx.lineTo(-18.5, -7 + flap * 2); ctx.quadraticCurveTo(-14.5, -9, -10.8, -8.6); ctx.closePath();
        cel(shade(capeCol, -0.1), -22, -9, 12, 8); ink(1.3);
      } else if(hatType === 'helm'){
        ctx.beginPath(); ctx.moveTo(-12.6, -1.2); ctx.quadraticCurveTo(-14, -17, 0, -17); ctx.quadraticCurveTo(14, -17, 12.6, -1.2);
        ctx.lineTo(9.8, -3.4); ctx.quadraticCurveTo(0, -9.4, -9.8, -3.4); ctx.closePath();
        cel(STEEL, -14, -17, 28, 16); ink(1.8);
        ctx.strokeStyle = GOLD; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-10.6, -5.2); ctx.quadraticCurveTo(0, -10.4, 10.6, -5.2); ctx.stroke();
        ctx.beginPath(); ctx.roundRect(0.4, -9, 3, 10.6, 1.2); cel(STEEL, 0, -9, 3, 11); ink(1.2);
        ctx.beginPath(); ctx.moveTo(-1, -16.4); ctx.bezierCurveTo(-7, -26 - flap, -19, -22 + flap * 2, -24, -9 + flap * 4);
        ctx.bezierCurveTo(-17, -15 + flap * 2, -11, -13, -5, -12.5); ctx.closePath();
        cel(capeCol, -24, -26, 24, 16); ink(1.5);
        ctx.fillStyle = GOLD; ctx.beginPath(); ctx.arc(0, -13.2, 1.7, 0, Math.PI * 2); ctx.fill(); ink(0.9);
      } else if(hatType === 'hood'){
        ctx.beginPath(); ctx.moveTo(-13, 4.5); ctx.bezierCurveTo(-17, -8, -10, -17, -2, -18);
        ctx.quadraticCurveTo(-9, -21 - flap, -19, -18 + flap * 3); ctx.quadraticCurveTo(-3, -27, 9, -17);
        ctx.bezierCurveTo(14, -10, 14, -1, 12.5, 4.5); ctx.quadraticCurveTo(8, -4, 0, -5.2); ctx.quadraticCurveTo(-8, -4, -13, 4.5); ctx.closePath();
        cel(shade('#2d3748', G ? 0 : -0.15), -19, -27, 33, 33); ink(1.8);
        ctx.beginPath(); ctx.moveTo(-9.5, 1.5); ctx.quadraticCurveTo(0, 5.6, 11.5, 1.5); ctx.lineTo(11, 8.5); ctx.quadraticCurveTo(0, 11.5, -9, 8.5); ctx.closePath();
        cel(shade(capeCol, -0.35), -10, 1, 22, 10); ink(1.3);
      } else if(hatType === 'feather'){
        ctx.beginPath(); ctx.moveTo(-12.4, -2.4); ctx.quadraticCurveTo(-12, -16, 2, -15.5); ctx.quadraticCurveTo(12, -14, 12.6, -3.4);
        ctx.quadraticCurveTo(0, -8, -12.4, -2.4); ctx.closePath();
        cel(G ? '#4299e1' : '#2f7a56', -13, -16, 26, 13); ink(1.7);
        ctx.beginPath(); ctx.moveTo(-14.6, -2); ctx.quadraticCurveTo(0, -9.2, 14.8, -3.2); ctx.lineTo(14.2, -1.2); ctx.quadraticCurveTo(0, -7, -14.4, 0); ctx.closePath();
        cel(shade('#2f7a56', -0.25), -15, -9, 30, 9); ink(1.3);
        ctx.beginPath(); ctx.moveTo(-3, -13); ctx.bezierCurveTo(-9, -24 - flap * 2, -19, -24 + flap, -25, -16 + flap * 3); ctx.bezierCurveTo(-18, -17, -11, -15, -3, -11); ctx.closePath();
        cel(G ? '#bee3f8' : '#ffd84a', -25, -26, 22, 14); ink(1.3);
        ctx.strokeStyle = shade('#c9a227', -0.3); ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(-3.5, -12.5); ctx.quadraticCurveTo(-13, -21, -23, -16); ctx.stroke();
      } else if(hatType === 'wizard'){
        ctx.beginPath(); ctx.ellipse(0, -8.4, 17.5, 4.6, -0.06, 0, Math.PI * 2); cel(shade(tunicCol, -0.15), -18, -13, 36, 9); ink(1.7);
        ctx.beginPath(); ctx.moveTo(-9.6, -9); ctx.quadraticCurveTo(-7.5, -20, -2, -26); ctx.quadraticCurveTo(0, -31 - flap, -9, -33 + flap * 2);
        ctx.quadraticCurveTo(5, -29, 4, -23); ctx.quadraticCurveTo(8, -16, 9.6, -9); ctx.quadraticCurveTo(0, -5.5, -9.6, -9); ctx.closePath();
        cel(tunicCol, -10, -33, 20, 26); ink(1.7);
        ctx.fillStyle = GOLD; ctx.beginPath(); ctx.moveTo(-9, -11.6); ctx.quadraticCurveTo(0, -8.2, 9, -11.6); ctx.lineTo(9.4, -14); ctx.quadraticCurveTo(0, -10.6, -9.4, -14); ctx.closePath(); ctx.fill(); ink(1);
        ctx.fillStyle = G ? '#ebf8ff' : '#fff3a8'; ctx.beginPath();
        for(let i = 0; i < 10; i++){ const r = i % 2 ? 1.2 : 2.9, a = -Math.PI / 2 + i * Math.PI / 5; ctx.lineTo(Math.cos(a) * r + 0.4, Math.sin(a) * r - 12.6); }
        ctx.closePath(); ctx.fill(); ink(0.8);
      } else if(hatType === 'crown'){
        ctx.beginPath(); ctx.moveTo(-10.5, -8); ctx.lineTo(-12, -20); ctx.lineTo(-5.5, -13.5); ctx.lineTo(0, -23); ctx.lineTo(5.5, -13.5); ctx.lineTo(12, -20); ctx.lineTo(10.5, -8); ctx.closePath();
        cel(GOLD, -12, -23, 24, 15); ink(1.6);
        ctx.fillStyle = '#b794f4'; ctx.beginPath(); ctx.arc(0, -12.4, 2.5, 0, Math.PI * 2); ctx.fill(); ink(0.9);
      } else if(hatType === 'halo'){
        ctx.save(); ctx.shadowColor = '#fde68a'; ctx.shadowBlur = 6;
        ctx.strokeStyle = '#fef08a'; ctx.lineWidth = 2.8;
        ctx.beginPath(); ctx.ellipse(0, -21 + Math.sin(t * 5) * 1.5, 11, 3.8, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      ctx.restore();

      // 5. แขนขวา + อาวุธหลัก (ไหล่เกราะตามอาชีพ แกว่งไปพร้อมแขน)
      const pauldron = (sd) => {
        ctx.save(); ctx.scale(sd, 1);
        if(cls === 'swordman'){
          ctx.beginPath(); ctx.moveTo(-5.8, 2); ctx.quadraticCurveTo(-6, -6.5, 0.5, -6.8); ctx.quadraticCurveTo(6.5, -6, 6, 2); ctx.closePath();
          cel(STEEL, -6, -7, 12, 9); ink(1.6);
          ctx.strokeStyle = GOLD; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(-5.4, 0); ctx.lineTo(5.6, 0); ctx.stroke();
        } else if(cls === 'thief'){
          ctx.beginPath(); ctx.moveTo(-4.8, 1.6); ctx.lineTo(-4, -5.2); ctx.lineTo(0, -3); ctx.lineTo(1, -8.6); ctx.lineTo(4.8, -2.6); ctx.lineTo(5, 1.6); ctx.closePath();
          cel(LEATHER, -5, -9, 10, 11); ink(1.4);
        } else if(cls === 'archer'){
          ctx.beginPath(); ctx.moveTo(-5, 2); ctx.quadraticCurveTo(-5.4, -5.6, 0, -5.8); ctx.quadraticCurveTo(5.4, -5.6, 5, 2); ctx.closePath();
          cel(LEATHER, -5, -6, 10, 8); ink(1.4);
          ctx.fillStyle = G ? '#bee3f8' : '#7ed957'; ctx.beginPath(); ctx.moveTo(0, -4.6); ctx.quadraticCurveTo(2.4, -2, 0, 0.4); ctx.quadraticCurveTo(-2.4, -2, 0, -4.6); ctx.fill();
        } else if(cls === 'mage'){
          ctx.beginPath(); ctx.arc(0, 0.6, 5.6, Math.PI, 0); ctx.closePath(); cel(shade(capeCol, -0.1), -6, -5, 12, 6); ink(1.4);
          ctx.fillStyle = GOLD; ctx.beginPath(); ctx.arc(0, -3, 1.3, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      };
      ctx.save();
      ctx.translate(6, -23);
      ctx.rotate(armSwing);
      this.drawWeapon(ctx, o.weaponId || 'sword_1h', st, o.attackProg || 0, prof, isCritMotion);
      ctx.beginPath(); ctx.arc(0, 0.8, 4.1, 0, Math.PI * 2); cel(DARK, -4, -3, 8, 8); ink(1.5);
      ctx.fillStyle = GOLD; ctx.fillRect(-3.6, 3, 7.2, 1.6);
      pauldron(1);
      ctx.restore();

      // 6. แขนซ้าย + โล่ (ถ้าสวมโล่และ VIT สูง จะตั้งการ์ดกระแทกไปด้านหน้าขณะโจมตี)
      ctx.save();
      ctx.translate(-6 + shieldForward, -22);
      ctx.rotate(shieldForward > 0 ? 0.15 : -armSwing * 0.5);
      ctx.beginPath(); ctx.arc(0, 1.6, 3.9, 0, Math.PI * 2); cel(DARK, -4, -2, 8, 8); ink(1.5);
      pauldron(-1);
      if(o.hasShield){
        ctx.beginPath(); ctx.moveTo(-7, -6); ctx.lineTo(6, -6); ctx.lineTo(6, 3); ctx.quadraticCurveTo(5, 9, -0.5, 12); ctx.quadraticCurveTo(-6, 9, -7, 3); ctx.closePath();
        cel(shieldForward > 0 ? '#4fd1c5' : '#3b82c4', -7, -6, 13, 18); ink(1.8);
        ctx.strokeStyle = GOLD; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-0.5, -5); ctx.lineTo(-0.5, 10.5); ctx.moveTo(-6, 1.5); ctx.lineTo(5, 1.5); ctx.stroke();
      }
      ctx.restore();

      // 7. ลูกแก้วรูนเวทหมุนรอบตัวตามค่า INT ขณะโจมตีหรือร่ายเวท
      if(!o.isGhost && prof.runeOrbs > 0 && (st === 'attack' || st === 'cast')){
        for(let i = 0; i < prof.runeOrbs; i++){
          const oa = t * 7 + (i * Math.PI * 2) / prof.runeOrbs;
          const ox = Math.cos(oa) * 24;
          const oy = -18 + Math.sin(oa) * 10;
          ctx.fillStyle = '#b794f4';
          ctx.strokeStyle = '#ebf8ff';
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(ox, oy, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }

      ctx.restore();
    },

    // วาดมอนสเตอร์ตามชนิด (dummy, slime/poring, wolf, golem, dragon หรือสไปรท์ที่ผู้ใช้ใส่เอง)
    drawMonster(ctx, x, y, o){
      o = o || {};
      const D = SL.store.get();
      const slot = ((D.modelSlots || {}).monsters || {})[o.monsterId || 'dummy'] || {};
      const wCfg = o.world || {};
      const bodyType = slot.bodyType || wCfg.bodyType || 'slime';
      const color = o.hurtFlash ? '#ffffff' : (slot.color || wCfg.color || '#f27ca4');
      const scale = (o.scale || 1) * (slot.scale || wCfg.scale || 1);
      const facing = o.facing || -1;
      const t = o.animTime || 0;
      const st = o.animState || 'idle';

      this.drawShadow(ctx, x, y + 4 * scale, 18 * scale, 9 * scale, st === 'dead' ? 0.15 : 0.35);

      const customImg = getLoadedImage(slot.spriteUrl);
      if(customImg){
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(facing * scale, scale);
        ctx.drawImage(customImg, -28, -56, 56, 56);
        ctx.restore();
        return;
      }

      ctx.save();
      const bounce = st === 'dead' ? 0 : Math.abs(Math.sin(t * (st === 'walk' ? 9 : 4))) * (bodyType === 'slime' ? 7 : 3);
      ctx.translate(x, y - bounce * scale);
      const sq = st === 'dead' ? 0.6 : (1 + Math.sin(t * 4) * 0.05);
      ctx.scale(facing * scale * sq, scale * (st === 'dead' ? 0.5 : (2 - sq)));
      ctx.strokeStyle = '#181c24';
      ctx.lineWidth = 2;

      if(bodyType === 'dummy'){
        // เสาไม้และหุ่นฟาง
        ctx.fillStyle = '#8c6239';
        ctx.fillRect(-3, -14, 6, 16);
        ctx.fillRect(-16, -28, 32, 5);
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.roundRect(-12, -34, 24, 22, 6); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, -43, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        // เป้าวาดบนอก
        ctx.strokeStyle = '#c53030'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(0, -23, 5, 0, Math.PI * 2); ctx.stroke();
      } else if(bodyType === 'slime'){
        // สไลม์ปอริ่งทรงหยดน้ำใส
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(-18, 0);
        ctx.bezierCurveTo(-20, -18, -8, -32, 0, -35);
        ctx.bezierCurveTo(8, -32, 20, -18, 18, 0);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        // จุดไฮไลท์เงาใส
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.beginPath(); ctx.ellipse(-6, -21, 4, 2.5, -0.5, 0, Math.PI * 2); ctx.fill();
        // ตา
        ctx.fillStyle = '#1a202c';
        ctx.beginPath(); ctx.arc(-4, -11, 2.2, 0, Math.PI * 2); ctx.arc(5, -11, 2.2, 0, Math.PI * 2); ctx.fill();
      } else if(bodyType === 'wolf'){
        // หมาป่าเขี้ยวเงา
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.roundRect(-16, -22, 28, 15, 6); ctx.fill(); ctx.stroke();
        // ขา
        const ls = st === 'walk' ? Math.sin(t * 14) * 5 : 0;
        ctx.fillRect(-13 + ls, -8, 5, 9); ctx.fillRect(6 - ls, -8, 5, 9);
        // หัว + หูตั้ง + ตาแดง
        ctx.beginPath(); ctx.moveTo(6, -28); ctx.lineTo(22, -20); ctx.lineTo(10, -14); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(8, -26); ctx.lineTo(11, -36); ctx.lineTo(15, -25); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ff4d4d';
        ctx.beginPath(); ctx.arc(14, -22, 2, 0, Math.PI * 2); ctx.fill();
      } else if(bodyType === 'golem'){
        // หุ่นเกราะหนา / โกเลมหิน
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.roundRect(-18, -38, 36, 30, 6); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#4a5568';
        ctx.fillRect(-13, -9, 9, 10); ctx.fillRect(4, -9, 9, 10);
        // หัวเกราะ + ตาเรืองแสงสีทอง
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.roundRect(-11, -50, 22, 14, 4); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#f6e05e';
        ctx.fillRect(-6, -45, 12, 3.5);
      } else if(bodyType === 'dragon'){
        // บอสมังกรเพลิงโบราณ
        const wingFlap = Math.sin(t * 7) * 8;
        ctx.fillStyle = '#9b2c2c';
        // ปีกซ้าย-ขวา
        ctx.beginPath(); ctx.moveTo(-8, -30); ctx.lineTo(-34, -48 + wingFlap); ctx.lineTo(-24, -18); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(8, -30); ctx.lineTo(30, -50 + wingFlap); ctx.lineTo(22, -18); ctx.closePath(); ctx.fill(); ctx.stroke();
        // ลำตัวมังกร
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.ellipse(0, -22, 18, 20, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        // แผงอกสีทอง
        ctx.fillStyle = '#f6ad55';
        ctx.beginPath(); ctx.ellipse(2, -20, 9, 13, 0, 0, Math.PI * 2); ctx.fill();
        // หัวมังกร + เขาคู่
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.roundRect(-11, -48, 24, 16, 6); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#f6e05e';
        ctx.beginPath(); ctx.moveTo(-8, -46); ctx.lineTo(-15, -60); ctx.lineTo(-2, -48); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(6, -46); ctx.lineTo(13, -60); ctx.lineTo(1, -48); ctx.closePath(); ctx.fill(); ctx.stroke();
        // ตาไฟ
        ctx.fillStyle = '#ffff66';
        ctx.beginPath(); ctx.arc(5, -40, 2.8, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  };

  /* ============================================================
     2) CAT QUEST 2.5D STORYBOOK WORLD & COMBAT RUNTIME
     - ดึงข้อมูลโซนแผนที่ (zones) และจุดเกิดมอนสเตอร์ (spawns) จาก SL.store.get().worldMap โดยตรง
     - แก้ไขจากหน้าไหน (#formulas, #editor, #models, #data) แผนที่และมอนสเตอร์ในโลกจะอัปเดตทันทีอัตโนมัติ
  ============================================================ */
  const WORLD_W = 2400, WORLD_H = 1700;

  function getCurrentMap(){
    const wm = (SL.store.get() || {}).worldMap || {};
    const maps = Array.isArray(wm.maps) ? wm.maps : [];
    return maps.find(m => m.id === wm.currentMapId) || maps[0] || { id:'map_prontera', name:'พาวทาวน์ & ทุ่งกว้าง', bgColor:'#2d4a3e', roadColor:'#6b5b45', zones: wm.zones || [], spawns: wm.spawns || [], portals: wm.portals || [] };
  }

  function getZones(){
    const m = getCurrentMap();
    if(Array.isArray(m.zones) && m.zones.length) return m.zones;
    const wm = (SL.store.get() || {}).worldMap;
    return (wm && Array.isArray(wm.zones) && wm.zones.length) ? wm.zones : (SL.DEFAULT_DATA.worldMap || {}).zones || [];
  }

  function getSpawns(){
    const m = getCurrentMap();
    if(Array.isArray(m.spawns)) return m.spawns;
    const wm = (SL.store.get() || {}).worldMap;
    return (wm && Array.isArray(wm.spawns)) ? wm.spawns : (SL.DEFAULT_DATA.worldMap || {}).spawns || [];
  }

  function getPortals(){
    const m = getCurrentMap();
    if(Array.isArray(m.portals)) return m.portals;
    const wm = (SL.store.get() || {}).worldMap;
    return (wm && Array.isArray(wm.portals)) ? wm.portals : [];
  }

  // ต้นไม้ หิน และสิ่งก่อสร้าง Pop-up 2.5D บนแผนที่ (เรียง Depth ตามแกน Y)
  const PROPS = [
    { kind:'fountain', x:420, y:850, r:38, label:'น้ำพุฟื้นฟู HP/SP' },
    { kind:'sign', x:590, y:820, r:14, label:'→ ลานฝึกซ้อม & แท่นบูชาบอส' },
    { kind:'tree', x:260, y:690, r:22 }, { kind:'tree', x:310, y:1020, r:22 }, { kind:'tree', x:560, y:670, r:22 },
    { kind:'tree', x:730, y:260, r:24 }, { kind:'tree', x:1220, y:290, r:24 }, { kind:'tree', x:1190, y:560, r:22 },
    { kind:'tree', x:1290, y:1090, r:25 }, { kind:'tree', x:1360, y:1410, r:25 }, { kind:'tree', x:1720, y:1150, r:25 }, { kind:'tree', x:1690, y:1390, r:24 },
    { kind:'rock', x:710, y:580, r:20 }, { kind:'rock', x:1280, y:740, r:24 }, { kind:'rock', x:1540, y:920, r:22 },
    { kind:'pillar', x:1760, y:450, r:20 }, { kind:'pillar', x:2120, y:450, r:20 }, { kind:'pillar', x:1760, y:780, r:20 }, { kind:'pillar', x:2120, y:780, r:20 },
  ];

  /* ============================================================
     3) MULTIPLAYER NETWORK ARCHITECTURE (SL.net + SL.binCodec)
     - Gateway & Chat Server (Go WebSocket :8080/ws) + Simulation Server (Go 30-60Hz :9001)
     - Data Protocol: Binary Wire Format (FlatBuffers 0xC7) ลดขนาดข้อมูลลง 5–10 เท่าเทียบกับ JSON
  ============================================================ */
  const OP = {
    AUTH: 'auth',
    JOIN: 'player_join',
    LEAVE: 'player_leave',
    MOVE: 'move',
    ATTACK: 'attack',
    SKILL: 'skill',
    DAMAGE: 'damage',
    SNAPSHOT: 'snapshot',
    CHAT: 'chat',
    PING: 'ping'
  };

  let netTickAccum = 0;
  let pingTickAccum = 0;

  const net = SL.net = {
    mode: 'simulated', // 'simulated' (จำลองคลัสเตอร์ 30Hz ในเครื่อง) | 'ws' (เชื่อมต่อ Go Gateway + Go Sim จริง)
    protocol: 'flatbuffers-0xC7',
    tickRateHz: 30,
    status: 'connected',
    serverUrl: 'ws://localhost:8080/ws',
    ping: 14,
    lastPingSent: 0,
    socket: null,
    showConnBar: false,
    peers: [],
    chatLog: [
      { sender: 'ระบบคลัสเตอร์', text: 'เชื่อมต่อโหมด FlatBuffers Binary (0xC7) · Go Sim 30Hz พร้อมทำงาน!', time: '12:00', type: 'sys' },
      { sender: 'PoringHunter', text: 'ทุ่งปอริ่งข้างบนมีใครมาฟาร์มไหมครับ!', time: '12:01', type: 'peer' },
      { sender: 'Shadow_Fang', text: 'ระวังวงแดงหมาป่าด้วยนะครับ กลิ้ง Spacebar หลบได้!', time: '12:02', type: 'peer' }
    ],
    listeners: [],
    subscribe(fn){ this.listeners.push(fn); },
    emit(){ this.listeners.forEach(fn => { try{ fn(); }catch(e){} }); },

    // เข้ารหัสแพ็กเก็ตเป็น Binary ArrayBuffer (FlatBuffers 0xC7) ก่อนส่งเสมอ
    encodePacket(op, payload){
      const bc = SL.binCodec;
      if(!bc) return null;
      if(op === OP.MOVE) return bc.encodeMove(payload);
      if(op === OP.ATTACK) return bc.encodeAttack(payload);
      if(op === OP.SKILL) return bc.encodeSkill(payload);
      if(op === OP.CHAT) return bc.encodeChat(payload);
      if(op === OP.PING) return bc.encodePing(payload && payload.clientTime);
      if(op === OP.SNAPSHOT) return bc.encodeWorldSnapshot(payload.tick, payload.peers, payload.mobs);
      return null;
    },

    send(op, payload){
      const buf = this.encodePacket(op, payload);
      if(this.mode === 'ws' && this.socket && this.socket.readyState === WebSocket.OPEN){
        if(buf){
          this.socket.send(buf);
        } else {
          this.socket.send(JSON.stringify({ op: op, payload: payload, t: Date.now() }));
        }
      } else {
        // ในโหมดจำลอง (Simulated 30Hz Host): ถอดรหัส Binary Buffer จริงเพื่อวัดประสิทธิภาพและทดสอบไป-กลับ
        if(buf && SL.binCodec){
          const decoded = SL.binCodec.decode(buf);
          this.mockServerReceive(op, payload, decoded);
        } else {
          this.mockServerReceive(op, payload, null);
        }
      }
    },

    mockServerReceive(op, payload, decoded){
      if(op === OP.CHAT){
        const msg = (decoded && decoded.op === SL.binCodec.OP.CHAT) ? decoded : payload;
        this.chatLog.push({
          sender: msg.sender || 'ผู้เล่น',
          text: msg.text,
          time: new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }),
          type: 'player'
        });
        if(this.chatLog.length > 50) this.chatLog.shift();
        this.emit();
      }
    },

    connect(url){
      if(url) this.serverUrl = url.trim();
      this.mode = 'ws';
      this.status = 'connecting';
      this.emit();
      try {
        if(this.socket) this.socket.close();
        this.socket = new WebSocket(this.serverUrl);
        this.socket.binaryType = 'arraybuffer';
        this.socket.onopen = () => {
          this.status = 'connected';
          this.lastPingSent = Date.now();
          this.send(OP.PING, { clientTime: this.lastPingSent });
          this.chatLog.push({
            sender: 'Go Gateway',
            text: 'เชื่อมต่อ WebSocket Binary (' + this.serverUrl + ') สำเร็จ!',
            time: new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }),
            type: 'sys'
          });
          this.emit();
        };
        this.socket.onmessage = ev => {
          try {
            if(ev.data instanceof ArrayBuffer && SL.binCodec){
              const pkt = SL.binCodec.decode(ev.data);
              if(pkt) this.handleBinaryPacket(pkt);
            } else if(typeof ev.data === 'string'){
              const data = JSON.parse(ev.data);
              this.handleServerPacket(data);
            }
          } catch(e){}
        };
        this.socket.onclose = () => {
          if(this.mode === 'ws'){
            this.chatLog.push({
              sender: 'ระบบคลัสเตอร์',
              text: 'สลับกลับสู่โหมดจำลองคลัสเตอร์ 30Hz ในเครื่อง (Local Binary Sim)',
              time: new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }),
              type: 'sys'
            });
          }
          this.status = 'connected';
          this.mode = 'simulated';
          this.emit();
        };
      } catch(e) {
        this.status = 'connected';
        this.mode = 'simulated';
        this.emit();
      }
    },

    disconnectToSim(){
      if(this.socket){
        try { this.socket.close(); } catch(e){}
        this.socket = null;
      }
      this.mode = 'simulated';
      this.status = 'connected';
      this.emit();
    },

    handleBinaryPacket(pkt){
      const B = SL.binCodec.OP;
      const code = pkt.op || pkt.opcode;
      if(code === B.PONG){
        this.ping = Math.max(1, Math.round(Date.now() - (pkt.clientTs || Date.now())));
      } else if(code === B.WORLD_SNAPSHOT){
        // อัปเดตตำแหน่งเพื่อนในห้องจาก Binary Snapshot (16 bytes/peer)
        if(Array.isArray(pkt.peers)){
          pkt.peers.forEach(sp => {
            if(player && sp.uid === player.uid) return;
            let p = this.peers.find(x => x.uid === sp.uid);
            if(!p){
              p = {
                uid: sp.uid,
                name: 'Player_' + sp.uid,
                classId: sp.classId || 'swordman',
                weaponId: sp.weaponId || 'sword_1h',
                hasShield: false,
                x: sp.x, y: sp.y,
                facing: sp.facing || 1,
                animState: sp.animState || 'idle',
                animTime: 0,
                hp: sp.hp || 500, maxHp: sp.maxHp || 500,
                chatText: '', chatTimer: 0, actionTimer: 2.0, targetUid: 0
              };
              this.peers.push(p);
            } else {
              p.x = sp.x; p.y = sp.y;
              p.facing = sp.facing;
              p.animState = sp.animState;
              p.hp = sp.hp; p.maxHp = sp.maxHp;
            }
          });
        }
        // อัปเดตมอนสเตอร์จาก Authoritative Go Simulation Server หากอยู่ในโหมด WS จริง
        if(this.mode === 'ws' && Array.isArray(pkt.mobs)){
          pkt.mobs.forEach(sm => {
            const m = mobs.find(x => x.uid === sm.uid);
            if(m){
              m.x = sm.x; m.y = sm.y;
              m.hp = sm.hp;
              m.alive = sm.alive;
              m.facing = sm.facing;
              m.animState = sm.animState;
            }
          });
        }
      } else if(code === B.DAMAGE_EVENT){
        const targetMob = mobs.find(x => x.uid === pkt.targetUid);
        if(targetMob){
          targetMob.hp = pkt.hpLeft;
          targetMob.alive = pkt.hpLeft > 0;
          addFloater(targetMob.x, targetMob.y, pkt.miss ? 'MISS' : pkt.dmg, pkt.crit ? '#f6e05e' : '#ffffff', pkt.crit ? 18 : 14, pkt.crit);
        }
      } else if(code === B.CHAT){
        this.chatLog.push({
          sender: pkt.sender || 'Player',
          text: pkt.text || '',
          time: new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }),
          type: 'peer'
        });
        this.emit();
      }
    },

    handleServerPacket(pkt){
      if(pkt.op === OP.MOVE && pkt.payload){
        const p = this.peers.find(x => x.uid === pkt.payload.uid);
        if(p) Object.assign(p, pkt.payload);
      } else if(pkt.op === OP.CHAT){
        this.chatLog.push(pkt.payload);
        this.emit();
      }
    }
  };

  // สร้างเพื่อนร่วมเซิร์ฟเวอร์จำลอง (Simulated Online Peers)
  function initSimulatedPeers(){
    net.peers = [
      {
        uid: 9001,
        name: 'PoringHunter',
        classId: 'novice',
        weaponId: 'unarmed',
        hasShield: false,
        x: 940, y: 390,
        facing: 1,
        animState: 'idle',
        animTime: 0,
        hp: 350, maxHp: 350,
        chatText: '',
        chatTimer: 0,
        actionTimer: 2.0,
        targetUid: 0
      },
      {
        uid: 9002,
        name: 'Shadow_Fang',
        classId: 'thief',
        weaponId: 'dagger',
        hasShield: false,
        x: 1480, y: 1220,
        facing: -1,
        animState: 'idle',
        animTime: 0,
        hp: 1450, maxHp: 1450,
        chatText: '',
        chatTimer: 0,
        actionTimer: 1.5,
        targetUid: 0
      },
      {
        uid: 9003,
        name: 'Grand_Archmage',
        classId: 'mage',
        weaponId: 'staff',
        hasShield: false,
        x: 460, y: 820,
        facing: 1,
        animState: 'idle',
        animTime: 0,
        hp: 850, maxHp: 850,
        chatText: 'พาวทาวน์ น้ำพุฟื้นฟูเลือดไวมาก!',
        chatTimer: 6.0,
        actionTimer: 3.0,
        targetUid: 0
      }
    ];
  }

  let root = null, canvas = null, ctx = null, miniCanvas = null, miniCtx = null;
  let visible = false, raf = 0, lastTs = 0, worldTime = 0;
  const keys = {};
  let cam = { x: 420, y: 850, zoom: 1.2 };
  let player = null, mobs = [], telegraphs = [], projectiles = [], slashes = [], floaters = [], particles = [], groundLoots = [];
  let targetMobId = 0, nextEntityId = 1, portalCd = 0;
  let autoAttack = true, autoSkill = false, godMode = false;
  const UI_REFS = {};

  function dist(ax, ay, bx, by){ return Math.hypot(bx - ax, by - ay); }

  function switchWorldMap(toMapId, toX, toY){
    const D = SL.store.get();
    const wm = D.worldMap;
    if(!wm || !Array.isArray(wm.maps)) return;
    const targetMap = wm.maps.find(m => m.id === toMapId);
    if(!targetMap) return;
    wm.currentMapId = targetMap.id;
    wm.zones = targetMap.zones;
    wm.spawns = targetMap.spawns;
    wm.portals = targetMap.portals;
    mobs = []; telegraphs = []; projectiles = []; slashes = []; groundLoots = [];
    getSpawns().forEach((s, idx) => spawnMonsterInstance(s.monsterId, s.x, s.y, s.x, s.y, s.id || ('sp_' + (idx + 1))));
    if(player){
      player.x = toX !== undefined ? toX : 520;
      player.y = toY !== undefined ? toY : 850;
      player.destX = null; player.destY = null; player.chaseMobUid = 0;
      cam.x = player.x; cam.y = player.y;
      portalCd = 2.0;
      addParticles(player.x, player.y, '#9f7aea', 18, 120);
      addFloater(player.x, player.y - 20, '🌀 วาร์ปสู่ ' + targetMap.name, '#b794f4', 17, true);
    }
    SL.store.save();
  }

  function gainExpAndLoot(mob, mDef){
    const st = SL.state.get();
    const expCfg = mDef.exp || { base: 20, job: 15 };
    st.baseExp = (st.baseExp || 0) + (expCfg.base || 0);
    st.jobExp = (st.jobExp || 0) + (expCfg.job || 0);

    // ตรวจสอบ Base Level Up!
    let reqBase = Math.max(10, C.nextBaseExp(st.baseLv || 50));
    let leveledUp = false, bGuard = 0;
    while(st.baseExp >= reqBase && (st.baseLv || 50) < 99 && bGuard++ < 20){
      st.baseExp -= reqBase;
      st.baseLv = (st.baseLv || 50) + 1;
      reqBase = Math.max(10, C.nextBaseExp(st.baseLv));
      leveledUp = true;
      addFloater(player.x, player.y - 32, '🆙 Base Lv.' + st.baseLv + ' UP! (+แต้มสเตตัส)', '#f6e05e', 20, true);
      addParticles(player.x, player.y - 20, '#f6e05e', 20, 150);
    }

    // ตรวจสอบ Job Level Up!
    let reqJob = Math.max(10, C.nextJobExp(st.jobLv || 10));
    let jGuard = 0;
    while(st.jobExp >= reqJob && (st.jobLv || 10) < 50 && jGuard++ < 20){
      st.jobExp -= reqJob;
      st.jobLv = (st.jobLv || 10) + 1;
      st.skillPoints = (st.skillPoints || 10) + 1;
      reqJob = Math.max(10, C.nextJobExp(st.jobLv));
      leveledUp = true;
      addFloater(player.x, player.y - 48, '🌟 Job Lv.' + st.jobLv + ' UP! (+1 แต้มสกิล)', '#63b3ed', 19, true);
      addParticles(player.x, player.y - 20, '#63b3ed', 18, 140);
    }

    if(groundLoots.length > 30) groundLoots.splice(0, groundLoots.length - 30);

    // ดรอปเหรียญทองและไอเทม/การ์ดลงพื้น (Ground Loot)
    const goldRange = mDef.gold || [5, 15];
    const goldAmt = goldRange[1] > 0 ? Math.round(goldRange[0] + Math.random() * (goldRange[1] - goldRange[0])) : 0;
    if(goldAmt > 0){
      const ang = Math.random() * Math.PI * 2;
      groundLoots.push({
        uid: nextEntityId++,
        kind: 'gold',
        amount: goldAmt,
        name: goldAmt + ' Gold',
        icon: '🪙',
        color: '#f6e05e',
        x: mob.x + Math.cos(ang) * 24,
        y: mob.y + Math.sin(ang) * 16,
        age: 0
      });
    }

    const drops = Array.isArray(mDef.drops) ? mDef.drops : [];
    drops.forEach(dr => {
      if(Math.random() <= (dr.chance || 0.2)){
        const eq = SL.store.find('equipItems', dr.itemId);
        if(eq){
          const ang = Math.random() * Math.PI * 2;
          groundLoots.push({
            uid: nextEntityId++,
            kind: 'item',
            itemId: eq.id,
            name: eq.name,
            icon: eq.icon || '💎',
            color: eq.slot === 'card' ? '#b794f4' : '#68d391',
            x: mob.x + Math.cos(ang) * 34,
            y: mob.y + Math.sin(ang) * 24,
            age: 0
          });
        }
      }
    });

    if(leveledUp) syncPlayerStats();
    SL.state.save();
  }

  function spawnMonsterInstance(monsterId, x, y, homeX, homeY, spawnSlotId){
    const mDef = SL.store.find('monsters', monsterId) || SL.store.get().monsters[0];
    if(!mDef) return null;
    const w = mDef.world || {};
    const m = {
      uid: nextEntityId++,
      spawnSlotId: spawnSlotId || '',
      monsterId: mDef.id,
      name: mDef.name,
      x: x, y: y,
      homeX: homeX !== undefined ? homeX : x,
      homeY: homeY !== undefined ? homeY : y,
      vx: 0, vy: 0,
      facing: -1,
      hp: mDef.maxHp,
      maxHp: mDef.maxHp,
      alive: true,
      respawnLeft: 0,
      attackCd: 0.8 + Math.random() * 0.8,
      skillCd: (w.telegraph && w.telegraph.cd ? w.telegraph.cd * (0.5 + Math.random() * 0.5) : 8),
      casting: false,
      statuses: [],
      animState: 'idle',
      animTime: Math.random() * 10,
      hurtTimer: 0,
    };
    mobs.push(m);
    return m;
  }

  // ซิงก์มอนสเตอร์และจุดเกิดบนแผนที่แบบ Reactive ทันทีเมื่อแก้ข้อมูลจากหน้าใดก็ตาม
  function syncWorldEntities(){
    if(!player) return;
    const spawns = getSpawns();
    const spawnMap = {};
    spawns.forEach((sp, idx) => {
      const sid = sp.id || ('sp_' + (idx + 1));
      spawnMap[sid] = sp;
      let existing = mobs.find(m => m.spawnSlotId === sid);
      if(!existing){
        spawnMonsterInstance(sp.monsterId, sp.x, sp.y, sp.x, sp.y, sid);
      } else {
        if(existing.monsterId !== sp.monsterId){
          existing.monsterId = sp.monsterId;
          const newDef = SL.store.find('monsters', sp.monsterId);
          if(newDef){
            existing.name = newDef.name;
            existing.maxHp = newDef.maxHp;
            existing.hp = newDef.maxHp;
          }
        }
        if(existing.homeX !== sp.x || existing.homeY !== sp.y){
          existing.homeX = sp.x;
          existing.homeY = sp.y;
          existing.x = sp.x;
          existing.y = sp.y;
        }
      }
    });

    // ลบมอนสเตอร์ที่ผูกกับจุดเกิดที่ถูกลบไปแล้ว หรือมอนสเตอร์ที่ถูกลบออกจากฐานข้อมูล
    for(let i = mobs.length - 1; i >= 0; i--){
      const m = mobs[i];
      if(m.spawnSlotId && !spawnMap[m.spawnSlotId]){
        mobs.splice(i, 1);
        continue;
      }
      const mDef = SL.store.find('monsters', m.monsterId);
      if(!mDef){
        mobs.splice(i, 1);
        continue;
      }
      // อัปเดตชื่อและ MaxHP แบบเรียลไทม์โดยรักษาสัดส่วนเลือดปัจจุบันไว้
      m.name = mDef.name;
      if(m.maxHp !== mDef.maxHp && mDef.maxHp > 0){
        const ratio = m.maxHp > 0 ? clamp(m.hp / m.maxHp, 0, 1) : 1;
        m.maxHp = mDef.maxHp;
        m.hp = m.alive ? Math.max(1, Math.round(m.maxHp * ratio)) : 0;
      }
    }
  }

  function initWorld(){
    mobs = []; telegraphs = []; projectiles = []; slashes = []; floaters = []; particles = [];
    getSpawns().forEach((s, idx) => spawnMonsterInstance(s.monsterId, s.x, s.y, s.x, s.y, s.id || ('sp_' + (idx + 1))));
    initSimulatedPeers();
    const P = C.player(SL.state.get(), []);
    player = {
      x: 520, y: 850,
      destX: null, destY: null,
      chaseMobUid: 0,
      facing: 1,
      hp: P.stats.maxHp, sp: P.stats.maxSp,
      alive: true, reviveLeft: 0,
      attackCd: 0,
      rollCd: 0, rollTimer: 0, rollDx: 0, rollDy: 0,
      animState: 'idle', animTime: 0, attackAnimTimer: 0, hurtTimer: 0,
      statuses: [], cd: {},
      kills: 0, totalDmg: 0,
      chatText: '', chatTimer: 0,
      P: P,
    };
    cam.x = player.x; cam.y = player.y;
    const firstDummy = mobs.find(m => m.monsterId === 'dummy') || mobs[0];
    if(firstDummy) targetMobId = firstDummy.uid;
  }

  function syncPlayerStats(){
    if(!player) return;
    const st = SL.state.get();
    if(st.autoSyncStats){
      const d = C.computeDerivedFromRaw(st);
      st.sheet = d.sheet;
    }
    // ล้างสถานะที่สกิลถูกลบหรือไม่ได้เรียนแล้ว
    player.statuses = player.statuses.filter(x => SL.store.skill(x.id) && (st.learned[x.id] || 0) > 0);
    player.P = C.player(st, player.statuses.map(x => ({ id: x.id, lv: x.lv })));
    player.hp = clamp(player.hp, 0, player.P.stats.maxHp);
    player.sp = clamp(player.sp, 0, player.P.stats.maxSp);
    syncWorldEntities();
  }

  function addFloater(x, y, text, color, size, big){
    if(floaters.length > 40) floaters.shift(); // Object pool cap
    floaters.push({
      x: x + (Math.random() * 24 - 12),
      y: y - 34,
      vx: (Math.random() * 28 - 14),
      vy: big ? -68 : -48,
      text: String(text),
      color: color || '#ffffff',
      size: size || 15,
      age: 0,
      life: big ? 1.15 : 0.9,
    });
  }

  function addParticles(x, y, color, count, speed){
    const cnt = Math.min(count || 8, 12);
    if(particles.length > 70) particles.splice(0, cnt);
    for(let i = 0; i < cnt; i++){
      const ang = Math.random() * Math.PI * 2;
      const spd = (0.3 + Math.random() * 0.7) * (speed || 70);
      particles.push({ x: x, y: y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, r: 2.5 + Math.random() * 3, color: color, age: 0, life: 0.35 + Math.random() * 0.25 });
    }
  }

  function addStatus(list, entry){
    for(let i = list.length - 1; i >= 0; i--){
      if(list[i].id === entry.id || (entry.group && list[i].group === entry.group)) list.splice(i, 1);
    }
    list.push(entry);
  }

  function weaponRange(){
    const st = SL.state.get();
    const wp = ((SL.store.get().formulaConfig || {}).weaponProfiles || {})[st.weaponId];
    return wp && wp.range ? wp.range : (st.weaponId === 'bow' || st.weaponId === 'staff' ? 240 : 82);
  }

  /* ---------- ตรวจสอบเงื่อนไขและสั่งใช้สกิลในโลก 2.5D ---------- */
  function whyCannotCast(skill){
    if(!player || !player.alive) return 'ตัวละครล้มอยู่';
    const st = SL.state.get(), lv = st.learned[skill.id] || 0;
    if(lv <= 0) return 'ยังไม่ได้เรียน';
    if(!R.isCastable(skill)) return 'เป็นพาสซีฟ (ทำงานอัตโนมัติ)';
    if(!R.weaponOk(skill, player.P.weapon, player.P.hasShield)) return skill.needShield ? 'ต้องถือโล่ + อาวุธ 1 มือ' : 'อาวุธไม่ตรงเงื่อนไข';
    const u = C.usage(skill, lv);
    if((player.cd[skill.id] || 0) > 0) return 'คูลดาวน์ ' + player.cd[skill.id].toFixed(1) + 's';
    if(player.sp < u.sp) return 'SP ไม่พอ (' + Math.ceil(u.sp) + ')';
    if(u.hp > 0 && player.hp <= u.hp * player.P.stats.maxHp) return 'HP ไม่พอจ่าย';
    return '';
  }

  function damageMob(mob, spec, lv, label, isMagic, skillId){
    if(!mob || !mob.alive) return null;
    const mDef = SL.store.find('monsters', mob.monsterId) || SL.store.get().monsters[0];
    const M = C.monster(mDef, mob.statuses.map(x => ({ id: x.id, lv: x.lv })));
    const atkElem = C.skillElement(skillId || '', spec, player.P);
    const specWithElem = Object.assign({}, spec, { element: atkElem });
    const r = C.roll(specWithElem, lv, player.P, M, Math.random, 0.08);
    if(r.miss){
      addFloater(mob.x, mob.y, 'MISS', '#94a3b8', 13, false);
      return r;
    }
    mob.hp -= r.dmg;
    mob.hurtTimer = 0.16;
    player.totalDmg += r.dmg;
    const col = r.crit ? '#f6e05e' : (r.elemMult > 1.05 ? '#f6ad55' : (isMagic ? '#63b3ed' : '#ffffff'));
    addFloater(mob.x, mob.y, (r.crit ? '💥 CRIT ' : '') + r.dmg, col, r.crit ? 20 : 15, r.crit);
    if(r.elemMult > 1.05){
      const atkInfo = C.elementInfo ? C.elementInfo(atkElem) : { icon:'🔥', name:atkElem };
      const defInfo = C.elementInfo ? C.elementInfo(M.element) : { icon:'', name:M.element };
      addFloater(mob.x, mob.y - 18, atkInfo.icon + ' ชนะธาตุ ' + defInfo.name + ' ×' + r.elemMult.toFixed(2) + '!', '#f6ad55', 13.5, false);
    } else if(r.elemMult < 0.95){
      const defInfo = C.elementInfo ? C.elementInfo(M.element) : { icon:'🛡️', name:M.element };
      addFloater(mob.x, mob.y - 18, '🛡️ ' + defInfo.icon + 'ต้านธาตุ ×' + r.elemMult.toFixed(2), '#94a3b8', 12.5, false);
    }
    addParticles(mob.x, mob.y - 18, col, r.crit ? 12 : 5, r.crit ? 110 : 85);

    if(mob.hp <= 0){
      mob.hp = 0; mob.alive = false;
      mob.respawnLeft = mob.monsterId === 'dummy' ? 1.0 : (SL.store.get().globals.respawnDelay || 3.5) + 1.5;
      mob.statuses = [];
      player.kills++;
      addFloater(mob.x, mob.y - 14, '★ ล้ม ' + mob.name + '!', '#68d391', 16, true);
      addParticles(mob.x, mob.y - 16, '#f6ad55', 16, 120);
      gainExpAndLoot(mob, mDef);
    }
    return r;
  }

  // กดใช้ไอเทมฟื้นฟู/ยาบัฟจากกระเป๋าหรือแถบทางลัด [Q / E]
  function useConsumableInWorld(itemId){
    const it = SL.store.find('equipItems', itemId);
    if(!it || it.slot !== 'consumable' || !it.consumeEffect) return false;
    const qty = SL.state.getQty ? SL.state.getQty(itemId) : 0;
    if(qty <= 0){
      ui.toast('ไม่มี ' + it.name + ' เหลือในกระเป๋า! (หาซื้อเพิ่มได้ในร้านค้า 🏪)');
      return false;
    }
    const ef = it.consumeEffect;
    SL.state.removeItem(itemId, 1);
    if(player){
      const S = player.P.stats;
      if(ef.hpPct){
        const healAmt = Math.round(S.maxHp * ef.hpPct);
        player.hp = Math.min(S.maxHp, player.hp + healAmt);
        addFloater(player.x, player.y - 18, it.icon + ' +' + healAmt + ' HP!', '#68d391', 16, true);
        addParticles(player.x, player.y - 14, '#68d391', 12, 95);
      }
      if(ef.spPct){
        const spAmt = Math.round(S.maxSp * ef.spPct);
        player.sp = Math.min(S.maxSp, player.sp + spAmt);
        addFloater(player.x, player.y - 26, it.icon + ' +' + spAmt + ' SP!', '#63b3ed', 15, true);
        addParticles(player.x, player.y - 14, '#63b3ed', 10, 90);
      }
    }
    ui.toast('ใช้ ' + it.icon + ' ' + it.name + ' แล้ว (เหลือ ' + SL.state.getQty(itemId) + ' ชิ้น)');
    if(UI_REFS.renderInvDrawer) UI_REFS.renderInvDrawer();
    rebuildWorldHotbar();
    return true;
  }

  /* ============================================================
     ระบบโจมตีผู้เล่น (Player Attack Controller) — ปรับท่าโจมตี/เอฟเฟกต์ตามค่าสเตตัสอัตโนมัติ
  ============================================================ */
  function performPlayerAttack(manualTarget, forceSwing){
    if(!player || !player.alive || player.rollTimer > 0) return false;
    if(player.attackCd > 0) return false;

    let target = manualTarget || mobs.find(m => m.uid === targetMobId && m.alive);
    if(!target && !forceSwing){
      // ค้นหามอนสเตอร์ที่ยังมีชีวิตที่ใกล้ที่สุดในระยะ 450px
      let best = null, bestD = 450;
      mobs.forEach(m => {
        if(m.alive){
          const d = dist(player.x, player.y, m.x, m.y);
          if(d < bestD){ bestD = d; best = m; }
        }
      });
      if(best){ target = best; targetMobId = best.uid; }
    }

    const st = SL.state.get();
    const prof = rigRenderer.getAttackProfile(st.rawStats, player.P.stats, st.weaponId, st.hasShield);
    const rng = weaponRange();
    const isMagicWeapon = player.P.weapon && player.P.weapon.damageType === 'magic';
    const basicSpec = isMagicWeapon ? { kind:'magic', terms:[{ stat:'matk', mult:0.65 }] } : C.BASIC;

    // คำนวณขั้นคอมโบและระยะเวลาอนิเมชันจาก ASPD / AGI
    const step = ((player.comboStep || 0) + 1) % prof.comboMax;
    const animDur = clamp(0.78 / Math.max(0.8, player.P.aps), 0.14, 0.36);
    const slashCol = prof.arcaneEnchant ? '#b794f4' : (prof.heavyCleave ? '#f6ad55' : '#ffffff');
    const slashRadius = Math.max(55, rng * 0.85) * prof.weaponScale;

    if(target && dist(player.x, player.y, target.x, target.y) <= rng + 24){
      // โจมตีโดนเป้าหมายในระยะ!
      targetMobId = target.uid;
      player.facing = target.x >= player.x ? 1 : -1;
      player.attackCd = 1 / player.P.aps;
      player.animState = 'attack';
      player.attackAnimDur = animDur;
      player.attackAnimTimer = animDur;
      player.comboStep = step;
      player.isCritSwing = false;

      if(rng > 120){
        projectiles.push({
          x: player.x, y: player.y - 16,
          startX: player.x, startY: player.y - 16,
          targetUid: target.uid,
          targetX: target.x, targetY: target.y - 18,
          age: 0,
          speed: prof.projSpeed,
          pierceTrail: prof.sonicPierce,
          arcane: prof.arcaneEnchant,
          color: isMagicWeapon || prof.arcaneEnchant ? '#63b3ed' : (prof.sonicPierce ? '#68d391' : '#f6e05e'),
          spec: basicSpec, lv: 1, isMagic: isMagicWeapon
        });
      } else {
        const ang = Math.atan2(target.y - player.y, target.x - player.x);
        const hitRes = damageMob(target, basicSpec, 1, 'ตีธรรมดา', isMagicWeapon);
        const isCrit = !!(hitRes && hitRes.crit);
        player.isCritSwing = isCrit;

        if(isCrit){
          // LUK / CRIT -> กากบาทสายฟ้าสีทอง (X-Cross Crit Slash)
          slashes.push({ kind:'x-slash', x: target.x, y: target.y - 18, angle: ang, r: slashRadius * 0.9, color: '#f6e05e', age: 0, life: 0.28 });
        } else if(step === 2 && prof.comboMax === 3){
          // คอมโบขั้นที่ 3 (AGI สูง) -> วงพายุหมุนรอบตัว 360 องศา (+ ทุบพื้นถ้า STR >= 75)
          slashes.push({ kind:'spin', x: player.x, y: player.y - 14, angle: ang, r: slashRadius * 1.1, color: prof.groundSlam ? '#f56565' : '#63b3ed', age: 0, life: 0.26 });
          if(prof.groundSlam){
            slashes.push({ kind:'aoe', x: target.x, y: target.y, r: 78, color: '#f6ad55', age: 0, life: 0.32 });
          }
        } else if(prof.heavyCleave){
          // STR สูง -> คลื่นดาบอัดอากาศ 2 ชั้น
          slashes.push({ kind:'double-arc', x: player.x, y: player.y - 14, angle: ang, r: slashRadius, color: slashCol, age: 0, life: 0.24 });
        } else {
          slashes.push({ kind:'arc', x: player.x, y: player.y - 14, angle: ang, r: slashRadius, color: slashCol, age: 0, life: 0.22 });
        }
      }
      net.send(OP.ATTACK, { attackerUid: player.uid || 1001, targetUid: target.uid, x: player.x, y: player.y });
      return true;
    } else if(target && !forceSwing){
      // ศัตรูอยู่นอกระยะ -> สั่งให้ผู้เล่นเริ่มวิ่งไล่ตามศัตรูตัวนี้อัตโนมัติ
      player.chaseMobUid = target.uid;
      player.destX = null; player.destY = null;
      return false;
    } else {
      // โจมตีฟันลม / ยิงลูกธนูไปข้างหน้า (ปรับท่าตามค่าสเตตัสเช่นกัน)
      player.attackCd = 1 / player.P.aps;
      player.animState = 'attack';
      player.attackAnimDur = animDur;
      player.attackAnimTimer = animDur;
      player.comboStep = step;
      player.isCritSwing = prof.critJumpReady && step === prof.comboMax - 1;
      const ang = player.facing >= 0 ? 0 : Math.PI;
      if(rng > 120){
        projectiles.push({
          x: player.x, y: player.y - 16,
          startX: player.x, startY: player.y - 16,
          targetUid: 0, targetX: player.x + Math.cos(ang) * rng, targetY: player.y + Math.sin(ang) * rng,
          speed: prof.projSpeed,
          pierceTrail: prof.sonicPierce,
          arcane: prof.arcaneEnchant,
          color: isMagicWeapon || prof.arcaneEnchant ? '#63b3ed' : (prof.sonicPierce ? '#68d391' : '#f6e05e'),
          spec: basicSpec, lv: 1, isMagic: isMagicWeapon
        });
      } else if(step === 2 && prof.comboMax === 3){
        slashes.push({ kind:'spin', x: player.x, y: player.y - 14, angle: ang, r: 72 * prof.weaponScale, color: '#63b3ed', age: 0, life: 0.25 });
      } else if(prof.heavyCleave){
        slashes.push({ kind:'double-arc', x: player.x, y: player.y - 14, angle: ang, r: 68 * prof.weaponScale, color: slashCol, age: 0, life: 0.24 });
      } else {
        slashes.push({ kind:'arc', x: player.x, y: player.y - 14, angle: ang, r: 65 * prof.weaponScale, color: slashCol, age: 0, life: 0.22 });
      }
      // ตรวจสอบว่ามีมอนสเตอร์ยืนอยู่ข้างหน้ามุมฟันนี้หรือไม่
      mobs.forEach(m => {
        if(m.alive && dist(player.x, player.y, m.x, m.y) <= rng + 15){
          const mAng = Math.atan2(m.y - player.y, m.x - player.x);
          let diff = Math.abs(mAng - ang);
          while(diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
          if(diff < Math.PI * 0.5 || (step === 2 && prof.comboMax === 3)){
            targetMobId = m.uid;
            const hr = damageMob(m, basicSpec, 1, 'ตีธรรมดา', isMagicWeapon);
            if(hr && hr.crit){
              player.isCritSwing = true;
              slashes.push({ kind:'x-slash', x: m.x, y: m.y - 18, angle: ang, r: 58, color: '#f6e05e', age: 0, life: 0.28 });
            }
          }
        }
      });
      return true;
    }
  }

  function castSkillInWorld(skillId){
    const skill = SL.store.skill(skillId);
    if(!skill || !player) return false;
    const st = SL.state.get(), lv = st.learned[skill.id] || 0;

    // Toggle เปิด/ปิดทันที
    if(skill.type === 'toggle'){
      const idx = player.statuses.findIndex(x => x.id === skill.id);
      if(idx >= 0){
        player.statuses.splice(idx, 1);
        syncPlayerStats();
        addFloater(player.x, player.y, 'ปิด ' + skill.name, '#a0aec0', 13, false);
        return true;
      }
    }

    const reason = whyCannotCast(skill);
    if(reason){ ui.toast(skill.name + ': ' + reason); return false; }

    let target = mobs.find(m => m.uid === targetMobId && m.alive);
    if(!target && skill.damage.kind){
      // หาเป้าหมายที่ใกล้ที่สุดในระยะ 380px
      let bestD = 380;
      mobs.forEach(m => { if(m.alive){ const d = dist(player.x, player.y, m.x, m.y); if(d < bestD){ bestD = d; target = m; targetMobId = m.uid; } } });
      if(!target && !skill.damage.aoe){
        ui.toast('คลิกเลือกมอนสเตอร์เป้าหมายก่อน หรือเข้าใกล้มอนสเตอร์');
        return false;
      }
    }

    // ถ้าเป็นสกิลเป้าเดี่ยวแล้วอยู่ไกลเกินระยะ ให้พุ่ง/เดินเข้าระยะอัตโนมัติ
    const castRange = skill.damage.aoe ? 140 : (skill.damage.kind === 'magic' ? 250 : Math.max(weaponRange() + 30, 115));
    if(target && !skill.damage.aoe && skill.damage.kind && dist(player.x, player.y, target.x, target.y) > castRange){
      player.chaseMobUid = target.uid;
      player.destX = null; player.destY = null;
      player.queuedSkillId = skill.id;
      return false;
    }

    const u = C.usage(skill, lv);
    player.sp = Math.max(0, player.sp - u.sp);
    if(u.hp > 0) player.hp = Math.max(1, player.hp - u.hp * player.P.stats.maxHp);
    if(u.cooldown > 0) player.cd[skill.id] = u.cooldown;
    if(u.usesAction) player.attackCd = Math.max(player.attackCd, 0.35 / Math.max(0.8, player.P.aps));

    player.animState = skill.damage.kind === 'magic' || !skill.damage.kind ? 'cast' : 'attack';
    player.attackAnimTimer = 0.36;
    if(target) player.facing = target.x >= player.x ? 1 : -1;

    addFloater(player.x, player.y - 16, '✨ ' + skill.name + ' Lv.' + lv, '#f6ad55', 14, false);

    // พิเศษ: Backstab พุ่งพริบตาไปด้านหลังเป้าหมาย!
    if(skill.id === 'thBackstab' && target){
      addParticles(player.x, player.y - 15, '#9f7aea', 10, 90);
      const side = target.x >= player.x ? 1 : -1;
      player.x = clamp(target.x + side * 38, 60, WORLD_W - 60);
      player.y = clamp(target.y, 60, WORLD_H - 60);
      player.facing = -side;
      addParticles(player.x, player.y - 15, '#9f7aea', 12, 110);
    }

    // 1. สกิลดาเมจ
    if(skill.damage.kind){
      const isMagic = skill.damage.kind === 'magic';
      if(skill.damage.aoe){
        // วงเวท/วงระเบิด AoE สไตล์ Cat Quest
        const cx = (isMagic && target) ? target.x : player.x;
        const cy = (isMagic && target) ? target.y : player.y;
        const rad = isMagic ? 135 : 120;
        slashes.push({ kind:'aoe', x: cx, y: cy, r: rad, color: isMagic ? '#63b3ed' : '#f56565', age: 0, life: 0.45 });
        mobs.forEach(m => {
          if(m.alive && dist(cx, cy, m.x, m.y) <= rad + 18){
            damageMob(m, skill.damage, lv, skill.name, isMagic, skill.id);
            if(skill.effects.length && u.duration > 0){
              skill.effects.forEach(e => { if(e.appliesTo === 'target') addStatus(m.statuses, { id: skill.id, lv: lv, left: u.duration, group: skill.group }); });
            }
          }
        });
      } else if(target){
        const d = dist(player.x, player.y, target.x, target.y);
        if(isMagic || weaponRange() > 130 || d > 115){
          projectiles.push({
            x: player.x, y: player.y - 18,
            startX: player.x, startY: player.y - 18,
            targetUid: target.uid,
            targetX: target.x, targetY: target.y - 18,
            age: 0,
            speed: isMagic ? 460 : 540,
            color: isMagic ? (skill.id === 'mgFrostNova' ? '#90cdf4' : skill.id === 'mgSoulStrike' ? '#b794f4' : '#f6ad55') : '#ecc94b',
            spec: skill.damage, lv: lv, skill: skill, u: u, isMagic: isMagic
          });
        } else {
          const ang = Math.atan2(target.y - player.y, target.x - player.x);
          slashes.push({ kind:'arc', x: player.x, y: player.y - 14, angle: ang, r: 78, color: skill.id.indexOf('th') === 0 ? '#b794f4' : '#f6e05e', age: 0, life: 0.28 });
          damageMob(target, skill.damage, lv, skill.name, isMagic, skill.id);
          if(skill.effects.length && u.duration > 0){
            skill.effects.forEach(e => { if(e.appliesTo === 'target') addStatus(target.statuses, { id: skill.id, lv: lv, left: u.duration, group: skill.group }); });
          }
        }
      }
    } else if(target && skill.effects.some(e => e.appliesTo === 'target') && u.duration > 0){
      // สกิลดีบัฟล้วน เช่น Provoke
      addStatus(target.statuses, { id: skill.id, lv: lv, left: u.duration, group: skill.group });
      slashes.push({ kind:'aoe', x: target.x, y: target.y, r: 50, color: '#fc8181', age: 0, life: 0.35 });
      addFloater(target.x, target.y, skill.name + '!', '#fc8181', 14, false);
    }

    // 2. สกิลฟื้นฟู HP
    if(skill.heal){
      const amt = val(skill.heal.pctMaxHp, lv) * player.P.stats.maxHp + val(skill.heal.flat, lv);
      const real = Math.max(0, Math.min(player.P.stats.maxHp - player.hp, amt));
      player.hp += real;
      addFloater(player.x, player.y, '+' + Math.round(real) + ' HP', '#68d391', 16, true);
      addParticles(player.x, player.y - 15, '#68d391', 12, 70);
    }

    // 3. บัฟ / Toggle ติดตัวผู้เล่น
    if(skill.type === 'toggle'){
      addStatus(player.statuses, { id: skill.id, lv: lv, left: Infinity, toggle: true, group: skill.group });
      syncPlayerStats();
    } else if(skill.effects.some(e => e.appliesTo !== 'target') && u.duration > 0){
      addStatus(player.statuses, { id: skill.id, lv: lv, left: u.duration, group: skill.group });
      syncPlayerStats();
    }
    return true;
  }

  /* ---------- กลิ้งหลบ (Cat Quest Dodge Roll) ---------- */
  function triggerRoll(){
    if(!player || !player.alive || player.rollTimer > 0 || player.rollCd > 0) return;
    const fc = (SL.store.get().formulaConfig || {}).baseConstants || {};
    let dx = (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) - (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0);
    let dy = (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0) - (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0);
    if(!dx && !dy){ dx = player.facing || 1; dy = 0; }
    const len = Math.hypot(dx, dy) || 1;
    player.rollDx = dx / len; player.rollDy = dy / len;
    player.rollTimer = fc.rollDuration || 0.28;
    player.rollCd = fc.rollCooldown || 1.1;
    player.destX = null; player.destY = null;
    player.chaseMobUid = 0;
    addParticles(player.x, player.y, '#e2e8f0', 8, 60);
    addFloater(player.x, player.y, '💨 กลิ้งหลบ!', '#90cdf4', 13, false);
  }

  /* ---------- อัปเดตโลก 1 เฟรม (High-Performance Tick) ---------- */
  let syncStatAccum = 0;
  function updateWorld(dt){
    if(!player) initWorld();
    worldTime += dt;
    syncStatAccum += dt;
    if(syncStatAccum >= 0.3){
      syncStatAccum = 0;
      syncPlayerStats();
    }
    const st = SL.state.get(), S = player.P.stats;
    const fc = (SL.store.get().formulaConfig || {}).baseConstants || {};

    // คูลดาวน์และสถานะผู้เล่น
    Object.keys(player.cd).forEach(k => { player.cd[k] = Math.max(0, player.cd[k] - dt); if(player.cd[k] <= 0) delete player.cd[k]; });
    player.rollCd = Math.max(0, player.rollCd - dt);
    player.attackCd = Math.max(0, player.attackCd - dt);
    player.attackAnimTimer = Math.max(0, player.attackAnimTimer - dt);
    player.hurtTimer = Math.max(0, player.hurtTimer - dt);
    if(player.chatTimer > 0){ player.chatTimer = Math.max(0, player.chatTimer - dt); if(player.chatTimer <= 0) player.chatText = ''; }

    for(let i = player.statuses.length - 1; i >= 0; i--){
      player.statuses[i].left -= dt;
      if(player.statuses[i].left <= 0){ player.statuses.splice(i, 1); syncPlayerStats(); }
    }

    if(!player.alive){
      player.animState = 'dead';
      player.reviveLeft -= dt;
      if(player.reviveLeft <= 0){
        player.alive = true;
        player.hp = S.maxHp; player.sp = S.maxSp;
        player.x = 420; player.y = 850;
        addFloater(player.x, player.y, '✨ ฟื้นคืนชีพที่น้ำพุพาวทาวน์!', '#68d391', 16, true);
      }
      return;
    }

    // ฟื้น HP/SP ตามธรรมชาติ + โบนัสเมื่อยืนใกล้บ่อน้ำพุเมืองพาวทาวน์
    const nearFountain = dist(player.x, player.y, 420, 850) < 95;
    player.hp = Math.min(S.maxHp, player.hp + (S.hpRegen + (nearFountain ? S.maxHp * 0.18 : 0)) * dt);
    player.sp = Math.min(S.maxSp, player.sp + (S.spRegen + (nearFountain ? S.maxSp * 0.22 : 0)) * dt);

    // Toggle HP/SP drain
    player.statuses.filter(x => x.toggle).forEach(x => {
      const sk = SL.store.skill(x.id); if(!sk) return;
      const u = C.usage(sk, x.lv), off = sk.toggleOff || {};
      if(u.hpDrain > 0) player.hp -= u.hpDrain * S.maxHp * dt;
      if(u.spDrain > 0) player.sp -= u.spDrain * dt;
      if((off.hpBelow && player.hp / S.maxHp < off.hpBelow) || player.sp <= 0){
        player.sp = Math.max(0, player.sp);
        player.statuses = player.statuses.filter(q => q.id !== x.id);
        addFloater(player.x, player.y, sk.name + ' ปิดอัตโนมัติ', '#a0aec0', 12, false);
      }
    });

    // Trigger skills (เช่น สู้ตาย Last Stand, สัญชาตญาณเอาตัวรอด)
    R.visibleSkills(st.classId).forEach(sk => {
      if(sk.type !== 'trigger' || !sk.trigger) return;
      const lv = st.learned[sk.id] || 0; if(!lv) return;
      const on = player.statuses.some(x => x.id === sk.id), hr = player.hp / S.maxHp;
      if(!on && (player.cd[sk.id] || 0) <= 0 && sk.trigger.hpBelow && hr <= sk.trigger.hpBelow && R.weaponOk(sk, player.P.weapon, player.P.hasShield)){
        const dur = val(sk.usage.duration, lv);
        addStatus(player.statuses, { id: sk.id, lv: lv, left: dur > 0 ? dur : Infinity, group: sk.group, trigger: true });
        player.cd[sk.id] = sk.trigger.cooldown || 60;
        addFloater(player.x, player.y, '⚡ ' + sk.name + ' ทำงาน!', '#f6ad55', 15, true);
      } else if(on && hr > (sk.trigger.hpAbove === undefined ? 1 : sk.trigger.hpAbove)){
        player.statuses = player.statuses.filter(x => x.id !== sk.id);
      }
    });

    // การเคลื่อนที่ของผู้เล่น (Roll > WASD > Active Chase > Click-to-Move)
    const moveSpd = (fc.moveSpeedBase || 195) * (1 + clamp((S.aspd - 100) * 0.0025, 0, 0.35));
    if(player.rollTimer > 0){
      const rollDur = fc.rollDuration || 0.28;
      const rollSpd = (fc.rollDistance || 135) / rollDur;
      player.x = clamp(player.x + player.rollDx * rollSpd * dt, 45, WORLD_W - 45);
      player.y = clamp(player.y + player.rollDy * rollSpd * dt, 45, WORLD_H - 45);
      player.rollTimer = Math.max(0, player.rollTimer - dt);
      player.animState = 'roll';
      player.rollProg = 1 - (player.rollTimer / rollDur);
    } else {
      let kx = (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) - (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0);
      let ky = (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0) - (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0);
      if(kx || ky){
        // กดเดินด้วยมือ -> ยกเลิกการคลิกเดินและการไล่ตาม เพื่อความลื่นไหล
        player.destX = null; player.destY = null;
        player.chaseMobUid = 0;
        const len = Math.hypot(kx, ky) || 1;
        player.x = clamp(player.x + (kx / len) * moveSpd * dt, 45, WORLD_W - 45);
        player.y = clamp(player.y + (ky / len) * moveSpd * dt, 45, WORLD_H - 45);
        if(kx) player.facing = kx > 0 ? 1 : -1;
        player.animState = player.attackAnimTimer > 0 ? 'attack' : 'walk';
      } else if(player.chaseMobUid){
        // กำลังวิ่งไล่ตามมอนสเตอร์เป้าหมาย
        const chaseMob = mobs.find(m => m.uid === player.chaseMobUid && m.alive);
        if(chaseMob){
          targetMobId = chaseMob.uid;
          const rng = weaponRange();
          const d = dist(player.x, player.y, chaseMob.x, chaseMob.y);
          if(d > rng + 10){
            const ang = Math.atan2(chaseMob.y - player.y, chaseMob.x - player.x);
            player.x = clamp(player.x + Math.cos(ang) * moveSpd * dt, 45, WORLD_W - 45);
            player.y = clamp(player.y + Math.sin(ang) * moveSpd * dt, 45, WORLD_H - 45);
            player.facing = chaseMob.x >= player.x ? 1 : -1;
            player.animState = player.attackAnimTimer > 0 ? 'attack' : 'walk';
          } else {
            // เข้าถึงระยะโจมตีแล้ว!
            if(player.queuedSkillId){
              const qid = player.queuedSkillId; player.queuedSkillId = '';
              castSkillInWorld(qid);
            } else {
              performPlayerAttack(chaseMob, false);
            }
          }
        } else {
          player.chaseMobUid = 0;
        }
      } else if(player.destX !== null && player.destY !== null){
        const d = dist(player.x, player.y, player.destX, player.destY);
        if(d > 8){
          const ang = Math.atan2(player.destY - player.y, player.destX - player.x);
          player.x = clamp(player.x + Math.cos(ang) * moveSpd * dt, 45, WORLD_W - 45);
          player.y = clamp(player.y + Math.sin(ang) * moveSpd * dt, 45, WORLD_H - 45);
          player.facing = Math.cos(ang) >= 0 ? 1 : -1;
          player.animState = player.attackAnimTimer > 0 ? 'attack' : 'walk';
        } else {
          player.destX = null; player.destY = null;
        }
      } else {
        player.animState = player.attackAnimTimer > 0 ? 'attack' : (player.hurtTimer > 0 ? 'hurt' : 'idle');
      }
    }
    player.animTime += dt;

    // ระบบโจมตีอัตโนมัติ (Auto-Attack)
    if(autoAttack && player.rollTimer <= 0 && player.attackCd <= 0){
      const curTarget = mobs.find(m => m.uid === targetMobId && m.alive);
      if(curTarget && dist(player.x, player.y, curTarget.x, curTarget.y) <= weaponRange() + 20){
        if(autoSkill){
          const rot = st.rotation && st.rotation.length ? st.rotation : R.defaultRotation(st);
          for(let i = 0; i < rot.length; i++){
            const sk = SL.store.skill(rot[i].id);
            if(sk && !whyCannotCast(sk)){
              if(sk.type === 'toggle' && player.statuses.some(x => x.id === sk.id)) continue;
              if(!sk.damage.kind && sk.effects.length && (player.statuses.some(x => x.id === sk.id) || curTarget.statuses.some(x => x.id === sk.id))) continue;
              if(sk.heal && player.hp / S.maxHp > 0.7) continue;
              if(castSkillInWorld(sk.id)) break;
            }
          }
        }
        if(player.attackCd <= 0){
          performPlayerAttack(curTarget, false);
        }
      }
    }

    // อัปเดตมอนสเตอร์ & AI วงแดง Telegraph
    mobs.forEach(m => {
      m.animTime += dt;
      m.hurtTimer = Math.max(0, m.hurtTimer - dt);
      for(let i = m.statuses.length - 1; i >= 0; i--){
        m.statuses[i].left -= dt;
        if(m.statuses[i].left <= 0) m.statuses.splice(i, 1);
      }
      if(!m.alive){
        m.animState = 'dead';
        m.respawnLeft -= dt;
        if(m.respawnLeft <= 0){
          const mDef = SL.store.find('monsters', m.monsterId) || SL.store.get().monsters[0];
          m.alive = true; m.maxHp = mDef.maxHp; m.hp = m.maxHp;
          m.x = m.homeX; m.y = m.homeY; m.casting = false;
        }
        return;
      }

      const mDef = SL.store.find('monsters', m.monsterId) || SL.store.get().monsters[0];
      const w = mDef.world || {};
      const M = C.monster(mDef, m.statuses.map(x => ({ id: x.id, lv: x.lv })));
      const dToPlayer = dist(m.x, m.y, player.x, player.y);
      const aggro = (w.aggroRange || 0) > 0 && dToPlayer <= w.aggroRange && dist(player.x, player.y, 420, 850) > 210;

      m.attackCd = Math.max(0, m.attackCd - dt);
      m.skillCd = Math.max(0, m.skillCd - dt);

      if(m.casting){
        m.animState = 'cast';
        return;
      }

      if(aggro){
        m.facing = player.x >= m.x ? 1 : -1;
        // ท่าไม้ตายวงแดง (Cat Quest Telegraph)
        if(w.telegraph && m.skillCd <= 0 && dToPlayer <= (w.telegraph.radius || 110) + 40){
          m.casting = true;
          m.skillCd = w.telegraph.cd || 8;
          const ang = Math.atan2(player.y - m.y, player.x - m.x);
          telegraphs.push({
            mobUid: m.uid,
            name: w.telegraph.name || 'โจมตีหนัก',
            shape: w.telegraph.shape || 'circle',
            x: w.telegraph.shape === 'circle' && dToPlayer < 60 ? m.x : (w.telegraph.shape === 'circle' ? player.x : m.x),
            y: w.telegraph.shape === 'circle' && dToPlayer < 60 ? m.y : (w.telegraph.shape === 'circle' ? player.y : m.y),
            angle: ang,
            radius: w.telegraph.radius || 110,
            coneAngle: ((w.telegraph.angle || 70) * Math.PI) / 180,
            mult: w.telegraph.mult || 2.0,
            elapsed: 0,
            duration: w.telegraph.castTime || 1.3,
          });
          return;
        }
        // เดินไล่ผู้เล่น
        if(dToPlayer > (w.attackRange || 68) && (w.moveSpeed || 0) > 0){
          const ang = Math.atan2(player.y - m.y, player.x - m.x);
          m.x += Math.cos(ang) * w.moveSpeed * dt;
          m.y += Math.sin(ang) * w.moveSpeed * dt;
          m.animState = 'walk';
        } else {
          m.animState = 'idle';
          if(m.attackCd <= 0 && dToPlayer <= (w.attackRange || 68) + 15){
            m.attackCd = M.interval;
            if(player.rollTimer > 0){
              addFloater(player.x, player.y, 'กลิ้งหลบ!', '#90cdf4', 13, false);
            } else if(!godMode){
              const strike = C.monsterStrike(player.P, M, Math.random);
              if(strike.miss){
                addFloater(player.x, player.y, 'FLEE!', '#94a3b8', 13, false);
              } else {
                player.hp -= strike.dmg;
                player.hurtTimer = 0.2;
                addFloater(player.x, player.y, '-' + strike.dmg + (strike.blocked ? ' (บล็อก!)' : ''), '#fc8181', 15, false);
                if(strike.elemMult !== undefined && strike.elemMult < 0.9){
                  addFloater(player.x, player.y - 16, '🛡️ เกราะต้านธาตุ ×' + strike.elemMult.toFixed(2), '#68d391', 12, false);
                } else if(strike.elemMult !== undefined && strike.elemMult > 1.15){
                  addFloater(player.x, player.y - 16, '⚠️ แพ้ธาตุมอน ×' + strike.elemMult.toFixed(2), '#f6ad55', 12, false);
                }
              }
            }
          }
        }
      } else {
        // เดินกลับจุดเกิดถ้าเดินห่างเกินไป
        const dHome = dist(m.x, m.y, m.homeX, m.homeY);
        if(dHome > 25 && (w.moveSpeed || 0) > 0){
          const ang = Math.atan2(m.homeY - m.y, m.homeX - m.x);
          m.x += Math.cos(ang) * (w.moveSpeed * 0.7) * dt;
          m.y += Math.sin(ang) * (w.moveSpeed * 0.7) * dt;
          m.facing = Math.cos(ang) >= 0 ? 1 : -1;
          m.animState = 'walk';
        } else {
          m.animState = 'idle';
        }
      }
    });

    // อัปเดตเพื่อนร่วมเซิร์ฟเวอร์จำลอง (Simulated Online Peers AI)
    if(net.mode === 'simulated'){
      net.peers.forEach(peer => {
        peer.animTime += dt;
        if(peer.chatTimer > 0){ peer.chatTimer -= dt; if(peer.chatTimer <= 0) peer.chatText = ''; }
        peer.actionTimer -= dt;
        if(peer.actionTimer <= 0){
          peer.actionTimer = 2.0 + Math.random() * 3.5;
          // หาศัตรูในระยะ 280px เพื่อตี
          let nearbyMob = null;
          mobs.forEach(m => { if(m.alive && dist(peer.x, peer.y, m.x, m.y) < 260) nearbyMob = m; });
          if(nearbyMob){
            peer.facing = nearbyMob.x >= peer.x ? 1 : -1;
            peer.animState = 'attack';
            const dmg = 45 + Math.floor(Math.random() * 55);
            nearbyMob.hp = Math.max(0, nearbyMob.hp - dmg);
            addFloater(nearbyMob.x, nearbyMob.y, dmg, '#e2e8f0', 14, false);
            slashes.push({ kind:'arc', x: peer.x, y: peer.y - 14, angle: Math.atan2(nearbyMob.y - peer.y, nearbyMob.x - peer.x), r: 50, color: '#90cdf4', age: 0, life: 0.2 });
          } else {
            // สุ่มเดินเล็กน้อย
            const rx = peer.x + (Math.random() * 80 - 40);
            const ry = peer.y + (Math.random() * 60 - 30);
            peer.x = clamp(rx, 100, WORLD_W - 100);
            peer.y = clamp(ry, 100, WORLD_H - 100);
            peer.animState = 'idle';
          }
        }
      });
    }

    // 30Hz Binary Network Tick (FlatBuffers 0xC7 Wire Serialization)
    netTickAccum += dt;
    pingTickAccum += dt;
    if(netTickAccum >= 1 / 30){
      netTickAccum = 0;
      net.send(OP.MOVE, {
        uid: player.uid || 1001,
        x: player.x,
        y: player.y,
        facing: player.facing,
        animState: player.animState,
        classId: st.classId,
        hp: player.hp,
        maxHp: S.maxHp
      });
      if(net.mode === 'simulated' && SL.binCodec){
        // จำลองการส่ง WorldSnapshot Binary 30Hz จาก Go Simulation Server
        const snapBuf = SL.binCodec.encodeWorldSnapshot(Math.floor(worldTime * 30), net.peers, mobs);
        SL.binCodec.decode(snapBuf);
      }
    }
    if(pingTickAccum >= 2.0){
      pingTickAccum = 0;
      if(net.mode === 'ws'){
        net.lastPingSent = Date.now();
        net.send(OP.PING, { clientTime: net.lastPingSent });
      }
    }

    // อัปเดตวงแดงเตือน (Telegraphs)
    for(let i = telegraphs.length - 1; i >= 0; i--){
      const tg = telegraphs[i];
      const caster = mobs.find(m => m.uid === tg.mobUid);
      if(!caster || !caster.alive){ telegraphs.splice(i, 1); continue; }
      tg.elapsed += dt;
      if(tg.elapsed >= tg.duration){
        caster.casting = false;
        slashes.push({ kind:'aoe', x: tg.x, y: tg.y, r: tg.radius, color: '#fc8181', age: 0, life: 0.35 });
        let hitPlayer = false;
        const dp = dist(tg.x, tg.y, player.x, player.y);
        if(tg.shape === 'circle'){
          hitPlayer = dp <= tg.radius;
        } else if(tg.shape === 'cone'){
          if(dp <= tg.radius){
            let diff = Math.atan2(player.y - tg.y, player.x - tg.x) - tg.angle;
            while(diff > Math.PI) diff -= Math.PI * 2;
            while(diff < -Math.PI) diff += Math.PI * 2;
            hitPlayer = Math.abs(diff) <= tg.coneAngle * 0.5;
          }
        } else if(tg.shape === 'line'){
          const cos = Math.cos(tg.angle), sin = Math.sin(tg.angle);
          const px = player.x - tg.x, py = player.y - tg.y;
          const proj = px * cos + py * sin;
          const perp = Math.abs(-px * sin + py * cos);
          hitPlayer = proj >= 0 && proj <= tg.radius && perp <= 28;
          caster.x = clamp(tg.x + cos * (tg.radius - 20), 50, WORLD_W - 50);
          caster.y = clamp(tg.y + sin * (tg.radius - 20), 50, WORLD_H - 50);
        }

        if(hitPlayer){
          if(player.rollTimer > 0){
            addFloater(player.x, player.y, '✨ หลบวงแดงสำเร็จ!', '#68d391', 16, true);
          } else if(!godMode){
            const mDef = SL.store.find('monsters', caster.monsterId) || SL.store.get().monsters[0];
            const M = C.monster(mDef, caster.statuses.map(x => ({ id: x.id, lv: x.lv })));
            const strike = C.monsterStrike(player.P, M, Math.random);
            const dmg = Math.max(1, Math.round((strike.miss ? M.atk * 0.5 : strike.dmg) * tg.mult));
            player.hp -= dmg;
            player.hurtTimer = 0.3;
            addFloater(player.x, player.y, '💥 ' + tg.name + ' -' + dmg + '!', '#ff4d4d', 19, true);
          }
        }
        telegraphs.splice(i, 1);
      }
    }

    // อัปเดต Projectiles (ป้องกัน NaN เมื่อมอนสเตอร์ตายกลางอากาศ)
    for(let i = projectiles.length - 1; i >= 0; i--){
      const p = projectiles[i];
      p.age = (p.age || 0) + dt;
      if(p.age > 3.0){ projectiles.splice(i, 1); continue; }
      let tx = p.targetX, ty = p.targetY;
      if(p.targetUid){
        const tMob = mobs.find(m => m.uid === p.targetUid && m.alive);
        if(tMob){
          tx = tMob.x; ty = tMob.y - 18;
          p.targetX = tx; p.targetY = ty;
        }
      }
      if(!isFinite(tx) || !isFinite(ty)){
        projectiles.splice(i, 1);
        continue;
      }
      const d = dist(p.x, p.y, tx, ty);
      if(d <= p.speed * dt + 14){
        if(p.targetUid){
          const tMob = mobs.find(m => m.uid === p.targetUid && m.alive);
          if(tMob){
            damageMob(tMob, p.spec, p.lv, p.skill ? p.skill.name : 'โจมตี', p.isMagic, p.skill ? p.skill.id : '');
            if(p.skill && p.skill.effects.length && p.u && p.u.duration > 0){
              p.skill.effects.forEach(e => { if(e.appliesTo === 'target') addStatus(tMob.statuses, { id: p.skill.id, lv: p.lv, left: p.u.duration, group: p.skill.group }); });
            }
          }
        }
        projectiles.splice(i, 1);
      } else {
        const ang = Math.atan2(ty - p.y, tx - p.x);
        p.x += Math.cos(ang) * p.speed * dt;
        p.y += Math.sin(ang) * p.speed * dt;
      }
    }

    // ตรวจสอบการเหยียบวาร์ปพอร์ทัลข้ามแผนที่ (Portal Warp)
    portalCd = Math.max(0, portalCd - dt);
    if(portalCd <= 0 && player.alive){
      const portals = getPortals();
      for(let i = 0; i < portals.length; i++){
        const pt = portals[i];
        if(dist(player.x, player.y, pt.x, pt.y) <= 44){
          switchWorldMap(pt.toMapId, pt.toX, pt.toY);
          break;
        }
      }
    }

    // อัปเดตไอเทมและเหรียญทองที่ดรอปบนพื้น (Magnet Pull & Pickup)
    for(let i = groundLoots.length - 1; i >= 0; i--){
      const lt = groundLoots[i];
      lt.age += dt;
      if(lt.age > 35){ groundLoots.splice(i, 1); continue; }
      const d = dist(player.x, player.y, lt.x, lt.y);
      if(d <= 115 && lt.age > 0.25){
        const ang = Math.atan2(player.y - lt.y, player.x - lt.x);
        const pullSpd = 290;
        lt.x += Math.cos(ang) * pullSpd * dt;
        lt.y += Math.sin(ang) * pullSpd * dt;
      }
      if(d <= 28 && lt.age > 0.2){
        if(lt.kind === 'gold'){
          st.gold = (st.gold || 0) + (lt.amount || 1);
          addFloater(player.x, player.y - 10, '🪙 +' + lt.amount + ' Gold', '#f6e05e', 14, false);
          SL.state.save();
        } else if(lt.kind === 'item' && lt.itemId){
          const newQty = SL.state.addItem ? SL.state.addItem(lt.itemId, 1) : 1;
          addFloater(player.x, player.y - 16, lt.icon + ' ได้รับ ' + lt.name + ' (×' + newQty + ')!', lt.color || '#68d391', 15, true);
          ui.toast('ดรอปไอเทม: ' + lt.icon + ' ' + lt.name + ' (มี ×' + newQty + ' ในกระเป๋า [กด I/B])');
        }
        if(UI_REFS.renderInvDrawer && UI_REFS.invDrawerOpen) UI_REFS.renderInvDrawer();
        rebuildWorldHotbar();
        groundLoots.splice(i, 1);
      }
    }

    // เช็กผู้เล่นล้ม
    if(player.hp <= 0 && player.alive){
      if(godMode){ player.hp = S.maxHp; }
      else {
        player.hp = 0; player.alive = false; player.reviveLeft = 2.5;
        player.statuses = [];
        addFloater(player.x, player.y, '💀 ตัวละครล้ม! รอฟื้น 2.5 วิ', '#fc8181', 18, true);
      }
    }

    // อัปเดตเอฟเฟกต์ Slash, Particles, Floaters
    for(let i = slashes.length - 1; i >= 0; i--){ slashes[i].age += dt; if(slashes[i].age >= slashes[i].life) slashes.splice(i, 1); }
    for(let i = particles.length - 1; i >= 0; i--){
      const pt = particles[i]; pt.age += dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      if(pt.age >= pt.life) particles.splice(i, 1);
    }
    for(let i = floaters.length - 1; i >= 0; i--){
      const fl = floaters[i]; fl.age += dt; fl.x += fl.vx * dt; fl.y += fl.vy * dt; fl.vy += 65 * dt;
      if(fl.age >= fl.life) floaters.splice(i, 1);
    }

    // กล้องเลื่อนตามตัวละครแบบ Smooth Lerp
    cam.x += (player.x - cam.x) * Math.min(1, dt * 8.5);
    cam.y += (player.y - cam.y) * Math.min(1, dt * 8.5);
    if(canvas){
      // กล้องหยุดที่ขอบแมพ ไม่แสดงพื้นที่นอกโลก (ถ้าจอกว้างกว่าโลกให้อยู่กึ่งกลาง)
      const zk = cam.zoom * (canvas.__dpr || 1), vw = canvas.width / zk / 2, vh = canvas.height / zk / 2;
      cam.x = vw * 2 >= WORLD_W ? WORLD_W / 2 : clamp(cam.x, vw, WORLD_W - vw);
      cam.y = vh * 2 >= WORLD_H ? WORLD_H / 2 : clamp(cam.y, vh, WORLD_H - vh);
    }
  }

  /* ============================================================
     4) วาดแผนที่หนังสือนิทานป๊อปอัป (Pop-up Storybook & Frustum Culling)
  ============================================================ */
  function drawProp(ctx, p){
    rigRenderer.drawShadow(ctx, p.x, p.y + 4, p.r * 1.1, p.r * 0.55, 0.28);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.strokeStyle = '#1a202c'; ctx.lineWidth = 2;
    if(p.kind === 'tree'){
      const sway = Math.sin(worldTime * 2.2 + p.x) * 2;
      ctx.fillStyle = '#744210'; ctx.fillRect(-5, -18, 10, 20); ctx.strokeRect(-5, -18, 10, 20);
      ctx.fillStyle = '#38a169';
      ctx.beginPath(); ctx.arc(sway, -34, 22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#48bb78';
      ctx.beginPath(); ctx.arc(-10 + sway, -26, 15, 0, Math.PI * 2); ctx.arc(10 + sway, -26, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else if(p.kind === 'rock'){
      ctx.fillStyle = '#718096';
      ctx.beginPath(); ctx.moveTo(-18, 2); ctx.lineTo(-12, -16); ctx.lineTo(6, -20); ctx.lineTo(18, -6); ctx.lineTo(15, 4); ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else if(p.kind === 'pillar'){
      ctx.fillStyle = '#a0aec0';
      ctx.fillRect(-10, -48, 20, 50); ctx.strokeRect(-10, -48, 20, 50);
      ctx.fillStyle = '#cbd5e0';
      ctx.fillRect(-13, -53, 26, 7); ctx.strokeRect(-13, -53, 26, 7);
    } else if(p.kind === 'fountain'){
      ctx.fillStyle = '#a0aec0';
      ctx.beginPath(); ctx.ellipse(0, 0, 38, 20, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#4299e1';
      ctx.beginPath(); ctx.ellipse(0, -2, 31, 15, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#90cdf4';
      const hJet = 16 + Math.sin(worldTime * 8) * 4;
      ctx.beginPath(); ctx.ellipse(0, -10 - hJet * 0.5, 6, hJet * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    } else if(p.kind === 'sign'){
      ctx.fillStyle = '#744210'; ctx.fillRect(-2.5, -22, 5, 24);
      ctx.fillStyle = '#d69e2e'; ctx.beginPath(); ctx.roundRect(-16, -32, 32, 14, 3); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  function drawSpeechBubble(ctx, x, y, text){
    if(!text) return;
    ctx.save();
    ctx.font = '600 12px "IBM Plex Sans Thai", sans-serif';
    const tw = ctx.measureText(text).width;
    const bw = tw + 16, bh = 24, bx = x - bw * 0.5, by = y - 76;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.strokeStyle = '#181c24'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 6); ctx.fill(); ctx.stroke();
    // หางลูกโป่งคำพูด
    ctx.beginPath(); ctx.moveTo(x - 4, by + bh); ctx.lineTo(x, by + bh + 5); ctx.lineTo(x + 4, by + bh); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#1a202c'; ctx.textAlign = 'center';
    ctx.fillText(text, x, by + 16);
    ctx.restore();
  }

  function renderWorld(){
    if(!canvas || !ctx || !player) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W * 0.5, H * 0.5);
    const ZK = cam.zoom * (canvas.__dpr || 1);
    ctx.scale(ZK, ZK);
    ctx.translate(-cam.x, -cam.y);

    // คำนวณขอบเขตหน้าจอสำหรับ Frustum Culling
    const halfW = (W * 0.5) / ZK + 80;
    const halfH = (H * 0.5) / ZK + 80;
    const viewL = cam.x - halfW, viewR = cam.x + halfW, viewT = cam.y - halfH, viewB = cam.y + halfH;
    const inView = (x, y, r) => x + r >= viewL && x - r <= viewR && y + r >= viewT && y - r <= viewB;

    // 1. พื้นโลก (ปรับสีตามแผนที่ปัจจุบัน Multi-Map)
    const curMap = getCurrentMap();
    ctx.fillStyle = curMap.bgColor || '#2d4a3e';
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1;
    for(let gx = 0; gx <= WORLD_W; gx += 120){ ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, WORLD_H); ctx.stroke(); }
    for(let gy = 0; gy <= WORLD_H; gy += 120){ ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(WORLD_W, gy); ctx.stroke(); }

    ctx.strokeStyle = curMap.roadColor || '#6b5b45'; ctx.lineWidth = 46; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(420, 850); ctx.lineTo(880, 850);
    ctx.lineTo(980, 380);
    ctx.moveTo(880, 850); ctx.lineTo(1520, 1250);
    ctx.moveTo(880, 850); ctx.lineTo(1920, 620);
    ctx.stroke();

    getZones().forEach(z => {
      ctx.save();
      ctx.fillStyle = z.id === 'shrine' ? 'rgba(180, 50, 50, 0.16)' : z.id === 'town' ? 'rgba(72, 187, 120, 0.15)' : 'rgba(255, 255, 255, 0.05)';
      ctx.strokeStyle = z.color;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r, z.r * 0.68, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '700 20px "Chakra Petch", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(z.name, z.x + 2, z.y - z.r * 0.68 - 16);
      ctx.fillStyle = z.color;
      ctx.fillText(z.name, z.x, z.y - z.r * 0.68 - 18);
      ctx.font = '500 13px "IBM Plex Sans Thai", sans-serif';
      ctx.fillStyle = 'rgba(235,240,250,0.78)';
      ctx.fillText(z.sub || '', z.x, z.y - z.r * 0.68 + 2);
      ctx.restore();
    });

    // วาดพอร์ทัลวาร์ปข้ามแมพ (Portals 🌀)
    getPortals().forEach(pt => {
      if(!inView(pt.x, pt.y, 85)) return;
      ctx.save();
      const pulse = 1 + Math.sin(worldTime * 4.5) * 0.08;
      ctx.translate(pt.x, pt.y);
      ctx.fillStyle = 'rgba(159, 122, 234, 0.24)';
      ctx.strokeStyle = pt.color || '#9f7aea';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(0, 0, 42 * pulse, 24 * pulse, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.rotate(worldTime * 1.8);
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = '#e9d8fd'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.font = '600 12.5px "IBM Plex Sans Thai", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e9d8fd';
      ctx.fillText(pt.name || '🌀 วาร์ป', pt.x, pt.y - 32);
      ctx.restore();
    });

    // วาดเหรียญทองและไอเทมดรอปบนพื้น (Ground Loots)
    groundLoots.forEach(lt => {
      if(!inView(lt.x, lt.y, 45)) return;
      ctx.save();
      const bob = Math.sin(worldTime * 6 + lt.uid) * 4;
      rigRenderer.drawShadow(ctx, lt.x, lt.y + 4, 12, 6, 0.35);
      ctx.fillStyle = lt.color || '#f6e05e';
      ctx.strokeStyle = '#1a202c'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(lt.x, lt.y - 8 + bob, lt.kind === 'item' ? 10 : 7.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.font = '600 11px "IBM Plex Sans Thai", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = lt.color || '#f6e05e';
      ctx.fillText((lt.icon || '🪙') + ' ' + lt.name, lt.x, lt.y - 22 + bob);
      ctx.restore();
    });

    if(player.destX !== null && player.destY !== null){
      ctx.save();
      ctx.strokeStyle = '#68d391'; ctx.lineWidth = 2;
      const r = 10 + Math.sin(worldTime * 10) * 3;
      ctx.beginPath(); ctx.ellipse(player.destX, player.destY, r, r * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // 2. วงแดงเตือนพื้นที่โจมตี (Telegraphs)
    telegraphs.forEach(tg => {
      if(!inView(tg.x, tg.y, tg.radius + 20)) return;
      const prog = clamp(tg.elapsed / tg.duration, 0, 1);
      ctx.save();
      ctx.fillStyle = 'rgba(229, 62, 62, 0.22)';
      ctx.strokeStyle = '#ff4d4d';
      ctx.lineWidth = 2.5;
      if(tg.shape === 'circle'){
        ctx.beginPath(); ctx.ellipse(tg.x, tg.y, tg.radius, tg.radius * 0.65, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(245, 101, 101, 0.48)';
        ctx.beginPath(); ctx.ellipse(tg.x, tg.y, tg.radius * prog, tg.radius * 0.65 * prog, 0, 0, Math.PI * 2); ctx.fill();
      } else if(tg.shape === 'cone'){
        ctx.beginPath(); ctx.moveTo(tg.x, tg.y);
        ctx.arc(tg.x, tg.y, tg.radius, tg.angle - tg.coneAngle * 0.5, tg.angle + tg.coneAngle * 0.5);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(245, 101, 101, 0.5)';
        ctx.beginPath(); ctx.moveTo(tg.x, tg.y);
        ctx.arc(tg.x, tg.y, tg.radius * prog, tg.angle - tg.coneAngle * 0.5, tg.angle + tg.coneAngle * 0.5);
        ctx.closePath(); ctx.fill();
      } else if(tg.shape === 'line'){
        ctx.translate(tg.x, tg.y); ctx.rotate(tg.angle);
        ctx.fillRect(0, -24, tg.radius, 48); ctx.strokeRect(0, -24, tg.radius, 48);
        ctx.fillStyle = 'rgba(245, 101, 101, 0.52)';
        ctx.fillRect(0, -24, tg.radius * prog, 48);
      }
      ctx.restore();
    });

    // 3. จัดเรียง Depth (Y-Sorting) ของวัตถุ, มอนสเตอร์, ผู้เล่น และเพื่อนร่วมเซิร์ฟเวอร์
    const renderList = [];
    PROPS.forEach(p => { if(inView(p.x, p.y, p.r * 1.5)) renderList.push({ y: p.y, draw: () => drawProp(ctx, p) }); });

    mobs.forEach(m => {
      if(!inView(m.x, m.y, 80)) return;
      renderList.push({
        y: m.y,
        draw: () => {
          if(!m.alive && m.respawnLeft < 0.8) return;
          if(m.uid === targetMobId && m.alive){
            ctx.save();
            ctx.strokeStyle = '#f6e05e'; ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.ellipse(m.x, m.y + 4, 26, 13, 0, 0, Math.PI * 2); ctx.stroke();
            // วาดเส้นล็อกเป้าลอย
            ctx.fillStyle = '#f6e05e';
            ctx.beginPath(); ctx.moveTo(m.x, m.y - 70); ctx.lineTo(m.x - 6, m.y - 82); ctx.lineTo(m.x + 6, m.y - 82); ctx.closePath(); ctx.fill();
            ctx.restore();
          }
          const mDef = SL.store.find('monsters', m.monsterId) || SL.store.get().monsters[0];
          rigRenderer.drawMonster(ctx, m.x, m.y, {
            monsterId: m.monsterId, world: mDef.world, facing: m.facing,
            animState: m.animState, animTime: m.animTime, hurtFlash: m.hurtTimer > 0
          });
          if(m.alive){
            const bw = 50, bh = 6, bx = m.x - bw * 0.5, by = m.y - 54 * ((mDef.world && mDef.world.scale) || 1);
            ctx.fillStyle = 'rgba(15,20,28,0.85)'; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
            ctx.fillStyle = m.uid === targetMobId ? '#f56565' : '#4fd1c5';
            ctx.fillRect(bx, by, bw * clamp(m.hp / m.maxHp, 0, 1), bh);
            ctx.font = '600 11px "IBM Plex Sans Thai", sans-serif';
            ctx.textAlign = 'center'; ctx.fillStyle = '#e2e8f0';
            const elList = ((SL.store.get().elementSystem || {}).elements) || [];
            const elObj = elList.find(e => e.id === mDef.element);
            const elTag = elObj && elObj.id !== 'neutral' ? (elObj.icon + ' ') : '';
            ctx.fillText(elTag + m.name, m.x, by - 4);
          }
        }
      });
    });

    // วาดเพื่อนร่วมห้องออนไลน์ (Peers)
    net.peers.forEach(peer => {
      if(!inView(peer.x, peer.y, 80)) return;
      renderList.push({
        y: peer.y,
        draw: () => {
          rigRenderer.drawCharacter(ctx, peer.x, peer.y, {
            classId: peer.classId, weaponId: peer.weaponId, hasShield: peer.hasShield,
            facing: peer.facing, animState: peer.animState, animTime: peer.animTime, scale: 0.96
          });
          // ป้ายชื่อผู้เล่นออนไลน์สีเขียว
          const bw = 46, bx = peer.x - bw * 0.5, by = peer.y - 58;
          ctx.font = '600 11.5px "IBM Plex Sans Thai", sans-serif';
          ctx.textAlign = 'center'; ctx.fillStyle = '#68d391';
          ctx.fillText('👤 ' + peer.name, peer.x, by - 4);
          drawSpeechBubble(ctx, peer.x, peer.y, peer.chatText);
        }
      });
    });

    // วาดตัวละครผู้เล่นหลัก (พร้อมหมวก/เกราะ/ออร่าธาตุจากการ์ดที่สวมใส่)
    const st = SL.state.get();
    const eqCfg = st.equipped || {};
    const hgItem = eqCfg.headgear ? SL.store.find('equipItems', eqCfg.headgear) : null;
    const armItem = eqCfg.armor ? SL.store.find('equipItems', eqCfg.armor) : null;
    const baseStyle = ((SL.store.get().modelStyles || {}).classes || {})[st.classId] || {};
    const customStyle = Object.assign({}, baseStyle);
    if(hgItem && hgItem.hatType) customStyle.hat = hgItem.hatType;
    if(armItem && armItem.tunicColor) customStyle.tunic = armItem.tunicColor;

    const auras = [];
    player.statuses.forEach(s => {
      if(s.toggle) auras.push('#b794f4');
      else if(s.trigger) auras.push('#f6ad55');
      else auras.push('#63b3ed');
    });
    renderList.push({
      y: player.y,
      draw: () => {
        const atkProg = player.attackAnimTimer > 0 && player.attackAnimDur > 0
          ? clamp(1 - (player.attackAnimTimer / player.attackAnimDur), 0, 1)
          : undefined;
        rigRenderer.drawCharacter(ctx, player.x, player.y, {
          classId: st.classId, weaponId: st.weaponId, hasShield: st.hasShield,
          style: customStyle,
          rawStats: st.rawStats, sheet: player.P.stats,
          facing: player.facing, animState: player.animState, animTime: player.animTime,
          attackProg: atkProg, comboStep: player.comboStep || 0, isCritSwing: player.isCritSwing,
          rollProg: player.rollProg, hurtFlash: player.hurtTimer > 0, auras: auras
        });
        const bw = 48, bx = player.x - bw * 0.5, by = player.y - 58;
        ctx.fillStyle = 'rgba(15,20,28,0.85)'; ctx.fillRect(bx - 1, by - 1, bw + 2, 10);
        ctx.fillStyle = '#68d391'; ctx.fillRect(bx, by, bw * clamp(player.hp / player.P.stats.maxHp, 0, 1), 4);
        ctx.fillStyle = '#63b3ed'; ctx.fillRect(bx, by + 5, bw * clamp(player.sp / Math.max(1, player.P.stats.maxSp), 0, 1), 3);
        drawSpeechBubble(ctx, player.x, player.y, player.chatText);
      }
    });

    renderList.sort((a, b) => a.y - b.y);
    renderList.forEach(item => item.draw());

    // 4. เอฟเฟกต์ Slash, Projectiles, Particles, Floaters (ปรับรูปทรงตามค่าสเตตัส STR/AGI/INT/DEX/LUK)
    slashes.forEach(sl => {
      const p = clamp(sl.age / sl.life, 0, 1);
      ctx.save();
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = sl.color;
      ctx.lineCap = 'round';
      if(sl.kind === 'aoe'){
        ctx.lineWidth = 4 * (1 - p * 0.5);
        ctx.beginPath(); ctx.ellipse(sl.x, sl.y, sl.r * (0.4 + 0.6 * p), sl.r * 0.65 * (0.4 + 0.6 * p), 0, 0, Math.PI * 2); ctx.stroke();
      } else if(sl.kind === 'x-slash'){
        // LUK / CRIT กากบาทสายฟ้าสีทอง
        ctx.lineWidth = 6 * (1 - p * 0.4);
        const len = sl.r * (0.55 + 0.45 * p);
        ctx.beginPath();
        ctx.moveTo(sl.x - len * 0.7, sl.y - len * 0.7); ctx.lineTo(sl.x + len * 0.7, sl.y + len * 0.7);
        ctx.moveTo(sl.x + len * 0.7, sl.y - len * 0.7); ctx.lineTo(sl.x - len * 0.7, sl.y + len * 0.7);
        ctx.stroke();
      } else if(sl.kind === 'spin'){
        // AGI / ASPD คอมโบขั้น 3 พายุหมุน 360 องศา
        ctx.lineWidth = 8 * (1 - p * 0.5);
        ctx.beginPath(); ctx.arc(sl.x, sl.y, sl.r * (0.7 + 0.3 * p), p * Math.PI, p * Math.PI + Math.PI * 1.65); ctx.stroke();
      } else if(sl.kind === 'double-arc'){
        // STR สูง คลื่นดาบอัดอากาศ 2 ชั้น
        ctx.lineWidth = 8.5 * (1 - p * 0.45);
        ctx.beginPath(); ctx.arc(sl.x, sl.y, sl.r, sl.angle - 0.95, sl.angle + 0.95); ctx.stroke();
        ctx.lineWidth = 4 * (1 - p * 0.5);
        ctx.strokeStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(sl.x, sl.y, sl.r * 0.78, sl.angle - 0.8, sl.angle + 0.8); ctx.stroke();
      } else {
        ctx.lineWidth = 7 * (1 - p * 0.5);
        ctx.beginPath(); ctx.arc(sl.x, sl.y, sl.r, sl.angle - 0.85, sl.angle + 0.85); ctx.stroke();
      }
      ctx.restore();
    });

    projectiles.forEach(pr => {
      ctx.save();
      if(pr.pierceTrail && pr.startX !== undefined){
        // DEX สูง เส้นแสงเลเซอร์ผ่าอากาศตามหลังลูกธนู/มีดบิน
        ctx.strokeStyle = pr.color;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(pr.startX, pr.startY); ctx.lineTo(pr.x, pr.y); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = pr.color; ctx.strokeStyle = '#1a202c'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.isMagic || pr.arcane ? 7 : 4.8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if(pr.arcane){
        ctx.strokeStyle = '#ebf8ff'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(pr.x, pr.y, 10, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    });

    particles.forEach(pt => {
      ctx.save();
      ctx.globalAlpha = clamp(1 - pt.age / pt.life, 0, 1);
      ctx.fillStyle = pt.color;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });

    floaters.forEach(fl => {
      const a = clamp(1 - (fl.age / fl.life) * 0.85, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = '700 ' + fl.size + 'px "Chakra Petch", sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(10,14,20,0.88)';
      ctx.strokeText(fl.text, fl.x, fl.y);
      ctx.fillStyle = fl.color;
      ctx.fillText(fl.text, fl.x, fl.y);
      ctx.restore();
    });

    ctx.restore();

    // 5. Mini-map
    if(miniCtx && miniCanvas){
      const mw = miniCanvas.width, mh = miniCanvas.height;
      miniCtx.clearRect(0, 0, mw, mh);
      miniCtx.fillStyle = '#1a2621'; miniCtx.fillRect(0, 0, mw, mh);
      const sx = mw / WORLD_W, sy = mh / WORLD_H;
      getZones().forEach(z => {
        miniCtx.strokeStyle = z.color; miniCtx.lineWidth = 1;
        miniCtx.beginPath(); miniCtx.arc(z.x * sx, z.y * sy, z.r * sx, 0, Math.PI * 2); miniCtx.stroke();
      });
      mobs.forEach(m => {
        if(!m.alive) return;
        miniCtx.fillStyle = m.uid === targetMobId ? '#f6e05e' : '#fc8181';
        miniCtx.beginPath(); miniCtx.arc(m.x * sx, m.y * sy, m.monsterId === 'boss' ? 4 : 2.5, 0, Math.PI * 2); miniCtx.fill();
      });
      net.peers.forEach(peer => {
        miniCtx.fillStyle = '#63b3ed';
        miniCtx.beginPath(); miniCtx.arc(peer.x * sx, peer.y * sy, 2.8, 0, Math.PI * 2); miniCtx.fill();
      });
      miniCtx.fillStyle = '#68d391';
      miniCtx.beginPath(); miniCtx.arc(player.x * sx, player.y * sy, 3.8, 0, Math.PI * 2); miniCtx.fill();
    }
  }

  /* ============================================================
     5) HUD, CHAT & SKILL HOTBAR UPDATES
  ============================================================ */
  let hotbarSig = '', hotbarBtns = [];
  function rebuildWorldHotbar(){
    if(!UI_REFS.hotbar) return;
    const st = SL.state.get();
    const list = R.visibleSkills(st.classId).filter(s => R.isCastable(s) && st.learned[s.id]);
    const qRed = SL.state.getQty ? SL.state.getQty('pot_red') : 0;
    const qBlue = SL.state.getQty ? SL.state.getQty('pot_blue') : 0;
    const sig = list.map(s => s.id + ':' + st.learned[s.id] + s.name).join('|') + '|pot:' + qRed + ':' + qBlue;
    if(sig === hotbarSig) return;
    hotbarSig = sig; hotbarBtns = [];
    ui.clear(UI_REFS.hotbar);

    // ปุ่มตีธรรมดา (กดปุ่มนี้ หรือกด F / J หรือคลิกที่ตัวมอนสเตอร์)
    const atkBtn = h('button', { class:'sk active', type:'button', style:{ width:'94px' }, onclick: () => performPlayerAttack(null, true) },
      h('b', '[F/J] โจมตี'), h('small', 'ระยะ ' + weaponRange() + 'px'));
    const rollOv = h('div', { class:'cdov' });
    const rollBtn = h('button', { class:'sk', type:'button', style:{ width:'94px' }, onclick: triggerRoll }, rollOv,
      h('b', '[Space] กลิ้ง'), h('small', 'หลบวงแดง (อมตะ)'));
    UI_REFS.rollOv = rollOv;
    UI_REFS.hotbar.appendChild(atkBtn);
    UI_REFS.hotbar.appendChild(rollBtn);

    list.forEach((s, idx) => {
      const lv = st.learned[s.id], u = C.usage(s, lv), ov = h('div', { class:'cdov' });
      const keyNum = idx < 9 ? '[' + (idx + 1) + '] ' : '';
      const b = h('button', { class:'sk', type:'button', onclick: () => castSkillInWorld(s.id) }, ov,
        h('b', keyNum + s.name),
        h('small', 'Lv' + lv + (u.sp ? ' · SP ' + fmt(u.sp, 0) : '') + (u.cooldown ? ' · CD ' + fmt(u.cooldown, 1) + 's' : '')));
      hotbarBtns.push({ id: s.id, keyIdx: idx + 1, b: b, ov: ov, cd: u.cooldown });
      UI_REFS.hotbar.appendChild(b);
    });

    // ปุ่มทางลัดกดใช้ยาแดง [Q] และยาฟ้า [E]
    const redBtn = h('button', { class:'sk' + (qRed <= 0 ? ' off' : ''), type:'button', style:{ width:'94px', borderColor:'#fc8181' }, onclick: () => useConsumableInWorld('pot_red') },
      h('b', '[Q] 🍷 ยาแดง'), h('small', 'HP +35% (×' + qRed + ')'));
    const blueBtn = h('button', { class:'sk' + (qBlue <= 0 ? ' off' : ''), type:'button', style:{ width:'94px', borderColor:'#63b3ed' }, onclick: () => useConsumableInWorld('pot_blue') },
      h('b', '[E] 🧪 ยาฟ้า'), h('small', 'SP +40% (×' + qBlue + ')'));
    UI_REFS.hotbar.appendChild(redBtn);
    UI_REFS.hotbar.appendChild(blueBtn);
  }

  function updateWorldHUD(){
    if(!player || !UI_REFS.hpBar) return;
    const S = player.P.stats, st = SL.state.get();
    const hpPct = clamp(player.hp / S.maxHp * 100, 0, 100);
    const spPct = clamp(player.sp / Math.max(1, S.maxSp) * 100, 0, 100);
    UI_REFS.hpBar.firstChild.style.width = hpPct + '%';
    UI_REFS.hpBar.lastChild.textContent = 'HP ' + Math.round(player.hp) + ' / ' + Math.round(S.maxHp);
    UI_REFS.spBar.firstChild.style.width = spPct + '%';
    UI_REFS.spBar.lastChild.textContent = 'SP ' + Math.round(player.sp) + ' / ' + Math.round(S.maxSp);

    const kName = (SL.store.klass(st.classId) || {}).name || st.classId;
    const reqB = C.nextBaseExp(st.baseLv || 50), reqJ = C.nextJobExp(st.jobLv || 10);
    const pEl = C.elementInfo ? C.elementInfo(player.P.attackElement) : { icon:'⚪', name:'ไร้ธาตุ' };
    const defEl = C.elementInfo ? C.elementInfo(player.P.defenseElement || 'neutral') : { icon:'⚪', name:'ไร้ธาตุ' };
    UI_REFS.heroTitle.textContent = kName + ' · Lv.' + (st.baseLv || 50) + ' / Job ' + (st.jobLv || 10);
    if(UI_REFS.heroSub) UI_REFS.heroSub.textContent = 'ATK ' + Math.round(S.atk) + ' · โจมตี:' + pEl.icon + pEl.name + ' · เกราะ:' + defEl.icon + defEl.name;
    const bPct = clamp((st.baseExp || 0) / Math.max(1, reqB) * 100, 0, 100), jPct = clamp((st.jobExp || 0) / Math.max(1, reqJ) * 100, 0, 100);
    if(UI_REFS.baseBar){ UI_REFS.baseBar.firstChild.style.width = bPct + '%'; UI_REFS.baseBar.lastChild.textContent = 'Base ' + bPct.toFixed(1) + '%'; UI_REFS.baseBar.title = 'BaseEXP ' + Math.floor(st.baseExp || 0) + ' / ' + reqB; }
    if(UI_REFS.jobBar){ UI_REFS.jobBar.firstChild.style.width = jPct + '%'; UI_REFS.jobBar.lastChild.textContent = 'Job ' + jPct.toFixed(1) + '%'; UI_REFS.jobBar.title = 'JobEXP ' + Math.floor(st.jobExp || 0) + ' / ' + reqJ; }
    if(UI_REFS.expGoldBadge) UI_REFS.expGoldBadge.textContent = '🪙 ' + (st.gold || 0).toLocaleString() + ' Zeny';

    if(UI_REFS.rollOv){
      const fc = (SL.store.get().formulaConfig || {}).baseConstants || {};
      UI_REFS.rollOv.style.transform = 'scaleY(' + clamp(player.rollCd / (fc.rollCooldown || 1.1), 0, 1) + ')';
    }
    hotbarBtns.forEach(hb => {
      const cdv = player.cd[hb.id] || 0;
      const on = player.statuses.some(x => x.id === hb.id);
      hb.ov.style.transform = 'scaleY(' + (hb.cd > 0 ? clamp(cdv / hb.cd, 0, 1) : 0) + ')';
      hb.b.classList.toggle('active', on);
      hb.b.classList.toggle('off', !!whyCannotCast(SL.store.skill(hb.id)) && !on);
    });

    const tMob = mobs.find(m => m.uid === targetMobId && m.alive);
    if(tMob){
      const mDef = SL.store.find('monsters', tMob.monsterId) || {};
      const mEl = C.elementInfo ? C.elementInfo(mDef.element || 'neutral') : { icon:'⚪', name:'ไร้ธาตุ' };
      const curMult = C.elementMult(player.P.attackElement || 'neutral', mDef.element || 'neutral');
      const multTag = curMult > 1.05 ? ' (ชนะทาง ×' + curMult.toFixed(2) + '!)' : (curMult < 0.95 ? ' (ต้านทาน ×' + curMult.toFixed(2) + ')' : ' (×1.0)');
      const rel = C.elementRelations ? C.elementRelations(mDef.element || 'neutral') : { weakToAttackers:[] };
      const weakTxt = rel.weakToAttackers.length
        ? ' · แพ้ธาตุ: ' + rel.weakToAttackers.slice(0, 3).map(w => w.icon + w.name + '×' + w.mult).join(', ')
        : '';
      UI_REFS.targetInfo.textContent = '🎯 ' + tMob.name + ' [' + mEl.icon + mEl.name + '] HP ' + Math.round(tMob.hp) + '/' + Math.round(tMob.maxHp) + multTag + weakTxt;
    } else {
      UI_REFS.targetInfo.textContent = '🎯 คลิกมอนสเตอร์ หรือกด [F/J] เพื่อล็อกเป้าและดูจุดอ่อนธาตุ';
    }

    if(UI_REFS.netBadge){
      const peerCount = net.peers.length + 1;
      const modeTxt = net.mode === 'ws' ? 'Go WS' : 'Sim Cluster';
      UI_REFS.netBadge.textContent = '🟢 ' + modeTxt + ': ' + net.ping + 'ms · ' + peerCount + ' คน';
    }
    if(UI_REFS.protoBadge && SL.binCodec){
      const stc = SL.binCodec.stats;
      const savePct = Math.round(SL.binCodec.savingsRatio() * 100);
      const kbBin = ((stc.binaryBytes || 0) / 1024).toFixed(1);
      const kbJson = ((stc.jsonEquivBytes || 0) / 1024).toFixed(1);
      UI_REFS.protoBadge.textContent = '⚡ FlatBuffers 0xC7 (' + net.tickRateHz + 'Hz) · ' + kbBin + 'KB แทน JSON ' + kbJson + 'KB (ประหยัด ' + savePct + '%)';
    }
  }

  function loop(ts){
    raf = 0; if(!visible) return;
    const dt = lastTs ? Math.min(0.06, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    try {
      updateWorld(dt);
      renderWorld();
      updateWorldHUD();
    } catch(err){
      console.error('[WorldLoop Error]', err);
    }
    if(visible) raf = requestAnimationFrame(loop);
  }

  /* ============================================================
     6) MOUNT PAGE (#world)
  ============================================================ */
  ui.pages.world = {
    mount(r){
      root = r;
      initWorld();

      canvas = h('canvas', { width: 1280, height: 720 });
      ctx = canvas.getContext('2d');
      miniCanvas = h('canvas', { width: 150, height: 106, style:{ borderRadius:'6px', border:'1px solid var(--border)', cursor:'pointer' } });
      miniCtx = miniCanvas.getContext('2d');

      // คลิกบน Canvas เพื่อโจมตีมอนสเตอร์ หรือเดินไปยังจุดหมาย
      canvas.addEventListener('pointerdown', ev => {
        const rect = canvas.getBoundingClientRect();
        const sx = (ev.clientX - rect.left) * (canvas.width / rect.width);
        const sy = (ev.clientY - rect.top) * (canvas.height / rect.height);
        const wx = (sx - canvas.width * 0.5) / (cam.zoom * (canvas.__dpr || 1)) + cam.x;
        const wy = (sy - canvas.height * 0.5) / (cam.zoom * (canvas.__dpr || 1)) + cam.y;

        // คำนวณ Hitbox มอนสเตอร์แบบแม่นยำและครอบคลุม
        let clickedMob = null, bestD = 65;
        mobs.forEach(m => {
          if(m.alive){
            const mDef = SL.store.find('monsters', m.monsterId) || {};
            const sc = (mDef.world && mDef.world.scale) || 1;
            const cy = m.y - 25 * sc;
            const d = dist(wx, wy, m.x, cy);
            if(d < bestD * sc){
              bestD = d / sc;
              clickedMob = m;
            }
          }
        });

        if(clickedMob){
          targetMobId = clickedMob.uid;
          player.chaseMobUid = clickedMob.uid;
          player.destX = null; player.destY = null;
          // ตีทันทีถ้าอยู่ในระยะ หรือเริ่มวิ่งเข้าหาทันที!
          performPlayerAttack(clickedMob, false);
        } else {
          // คลิกที่พื้น: เคลื่อนที่ไปจุดที่คลิก
          player.chaseMobUid = 0;
          player.destX = clamp(wx, 45, WORLD_W - 45);
          player.destY = clamp(wy, 45, WORLD_H - 45);
        }
      });

      canvas.addEventListener('wheel', ev => {
        ev.preventDefault();
        cam.zoom = clamp(cam.zoom + (ev.deltaY < 0 ? 0.1 : -0.1), 0.65, 1.6);
      }, { passive: false });

      miniCanvas.addEventListener('pointerdown', ev => {
        const rect = miniCanvas.getBoundingClientRect();
        const wx = ((ev.clientX - rect.left) / rect.width) * WORLD_W;
        const wy = ((ev.clientY - rect.top) / rect.height) * WORLD_H;
        player.chaseMobUid = 0;
        player.destX = clamp(wx, 50, WORLD_W - 50);
        player.destY = clamp(wy, 50, WORLD_H - 50);
      });

      // คีย์บอร์ด WASD, Spacebar กลิ้งหลบ, F/J โจมตี, 1–9 ใช้สกิล, Q/E ยา, I/B กระเป๋าอุปกรณ์, Enter พิมพ์แชท
      window.addEventListener('keydown', ev => {
        if(!visible) return;
        const tag = (ev.target && ev.target.tagName) || '';
        if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'){
          if(ev.code === 'Enter' && ev.target === UI_REFS.chatInput){
            sendChatMsg();
          }
          return;
        }

        if(ev.altKey && (ev.code === 'KeyE' || ev.code === 'KeyQ')){
          ev.preventDefault();
          if(UI_REFS.toggleInvDrawer) UI_REFS.toggleInvDrawer();
          return;
        }
        keys[ev.code] = true;
        if(ev.code === 'Space'){
          ev.preventDefault();
          triggerRoll();
        } else if(ev.code === 'KeyF' || ev.code === 'KeyJ' || ev.code === 'KeyZ'){
          ev.preventDefault();
          performPlayerAttack(null, true);
        } else if(ev.code === 'KeyQ'){
          ev.preventDefault();
          useConsumableInWorld('pot_red');
        } else if(ev.code === 'KeyE'){
          ev.preventDefault();
          useConsumableInWorld('pot_blue');
        } else if(ev.code === 'KeyI' || ev.code === 'KeyB'){
          ev.preventDefault();
          if(UI_REFS.toggleInvDrawer) UI_REFS.toggleInvDrawer();
        } else if(ev.code === 'Tab'){
          ev.preventDefault();
          let best = null, bestD = 500;
          mobs.forEach(m => { if(m.alive && m.uid !== targetMobId){ const d = dist(player.x, player.y, m.x, m.y); if(d < bestD){ bestD = d; best = m; } } });
          if(best) targetMobId = best.uid;
        } else if(/^Digit[1-9]$/.test(ev.code)){
          const idx = parseInt(ev.code.slice(5), 10) - 1;
          if(hotbarBtns[idx]) castSkillInWorld(hotbarBtns[idx].id);
        } else if(ev.code === 'Enter'){
          ev.preventDefault();
          if(UI_REFS.chatInput) UI_REFS.chatInput.focus();
        }
      });
      window.addEventListener('keyup', ev => { keys[ev.code] = false; });

      UI_REFS.hpBar = h('div', { class:'bar', style:{ width:'165px' } }, h('i'), h('span'));
      UI_REFS.spBar = h('div', { class:'bar sp', style:{ width:'145px' } }, h('i'), h('span'));
      UI_REFS.heroTitle = h('div', { class:'small', style:{ fontWeight:600 } });
      UI_REFS.expGoldBadge = h('span', { class:'chip ok', style:{ fontSize:'11.5px' } }, '🪙 250 Gold');
      UI_REFS.targetInfo = h('div', { class:'small warn' });
      UI_REFS.hotbar = h('div', { class:'skillbar' });
      UI_REFS.protoBadge = h('span', { class:'tiny muted', style:{ color:'#90cdf4' } }, '⚡ FlatBuffers 0xC7 (30Hz) · ประหยัด ~86%');

      const connBar = h('div', { class:'row', style:{ display:'none', gap:'4px' } });
      const connUrlInput = h('input', { type:'text', value: net.serverUrl, placeholder:'ws://localhost:8080/ws', style:{ width:'165px', fontSize:'11px', padding:'3px 6px' } });
      connBar.appendChild(connUrlInput);
      connBar.appendChild(h('button', { class:'btn sm primary', type:'button', onclick: () => {
        net.connect(connUrlInput.value || 'ws://localhost:8080/ws');
        connBar.style.display = 'none';
      } }, 'เชื่อม WS'));
      connBar.appendChild(h('button', { class:'btn sm', type:'button', onclick: () => {
        net.disconnectToSim();
        connBar.style.display = 'none';
      } }, 'จำลอง'));

      UI_REFS.netBadge = h('span', { class:'chip ok', title:'คลิกเพื่อตั้งค่าการเชื่อมต่อ Go Gateway / Go Sim Server', style:{ cursor:'pointer' }, onclick: () => {
        connBar.style.display = connBar.style.display === 'none' ? 'flex' : 'none';
      } }, '🟢 Sim Cluster: 14ms · 4 คน');

      const D = SL.store.get();
      const buildSel = ui.select([{ v:'', t:'⚡ สลับบิลด์ตัวละคร…' }].concat(D.builds.map(b => ({ v: b.id, t: b.name }))), '', v => {
        if(v){
          SL.rules.applyBuild(v);
          syncPlayerStats();
          player.hp = player.P.stats.maxHp; player.sp = player.P.stats.maxSp;
          buildSel.value = '';
          ui.toast('เปลี่ยนบิลด์ในโลกผจญภัยแล้ว');
        }
      }, { label:'สลับบิลด์' });

      const spawnSelWrap = h('span');
      const warpBar = h('div', { class:'row' });
      const equipBar = h('div', { class:'row', style:{ gap:'5px', flexWrap:'wrap' } });
      const invDrawer = h('div', { class:'panel col', style:{ display:'none', marginBottom:'8px', borderColor:'var(--accent)', background:'var(--surface-2)' } });
      UI_REFS.spawnSelWrap = spawnSelWrap;
      UI_REFS.warpBar = warpBar;
      UI_REFS.equipBar = equipBar;
      UI_REFS.invDrawer = invDrawer;
      UI_REFS.invDrawerOpen = false;
      UI_REFS.invTab = 'bag';

      const roUiState = {
        bagTab: 'all',        // all | item | equip | card | etc
        rightMode: 'storage', // storage | shop
        storageTab: 'all',    // all | equip | card | etc
        selectedId: 'eq_helm_valkyrie',
        selectedSource: 'bag' // bag | storage | shop | equip
      };

      // เรนเดอร์ระบบหน้าต่างอุปกรณ์ Paperdoll (Alt+Q) + ช่องกระเป๋าไอเทม 36 ช่อง (Alt+E) + ช่องเก็บของคาฟรา 36 ช่อง & ร้านค้า แบบ RO / MMORPG
      SL.ui.renderRoInventorySuite = function(container, opts){
        if(!container) return;
        opts = opts || {};
        ui.clear(container);
        const curD = SL.store.get();
        const stNow = SL.state.get();
        const eqAll = Array.isArray(curD.equipItems) ? curD.equipItems : [];
        const eqState = stNow.equipped || {};
        const P = player ? player.P : C.player(stNow, []);
        const atkRel = C.elementRelations ? C.elementRelations(P.attackElement || 'neutral') : { info:{ icon:'⚪', name:'ไร้ธาตุ' }, strongAgainst:[], weakAttackAgainst:[] };
        const defRel = C.elementRelations ? C.elementRelations(P.defenseElement || 'neutral') : { info:{ icon:'⚪', name:'ไร้ธาตุ' }, resistsAttackers:[], weakToAttackers:[] };
        const wInfo = SL.state.calcWeight ? SL.state.calcWeight() : { cur: 250, max: 3200 };

        function refreshAll(){
          syncPlayerStats();
          if(UI_REFS.rebuildWorldControls) UI_REFS.rebuildWorldControls();
          rebuildWorldHotbar();
          if(opts.onChange) opts.onChange();
          SL.ui.renderRoInventorySuite(container, opts);
        }

        function getElemBadge(it){
          if(!it) return '';
          const elId = it.attackElement || it.defenseElement || '';
          if(!elId) return '';
          const el = C.elementInfo ? C.elementInfo(elId) : null;
          return el ? el.icon : '';
        }

        // แถบหัวข้อหลัก (เมื่อเปิดเป็นหน้าต่างป๊อปอัปในโหมด #world)
        if(opts.showClose){
          container.appendChild(h('div', { class:'row sp-between', style:{ marginBottom:'4px' } },
            h('div', { class:'row', style:{ gap:'8px' } },
              h('b', { style:{ fontSize:'14px', color:'#f3e5ab', fontFamily:'var(--font-display)' } }, '⚔️ ระบบอุปกรณ์ Paperdoll [Alt+Q] · ช่องกระเป๋าไอเทม [Alt+E] · ช่องเก็บของคาฟรา (RO / MMORPG Style)'),
              h('span', { class:'tiny muted' }, 'รองรับ: คลิกดูข้อมูล · ดับเบิลคลิก/คลิกขวา เพื่อสวมใส่/ใช้ยา/ฝาก-เบิก · ลากวาง (Drag & Drop) ข้ามช่องได้ทันที!')
            ),
            h('button', { class:'btn sm danger', type:'button', onclick: opts.onClose }, '✕ ปิดหน้าต่าง [I / B]')
          ));
        }

        const suite = h('div', { class:'ro-suite' });

        /* ==============================================================
           WINDOW 1: 👑 EQUIP [Alt+Q] — หน้าต่างอุปกรณ์สวมใส่ตัวละคร (Paperdoll)
        ============================================================== */
        const eqWin = h('div', { class:'ro-win' },
          h('div', { class:'ro-win-hdr' },
            h('span', { class:'ro-dots' }, h('i'), h('i'), h('span', { style:{ marginLeft:'4px' } }, '👑 EQUIP [Alt+Q] · อุปกรณ์สวมใส่')),
            h('button', { class:'btn sm', type:'button', style:{ padding:'1px 7px', fontSize:'10.5px' }, onclick: () => {
              SL.state.change(s => { s.equipped = { headgear:'', armor:'', garment:'', footgear:'', accessory:'', card:'' }; });
              ui.toast('ถอดอุปกรณ์สวมใส่ทั้งหมดเข้ากระเป๋าแล้ว');
              refreshAll();
            } }, 'ถอดทั้งหมด')
          )
        );
        const eqBody = h('div', { class:'ro-win-body' });

        function makePaperdollSlot(cfg){
          if(cfg.special === 'weapon'){
            const curW = SL.store.find('weapons', stNow.weaponId) || curD.weapons[0] || { id:'sword_1h', name:'ดาบ 1 มือ' };
            const wIcons = { unarmed:'👊', sword_1h:'🗡️', sword_2h:'⚔️', axe:'🪓', mace:'🔨', dagger:'🔪', bow:'🏹', staff:'🪄' };
            const slotEl = h('div', {
              class: 'ro-slot r-rare',
              title: 'อาวุธหลัก: ' + curW.name + ' (คลิกเพื่อสลับอาวุธ)',
              onclick: () => {
                const idx = curD.weapons.findIndex(w => w.id === stNow.weaponId);
                const nextW = curD.weapons[(idx + 1) % curD.weapons.length];
                if(nextW){
                  SL.state.change(s => { s.weaponId = nextW.id; if(nextW.slotType === '2H') s.hasShield = false; });
                  ui.toast('เปลี่ยนอาวุธหลักเป็น: ' + nextW.name);
                  refreshAll();
                }
              }
            },
              h('span', { class:'ro-el-tag' }, atkRel.info.icon || ''),
              h('span', { class:'ro-ico' }, wIcons[curW.id] || '🗡️'),
              h('span', { class:'ro-slot-lbl' }, curW.name)
            );
            return slotEl;
          }
          if(cfg.special === 'shield'){
            const curW = SL.store.find('weapons', stNow.weaponId) || {};
            const canShield = curW.slotType !== '2H';
            const hasSh = !!stNow.hasShield && canShield;
            const slotEl = h('div', {
              class: 'ro-slot ' + (hasSh ? 'r-rare' : 'empty'),
              title: canShield ? 'คลิกเพื่อสวม/ถอดโล่ป้องกัน (DEF +15, Block 15%)' : 'อาวุธ 2 มือไม่สามารถถือโล่ได้',
              onclick: () => {
                if(!canShield){ ui.toast('ถืออาวุธ 2 มืออยู่ ไม่สามารถสวมโล่ได้'); return; }
                SL.state.change(s => { s.hasShield = !s.hasShield; });
                ui.toast(SL.state.get().hasShield ? '🛡️ สวมใส่โล่ป้องกันแล้ว' : 'ถอดโล่ป้องกันแล้ว');
                refreshAll();
              }
            },
              h('span', { class: hasSh ? 'ro-ico' : 'ro-ghost-ico' }, '🛡️'),
              h('span', { class:'ro-slot-lbl' }, hasSh ? 'โล่อัศวิน' : (canShield ? 'โล่ (ว่าง)' : '2H ล็อก'))
            );
            return slotEl;
          }

          const itemId = eqState[cfg.slot] || '';
          const item = eqAll.find(x => x.id === itemId);
          const isSel = item && roUiState.selectedId === item.id && roUiState.selectedSource === 'equip';
          const slotEl = h('div', {
            class: 'ro-slot ' + (item ? ('r-' + (item.rarity || 'common')) : 'empty') + (isSel ? ' sel' : ''),
            title: item ? (item.name + ' — ' + item.desc + '\n(ดับเบิลคลิกหรือคลิกขวาเพื่อถอดออก)') : (cfg.label + ' (ลากอุปกรณ์มาวางที่นี่เพื่อสวมใส่)'),
            onclick: () => {
              if(item){
                roUiState.selectedId = item.id;
                roUiState.selectedSource = 'equip';
                SL.ui.renderRoInventorySuite(container, opts);
              }
            },
            ondblclick: () => {
              if(item){
                SL.state.unequipSlot(cfg.slot);
                ui.toast('ถอด ' + item.name + ' ออกแล้ว');
                refreshAll();
              }
            },
            oncontextmenu: ev => {
              ev.preventDefault();
              if(item){
                SL.state.unequipSlot(cfg.slot);
                ui.toast('ถอด ' + item.name + ' ออกแล้ว');
                refreshAll();
              }
            },
            ondragover: ev => { ev.preventDefault(); slotEl.classList.add('drag-over'); },
            ondragleave: () => { slotEl.classList.remove('drag-over'); },
            ondrop: ev => {
              ev.preventDefault();
              slotEl.classList.remove('drag-over');
              const dragId = ev.dataTransfer.getData('text/plain');
              const dragIt = eqAll.find(x => x.id === dragId);
              if(dragIt && dragIt.slot && dragIt.slot !== 'consumable' && dragIt.slot !== 'etc'){
                if((SL.state.getStorageQty ? SL.state.getStorageQty(dragId) : 0) > 0 && (SL.state.getQty ? SL.state.getQty(dragId) : 0) <= 0){
                  SL.state.withdrawFromStorage(dragId, 1);
                }
                SL.state.change(s => { s.equipped[dragIt.slot] = dragIt.id; });
                ui.toast('สวมใส่ ' + dragIt.icon + ' ' + dragIt.name + ' เรียบร้อย!');
                refreshAll();
              }
            }
          },
            item && getElemBadge(item) ? h('span', { class:'ro-el-tag' }, getElemBadge(item)) : null,
            h('span', { class: item ? 'ro-ico' : 'ro-ghost-ico' }, item ? (item.icon || cfg.ghost) : cfg.ghost),
            h('span', { class:'ro-slot-lbl' }, item ? item.name.replace(/^[^\s]+\s/, '') : cfg.short)
          );
          return slotEl;
        }

        const leftPdCol = h('div', { class:'ro-pd-col' },
          makePaperdollSlot({ slot:'headgear', short:'หมวก', label:'👑 หมวก (Headgear)', ghost:'👑' }),
          makePaperdollSlot({ slot:'armor',    short:'เกราะธาตุ', label:'🦺 เสื้อเกราะ (Armor)', ghost:'🦺' }),
          makePaperdollSlot({ special:'weapon' }),
          makePaperdollSlot({ slot:'card',     short:'การ์ดอาวุธ', label:'🃏 การ์ดเสียบอาวุธ (Card)', ghost:'🃏' })
        );
        const rightPdCol = h('div', { class:'ro-pd-col' },
          makePaperdollSlot({ slot:'garment',   short:'ผ้าคลุม', label:'🧣 ผ้าคลุมไหล่ (Garment)', ghost:'🧣' }),
          makePaperdollSlot({ special:'shield' }),
          makePaperdollSlot({ slot:'footgear',  short:'รองเท้า', label:'👢 รองเท้า (Footgear)', ghost:'👢' }),
          makePaperdollSlot({ slot:'accessory', short:'ประดับ', label:'💍 เครื่องประดับ (Accessory)', ghost:'💍' })
        );

        // วาดตัวละคร Chibi Live Avatar ตรงกลางหน้าต่าง Paperdoll
        const pdCanvas = h('canvas', { width: 126, height: 138, style:{ width:'126px', height:'138px', display:'block' } });
        const pdCtx = pdCanvas.getContext('2d');
        if(pdCtx){
          pdCtx.clearRect(0, 0, 126, 138);
          rigRenderer.drawCharacter(pdCtx, 63, 114, {
            classId: stNow.classId,
            weaponId: stNow.weaponId,
            hasShield: stNow.hasShield,
            equipped: stNow.equipped,
            rawStats: stNow.rawStats,
            sheet: P.stats,
            facing: 1,
            animState: 'idle',
            animTime: worldTime || 1.2,
            scale: 1.35
          });
        }

        const centerPd = h('div', { class:'ro-pd-center',
          ondragover: ev => ev.preventDefault(),
          ondrop: ev => {
            ev.preventDefault();
            const dragId = ev.dataTransfer.getData('text/plain');
            const dragIt = eqAll.find(x => x.id === dragId);
            if(dragIt && dragIt.slot && dragIt.slot !== 'consumable' && dragIt.slot !== 'etc'){
              if((SL.state.getStorageQty ? SL.state.getStorageQty(dragId) : 0) > 0 && (SL.state.getQty ? SL.state.getQty(dragId) : 0) <= 0){
                SL.state.withdrawFromStorage(dragId, 1);
              }
              SL.state.change(s => { s.equipped[dragIt.slot] = dragIt.id; });
              ui.toast('สวมใส่ ' + dragIt.icon + ' ' + dragIt.name + ' แล้ว!');
              refreshAll();
            }
          }
        },
          h('div', { class:'tiny', style:{ fontWeight:700, color:'#f3e5ab' } }, (SL.store.klass(stNow.classId) || {}).name + ' Lv.' + (stNow.baseLv || 50)),
          pdCanvas,
          h('div', { class:'row', style:{ gap:'4px', justifyContent:'center' } },
            h('span', { class:'chip', style:{ fontSize:'10.5px', borderColor: atkRel.info.color || '#d1a44c' } }, '⚔️ ' + atkRel.info.icon + atkRel.info.name),
            h('span', { class:'chip', style:{ fontSize:'10.5px', borderColor: defRel.info.color || '#63b3ed' } }, '🦺 ' + defRel.info.icon + defRel.info.name)
          )
        );

        eqBody.appendChild(h('div', { class:'ro-paperdoll' }, leftPdCol, centerPd, rightPdCol));

        // สรุปค่าพลังต่อสู้ & เรดาร์แพ้-ชนะธาตุใต้ Paperdoll
        eqBody.appendChild(h('div', { class:'ro-footbar', style:{ flexDirection:'column', alignItems:'stretch', gap:'3px' } },
          h('div', { class:'row sp-between tiny' },
            h('span', null, 'ATK ', h('b', { class:'warn' }, Math.round(P.stats.atk)), ' · MATK ', h('b', { class:'warn' }, Math.round(P.stats.matk))),
            h('span', null, 'DEF ', h('b', { class:'ok' }, Math.round(P.stats.def)), ' · FLEE ', h('b', null, Math.round(P.stats.flee)), ' · ASPD ', h('b', { class:'ok' }, fmt(P.stats.aspd, 1)))
          ),
          h('div', { class:'tiny ok' }, '🔥 โจมตีชนะทาง: ' + (atkRel.strongAgainst.length ? atkRel.strongAgainst.slice(0, 4).map(e => e.icon + e.name + '×' + e.mult).join(', ') : 'ตีปกติ ×1.0 (ยกเว้นวิญญาณ ×0.25)')),
          h('div', { class:'tiny', style:{ color:'#90cdf4' } }, '🛡️ เกราะต้านทาน: ' + (defRel.resistsAttackers.length ? defRel.resistsAttackers.slice(0, 4).map(e => e.icon + e.name + '×' + e.mult).join(', ') : 'รับดาเมจปกติ ×1.0 ทุกธาตุ'))
        ));
        eqWin.appendChild(eqBody);
        suite.appendChild(eqWin);

        /* ==============================================================
           WINDOW 2: 🎒 ITEM INVENTORY [Alt+E] — ช่องกระเป๋าไอเทม (36 ช่อง 6×6)
        ============================================================== */
        const ownedIds = (stNow.inventory || []).filter(id => (SL.state.getQty ? SL.state.getQty(id) : 1) > 0);
        const bagWin = h('div', { class:'ro-win' },
          h('div', { class:'ro-win-hdr' },
            h('span', { class:'ro-dots' }, h('i'), h('i'), h('span', { style:{ marginLeft:'4px' } }, '🎒 INVENTORY [Alt+E] · ช่องกระเป๋าไอเทม')),
            h('button', { class:'btn sm', type:'button', style:{ padding:'1px 7px', fontSize:'10.5px' }, onclick: () => {
              if(SL.state.sortInventory) SL.state.sortInventory();
              ui.toast('จัดเรียงไอเทมในกระเป๋าตามหมวดหมู่แล้ว');
              refreshAll();
            } }, '⇅ เรียงของ')
          )
        );
        const bagBody = h('div', { class:'ro-win-body' });

        // แถบหมวดหมู่แบบ RO (ALL / ITEM / EQUIP / CARD / ETC)
        const bagTabs = h('div', { class:'ro-tabs' });
        [
          { id:'all',   label:'ALL (' + ownedIds.length + ')' },
          { id:'item',  label:'🧪 ITEM (ยา)' },
          { id:'equip', label:'👑 EQUIP (สวมใส่)' },
          { id:'card',  label:'🃏 CARD (การ์ด)' },
          { id:'etc',   label:'💎 ETC (ขยะ/แร่)' }
        ].forEach(tb => {
          bagTabs.appendChild(h('button', {
            class: 'ro-tab' + (roUiState.bagTab === tb.id ? ' on' : ''),
            type: 'button',
            onclick: () => { roUiState.bagTab = tb.id; SL.ui.renderRoInventorySuite(container, opts); }
          }, tb.label));
        });
        bagBody.appendChild(bagTabs);

        const filteredBag = ownedIds.map(id => eqAll.find(x => x.id === id)).filter(it => {
          if(!it) return false;
          if(roUiState.bagTab === 'item') return it.slot === 'consumable';
          if(roUiState.bagTab === 'equip') return it.slot !== 'consumable' && it.slot !== 'card' && it.slot !== 'etc';
          if(roUiState.bagTab === 'card') return it.slot === 'card';
          if(roUiState.bagTab === 'etc') return it.slot === 'etc';
          return true;
        });

        const bagGrid = h('div', {
          class:'ro-grid',
          ondragover: ev => ev.preventDefault(),
          ondrop: ev => {
            ev.preventDefault();
            const src = ev.dataTransfer.getData('source');
            const dragId = ev.dataTransfer.getData('text/plain');
            if(src === 'storage' && dragId && SL.state.withdrawFromStorage){
              SL.state.withdrawFromStorage(dragId, 1);
              ui.toast('📤 เบิกไอเทมเข้ากระเป๋าแล้ว');
              refreshAll();
            }
          }
        });

        const TOTAL_BAG_SLOTS = 30; // 6×5 = 30 ช่องกระเป๋ามาตรฐาน
        for(let i = 0; i < Math.max(TOTAL_BAG_SLOTS, filteredBag.length); i++){
          const it = filteredBag[i];
          if(it){
            const qty = SL.state.getQty ? SL.state.getQty(it.id) : 1;
            const isEquipped = it.slot && it.slot !== 'consumable' && it.slot !== 'etc' && eqState[it.slot] === it.id;
            const isSel = roUiState.selectedId === it.id && roUiState.selectedSource === 'bag';
            const elBadge = getElemBadge(it);
            const cell = h('div', {
              class: 'ro-slot r-' + (it.rarity || 'common') + (isSel ? ' sel' : ''),
              draggable: 'true',
              title: it.name + ' (×' + qty + ')\n' + (it.desc || '') + '\n[คลิกซ้าย: ดูข้อมูล | ดับเบิลคลิก/คลิกขวา: สวมใส่/ใช้ยา | ลากไปวางที่คลังเพื่อฝากของ]',
              ondragstart: ev => {
                ev.dataTransfer.setData('text/plain', it.id);
                ev.dataTransfer.setData('source', 'bag');
              },
              onclick: () => {
                roUiState.selectedId = it.id;
                roUiState.selectedSource = 'bag';
                SL.ui.renderRoInventorySuite(container, opts);
              },
              ondblclick: () => {
                if(it.slot === 'consumable'){
                  useConsumableInWorld(it.id);
                  refreshAll();
                } else if(it.slot === 'etc'){
                  if(SL.state.depositToStorage(it.id, 1)){
                    ui.toast('📥 ฝาก ' + it.name + ' เข้าช่องเก็บของคาฟราแล้ว');
                    refreshAll();
                  }
                } else {
                  SL.state.equipItem(it.id);
                  ui.toast((SL.state.get().equipped[it.slot] === it.id ? 'สวมใส่ ' : 'ถอด ') + it.name + ' แล้ว');
                  refreshAll();
                }
              },
              oncontextmenu: ev => {
                ev.preventDefault();
                if(it.slot === 'consumable'){
                  useConsumableInWorld(it.id);
                  refreshAll();
                } else if(it.slot === 'etc'){
                  if(SL.state.depositToStorage(it.id, 1)){
                    ui.toast('📥 ฝาก ' + it.name + ' เข้าช่องเก็บของคาฟราแล้ว');
                    refreshAll();
                  }
                } else {
                  SL.state.equipItem(it.id);
                  ui.toast((SL.state.get().equipped[it.slot] === it.id ? 'สวมใส่ ' : 'ถอด ') + it.name + ' แล้ว');
                  refreshAll();
                }
              }
            },
              elBadge ? h('span', { class:'ro-el-tag' }, elBadge) : null,
              isEquipped ? h('span', { class:'ro-eq-tag' }, 'E') : null,
              h('span', { class:'ro-ico' }, it.icon || '💎'),
              h('span', { class:'ro-qty' }, '×' + qty)
            );
            bagGrid.appendChild(cell);
          } else {
            bagGrid.appendChild(h('div', { class:'ro-slot empty', title:'ช่องกระเป๋าว่าง #' + (i + 1) }));
          }
        }
        bagBody.appendChild(bagGrid);

        // แถบสถานะน้ำหนักและ Zeny ใต้กระเป๋าแบบ RO
        bagBody.appendChild(h('div', { class:'ro-footbar' },
          h('span', null, '🎒 ช่อง: ', h('b', null, ownedIds.length + '/' + TOTAL_BAG_SLOTS)),
          h('span', null, '⚖️ น้ำหนัก: ', h('b', { class: wInfo.cur > wInfo.max * 0.9 ? 'bad' : 'ok' }, wInfo.cur + ' / ' + wInfo.max)),
          h('span', { class:'warn', style:{ fontWeight:700 } }, '🪙 ' + (stNow.gold || 0).toLocaleString() + ' Zeny')
        ));
        bagWin.appendChild(bagBody);
        suite.appendChild(bagWin);

        /* ==============================================================
           WINDOW 3: 📦 KAFRA STORAGE & SHOP — ช่องเก็บของคาฟรา (36 ช่อง) & ร้านค้า
        ============================================================== */
        const stIds = (stNow.storage || []).filter(id => (SL.state.getStorageQty ? SL.state.getStorageQty(id) : 0) > 0);
        const rightWin = h('div', { class:'ro-win' },
          h('div', { class:'ro-win-hdr' },
            h('span', { class:'ro-dots' }, h('i'), h('i'), h('span', { style:{ marginLeft:'4px' } },
              roUiState.rightMode === 'storage' ? '📦 KAFRA STORAGE · ช่องเก็บของคาฟรา' : '🏪 TOOL & CARD DEALER · ร้านค้า RO'
            )),
            h('div', { class:'row', style:{ gap:'4px' } },
              h('button', {
                class: 'btn sm' + (roUiState.rightMode === 'storage' ? ' primary' : ''),
                type: 'button',
                style:{ padding:'1px 7px', fontSize:'10.5px' },
                onclick: () => { roUiState.rightMode = 'storage'; SL.ui.renderRoInventorySuite(container, opts); }
              }, '📦 คลังเก็บของ (' + stIds.length + ')'),
              h('button', {
                class: 'btn sm' + (roUiState.rightMode === 'shop' ? ' primary' : ''),
                type: 'button',
                style:{ padding:'1px 7px', fontSize:'10.5px' },
                onclick: () => { roUiState.rightMode = 'shop'; SL.ui.renderRoInventorySuite(container, opts); }
              }, '🏪 ร้านค้า')
            )
          )
        );
        const rightBody = h('div', { class:'ro-win-body' });

        // แถบหมวดหมู่ย่อยของคลังเก็บของคาฟรา / ร้านค้า
        const rightTabs = h('div', { class:'ro-tabs' });
        [
          { id:'all',   label:'ALL' },
          { id:'item',  label:'🧪 ITEM' },
          { id:'equip', label:'👑 EQUIP' },
          { id:'card',  label:'🃏 CARD (13 ธาตุ)' },
          { id:'etc',   label:'💎 ETC' }
        ].forEach(tb => {
          rightTabs.appendChild(h('button', {
            class: 'ro-tab' + (roUiState.storageTab === tb.id ? ' on' : ''),
            type: 'button',
            onclick: () => { roUiState.storageTab = tb.id; SL.ui.renderRoInventorySuite(container, opts); }
          }, tb.label));
        });
        rightBody.appendChild(rightTabs);

        const TOTAL_STORAGE_SLOTS = 30;
        const rightGrid = h('div', {
          class:'ro-grid',
          ondragover: ev => ev.preventDefault(),
          ondrop: ev => {
            ev.preventDefault();
            const src = ev.dataTransfer.getData('source');
            const dragId = ev.dataTransfer.getData('text/plain');
            if(src === 'bag' && dragId && SL.state.depositToStorage){
              roUiState.rightMode = 'storage';
              SL.state.depositToStorage(dragId, 1);
              ui.toast('📥 ฝากไอเทมเข้าช่องเก็บของคาฟราแล้ว');
              refreshAll();
            }
          }
        });

        if(roUiState.rightMode === 'storage'){
          const filteredStorage = stIds.map(id => eqAll.find(x => x.id === id)).filter(it => {
            if(!it) return false;
            if(roUiState.storageTab === 'item') return it.slot === 'consumable';
            if(roUiState.storageTab === 'equip') return it.slot !== 'consumable' && it.slot !== 'card' && it.slot !== 'etc';
            if(roUiState.storageTab === 'card') return it.slot === 'card';
            if(roUiState.storageTab === 'etc') return it.slot === 'etc';
            return true;
          });

          for(let i = 0; i < Math.max(TOTAL_STORAGE_SLOTS, filteredStorage.length); i++){
            const it = filteredStorage[i];
            if(it){
              const qty = SL.state.getStorageQty ? SL.state.getStorageQty(it.id) : 1;
              const isSel = roUiState.selectedId === it.id && roUiState.selectedSource === 'storage';
              const elBadge = getElemBadge(it);
              const cell = h('div', {
                class: 'ro-slot r-' + (it.rarity || 'common') + (isSel ? ' sel' : ''),
                draggable: 'true',
                title: '[คลังคาฟรา] ' + it.name + ' (×' + qty + ')\n' + (it.desc || '') + '\n[ดับเบิลคลิก/คลิกขวา: เบิกเข้ากระเป๋า | ลากไปวางที่กระเป๋าหรือช่องสวมใส่]',
                ondragstart: ev => {
                  ev.dataTransfer.setData('text/plain', it.id);
                  ev.dataTransfer.setData('source', 'storage');
                },
                onclick: () => {
                  roUiState.selectedId = it.id;
                  roUiState.selectedSource = 'storage';
                  SL.ui.renderRoInventorySuite(container, opts);
                },
                ondblclick: () => {
                  if(SL.state.withdrawFromStorage(it.id, 1)){
                    ui.toast('📤 เบิก ' + it.icon + ' ' + it.name + ' เข้ากระเป๋าแล้ว');
                    refreshAll();
                  }
                },
                oncontextmenu: ev => {
                  ev.preventDefault();
                  if(SL.state.withdrawFromStorage(it.id, 1)){
                    ui.toast('📤 เบิก ' + it.icon + ' ' + it.name + ' เข้ากระเป๋าแล้ว');
                    refreshAll();
                  }
                }
              },
                elBadge ? h('span', { class:'ro-el-tag' }, elBadge) : null,
                h('span', { class:'ro-ico' }, it.icon || '📦'),
                h('span', { class:'ro-qty' }, '×' + qty)
              );
              rightGrid.appendChild(cell);
            } else {
              rightGrid.appendChild(h('div', { class:'ro-slot empty', title:'ช่องเก็บของคาฟราว่าง #' + (i + 1) + ' (ลากไอเทมจากกระเป๋ามาวางที่นี่เพื่อฝาก)' }));
            }
          }

          rightBody.appendChild(rightGrid);
          rightBody.appendChild(h('div', { class:'ro-footbar' },
            h('span', null, '📦 ช่องเก็บของ: ', h('b', null, stIds.length + '/' + TOTAL_STORAGE_SLOTS + ' ช่อง')),
            h('button', { class:'btn sm', type:'button', style:{ padding:'1px 7px', fontSize:'10.5px' }, onclick: () => {
              let moved = 0;
              (stNow.inventory || []).slice().forEach(id => {
                const it = eqAll.find(x => x.id === id);
                const q = SL.state.getQty(id);
                if(it && it.slot === 'etc' && q > 0){
                  SL.state.depositToStorage(id, q);
                  moved += q;
                }
              });
              ui.toast(moved > 0 ? ('📥 ฝากวัตถุดิบ ETC ทั้งหมด (' + moved + ' ชิ้น) เข้าคลังคาฟราแล้ว!') : 'ไม่มีวัตถุดิบ ETC ในกระเป๋าให้ฝาก');
              refreshAll();
            } }, '📥 ฝากขยะ ETC ทั้งหมดเข้าคลัง')
          ));
        } else {
          // โหมดร้านค้า RO Tool & Card Shop (แสดงเป็นช่องตาราง 30 ช่องพร้อมป้ายราคา)
          const filteredShop = eqAll.filter(it => {
            if(!it) return false;
            if(roUiState.storageTab === 'item') return it.slot === 'consumable';
            if(roUiState.storageTab === 'equip') return it.slot !== 'consumable' && it.slot !== 'card' && it.slot !== 'etc';
            if(roUiState.storageTab === 'card') return it.slot === 'card';
            if(roUiState.storageTab === 'etc') return it.slot === 'etc';
            return true;
          });

          for(let i = 0; i < Math.max(TOTAL_STORAGE_SLOTS, filteredShop.length); i++){
            const it = filteredShop[i];
            if(it){
              const price = it.price || 100;
              const isSel = roUiState.selectedId === it.id && roUiState.selectedSource === 'shop';
              const elBadge = getElemBadge(it);
              const cell = h('div', {
                class: 'ro-slot r-' + (it.rarity || 'common') + (isSel ? ' sel' : ''),
                title: '[ร้านค้า] ' + it.name + ' — ราคา ' + price + ' Zeny\n' + (it.desc || '') + '\n[ดับเบิลคลิกเพื่อซื้อทันที 1 ชิ้น]',
                onclick: () => {
                  roUiState.selectedId = it.id;
                  roUiState.selectedSource = 'shop';
                  SL.ui.renderRoInventorySuite(container, opts);
                },
                ondblclick: () => {
                  if((stNow.gold || 0) < price){
                    ui.toast('Zeny (Gold) ไม่พอ! ต้องการ ' + price + 'G');
                    return;
                  }
                  stNow.gold -= price;
                  SL.state.addItem(it.id, 1);
                  ui.toast('🪙 ซื้อ ' + it.icon + ' ' + it.name + ' เข้ากระเป๋าแล้ว!');
                  refreshAll();
                }
              },
                elBadge ? h('span', { class:'ro-el-tag' }, elBadge) : null,
                h('span', { class:'ro-ico' }, it.icon || '💎'),
                h('span', { class:'ro-qty', style:{ color:'#f6e05e' } }, price + 'G')
              );
              rightGrid.appendChild(cell);
            } else {
              rightGrid.appendChild(h('div', { class:'ro-slot empty' }));
            }
          }

          rightBody.appendChild(rightGrid);
          rightBody.appendChild(h('div', { class:'ro-footbar' },
            h('span', { class:'tiny muted' }, '💡 คลิกที่ไอเทมเพื่อดูรายละเอียด หรือดับเบิลคลิกเพื่อซื้อเข้ากระเป๋าทันที'),
            h('span', { class:'warn', style:{ fontWeight:700 } }, '🪙 งบของคุณ: ' + (stNow.gold || 0).toLocaleString() + 'G')
          ));
        }

        rightWin.appendChild(rightBody);
        suite.appendChild(rightWin);
        container.appendChild(suite);

        /* ==============================================================
           BOTTOM INSPECTOR: 🔍 แถบรายละเอียดไอเทม & ปุ่มคำสั่งด่วน (RO Item Card Tooltip)
        ============================================================== */
        const selItem = eqAll.find(x => x.id === roUiState.selectedId) || eqAll[0];
        if(selItem){
          const invQty = SL.state.getQty ? SL.state.getQty(selItem.id) : 0;
          const stQty = SL.state.getStorageQty ? SL.state.getStorageQty(selItem.id) : 0;
          const isEquipped = selItem.slot && selItem.slot !== 'consumable' && selItem.slot !== 'etc' && eqState[selItem.slot] === selItem.id;
          const buyPrice = selItem.price || 100;
          const sellPrice = Math.max(5, Math.round(buyPrice * 0.5));
          const rarityLabels = { common:'ทั่วไป (Common)', rare:'หายาก (Rare)', epic:'มหากาพย์ (Epic)', legendary:'ตำนาน (Legendary ★)' };
          const slotLabels = { headgear:'👑 หมวก', armor:'🦺 ชุดเกราะธาตุ', garment:'🧣 ผ้าคลุมไหล่', footgear:'👢 รองเท้า', accessory:'💍 เครื่องประดับ', card:'🃏 การ์ดเสียบอาวุธ', consumable:'🧪 ยาฟื้นฟู (ITEM)', etc:'💎 วัตถุดิบดรอป (ETC)' };

          const actions = h('div', { class:'row', style:{ gap:'6px' } });

          // ปุ่มสวมใส่ / ถอดออก (สำหรับอุปกรณ์และการ์ด)
          if(selItem.slot && selItem.slot !== 'consumable' && selItem.slot !== 'etc' && (invQty > 0 || isEquipped)){
            actions.appendChild(h('button', {
              class: 'btn sm' + (isEquipped ? '' : ' primary'),
              type: 'button',
              onclick: () => {
                SL.state.equipItem(selItem.id);
                ui.toast((SL.state.get().equipped[selItem.slot] === selItem.id ? '👑 สวมใส่ ' : 'ถอด ') + selItem.name + ' แล้ว');
                refreshAll();
              }
            }, isEquipped ? 'ถอดออกจากตัว' : '👑 สวมใส่ทันที'));
          }

          // ปุ่มกดใช้ยา (สำหรับ Consumable)
          if(selItem.slot === 'consumable' && invQty > 0){
            actions.appendChild(h('button', {
              class: 'btn sm primary',
              type: 'button',
              onclick: () => {
                useConsumableInWorld(selItem.id);
                refreshAll();
              }
            }, '🧪 กดใช้ฟื้นฟูทันที (มี ×' + invQty + ')'));
          }

          // ปุ่มฝากเข้าช่องเก็บของคาฟรา (เมื่อมีของในกระเป๋า)
          if(invQty > 0){
            actions.appendChild(h('button', {
              class: 'btn sm',
              type: 'button',
              onclick: () => {
                SL.state.depositToStorage(selItem.id, 1);
                ui.toast('📥 ฝาก ' + selItem.name + ' ×1 เข้าช่องเก็บของคาฟราแล้ว');
                refreshAll();
              }
            }, '📥 ฝากเข้าคลัง (×1)'));
            if(invQty > 1){
              actions.appendChild(h('button', {
                class: 'btn sm',
                type: 'button',
                onclick: () => {
                  SL.state.depositToStorage(selItem.id, invQty);
                  ui.toast('📥 ฝาก ' + selItem.name + ' ทั้งหมด (×' + invQty + ') เข้าคลังคาฟราแล้ว');
                  refreshAll();
                }
              }, '📥 ฝากทั้งหมด (×' + invQty + ')'));
            }
          }

          // ปุ่มเบิกจากช่องเก็บของคาฟราเข้ากระเป๋า (เมื่อมีของในคลัง)
          if(stQty > 0){
            actions.appendChild(h('button', {
              class: 'btn sm primary',
              type: 'button',
              onclick: () => {
                SL.state.withdrawFromStorage(selItem.id, 1);
                ui.toast('📤 เบิก ' + selItem.name + ' ×1 เข้ากระเป๋าไอเทมแล้ว');
                refreshAll();
              }
            }, '📤 เบิกเข้ากระเป๋า (×1)'));
            if(stQty > 1){
              actions.appendChild(h('button', {
                class: 'btn sm',
                type: 'button',
                onclick: () => {
                  SL.state.withdrawFromStorage(selItem.id, stQty);
                  ui.toast('📤 เบิก ' + selItem.name + ' ทั้งหมด (×' + stQty + ') เข้ากระเป๋าแล้ว');
                  refreshAll();
                }
              }, '📤 เบิกทั้งหมด (×' + stQty + ')'));
            }
          }

          // ปุ่มซื้อเพิ่มจากร้านค้า
          actions.appendChild(h('button', {
            class: 'btn sm',
            type: 'button',
            onclick: () => {
              if((stNow.gold || 0) < buyPrice){
                ui.toast('Zeny (Gold) ไม่พอ! ต้องการ ' + buyPrice + 'G');
                return;
              }
              stNow.gold -= buyPrice;
              SL.state.addItem(selItem.id, 1);
              ui.toast('🪙 ซื้อ ' + selItem.icon + ' ' + selItem.name + ' เข้ากระเป๋าแล้ว');
              refreshAll();
            }
          }, '🪙 ซื้อเพิ่ม (-' + buyPrice + 'G)'));

          // ปุ่มขายคืน NPC
          if(invQty > 0){
            actions.appendChild(h('button', {
              class: 'btn sm danger',
              type: 'button',
              onclick: () => {
                stNow.gold = (stNow.gold || 0) + sellPrice;
                SL.state.removeItem(selItem.id, 1);
                ui.toast('💰 ขาย ' + selItem.name + ' ได้รับ +' + sellPrice + ' Zeny');
                refreshAll();
              }
            }, '💰 ขายคืน (+' + sellPrice + 'G)'));
          }

          container.appendChild(h('div', { class:'ro-inspect', style:{ marginTop:'8px' } },
            h('div', { class:'row', style:{ gap:'10px' } },
              h('div', { class:'ro-slot r-' + (selItem.rarity || 'common'), style:{ cursor:'default' } },
                getElemBadge(selItem) ? h('span', { class:'ro-el-tag' }, getElemBadge(selItem)) : null,
                h('span', { class:'ro-ico' }, selItem.icon || '💎')
              ),
              h('div', { class:'col', style:{ gap:'2px' } },
                h('div', { class:'row', style:{ gap:'6px' } },
                  h('b', { style:{ fontSize:'13.5px', color:'#f3e5ab' } }, selItem.name),
                  h('span', { class:'chip', style:{ fontSize:'10.5px' } }, slotLabels[selItem.slot] || selItem.slot),
                  h('span', { class:'chip', style:{ fontSize:'10.5px' } }, rarityLabels[selItem.rarity] || 'ทั่วไป'),
                  h('span', { class:'tiny muted' }, '🎒 ในกระเป๋า: ×' + invQty + ' · 📦 ในคลังคาฟรา: ×' + stQty + ' · ⚖️ น้ำหนัก: ' + (selItem.weight || 10))
                ),
                h('div', { class:'small ok' }, selItem.desc || '')
              )
            ),
            actions
          ));
        }
      };

      function renderInvDrawer(){
        if(!UI_REFS.invDrawer) return;
        SL.ui.renderRoInventorySuite(UI_REFS.invDrawer, {
          showClose: true,
          onClose: () => UI_REFS.toggleInvDrawer(false)
        });
      }

      UI_REFS.renderInvDrawer = renderInvDrawer;
      UI_REFS.toggleInvDrawer = function(force){
        UI_REFS.invDrawerOpen = force !== undefined ? !!force : !UI_REFS.invDrawerOpen;
        UI_REFS.invDrawer.style.display = UI_REFS.invDrawerOpen ? 'flex' : 'none';
        if(UI_REFS.invDrawerOpen) renderInvDrawer();
      };

      function rebuildWorldControls(){
        const curD = SL.store.get();
        const stNow = SL.state.get();
        if(UI_REFS.warpBar){
          ui.clear(UI_REFS.warpBar);
          const maps = (curD.worldMap && Array.isArray(curD.worldMap.maps)) ? curD.worldMap.maps : [];
          if(maps.length){
            const mapSel = ui.select(
              maps.map(m => ({ v: m.id, t: '🗺️ ' + m.name })),
              (curD.worldMap && curD.worldMap.currentMapId) || maps[0].id,
              v => { switchWorldMap(v, 520, 850); },
              { label:'เลือกแผนที่' }
            );
            UI_REFS.warpBar.appendChild(mapSel);
          }
          UI_REFS.warpBar.appendChild(h('span', { class:'tiny muted' }, 'โซน:'));
          getZones().forEach(z => {
            UI_REFS.warpBar.appendChild(h('button', { class:'btn sm', type:'button', onclick: () => {
              player.x = z.x; player.y = z.y + 40; player.destX = null; player.destY = null; player.chaseMobUid = 0;
              addParticles(player.x, player.y, z.color, 12, 80);
            } }, z.name.split(' (')[0]));
          });
        }
        if(UI_REFS.equipBar){
          ui.clear(UI_REFS.equipBar);
          const eqAll = Array.isArray(curD.equipItems) ? curD.equipItems : [];
          const eqState = stNow.equipped || {};
          // ปุ่มเปิดกระเป๋า & อุปกรณ์ 6 ช่อง + เรดาร์ 13 ธาตุ
          UI_REFS.equipBar.appendChild(h('button', {
            class: 'btn sm primary',
            type: 'button',
            onclick: () => UI_REFS.toggleInvDrawer()
          }, '🎒 กระเป๋า & อุปกรณ์ 6 ช่อง [I/B]'));
          [
            { slot:'armor', label:'🦺 เกราะธาตุ' },
            { slot:'card', label:'🃏 การ์ดธาตุโจมตี' }
          ].forEach(cfg => {
            const items = [{ v:'', t: cfg.label + ': (ไร้ธาตุ)' }].concat(
              eqAll.filter(x => x.slot === cfg.slot).map(x => ({ v: x.id, t: (x.icon || '') + ' ' + x.name }))
            );
            const sel = ui.select(items, eqState[cfg.slot] || '', v => {
              SL.state.change(s => { s.equipped[cfg.slot] = v; });
              syncPlayerStats();
              if(UI_REFS.invDrawerOpen) renderInvDrawer();
              ui.toast('อัปเดต ' + cfg.label + ' แล้ว');
            }, { label: cfg.label });
            UI_REFS.equipBar.appendChild(sel);
          });
        }
        if(UI_REFS.spawnSelWrap){
          const prevVal = UI_REFS.spawnSel ? UI_REFS.spawnSel.value : 'poring';
          ui.clear(UI_REFS.spawnSelWrap);
          UI_REFS.spawnSel = ui.select(curD.monsters.map(m => ({ v: m.id, t: '＋ เสก ' + m.name })), prevVal, () => {}, { label:'เลือกมอนสเตอร์ที่จะเสก' });
          UI_REFS.spawnSelWrap.appendChild(UI_REFS.spawnSel);
        }
      }
      UI_REFS.rebuildWorldControls = rebuildWorldControls;
      rebuildWorldControls();

      const spawnBtn = h('button', { class:'btn sm', type:'button', onclick: () => {
        const ang = Math.random() * Math.PI * 2;
        const selId = (UI_REFS.spawnSel && UI_REFS.spawnSel.value) || 'poring';
        const m = spawnMonsterInstance(selId, clamp(player.x + Math.cos(ang) * 140, 60, WORLD_W - 60), clamp(player.y + Math.sin(ang) * 140, 60, WORLD_H - 60));
        if(m){
          targetMobId = m.uid;
          player.chaseMobUid = m.uid;
          ui.toast('เสก ' + m.name + ' ลงแมพแล้ว!');
        }
      } }, 'เสกลงใกล้ตัว');

      // กล่องแชทผู้เล่นหลายคนในห้อง (MMO Chat Box)
      const chatBox = h('div', { class:'gx-win gx-chat' });
      const chatList = h('div', { class:'log', style:{ height:'110px', fontSize:'11.5px' } });
      const chatInput = h('input', { type:'text', placeholder:'กด Enter เพื่อพิมพ์คุยในห้อง…', style:{ width:'100%', fontSize:'12px' } });
      UI_REFS.chatInput = chatInput;

      function renderChat(){
        ui.clear(chatList);
        net.chatLog.slice(-15).forEach(c => {
          chatList.appendChild(h('div', null,
            h('span', { class:'muted tiny' }, '[' + (c.time || '12:00') + '] '),
            h('b', { style:{ color: c.type === 'sys' ? 'var(--accent)' : c.type === 'player' ? 'var(--success)' : 'var(--info)' } }, c.sender + ': '),
            h('span', null, c.text)
          ));
        });
        chatList.scrollTop = chatList.scrollHeight;
      }
      function sendChatMsg(){
        const txt = (chatInput.value || '').trim();
        if(!txt) return;
        player.chatText = txt;
        player.chatTimer = 4.5;
        net.send(OP.CHAT, { sender: 'ฉัน (' + (SL.store.klass(SL.state.get().classId) || {}).name + ')', text: txt });
        chatInput.value = '';
        chatInput.blur();
        renderChat();
      }
      net.subscribe(renderChat);
      renderChat();

      chatBox.appendChild(h('div', { class:'row sp-between' },
        h('span', { class:'tiny' }, '💬 แชทห้องออนไลน์'),
        UI_REFS.netBadge
      ));
      chatBox.appendChild(UI_REFS.protoBadge);
      chatBox.appendChild(connBar);
      chatBox.appendChild(chatList);
      chatBox.appendChild(h('div', { class:'row' },
        chatInput,
        h('button', { class:'btn sm primary', type:'button', onclick: sendChatMsg }, 'ส่ง')
      ));

      /* ---------- เลย์เอาต์สไตล์ Ragnarok Online: หน้าต่างลอยซ้อนในฉาก ลากย้ายได้ ---------- */
      const winBar = (txt) => h('div', { class:'gx-bar' }, h('i'), txt);

      // Basic Info (ซ้ายบน): ชื่ออาชีพ/เลเวล, HP, SP, Base/Job EXP, Zeny
      UI_REFS.heroSub = h('div', { class:'tiny muted gx-sub' });
      UI_REFS.baseBar = h('div', { class:'gx-xp' }, h('i'), h('span'));
      UI_REFS.jobBar = h('div', { class:'gx-xp job' }, h('i'), h('span'));
      const basicWin = h('div', { class:'gx-win gx-basic' }, winBar('Basic Info'),
        UI_REFS.heroTitle, UI_REFS.heroSub, UI_REFS.hpBar, UI_REFS.spBar, UI_REFS.baseBar, UI_REFS.jobBar, UI_REFS.expGoldBadge);

      // เมนูตัวละคร (เปิด/ปิดจากปุ่ม) + คำใบ้ปุ่มลัด
      const hudReset = h('button', { class:'btn sm', type:'button', onclick: () => {
        hudPos = {}; saveHudPos();
        stage.querySelectorAll('.gx-win').forEach(w => { w.style.left = w.style.top = w.style.right = w.style.bottom = w.style.transform = ''; });
        ui.toast('รีเซ็ตตำแหน่งหน้าต่าง HUD แล้ว');
      } }, '↺ รีเซ็ตตำแหน่งหน้าต่าง');
      const menuWin = h('div', { class:'gx-win gx-menu' }, winBar('Menu · ตัวละคร & โลก'),
        buildSel,
        ui.check('ตีออโต้เมื่ออยู่ใกล้', autoAttack, v => { autoAttack = v; }),
        ui.check('บอทใช้สกิล', autoSkill, v => { autoSkill = v; }),
        ui.check('อมตะ (Test)', godMode, v => { godMode = v; }),
        equipBar,
        h('div', { class:'row' }, spawnSelWrap, spawnBtn),
        h('div', { class:'row' },
          h('a', { class:'btn sm', href:'#formulas' }, '⚙️ ปรับสูตร/สเตตัส'),
          h('a', { class:'btn sm', href:'#models' }, '🎨 โมเดล/ริก')),
        hudReset,
        h('div', { class:'tiny muted gx-keys' }, 'WASD/คลิกพื้น เดิน · F/J โจมตี · Space กลิ้ง · 1–9 สกิล · Q/E ยา · I/B กระเป๋า · Tab เลือกเป้า · Enter แชท · ล้อเมาส์ซูม · ลากหน้าต่างที่ขอบเพื่อย้าย'));

      // หน้าต่างวาร์ป/เลือกแมพ
      const warpWin = h('div', { class:'gx-win gx-warpwin' }, winBar('Warp · เลือกแมพ & โซน'), warpBar);

      const toggle = (el, other) => () => { el.classList.toggle('open'); if(other) other.classList.remove('open'); fitCanvas(); };
      const menuBtn = h('button', { class:'gx-btn', type:'button', title:'เมนูตัวละคร & โลก', onclick: toggle(menuWin, warpWin) }, '☰ เมนู');
      const warpBtn = h('button', { class:'gx-btn', type:'button', title:'วาร์ป/เลือกแมพ', onclick: toggle(warpWin, menuWin) }, '🗺 วาร์ป');
      const invBtn = h('button', { class:'gx-btn', type:'button', title:'กระเป๋า/อุปกรณ์ [I / B]',
        onclick: () => { if(UI_REFS.toggleInvDrawer) UI_REFS.toggleInvDrawer(); } }, '🎒 กระเป๋า');

      // มินิแมพ + ปุ่มเมนู (ขวาบน)
      const miniWin = h('div', { class:'gx-win gx-mini' }, winBar('Minimap'), miniCanvas,
        h('div', { class:'gx-btnrow' }, invBtn, menuBtn, warpBtn));

      // ข้อมูลเป้าหมาย (กลางบน)
      const targetPill = h('div', { class:'gx-tc' }, UI_REFS.targetInfo);

      // Hotkey bar (ล่าง)
      const hotWin = h('div', { class:'gx-win gx-hotwin' }, UI_REFS.hotbar);

      invDrawer.className = 'gx-win gx-inv col';
      invDrawer.removeAttribute('style');
      invDrawer.style.display = 'none';

      const stage = h('div', { class:'gx-stage' }, canvas, basicWin, miniWin, warpWin, menuWin, targetPill, chatBox, hotWin, invDrawer);
      root.appendChild(stage);

      // ลากย้ายหน้าต่างได้แบบ RO (จำตำแหน่งไว้ใน localStorage)
      const HUD_KEY = 'roSkillLabHud_v1';
      let hudPos = {};
      try{ hudPos = JSON.parse(localStorage.getItem(HUD_KEY) || '{}') || {}; }catch(e){ hudPos = {}; }
      function saveHudPos(){ try{ localStorage.setItem(HUD_KEY, JSON.stringify(hudPos)); }catch(e){} }
      const hudWins = { basic: basicWin, mini: miniWin, warp: warpWin, menu: menuWin, chat: chatBox, hot: hotWin, inv: invDrawer };
      const placeWin = (id) => {
        const w = hudWins[id], p = hudPos[id];
        if(!w || !p) return;
        const sr = stage.getBoundingClientRect();
        w.style.left = clamp(p.x, 0, Math.max(0, sr.width - Math.max(60, w.offsetWidth))) + 'px';
        w.style.top = clamp(p.y, 0, Math.max(0, sr.height - 36)) + 'px';
        w.style.right = w.style.bottom = 'auto'; w.style.transform = 'none';
      };
      Object.keys(hudWins).forEach(id => {
        const w = hudWins[id];
        w.addEventListener('pointerdown', ev => {
          if(ev.button !== 0 || ev.target.closest('button,input,select,textarea,a,canvas,label,.log,.ro-win,.skillbar .sk')) return;
          const sr = stage.getBoundingClientRect(), wr = w.getBoundingClientRect();
          const ox = ev.clientX - wr.left, oy = ev.clientY - wr.top;
          const mv = e => {
            hudPos[id] = { x: clamp(e.clientX - sr.left - ox, 0, Math.max(0, sr.width - wr.width)), y: clamp(e.clientY - sr.top - oy, 0, Math.max(0, sr.height - 36)) };
            placeWin(id);
          };
          const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); saveHudPos(); };
          window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
          ev.preventDefault();
        });
      });

      // ปรับความละเอียด canvas ให้พอดีกับฉากเสมอ (รองรับจอ HiDPI) แล้วขยายมุมมองโลกตามขนาดจริง
      function fitCanvas(){
        // ให้ฉากสูงพอดีถึงขอบล่างของหน้าจอ ไม่ว่าแถบหัวจะกี่บรรทัด
        const top = stage.getBoundingClientRect().top + window.scrollY;
        const wantH = Math.max(560, Math.round(window.innerHeight - top - 10));
        if(stage.style.height !== wantH + 'px') stage.style.height = wantH + 'px';
        const r = stage.getBoundingClientRect();
        if(!r.width || !r.height) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.round(r.width * dpr), hh = Math.round(r.height * dpr);
        canvas.__dpr = dpr;
        if(canvas.width !== w || canvas.height !== hh){ canvas.width = w; canvas.height = hh; }
        Object.keys(hudWins).forEach(placeWin);
      }
      UI_REFS.fitCanvas = fitCanvas;
      if(typeof ResizeObserver !== 'undefined') new ResizeObserver(fitCanvas).observe(stage);
      window.addEventListener('resize', fitCanvas);

      rebuildWorldHotbar();
      updateWorldHUD();
    },
    update(){
      if(!root) return;
      syncPlayerStats();
      if(UI_REFS.rebuildWorldControls) UI_REFS.rebuildWorldControls();
      hotbarSig = '';
      rebuildWorldHotbar();
      updateWorldHUD();
    },
    onShow(){
      visible = true; lastTs = 0;
      document.body.classList.add('gx-full');
      if(UI_REFS.fitCanvas) UI_REFS.fitCanvas();
      syncPlayerStats();
      rebuildWorldHotbar();
      if(!raf) raf = requestAnimationFrame(loop);
    },
    onHide(){
      visible = false;
      document.body.classList.remove('gx-full');
      Object.keys(keys).forEach(k => { keys[k] = false; });
      if(raf){ cancelAnimationFrame(raf); raf = 0; }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
