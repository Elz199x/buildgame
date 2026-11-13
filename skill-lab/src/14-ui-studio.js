/* ============================================================
   MODULE 14 — ui-studio : สตูดิโอปรับแต่งระบบหลังบ้านแยกอิสระ
   ประกอบด้วย 2 หน้า:
   1) SL.ui.pages.formulas (#formulas) — อัพสเตตัส RO (STR/AGI/VIT/INT/DEX/LUK),
      ปรับแต่งสูตรคำนวณ Status Lab, ค่าสัมประสิทธิ์อาชีพ/อาวุธ และระบบวงเตือนมอนสเตอร์ (Telegraph)
   2) SL.ui.pages.models (#models) — พรีวิวริกกระดูกและอนิเมชัน 7 ท่าทางแบบอินเทอร์แอคทีฟ,
      ปรับแต่งสัดส่วน Chibi 2.5D และช่องเสียบโมเดล 3D (.glb/.gltf) หรือสไปรต์ภายนอก
============================================================ */
(function(g){
  const SL = g.SL, ui = SL.ui, h = ui.h, clear = ui.clear, C = SL.calc;
  const { clamp, clone, fmt } = SL.util;

  const STAT_META = [
    { key: 'str', label: 'STR (กำลัง)', desc: 'เพิ่มพลังโจมตีกายภาพ (ATK) ของอาวุธประชิด' },
    { key: 'agi', label: 'AGI (ความเร็ว)', desc: 'เพิ่มหลบหลีก (FLEE) และความเร็วโจมตี (ASPD)' },
    { key: 'vit', label: 'VIT (ความอึด)', desc: 'เพิ่มเลือดสูงสุด (MaxHP), DEF กายภาพ และรีเจนเลือด' },
    { key: 'int', label: 'INT (สติปัญญา)', desc: 'เพิ่มโจมตีเวท (MATK), MaxSP, MDEF และรีเจน SP' },
    { key: 'dex', label: 'DEX (ความแม่น)', desc: 'เพิ่มแม่นยำ (HIT), ASPD และเพิ่ม ATK อาวุธธนู' },
    { key: 'luk', label: 'LUK (โชค)', desc: 'เพิ่มคริติคอลกายภาพ/เวท (CRIT%) และหลบหลีกเสริม' }
  ];

  /* ============================================================
     1. หน้าสเตตัส & สูตรคำนวณ (#formulas)
  ============================================================ */
  ui.pages.formulas = {
    mount(root){
      this.root = root;
      this.selMonId = 'poring';
      this.render();
    },

    update(){
      this.render();
    },

    syncToSheet(){
      const st = SL.state.get();
      const res = SL.calc.computeDerivedFromRaw(st);
      SL.state.change(s => {
        s.sheet = Object.assign({}, s.sheet, res.sheet);
      });
    },

    render(){
      const root = this.root; if(!root) return;
      clear(root);
      const D = SL.store.get(), st = SL.state.get();
      const fc = D.formulaConfig || SL.DEFAULT_DATA.formulaConfig;
      const sps = fc.statusPointSystem || { startPoints: 48, levelUpOffset: 9, levelUpDivisor: 4, statCap: 99 };
      const raw = st.rawStats || { str: 40, agi: 40, vit: 30, int: 30, dex: 40, luk: 20 };
      const baseLv = clamp(Number(st.baseLv) || 50, 1, 99);
      const totalPts = SL.calc.totalStatusPoints(baseLv);
      const spentPts = SL.calc.totalStatSpent(raw);
      const remPts = totalPts - spentPts;
      const derivedRes = SL.calc.computeDerivedFromRaw(st);
      const derived = derivedRes.sheet;

      /* ---------- คอลัมน์ซ้าย: อัพสเตตัส RO + ผลลัพธ์จากสูตร ---------- */
      const leftCol = h('div', { class: 'col gap-lg' });

      // แผงที่ 1: จัดสรรแต้มสเตตัสพื้นฐาน (RO Status Allocator)
      const statPanel = h('div', { class: 'panel col' },
        h('div', { class: 'row sp-between' },
          h('h3', { style: { margin: '0' } }, '📊 จัดสรรแต้มสเตตัสพื้นฐาน (RO Status Lab)'),
          h('span', { class: 'chip ' + (remPts >= 0 ? 'ok' : 'bad') }, 'แต้มคงเหลือ: ' + remPts + ' / ' + totalPts)
        ),
        h('div', { class: 'row sp-between', style: { background: 'var(--surface-2)', padding: '8px 10px', borderRadius: '8px' } },
          h('label', { class: 'row small' }, 'อาชีพ:',
            ui.select(D.classes.map(c => ({ v: c.id, t: c.name })), st.classId, v => {
              SL.state.change(s => { s.classId = v; });
              if(SL.state.get().autoSyncStats) this.syncToSheet();
            })
          ),
          h('label', { class: 'row small' }, 'อาวุธ:',
            ui.select(D.weapons.map(w => ({ v: w.id, t: w.name })), st.weaponId, v => {
              SL.state.change(s => { s.weaponId = v; });
              if(SL.state.get().autoSyncStats) this.syncToSheet();
            })
          ),
          ui.check('สวมโล่', st.hasShield, v => {
            SL.state.change(s => { s.hasShield = v; });
            if(SL.state.get().autoSyncStats) this.syncToSheet();
          }),
          h('label', { class: 'row small' }, 'Base Lv:',
            ui.num(baseLv, v => {
              SL.state.change(s => { s.baseLv = clamp(Math.round(v), 1, 99); });
              if(SL.state.get().autoSyncStats) this.syncToSheet();
            }, { min: 1, max: 99, int: true })
          )
        )
      );

      const statTbl = h('table', { class: 'tbl' },
        h('thead', null, h('tr', null,
          h('th', null, 'ค่าสถานะ'),
          h('th', { class: 'n' }, 'ค่าพื้นฐาน'),
          h('th', { class: 'n' }, 'ค่าใช้แต้มถัดไป'),
          h('th', { class: 'n' }, 'ค่าจริงหลังเส้นโค้ง'),
          h('th', { class: 'n' }, 'ปรับค่า')
        ))
      );
      const statBody = h('tbody');
      const maxStat = sps.statCap || 99;
      STAT_META.forEach(m => {
        const curVal = clamp(Number(raw[m.key]) || 1, 1, maxStat);
        const cost = SL.calc.statCost(curVal);
        const eff = derivedRes.eff[m.key] || curVal;
        const setVal = nextVal => {
          const clamped = clamp(Math.round(nextVal), 1, maxStat);
          SL.state.change(s => {
            if(!s.rawStats) s.rawStats = { str: 40, agi: 40, vit: 30, int: 30, dex: 40, luk: 20 };
            s.rawStats[m.key] = clamped;
          });
          if(SL.state.get().autoSyncStats) this.syncToSheet();
        };
        statBody.appendChild(h('tr', null,
          h('td', null, h('b', null, m.label), h('div', { class: 'tiny muted' }, m.desc)),
          h('td', { class: 'n mono' }, String(curVal)),
          h('td', { class: 'n small muted' }, curVal >= maxStat ? 'MAX' : cost + ' แต้ม'),
          h('td', { class: 'n mono ok' }, eff.toFixed(1)),
          h('td', { class: 'n nowrap' },
            h('button', { type: 'button', class: 'btn sm', disabled: curVal <= 1, onclick: () => setVal(curVal - 10) }, '-10'), ' ',
            h('button', { type: 'button', class: 'btn sm', disabled: curVal <= 1, onclick: () => setVal(curVal - 1) }, '-1'), ' ',
            h('button', { type: 'button', class: 'btn sm primary', disabled: curVal >= maxStat, onclick: () => setVal(curVal + 1) }, '+1'), ' ',
            h('button', { type: 'button', class: 'btn sm', disabled: curVal >= maxStat, onclick: () => setVal(curVal + 10) }, '+10')
          )
        ));
      });
      statTbl.appendChild(statBody);
      statPanel.appendChild(statTbl);

      statPanel.appendChild(h('div', { class: 'row sp-between', style: { marginTop: '6px' } },
        ui.check('เชื่อมสเตตัสเข้าตัวละครในเกมอัตโนมัติ (Auto-Sync)', st.autoSyncStats !== false, v => {
          SL.state.change(s => { s.autoSyncStats = v; });
          if(v) this.syncToSheet();
        }),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn sm', onclick: () => {
            SL.state.change(s => { s.rawStats = { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 }; });
            if(SL.state.get().autoSyncStats) this.syncToSheet();
            ui.toast('รีเซ็ตแต้มสเตตัสทั้งหมดเป็น 1 แล้ว');
          } }, 'รีเซ็ตแต้มทั้งหมด'),
          h('button', { type: 'button', class: 'btn sm primary', onclick: () => {
            this.syncToSheet();
            ui.toast('ซิงก์ค่าที่คำนวณได้เข้าสู่ชีตตัวละครเรียบร้อย!');
          } }, '⚡ คำนวณและนำไปใช้กับตัวละครทันที')
        )
      ));
      leftCol.appendChild(statPanel);

      // แผงที่ 2: พรีวิวค่าสเตตัสปลายทาง + ท่าโจมตีที่เปลี่ยนตามสเตตัส (Derived Stats & Attack Motion Profile)
      const atkProf = (SL.rigRenderer && SL.rigRenderer.getAttackProfile)
        ? SL.rigRenderer.getAttackProfile(raw, derived, st.weaponId, st.hasShield)
        : null;

      const derivedPanel = h('div', { class: 'panel col' },
        h('div', { class: 'row sp-between' },
          h('h3', { style: { margin: '0' } }, '⚔️ ค่าสถานะปลายทาง & ท่าโจมตีตามสเตตัส'),
          h('a', { href: '#world', class: 'btn sm primary', style: { textDecoration: 'none' } }, '🎮 ทดสอบในโลก 2.5D')
        ),
        h('div', { class: 'cols c2' },
          h('dl', { class: 'kv panel flat' },
            h('dt', null, 'เลือดสูงสุด (MaxHP)'), h('dd', { class: 'mono ok' }, String(derived.maxHp)),
            h('dt', null, 'มานาสูงสุด (MaxSP)'), h('dd', { class: 'mono' }, String(derived.maxSp)),
            h('dt', null, 'พลังโจมตีกายภาพ (ATK)'), h('dd', { class: 'mono warn' }, String(derived.atk)),
            h('dt', null, 'พลังโจมตีเวท (MATK)'), h('dd', { class: 'mono warn' }, String(derived.matk)),
            h('dt', null, 'ป้องกันกายภาพ (DEF)'), h('dd', { class: 'mono' }, String(derived.def)),
            h('dt', null, 'ป้องกันเวท (MDEF)'), h('dd', { class: 'mono' }, String(derived.mdef))
          ),
          h('dl', { class: 'kv panel flat' },
            h('dt', null, 'ความแม่นยำ (HIT)'), h('dd', { class: 'mono' }, String(derived.hit)),
            h('dt', null, 'หลบหลีก (FLEE / Block)'), h('dd', { class: 'mono' }, derived.flee + ' / ' + Math.round((derived.blockChance || 0) * 100) + '%'),
            h('dt', null, 'คริกายภาพ / คริเวท'), h('dd', { class: 'mono' }, derived.physCrit + '% / ' + derived.magicCrit + '%'),
            h('dt', null, 'ความเร็วโจมตี (ASPD)'), h('dd', { class: 'mono ok' }, derived.aspd + ' (' + (100 / Math.max(1, 200 - derived.aspd)).toFixed(2) + ' ครั้ง/วิ)'),
            h('dt', null, 'ฟื้นฟูเลือด / มานา ต่อวิ'), h('dd', { class: 'mono' }, '+' + derived.hpRegen + ' HP / +' + derived.spRegen + ' SP'),
            h('dt', null, 'ระยะอาวุธในโลก 2.5D'), h('dd', { class: 'mono' }, derivedRes.weaponRange + ' px')
          )
        ),
        atkProf ? h('div', { class: 'panel flat col', style: { marginTop: '6px' } },
          h('div', { class: 'row sp-between' },
            h('b', { class: 'small' }, '🔥 ท่าโจมตีและเอฟเฟกต์ที่ปลดล็อกตามค่าสเตตัสปัจจุบัน (Dynamic Stat-Driven Moves):'),
            h('a', { href: '#models', class: 'tiny', style: { color: 'var(--accent)' } }, '🎬 ดูอนิเมชันในสตูดิโอ →')
          ),
          h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px', marginTop: '4px' } },
            atkProf.badges.map(b => h('span', { class: 'chip', style: { borderColor: b.color, color: b.color } }, '[' + b.stat + '] ' + b.text))
          ),
          h('div', { class: 'tiny muted', style: { marginTop: '4px' } },
            'เกณฑ์ปลดล็อกท่าพิเศษ: AGI ≥ 38 (คอมโบ 2 จังหวะ) · AGI ≥ 65 (คอมโบ 3 จังหวะหมุนตัว 360° + เงาติดตา) · STR ≥ 50 (อาวุธใหญ่ขึ้น + คลื่นดาบ 2 ชั้น) · STR ≥ 75 (ทุบพื้นระเบิดวง) · INT ≥ 40 (ออร่าดาบเวท + ลูกแก้วรูน) · DEX ≥ 50 (ศร/มีดแสงเลเซอร์ทะลวง) · LUK ≥ 45 (กระโดดผ่าคริติคอลสายฟ้า X-Slash) · VIT ≥ 45 + โล่ (ตั้งการ์ดโล่กระแทก)'
          )
        ) : null
      );
      leftCol.appendChild(derivedPanel);

      // แผงที่ 2B: หน้าต่างอุปกรณ์ Paperdoll [Alt+Q] + ช่องกระเป๋าไอเทม [Alt+E] + ช่องเก็บของคาฟรา & เรดาร์ 13 ธาตุ RO
      const elSys = D.elementSystem || { elements: [], matrix: {} };
      const elList = elSys.elements || [];
      const roSuiteWrap = h('div');
      if(SL.ui && SL.ui.renderRoInventorySuite){
        SL.ui.renderRoInventorySuite(roSuiteWrap, {
          showClose: false,
          onChange: () => {
            if(SL.state.get().autoSyncStats) this.syncToSheet();
            this.render();
          }
        });
      }

      const equipPanel = h('div', { class: 'panel col' },
        h('div', { class: 'row sp-between' },
          h('h3', { style: { margin: '0' } }, '👑 หน้าต่างอุปกรณ์ Paperdoll [Alt+Q] · ช่องกระเป๋าไอเทม [Alt+E] · ช่องเก็บของคาฟรา & 13 ธาตุ'),
          h('span', { class: 'chip ok' }, '🪙 ' + (st.gold || 0).toLocaleString() + ' Zeny · ซิงก์กับโลก 2.5D อัตโนมัติ')
        ),
        roSuiteWrap,
        h('details', null,
          h('summary', null, '🧭 คู่มือความสัมพันธ์แพ้ทาง-ชนะทางทั้ง 13 ธาตุ (Elemental Guide)'),
          h('div', { class: 'cols c2', style: { marginTop: '6px' } },
            elList.map(el => {
              const r = C.elementRelations ? C.elementRelations(el.id) : { strongAgainst:[], weakToAttackers:[] };
              return h('div', { class: 'panel flat col' },
                h('b', { class: 'small', style: { color: el.color || '#e2e8f0' } }, (el.icon || '') + ' ' + el.name + ' (' + el.id.toUpperCase() + ')'),
                h('div', { class: 'tiny muted' }, el.desc || ''),
                h('div', { class: 'tiny ok' }, '⚔️ โจมตีชนะ: ' + (r.strongAgainst.length ? r.strongAgainst.map(x => x.icon + x.name + '×' + x.mult).join(', ') : 'ตีปกติ ×1.0')),
                h('div', { class: 'tiny bad' }, '🎯 แพ้ทางธาตุ: ' + (r.weakToAttackers.length ? r.weakToAttackers.map(x => x.icon + x.name + '×' + x.mult).join(', ') : 'ไม่มีจุดอ่อนชัดเจน'))
              );
            })
          )
        ),
        h('details', null,
          h('summary', null, '🔥 ตารางแพ้-ชนะธาตุ RO 13×13 (Elemental Matrix — ปรับแต่งตัวคูณได้)'),
          h('div', { style: { overflowX: 'auto', marginTop: '6px' } },
            (() => {
              const tbl = h('table', { class: 'tbl', style: { fontSize: '11px' } });
              const thead = h('tr', null, h('th', null, 'โจมตี \\ เป้าหมาย'));
              elList.forEach(el => thead.appendChild(h('th', { class: 'n' }, (el.icon || '') + el.name)));
              tbl.appendChild(h('thead', null, thead));
              const tb = h('tbody');
              elList.forEach(atkEl => {
                const tr = h('tr', null, h('td', null, h('b', null, (atkEl.icon || '') + ' ' + atkEl.name)));
                elList.forEach(defEl => {
                  const curM = ((elSys.matrix || {})[atkEl.id] || {})[defEl.id];
                  const valM = curM === undefined ? 1.0 : curM;
                  tr.appendChild(h('td', { class: 'n' },
                    ui.num(valM, v => {
                      SL.store.change(d => {
                        d.elementSystem.matrix[atkEl.id] = d.elementSystem.matrix[atkEl.id] || {};
                        d.elementSystem.matrix[atkEl.id][defEl.id] = clamp(v, 0, 5);
                      });
                    }, { step: 0.25 })
                  ));
                });
                tb.appendChild(tr);
              });
              tbl.appendChild(tb);
              return tbl;
            })()
          )
        )
      );
      leftCol.appendChild(equipPanel);

      /* ---------- คอลัมน์ขวา: ปรับแต่งสูตรคำนวณ & มอนสเตอร์ ---------- */
      const rightCol = h('div', { class: 'col gap-lg' });

      // แผงที่ 3: ปรับค่าคงที่ของสูตร Status Lab (Formula Constants)
      const bc = fc.baseConstants;
      const gl = D.globals;
      const constPanel = h('div', { class: 'panel col' },
        h('div', { class: 'row sp-between' },
          h('h3', { style: { margin: '0' } }, '🔧 ปรับแต่งสมการคำนวณหลัก (Formula Engine)'),
          ui.confirmBtn('คืนค่าสูตรเริ่มต้น', () => {
            SL.store.change(d => {
              d.formulaConfig = clone(SL.DEFAULT_DATA.formulaConfig);
              d.globals = clone(SL.DEFAULT_DATA.globals);
            }, 'full');
            if(SL.state.get().autoSyncStats) this.syncToSheet();
            ui.toast('คืนค่าสูตรคำนวณเริ่มต้นแล้ว');
          }, 'sm')
        ),
        h('div', { class: 'small muted' }, 'ปรับเปลี่ยนตัวคูณสมการได้ทันที ระบบจะคำนวณสเตตัสและดาเมจในโหมดเล่นเกมจริงตามสูตรนี้ทันที'),
        h('div', { class: 'cols c2' },
          h('div', { class: 'panel flat col' },
            h('h4', null, 'สมการ HP / SP / ASPD / CRIT'),
            ui.field('HP ต่อ 1 VIT (hpPerVit)', ui.num(bc.hpPerVit, v => {
              SL.store.change(d => { d.formulaConfig.baseConstants.hpPerVit = clamp(v, 0, 200); });
              if(SL.state.get().autoSyncStats) this.syncToSheet();
            }, { step: 0.5 })),
            ui.field('SP ต่อ 1 INT (spPerInt)', ui.num(bc.spPerInt, v => {
              SL.store.change(d => { d.formulaConfig.baseConstants.spPerInt = clamp(v, 0, 200); });
              if(SL.state.get().autoSyncStats) this.syncToSheet();
            }, { step: 0.5 })),
            ui.field('MATK ต่อ 1 INT (matkPerInt)', ui.num(bc.matkPerInt, v => {
              SL.store.change(d => { d.formulaConfig.baseConstants.matkPerInt = clamp(v, 0, 50); });
              if(SL.state.get().autoSyncStats) this.syncToSheet();
            }, { step: 0.1 })),
            ui.field('ASPD ต่อ 1 AGI (aspdPerAgi)', ui.num(bc.aspdPerAgi, v => {
              SL.store.change(d => { d.formulaConfig.baseConstants.aspdPerAgi = clamp(v, 0, 5); });
              if(SL.state.get().autoSyncStats) this.syncToSheet();
            }, { step: 0.05 })),
            ui.field('CRIT% ต่อ 1 LUK (critPerLuk)', ui.num(bc.critPerLuk, v => {
              SL.store.change(d => { d.formulaConfig.baseConstants.critPerLuk = clamp(v, 0, 5); });
              if(SL.state.get().autoSyncStats) this.syncToSheet();
            }, { step: 0.05 }))
          ),
          h('div', { class: 'panel flat col' },
            h('h4', null, 'ระบบเคลื่อนที่ & สมการป้องกันโลก 2.5D'),
            ui.field('ความเร็วเดินพื้นฐาน (moveSpeedBase px/s)', ui.num(bc.moveSpeedBase || 195, v => {
              SL.store.change(d => { d.formulaConfig.baseConstants.moveSpeedBase = clamp(v, 60, 500); });
            }, { step: 5 })),
            ui.field('คูลดาวน์กลิ้งหลบ Dodge Roll (วินาที)', ui.num(bc.rollCooldown || 1.1, v => {
              SL.store.change(d => { d.formulaConfig.baseConstants.rollCooldown = clamp(v, 0.2, 10); });
            }, { step: 0.1 })),
            ui.field('ระยะกลิ้งหลบ Dodge Roll (px)', ui.num(bc.rollDistance || 135, v => {
              SL.store.change(d => { d.formulaConfig.baseConstants.rollDistance = clamp(v, 40, 400); });
            }, { step: 5 })),
            ui.field('สัมประสิทธิ์ความถึก DEF/MDEF (softDefK)', ui.num(gl.softDefK, v => {
              SL.store.change(d => { d.globals.softDefK = clamp(v, 10, 2000); });
            }, { step: 10 })),
            ui.field('ตัวคูณความแรงคริติคอล (critMult ×)', ui.num(gl.critMult, v => {
              SL.store.change(d => { d.globals.critMult = clamp(v, 1, 5); });
            }, { step: 0.05 }))
          )
        )
      );

      // ตารางปรับค่าสัมประสิทธิ์อาชีพ (Class Coefs)
      const clsDetails = h('details', null,
        h('summary', null, '🛡️ ตารางตัวคูณเลือดและมานาประจำอาชีพ (Class Coefficients)'),
        (() => {
          const tbl = h('table', { class: 'tbl', style: { marginTop: '6px' } },
            h('thead', null, h('tr', null,
              h('th', null, 'อาชีพ'),
              h('th', { class: 'n' }, 'ตัวคูณ MaxHP (hpCoef ×)'),
              h('th', { class: 'n' }, 'ตัวคูณ MaxSP (spCoef ×)')
            ))
          );
          const tb = h('tbody');
          D.classes.forEach(c => {
            const cf = (fc.classCoefs && fc.classCoefs[c.id]) || { hpCoef: 1.0, spCoef: 1.0 };
            const setCf = (k, val) => {
              SL.store.change(d => {
                if(!d.formulaConfig.classCoefs[c.id]) d.formulaConfig.classCoefs[c.id] = Object.assign({}, cf);
                d.formulaConfig.classCoefs[c.id][k] = val;
              });
              if(SL.state.get().autoSyncStats) this.syncToSheet();
            };
            tb.appendChild(h('tr', null,
              h('td', null, h('b', null, c.name)),
              h('td', { class: 'n' }, ui.num(cf.hpCoef, v => setCf('hpCoef', v), { step: 0.05 })),
              h('td', { class: 'n' }, ui.num(cf.spCoef, v => setCf('spCoef', v), { step: 0.05 }))
            ));
          });
          tbl.appendChild(tb);
          return tbl;
        })()
      );
      constPanel.appendChild(clsDetails);

      // ตารางปรับค่าอาวุธและระยะโจมตีในโลก 2.5D (Weapon Profiles)
      const wpDetails = h('details', null,
        h('summary', null, '🗡️ ตารางตัวคูณอาวุธ & ระยะโจมตีในโลก 2.5D (Weapon Profiles)'),
        (() => {
          const tbl = h('table', { class: 'tbl', style: { marginTop: '6px' } },
            h('thead', null, h('tr', null,
              h('th', null, 'อาวุธ'),
              h('th', { class: 'n' }, 'สเตตัสหลัก'),
              h('th', { class: 'n' }, 'ตัวคูณ×'),
              h('th', { class: 'n' }, 'ASPD±'),
              h('th', { class: 'n' }, 'MATK+%'),
              h('th', { class: 'n' }, 'ระยะตี (px)')
            ))
          );
          const tb = h('tbody');
          D.weapons.forEach(w => {
            const wp = (fc.weaponProfiles && fc.weaponProfiles[w.id]) || { stat: 'str', coeff: 1.0, aspdOffset: 0, range: 80, matkPercent: 0 };
            const setWp = (k, val) => {
              SL.store.change(d => {
                if(!d.formulaConfig.weaponProfiles[w.id]) d.formulaConfig.weaponProfiles[w.id] = Object.assign({}, wp);
                d.formulaConfig.weaponProfiles[w.id][k] = val;
              });
              if(SL.state.get().autoSyncStats) this.syncToSheet();
            };
            tb.appendChild(h('tr', null,
              h('td', null, h('b', null, w.name)),
              h('td', { class: 'n' }, ui.select(['str', 'agi', 'vit', 'int', 'dex', 'luk'].map(s => ({ v: s, t: s.toUpperCase() })), wp.stat || 'str', v => setWp('stat', v))),
              h('td', { class: 'n' }, ui.num(wp.coeff, v => setWp('coeff', v), { step: 0.1 })),
              h('td', { class: 'n' }, ui.num(wp.aspdOffset, v => setWp('aspdOffset', v), { step: 1 })),
              h('td', { class: 'n' }, ui.num(Math.round((wp.matkPercent || 0) * 100), v => setWp('matkPercent', v / 100), { step: 5 })),
              h('td', { class: 'n' }, ui.num(wp.range || 80, v => setWp('range', clamp(v, 30, 500)), { step: 5 }))
            ));
          });
          tbl.appendChild(tb);
          return tbl;
        })()
      );
      constPanel.appendChild(wpDetails);
      rightCol.appendChild(constPanel);

      // แผงที่ 4: ปรับแต่งมอนสเตอร์ & วงแดงเตือนท่าโจมตี (Monster & Cat Quest Telegraph Editor)
      const curMon = D.monsters.find(m => m.id === this.selMonId) || D.monsters[0];
      if(curMon) this.selMonId = curMon.id;
      const mw = (curMon && curMon.world) || { moveSpeed: 85, aggroRange: 190, attackRange: 58, telegraph: { name: 'โจมตีหนัก', cd: 7, castTime: 1.3, shape: 'circle', radius: 90, angle: 360, mult: 1.8 } };
      const tg = mw.telegraph || { name: 'โจมตีหนัก', cd: 7, castTime: 1.3, shape: 'circle', radius: 90, angle: 360, mult: 1.8 };

      const monPanel = h('div', { class: 'panel col' },
        h('div', { class: 'row sp-between' },
          h('h3', { style: { margin: '0' } }, '👾 ปรับแต่งมอนสเตอร์ & วงแดงเตือนภัย (ซิงก์ทุกหน้าอัตโนมัติ)'),
          h('div', { class: 'row' },
            ui.select(D.monsters.map(m => ({ v: m.id, t: m.name })), this.selMonId, v => {
              this.selMonId = v;
              this.render();
            }),
            h('button', { type: 'button', class: 'btn sm primary', onclick: () => {
              const newId = 'mob_' + (D.monsters.length + 1) + '_' + Math.floor(Math.random() * 90 + 10);
              SL.store.change(d => {
                d.monsters.push({
                  id: newId,
                  name: 'มอนสเตอร์ใหม่ #' + (d.monsters.length + 1),
                  def: 45, mdef: 25, flee: 65, maxHp: 6500, atk: 110, hit: 95, interval: 1.9,
                  world: {
                    bodyType: 'wolf', color: '#4fd1c5', scale: 1.05, moveSpeed: 115, aggroRange: 220, attackRange: 68,
                    telegraph: { name: 'คลื่นกระแทกรอบตัว', cd: 7, castTime: 1.2, shape: 'circle', radius: 105, angle: 360, mult: 1.9 }
                  }
                });
              });
              this.selMonId = newId;
              ui.toast('สร้างมอนสเตอร์ใหม่และซิงก์เข้าทุกหน้าเรียบร้อย!');
            } }, '＋ เพิ่มมอนสเตอร์ใหม่')
          )
        ),
        curMon ? h('div', { class: 'cols c2' },
          h('div', { class: 'panel flat col' },
            h('h4', null, 'ค่าสถานะมอนสเตอร์ (' + curMon.id + ')'),
            ui.field('ชื่อมอนสเตอร์ (เปลี่ยนแล้วอัปเดตทั้งแมพทันที)',
              ui.text(curMon.name || '', v => SL.store.change(d => {
                const m = d.monsters.find(x => x.id === curMon.id);
                if(m) m.name = v || curMon.id;
              }))
            ),
            h('div', { class: 'row' },
              ui.field('ธาตุ (Element)', ui.select(elList.map(e => ({ v: e.id, t: (e.icon || '') + ' ' + e.name })), curMon.element || 'neutral', v => SL.store.change(d => {
                d.monsters.find(x => x.id === curMon.id).element = v;
              }))),
              ui.field('ขนาด (Size)', ui.select([
                { v: 'small', t: 'S ขนาดเล็ก' },
                { v: 'medium', t: 'M ขนาดกลาง' },
                { v: 'large', t: 'L ขนาดใหญ่' }
              ], curMon.size || 'medium', v => SL.store.change(d => {
                d.monsters.find(x => x.id === curMon.id).size = v;
              })))
            ),
            h('div', { class: 'row' },
              ui.field('Max HP', ui.num(curMon.maxHp, v => SL.store.change(d => { d.monsters.find(x => x.id === curMon.id).maxHp = Math.max(1, v); }))),
              ui.field('ATK', ui.num(curMon.atk, v => SL.store.change(d => { d.monsters.find(x => x.id === curMon.id).atk = Math.max(0, v); })))
            ),
            h('div', { class: 'row' },
              ui.field('DEF', ui.num(curMon.def, v => SL.store.change(d => { d.monsters.find(x => x.id === curMon.id).def = Math.max(0, v); }))),
              ui.field('MDEF', ui.num(curMon.mdef, v => SL.store.change(d => { d.monsters.find(x => x.id === curMon.id).mdef = Math.max(0, v); })))
            ),
            h('div', { class: 'row' },
              ui.field('Base EXP', ui.num((curMon.exp && curMon.exp.base) || 0, v => SL.store.change(d => {
                const m = d.monsters.find(x => x.id === curMon.id); m.exp = m.exp || { base: 0, job: 0 }; m.exp.base = Math.max(0, Math.round(v));
              }))),
              ui.field('Job EXP', ui.num((curMon.exp && curMon.exp.job) || 0, v => SL.store.change(d => {
                const m = d.monsters.find(x => x.id === curMon.id); m.exp = m.exp || { base: 0, job: 0 }; m.exp.job = Math.max(0, Math.round(v));
              })))
            ),
            h('div', { class: 'row' },
              ui.field('ความเร็วเดิน (px/s)', ui.num(mw.moveSpeed, v => SL.store.change(d => {
                const m = d.monsters.find(x => x.id === curMon.id); m.world = m.world || {}; m.world.moveSpeed = clamp(v, 0, 350);
              }))),
              ui.field('ระยะไล่ล่า (Aggro px)', ui.num(mw.aggroRange, v => SL.store.change(d => {
                const m = d.monsters.find(x => x.id === curMon.id); m.world = m.world || {}; m.world.aggroRange = clamp(v, 0, 600);
              })))
            )
          ),
          h('div', { class: 'panel flat col' },
            h('h4', null, '🔴 วงเตือนท่าไม้ตาย (Cat Quest Telegraph)'),
            ui.field('ชื่อท่าโจมตีพื้นที่',
              ui.text(tg.name || '', v => SL.store.change(d => {
                const m = d.monsters.find(x => x.id === curMon.id); m.world = m.world || {}; m.world.telegraph = m.world.telegraph || {};
                m.world.telegraph.name = v;
              }))
            ),
            h('div', { class: 'row' },
              ui.field('รูปทรงวงเตือน',
                ui.select([
                  { v: 'circle', t: '⭕ วงกลมรอบตัว (Circle)' },
                  { v: 'cone', t: '📐 กรวยด้านหน้า (Cone)' },
                  { v: 'line', t: '📏 เส้นพุ่งชน (Line)' }
                ], tg.shape || 'circle', v => SL.store.change(d => {
                  const m = d.monsters.find(x => x.id === curMon.id); m.world = m.world || {}; m.world.telegraph = m.world.telegraph || {};
                  m.world.telegraph.shape = v;
                }))
              ),
              ui.field('ตัวคูณความแรง (× ATK)',
                ui.num(tg.mult || 1.8, v => SL.store.change(d => {
                  const m = d.monsters.find(x => x.id === curMon.id); m.world = m.world || {}; m.world.telegraph = m.world.telegraph || {};
                  m.world.telegraph.mult = clamp(v, 0.2, 20);
                }, { step: 0.1 }))
              )
            ),
            h('div', { class: 'row' },
              ui.field('เวลาร่ายวงแดง (วิ)',
                ui.num(tg.castTime || 1.3, v => SL.store.change(d => {
                  const m = d.monsters.find(x => x.id === curMon.id); m.world = m.world || {}; m.world.telegraph = m.world.telegraph || {};
                  m.world.telegraph.castTime = clamp(v, 0.3, 10);
                }, { step: 0.1 }))
              ),
              ui.field('คูลดาวน์ท่า (วิ)',
                ui.num(tg.cd || 7, v => SL.store.change(d => {
                  const m = d.monsters.find(x => x.id === curMon.id); m.world = m.world || {}; m.world.telegraph = m.world.telegraph || {};
                  m.world.telegraph.cd = clamp(v, 1, 60);
                }, { step: 0.5 }))
              ),
              ui.field('รัศมี/ความยาว (px)',
                ui.num(tg.radius || 90, v => SL.store.change(d => {
                  const m = d.monsters.find(x => x.id === curMon.id); m.world = m.world || {}; m.world.telegraph = m.world.telegraph || {};
                  m.world.telegraph.radius = clamp(v, 25, 450);
                }, { step: 5 }))
              )
            )
          )
        ) : null
      );
      rightCol.appendChild(monPanel);

      // แผงที่ 5: ปรับแต่งแผนที่โลกหลายแมพ (Multi-Map) & จุดเกิดมอนสเตอร์ + ส่งออก Config ให้ Go/Node Server
      const wm = D.worldMap || SL.DEFAULT_DATA.worldMap || { zones: [], spawns: [], maps: [] };
      const allMaps = Array.isArray(wm.maps) && wm.maps.length ? wm.maps : [];
      const curMapObj = allMaps.find(m => m.id === wm.currentMapId) || allMaps[0] || wm;

      const mapPanel = h('div', { class: 'panel col' },
        h('div', { class: 'row sp-between' },
          h('h3', { style: { margin: '0' } }, '🗺️ ปรับแต่งแผนที่โลก Multi-Map & จุดเกิดมอนสเตอร์'),
          h('div', { class: 'row' },
            allMaps.length ? ui.select(allMaps.map(m => ({ v: m.id, t: '🗺️ ' + m.name })), curMapObj.id, v => {
              SL.store.change(d => {
                const found = (d.worldMap.maps || []).find(x => x.id === v);
                if(found){
                  d.worldMap.currentMapId = found.id;
                  d.worldMap.zones = found.zones;
                  d.worldMap.spawns = found.spawns;
                  d.worldMap.portals = found.portals;
                }
              });
            }) : null,
            h('button', { type: 'button', class: 'btn sm primary', onclick: () => {
              const cur = SL.store.get();
              const sharedCfg = {
                version: cur.version,
                exportedAt: new Date().toISOString(),
                globals: cur.globals,
                formulaConfig: cur.formulaConfig,
                elementSystem: cur.elementSystem,
                monsters: cur.monsters,
                worldMap: cur.worldMap
              };
              const blob = new Blob([JSON.stringify(sharedCfg, null, 2)], { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'shared-world-config.json';
              a.click();
              ui.toast('ส่งออก shared-world-config.json สำหรับ Go/Node Server แล้ว!');
            } }, '📤 ส่งออก Server Config (.json)'),
            ui.confirmBtn('คืนค่าแมพเริ่มต้น', () => {
              SL.store.change(d => { d.worldMap = clone(SL.DEFAULT_DATA.worldMap); });
              ui.toast('คืนค่าโซนแผนที่และจุดเกิดมอนสเตอร์เริ่มต้นแล้ว');
            }, 'sm')
          )
        ),
        h('div', { class: 'small muted' }, 'แก้ไขชื่อโซน พิกัด หรือเปลี่ยนชนิดมอนสเตอร์ในแต่ละจุดเกิดได้ทันที โลก 2.5D (#world) และมินิแมพจะเปลี่ยนตามอัตโนมัติโดยไม่ต้องแก้โค้ดส่วนอื่น'),
        h('details', { open: true },
          h('summary', null, '📍 ตารางจุดเกิดมอนสเตอร์บนแผนที่ (' + (curMapObj.spawns || wm.spawns || []).length + ' จุด)'),
          (() => {
            const box = h('div', { class: 'col', style: { marginTop: '6px' } });
            const tbl = h('table', { class: 'tbl' },
              h('thead', null, h('tr', null,
                h('th', null, '#'),
                h('th', null, 'มอนสเตอร์ที่เกิด'),
                h('th', { class: 'n' }, 'พิกัด X (px)'),
                h('th', { class: 'n' }, 'พิกัด Y (px)'),
                h('th', { class: 'n' }, 'จัดการ')
              ))
            );
            const tb = h('tbody');
            (curMapObj.spawns || wm.spawns || []).forEach((sp, idx) => {
              tb.appendChild(h('tr', null,
                h('td', { class: 'mono tiny muted' }, sp.id || ('sp_' + (idx + 1))),
                h('td', null, ui.select(D.monsters.map(m => ({ v: m.id, t: m.name })), sp.monsterId, v => {
                  SL.store.change(d => { d.worldMap.spawns[idx].monsterId = v; });
                })),
                h('td', { class: 'n' }, ui.num(sp.x, v => {
                  SL.store.change(d => { d.worldMap.spawns[idx].x = clamp(Math.round(v), 60, 2340); });
                }, { step: 20 })),
                h('td', { class: 'n' }, ui.num(sp.y, v => {
                  SL.store.change(d => { d.worldMap.spawns[idx].y = clamp(Math.round(v), 60, 1640); });
                }, { step: 20 })),
                h('td', { class: 'n' }, h('button', { type: 'button', class: 'btn sm danger', onclick: () => {
                  SL.store.change(d => { d.worldMap.spawns.splice(idx, 1); });
                } }, 'ลบ'))
              ));
            });
            tbl.appendChild(tb);
            box.appendChild(tbl);
            box.appendChild(h('div', { class: 'row', style: { marginTop: '6px' } },
              h('button', { type: 'button', class: 'btn sm primary', onclick: () => {
                SL.store.change(d => {
                  const nextIdx = (d.worldMap.spawns || []).length + 1;
                  d.worldMap.spawns.push({ id: 'sp_' + Date.now().toString(36), monsterId: this.selMonId || 'poring', x: 960 + (nextIdx % 5) * 45, y: 420 + (nextIdx % 4) * 45 });
                });
                ui.toast('เพิ่มจุดเกิดมอนสเตอร์บนแมพแล้ว!');
              } }, '＋ เพิ่มจุดเกิดมอนสเตอร์ลงแมพ')
            ));
            return box;
          })()
        ),
        h('details', null,
          h('summary', null, '🏰 ตารางโซนแผนที่ & จุดวาร์ปด่วน (' + (curMapObj.zones || wm.zones || []).length + ' โซน)'),
          (() => {
            const tbl = h('table', { class: 'tbl', style: { marginTop: '6px' } },
              h('thead', null, h('tr', null,
                h('th', null, 'ชื่อโซนบนแผนที่'),
                h('th', null, 'คำอธิบายย่อย'),
                h('th', { class: 'n' }, 'X'),
                h('th', { class: 'n' }, 'Y'),
                h('th', { class: 'n' }, 'รัศมี')
              ))
            );
            const tb = h('tbody');
            (curMapObj.zones || wm.zones || []).forEach((z, idx) => {
              tb.appendChild(h('tr', null,
                h('td', null, ui.text(z.name, v => SL.store.change(d => { d.worldMap.zones[idx].name = v; }))),
                h('td', null, ui.text(z.sub || '', v => SL.store.change(d => { d.worldMap.zones[idx].sub = v; }))),
                h('td', { class: 'n' }, ui.num(z.x, v => SL.store.change(d => { d.worldMap.zones[idx].x = clamp(Math.round(v), 100, 2300); }), { step: 20 })),
                h('td', { class: 'n' }, ui.num(z.y, v => SL.store.change(d => { d.worldMap.zones[idx].y = clamp(Math.round(v), 100, 1600); }), { step: 20 })),
                h('td', { class: 'n' }, ui.num(z.r, v => SL.store.change(d => { d.worldMap.zones[idx].r = clamp(Math.round(v), 80, 600); }), { step: 10 }))
              ));
            });
            tbl.appendChild(tb);
            return tbl;
          })()
        )
      );
      rightCol.appendChild(mapPanel);

      root.appendChild(h('div', { class: 'cols c2' }, leftCol, rightCol));
    }
  };

  /* ============================================================
     2. หน้าโมเดล & ริกตัวละคร (#models)
  ============================================================ */
  const ANIM_STATES = [
    { id: 'idle', label: '🧍 ยืนพัก (Idle)' },
    { id: 'walk', label: '🏃 เดิน/วิ่ง (Walk)' },
    { id: 'attack', label: '⚔️ โจมตี (Attack)' },
    { id: 'cast', label: '✨ ร่ายเวท (Cast)' },
    { id: 'roll', label: '💨 กลิ้งหลบ (Dodge Roll)' },
    { id: 'hurt', label: '💥 โดนโจมตี (Hurt)' },
    { id: 'dead', label: '💀 ล้ม/ตาย (Dead)' }
  ];

  ui.pages.models = {
    mount(root){
      this.root = root;
      this.targetKind = 'class'; // 'class' | 'monster'
      this.targetId = 'swordman';
      this.previewAnim = 'idle';
      this.previewWeapon = 'sword_1h';
      this.previewShield = true;
      this.previewFacing = 1;
      this.animSpeed = 1;
      this.animTime = 0;
      this._raf = 0;
      this.render();
    },

    onShow(){
      this.startLoop();
    },

    onHide(){
      if(this._raf){ cancelAnimationFrame(this._raf); this._raf = 0; }
    },

    update(){
      this.render();
    },

    startLoop(){
      if(this._raf) cancelAnimationFrame(this._raf);
      let last = performance.now();
      const step = now => {
        const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
        last = now;
        this.animTime += dt * (this.animSpeed || 1);
        this.drawPreview();
        this._raf = requestAnimationFrame(step);
      };
      this._raf = requestAnimationFrame(step);
    },

    drawPreview(){
      const cv = this.canvas; if(!cv) return;
      const ctx = cv.getContext('2d');
      const W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);

      // วาดพื้นหลังฉาก Storybook จำลอง
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#1e293b');
      grad.addColorStop(0.65, '#2b394a');
      grad.addColorStop(0.66, '#3b5235');
      grad.addColorStop(1, '#293b24');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // ตารางอ้างอิงสัดส่วนพิกเซล (Grid)
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      for(let x = 0; x < W; x += 32){ ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for(let y = 0; y < H; y += 32){ ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

      // วงแหวนจุดยืนตัวละคร (Origin Pivot)
      const cx = W * 0.5, cy = H * 0.74;
      ctx.strokeStyle = 'rgba(209, 164, 76, 0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 48, 18, 0, 0, Math.PI * 2);
      ctx.stroke();

      // วาดตัวละครหรือมอนสเตอร์ด้วย SL.rigRenderer ขยาย 2.2 เท่าเพื่อให้ตรวจเช็คข้อต่อชัดเจน
      const D = SL.store.get();
      const st = SL.state.get();
      if(this.targetKind === 'class'){
        const prof = SL.rigRenderer.getAttackProfile(st.rawStats, st.sheet, this.previewWeapon, this.previewShield);
        SL.rigRenderer.drawCharacter(ctx, cx, cy, {
          classId: this.targetId,
          weaponId: this.previewWeapon,
          hasShield: this.previewShield,
          rawStats: st.rawStats,
          sheet: st.sheet,
          attackProfile: prof,
          facing: this.previewFacing,
          animState: this.previewAnim,
          animTime: this.animTime,
          scale: 2.25
        });

        // วาดเอฟเฟกต์คลื่นดาบจำลองตามค่าสเตตัสเมื่อเลือกท่า Attack
        if(this.previewAnim === 'attack'){
          const cycleRate = Math.max(1.6, prof.aps * 1.15);
          const phase = (this.animTime * cycleRate) % 1;
          const step = Math.floor(this.animTime * cycleRate) % prof.comboMax;
          if(phase > 0.2 && phase < 0.75){
            ctx.save();
            ctx.globalAlpha = 1 - (phase - 0.2) / 0.55;
            ctx.strokeStyle = prof.arcaneEnchant ? '#b794f4' : (prof.heavyCleave ? '#f6ad55' : '#ffffff');
            ctx.lineWidth = prof.heavyCleave ? 9 : 5;
            ctx.lineCap = 'round';
            const r = 82 * prof.weaponScale;
            const ang = this.previewFacing >= 0 ? 0 : Math.PI;
            ctx.beginPath();
            if(step === 2){
              ctx.arc(cx, cy - 35, r * 1.05, 0, Math.PI * 1.85);
            } else {
              ctx.arc(cx, cy - 35, r, ang - 0.85, ang + 0.85);
            }
            ctx.stroke();
            ctx.restore();
          }
        }
      }else{
        const mon = D.monsters.find(m => m.id === this.targetId) || D.monsters[0];
        SL.rigRenderer.drawMonster(ctx, cx, cy, {
          monsterId: this.targetId,
          world: mon ? mon.world : {},
          facing: this.previewFacing,
          animState: this.previewAnim,
          animTime: this.animTime,
          scale: 2.15
        });
      }

      // ป้ายกำกับสถานะมุมซ้ายบนของจอพรีวิว
      ctx.fillStyle = 'rgba(18, 22, 29, 0.82)';
      ctx.fillRect(10, 10, 320, 52);
      ctx.fillStyle = '#d1a44c';
      ctx.font = '600 13px "Chakra Petch", sans-serif';
      ctx.fillText('Target: ' + this.targetKind.toUpperCase() + ' / ' + this.targetId, 18, 28);
      ctx.fillStyle = '#e7eaf0';
      ctx.font = '12px monospace';
      ctx.fillText('State: ' + this.previewAnim + ' | ASPD ' + ((st.sheet && st.sheet.aspd) || 156) + ' | t=' + this.animTime.toFixed(2) + 's', 18, 48);
    },

    render(){
      const root = this.root; if(!root) return;
      clear(root);
      const D = SL.store.get();
      const slots = D.modelSlots || SL.DEFAULT_DATA.modelSlots;

      /* ---------- คอลัมน์ซ้าย: จอพรีวิว Rigging & Animation แบบอินเทอร์แอคทีฟ ---------- */
      this.canvas = h('canvas', { width: 520, height: 340, style: { width: '100%', maxWidth: '560px', height: 'auto', borderRadius: '10px', border: '1px solid var(--border)', display: 'block', margin: '0 auto' } });

      const animBtns = h('div', { class: 'row' });
      ANIM_STATES.forEach(a => {
        animBtns.appendChild(h('button', {
          type: 'button',
          class: 'btn sm' + (this.previewAnim === a.id ? ' primary' : ''),
          onclick: () => { this.previewAnim = a.id; this.animTime = 0; this.render(); }
        }, a.label));
      });

      const leftCol = h('div', { class: 'panel col' },
        h('div', { class: 'row sp-between' },
          h('h3', { style: { margin: '0' } }, '🎬 สตูดิโอทดสอบริกและอนิเมชัน (2.5D Rigging & Animation)'),
          h('a', { href: '#world', class: 'btn sm primary', style: { textDecoration: 'none' } }, '🎮 ทดสอบเดินในฉากจริง')
        ),
        this.canvas,
        h('div', { class: 'col', style: { background: 'var(--surface-2)', padding: '10px', borderRadius: '8px' } },
          h('div', { class: 'small muted' }, 'คลิกเลือกท่าทางเพื่อทดสอบการขยับข้อต่อ (หัว/หู/ลำตัว/แขน/ขา/อาวุธ/หาง):'),
          animBtns,
          h('div', { class: 'row sp-between', style: { marginTop: '6px' } },
            h('label', { class: 'row small' }, 'อาวุธถือทดสอบ:',
              ui.select(D.weapons.map(w => ({ v: w.id, t: w.name })), this.previewWeapon, v => { this.previewWeapon = v; })
            ),
            ui.check('ถือโล่ (Shield)', this.previewShield, v => { this.previewShield = v; }),
            h('button', { type: 'button', class: 'btn sm', onclick: () => { this.previewFacing *= -1; } }, '↔️ สลับหันซ้าย/ขวา'),
            h('label', { class: 'row small' }, 'ความเร็ว:',
              ui.select([
                { v: '0.25', t: '0.25× (Slow-Mo)' },
                { v: '0.5', t: '0.5×' },
                { v: '1', t: '1.0× (ปกติ)' },
                { v: '1.5', t: '1.5×' }
              ], String(this.animSpeed), v => { this.animSpeed = Number(v) || 1; })
            )
          )
        )
      );

      /* ---------- คอลัมน์ขวา: ตั้งค่าโมเดล, สัดส่วน Chibi และช่องเสียบไฟล์ภายนอก ---------- */
      const classList = D.classes.map(c => ({ kind: 'class', id: c.id, name: '👤 อาชีพ: ' + c.name }));
      const monList = D.monsters.map(m => ({ kind: 'monster', id: m.id, name: '👾 มอนสเตอร์: ' + m.name }));
      const allTargets = classList.concat(monList);
      const curKey = this.targetKind + ':' + this.targetId;

      const curSlot = this.targetKind === 'class'
        ? ((slots.classes && slots.classes[this.targetId]) || {})
        : ((slots.monsters && slots.monsters[this.targetId]) || {});

      const patchSlot = fn => {
        SL.store.change(d => {
          if(!d.modelSlots) d.modelSlots = clone(SL.DEFAULT_DATA.modelSlots);
          const group = this.targetKind === 'class' ? 'classes' : 'monsters';
          if(!d.modelSlots[group][this.targetId]) d.modelSlots[group][this.targetId] = {};
          fn(d.modelSlots[group][this.targetId], d);
        }, 'full');
      };

      const fileInput = h('input', {
        type: 'file',
        accept: 'image/png,image/webp,image/gif,image/svg+xml',
        style: { fontSize: '12px' },
        onchange: e => {
          const f = e.target.files && e.target.files[0];
          if(!f) return;
          const reader = new FileReader();
          reader.onload = ev => {
            patchSlot(s => { s.spriteUrl = String(ev.target.result || ''); });
            ui.toast('อัปโหลดสไปรต์สำหรับ ' + this.targetId + ' เรียบร้อย!');
          };
          reader.readAsDataURL(f);
        }
      });

      const rightCol = h('div', { class: 'panel col gap-lg' },
        h('div', { class: 'row sp-between' },
          h('h3', { style: { margin: '0' } }, '🎨 ปรับแต่งริก & เชื่อมต่อไฟล์โมเดลภายนอก'),
          ui.select(allTargets.map(t => ({ v: t.kind + ':' + t.id, t: t.name })), curKey, v => {
            const parts = String(v).split(':');
            this.targetKind = parts[0] || 'class';
            this.targetId = parts[1] || 'swordman';
            this.render();
          })
        ),

        // ส่วนที่ 1: ปรับแต่งรูปทรง Procedural Chibi 2.5D
        this.targetKind === 'class' ? h('div', { class: 'panel flat col' },
          h('h4', null, '1) ปรับแต่งรูปลักษณ์ Procedural Chibi Rig (ใช้ทันทีโดยไม่ต้องมีไฟล์นอก)'),
          h('div', { class: 'cols c2' },
            ui.field('สีตัว/ขนแมว (Body Color)',
              h('input', { type: 'color', value: curSlot.bodyColor || '#f4c98e', style: { height: '32px', width: '100%' }, onchange: e => patchSlot(s => { s.bodyColor = e.target.value; }) })
            ),
            ui.field('สีชุดเกราะ/เสื้อคลุม (Tunic Color)',
              h('input', { type: 'color', value: curSlot.tunicColor || '#3c689c', style: { height: '32px', width: '100%' }, onchange: e => patchSlot(s => { s.tunicColor = e.target.value; }) })
            ),
            ui.field('สีผ้าคลุมหลัง (Cape Color)',
              h('input', { type: 'color', value: curSlot.capeColor || '#c9493b', style: { height: '32px', width: '100%' }, onchange: e => patchSlot(s => { s.capeColor = e.target.value; }) })
            ),
            ui.field('ทรงหูตัวละคร (Cat Quest Ears)',
              ui.select([
                { v: 'cat', t: '🐱 หูแมว (Cat Ears)' },
                { v: 'fox', t: '🦊 หูจิ้งจอกยาว (Fox Ears)' },
                { v: 'none', t: '🙂 ไม่มีหูสัตว์' }
              ], curSlot.earStyle || 'cat', v => patchSlot(s => { s.earStyle = v; }))
            ),
            ui.field('หมวก/เครื่องประดับหัวประจำคลาส',
              ui.select([
                { v: 'bandana', t: 'ผ้าคาดหัว Novice' },
                { v: 'helm', t: 'หมวกเกราะอัศวิน Swordman' },
                { v: 'hood', t: 'ผ้าคลุมนักฆ่า Thief' },
                { v: 'feather', t: 'หมวกขนนกนายพราน Archer' },
                { v: 'wizard', t: 'หมวกแม่มดทรงสูง Mage' },
                { v: 'none', t: 'ไม่สวมหมวก' }
              ], curSlot.hatType || 'helm', v => patchSlot(s => { s.hatType = v; }))
            ),
            ui.field('ขนาดตัวละคร (Scale)',
              ui.num(curSlot.scale || 1.0, v => patchSlot(s => { s.scale = clamp(v, 0.5, 2.5); }), { step: 0.05 })
            )
          )
        ) : h('div', { class: 'panel flat col' },
          h('h4', null, '1) ปรับแต่งรูปลักษณ์ Procedural Monster Rig'),
          h('div', { class: 'cols c2' },
            ui.field('โครงสร้างกระดูกมอนสเตอร์ (Body Archetype)',
              ui.select([
                { v: 'slime', t: '💧 สไลม์เด้งดึ๋ง (Poring / Slime)' },
                { v: 'wolf', t: '🐺 หมาป่าเขี้ยวเงา (Wolf / Beast)' },
                { v: 'golem', t: '🛡️ หุ่นเกราะโกเลมยักษ์ (Animated Golem)' },
                { v: 'dragon', t: '🐲 บอสมังกรเพลิงมีปีก (Fire Dragon Boss)' },
                { v: 'dummy', t: '🪵 หุ่นฟางฝึกซ้อม (Training Dummy)' }
              ], curSlot.bodyType || 'slime', v => patchSlot((s, d) => {
                s.bodyType = v;
                const m = d.monsters.find(x => x.id === this.targetId);
                if(m && m.world) m.world.bodyType = v;
              }))
            ),
            ui.field('สีหลักของมอนสเตอร์',
              h('input', { type: 'color', value: curSlot.color || '#f27ca4', style: { height: '32px', width: '100%' }, onchange: e => patchSlot((s, d) => {
                s.color = e.target.value;
                const m = d.monsters.find(x => x.id === this.targetId);
                if(m && m.world) m.world.color = e.target.value;
              }) })
            ),
            ui.field('ขนาดตัวมอนสเตอร์ (Scale)',
              ui.num(curSlot.scale || 1.0, v => patchSlot((s, d) => {
                s.scale = clamp(v, 0.5, 3.0);
                const m = d.monsters.find(x => x.id === this.targetId);
                if(m && m.world) m.world.scale = s.scale;
              }), { step: 0.05 })
            )
          )
        ),

        // ส่วนที่ 2: ช่องเสียบไฟล์โมเดล 3D (.glb/.gltf) และสไปรต์ 2D
        h('div', { class: 'panel flat col' },
          h('h4', null, '2) ช่องเชื่อมต่อโมเดลภายนอก (External 3D .glb/.gltf & 2D Sprite Slot)'),
          h('div', { class: 'tiny muted' }, 'เมื่อใส่รูป Sprite หรือ URL โมเดลแล้ว ตัวเกมจะสลับไปเรนเดอร์ไฟล์ของคุณแทนโมเดลจำลองทันทีโดยใช้พิกัดและอนิเมชันเดียวกัน'),
          ui.field('อัปโหลดรูปตัวละคร 2D (.png/.webp/.gif) จากเครื่องเพื่อทดสอบทันที:', fileInput),
          ui.field('หรือระบุ Path / URL ของไฟล์สไปรต์ 2D (Sprite URL):',
            h('div', { class: 'row' },
              ui.text(curSlot.spriteUrl || '', v => patchSlot(s => { s.spriteUrl = v; }), { placeholder: 'เช่น assets/sprites/swordman.png หรือ Data URL' }),
              curSlot.spriteUrl ? h('button', { type: 'button', class: 'btn sm danger', onclick: () => patchSlot(s => { s.spriteUrl = ''; }) }, 'ล้างสไปรต์') : null
            )
          ),
          ui.field('ระบุ Path / URL ของโมเดล 3 มิติ (.glb / .gltf สำหรับ Three.js / Babylon.js Loader):',
            ui.text(curSlot.modelUrl || '', v => patchSlot(s => { s.modelUrl = v; }), { placeholder: 'เช่น assets/models/cat_knight.glb' })
          )
        ),

        // ส่วนที่ 3: ตารางผูกชื่อ Animation Clip (Animation State Mapping)
        h('div', { class: 'panel flat col' },
          h('h4', null, '3) ตารางผูกชื่อคลิปอนิเมชัน (Animation State → Clip Name Mapping)'),
          h('div', { class: 'tiny muted' }, 'กำหนดชื่อ Animation Clip ในไฟล์ Blender / Blockbench (.glb) ให้ตรงกับสถานะทั้ง 7 ของเอนจิ้นเกม'),
          (() => {
            const am = curSlot.animMap || { idle: 'Idle', walk: 'Walk', roll: 'Roll', attack: 'Attack', cast: 'Cast', hurt: 'Hit', dead: 'Death' };
            const grid = h('div', { class: 'cols c2' });
            ANIM_STATES.forEach(st => {
              grid.appendChild(ui.field(st.label,
                ui.text(am[st.id] || st.id, v => patchSlot(s => {
                  if(!s.animMap) s.animMap = Object.assign({}, am);
                  s.animMap[st.id] = v;
                }))
              ));
            });
            return grid;
          })()
        )
      );

      root.appendChild(h('div', { class: 'cols c2' }, leftCol, rightCol));
      this.startLoop();
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
