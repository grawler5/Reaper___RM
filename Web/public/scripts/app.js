import { clamp01, nowMs, sClone } from "./modules/utils.js?v=fix-strips-2026-01-23d";
import { getDebugFlag } from "./modules/env.js?v=fix-strips-2026-01-23d";

(() => {

  // ---------- UI debug / persistent log ----------
  const UI_DEBUG_VERSION = "fix-guid-move-showui-2026-01-24b";
  const UI_LOG_KEY = "ReaperRM_uiLog_v3";
  let _uiLog = [];
  let _lastLine = null;
  let _lastCount = 0;
  let _saveTimer = null;

  function _flushRepeat(){
    if (_lastLine && _lastCount > 1) {
      _uiLog[_uiLog.length-1] = _lastLine + " (x" + _lastCount + ")";
    }
    _lastLine = null;
    _lastCount = 0;
  }

  function uiLog(line){
    const ts = new Date().toISOString();
    const msg = "[" + ts + "] " + String(line);
    if (_lastLine === msg) {
      _lastCount += 1;
    } else {
      _flushRepeat();
      _uiLog.push(msg);
      _lastLine = msg;
      _lastCount = 1;
      if (_uiLog.length > 2000) _uiLog.splice(0, _uiLog.length - 2000);
    }
    if (!_saveTimer) {
      _saveTimer = setTimeout(()=>{
        try {
          _flushRepeat();
          localStorage.setItem(UI_LOG_KEY, _uiLog.join("\n"));
        } catch(_e){}
        _saveTimer = null;
      }, 250);
    }
  }

  // Expose to console even in module context:
  window.ReaperRM_uiDebugVersion = UI_DEBUG_VERSION;
  window.ReaperRM_getUiLog = function() {
    try {
      _flushRepeat();
      return localStorage.getItem(UI_LOG_KEY) || _uiLog.join("\n");
    } catch(_e) {
      _flushRepeat();
      return _uiLog.join("\n");
    }
  };
  window.ReaperRM_clearUiLog = function() {
    try { localStorage.removeItem(UI_LOG_KEY); } catch(_e){}
    _uiLog = [];
    _lastLine = null;
    _lastCount = 0;
  };

  // ---------- Safety / polyfills ----------
  const errBanner = document.getElementById("errBanner");
  function showError(msg){
    const m = String(msg||"");
    // Chrome can emit these as window errors; they are noisy but usually harmless.
    if (m.includes("ResizeObserver loop")) return;
    console.error(msg);
    if (!errBanner) return;
    errBanner.style.display = "block";
    errBanner.textContent = "UI error: " + m;
  }
  window.addEventListener("error", (e)=>showError(e.message || String(e.error||e)));
  window.addEventListener("unhandledrejection", (e)=>showError(e.reason ? String(e.reason) : "promise rejected"));

  if (!window.CSS) window.CSS = {};
  if (!CSS.escape){
    CSS.escape = function(v){
      return String(v).replace(/[^a-zA-Z0-9_\-]/g, (c)=>"\\"+c);
    }
  }




  // ---------- Debug (text-only overlay) ----------
  const RM_DEBUG = getDebugFlag();
  const rmDbgMake = (parent)=>{
    if (!RM_DEBUG || !parent) return null;
    const d = document.createElement('div');
    d.className = 'rmDbgPanel';
    d.textContent = '';
    parent.appendChild(d);
    return d;
  };

  // ---------- Plugin windows (desktop floating) + fullscreen (phone) ----------
  const pluginLayer = document.getElementById("pluginLayer");
  const pluginOverlay = document.getElementById("pluginOverlay");
  const pluginWins = new Map(); // key -> {key,guid,fxIndex,el,params,search,pollT,z}
  let pluginZ = 5100;
  const fxPresetCache = new Map(); // fxName -> {presets:[], ts}
  const fxPendingOpen = new Map(); // guid -> {name, ts}
  const fxHoldRestore = new Map(); // guid -> [enabled fx indices]
  // Remember per-track FX slots scroll position (prevents scroll snapping back after UI refresh).
  // Keep a separate "last good" value so a bogus 0 (Chrome post-inertia snap) can't erase it.
  const fxSlotsScroll = new Map(); // guid -> scrollTop
  const fxSlotsLastGood = new Map(); // guid -> last good scrollTop (> ~1 row)
  const FX_SLOT_REORDER_ENABLED = false; // drag-reorder for FX slots (unfinished, can break scrolling)

  // --- Plugin layout registry (v1.2.1) ---
  // We render DAW-like panels for known plugins; otherwise fallback to raw parameter list.
  const PLUG_LAYOUTS = [
  {
    id: "ns1",
    match: (name)=> /\bNS1\b/i.test(name),
    title: "NS1",
    sections: [
      // Waves NS1 exposes the main reduction control as parameter index 2 (NS1 #2)
      { title: "", controls: [ {type:"ns1Panel", extra:{ paramIndex:2, faderFind:[/^NS1\b/i], brand:"NS1" }} ] }
    ]
  },
  {
    id: "rm_ns",
    match: (name)=> /\bRM[\s_-]*NS\b/i.test(name),
    title: "RM-NS",
    // Larger default size + 2x UI scale (previously was too small).
    winW: 400,
    winH: 520,
    // Slightly smaller so it never ends up "pushed down" on smaller windows.
    scaleMult: 0.98,
    sections: [
      { title: "", controls: [ {type:"ns1Panel", extra:{ paramIndex:0, faderFind:[/^Reduction\b/i], brand:"" }} ] }
    ]
  },
  {
    id: "rm_gate",
    match: (name)=> /\bRM[\s_]*Gate\b/i.test(name),
    title: "RM Gate",
    sections: [
      {
        title: "",
        controls: [ {type:"rmGatePanel"} ]
      }
    ]
  },
  {
    id: "rm_preamp",
    match: (name)=> /\bRM[\s_]*PreAmp\b/i.test(name),
    title: "RM PreAmp",
    // Default window was too short and clipped the lower part of the UI.
    winW: 520,
    winH: 560,
    scaleMult: 1.25,

    sections: [
      { title: "", controls: [ {type:"preampPanel"} ] }
    ]
  },
  {
    id: "rm_eq4",
    match: (name)=> /\bRM[\s_]*EQ4\b/i.test(name),
    title: "RM_EQ",
    // Slightly taller than default so bottom controls are not clipped.
    winW: 920,
    winH: 720,
    sections: [
      { title: "", controls: [ {type:"rmEqProQPanel", extra:{brand:"RM_EQ", maxBands:4, allowAdd:false}} ] }
    ]
  },
  {
    id: "rm_eq2",
    match: (name)=> /\bRM[\s_]*EQ2\b/i.test(name),
    title: "RM_EQ2",
    winW: 920,
    winH: 700,
    sections: [
      { title: "", controls: [ {type:"rmEqProQPanel", extra:{brand:"RM_EQ2", maxBands:20, allowAdd:true}} ] }
    ]
  },
  {
    id: "rm_1175",
    match: (name)=> /\bRM[\s_]*1175\b/i.test(name),
    title: "RM_1175",
    // Reference UI is wide/short; match FX panel size (1.5x NC76 base 906x213).
    winW: 1120,
    winH: 420,
    scaleMult: 0.85,
    sections: [
      { title: "", controls: [ {type:"nc76Panel"} ] }
    ]
  }
,
  {
    id: "rm_la1a",
    match: (name)=> /\bRM[\s_]*LA1A\b/i.test(name),
    title: "RM_LA1A",
    // Match the original LA-1A horizontal faceplate proportions.
    winW: 920,
    winH: 380,
    sections: [
      { title: "", controls: [ {type:"la1aPanel", extra:{gainFind:[/\bgain\b/i], peakFind:[/peak\s*reduction/i], modeFind:[/\bmode\b|compress|limit/i], detectFind:[/peak\s*detection|detection/i], sidechainFind:[/side\s*chain/i], grFind:[/telemetry.*\bgr\b/i]} } ] }
    ]
  },
  
{
  id: "rm_deesser",
  match: (name)=> /\bRM[\s_]*Deesser\b/i.test(name),
  title: "RM_Deesser",
  winW: 560,
  winH: 520,
  sections: [
    { title: "", controls: [
      {type:"rmDeesserPanel", extra:{
        thrFind:[/threshold|\bthr\b/i],
        freqFind:[/frequency|freq/i],
        rangeFind:[/range/i],
	        outFind:[/\boutput\b/i],
        grFind:[/telemetry.*\bgr\b/i],
        typeFind:[/filter\s*type|filter\s*mode|type/i],
      } }
    ] }
  ]
},
  {
    id: "rm_comp2",
    match: (name)=> /\bRM[\s_]*Compressor\s*2\b/i.test(name),
    title: "RM_Compressor2",
    // Make the default window match the full panel size (no clipping / scrollbars).
    // Previous iterations were too small (~30%).
    winW: 720,
    winH: 620,
    scaleMult: 0.78,
    sections: [
      { title: "", controls: [
        {type:"rmCompressorPanel", extra:{
          thresholdFind:[/threshold|\bthresh\b/i],
          attackFind:[/\battack\b/i],
          releaseFind:[/\brelease\b/i],
          kneeFind:[/\bknee\b/i],
          ratioFind:[/\bratio\b/i],
          detectFind:[/detect|detector|side\s*chain\s*source|side\s*chain|sidechain|source/i],
          lpFind:[/\blp\b|low\s*pass|lowpass|detector\s*lp/i],
          hpFind:[/\bhp\b|high\s*pass|highpass|detector\s*hp/i],
          bpmSyncFind:[/bpm\s*sync|tempo\s*sync|sync/i],
          autoMakeupFind:[/auto\s*makeup|makeup\b/i],
          limitOutFind:[/limit\s*out|output\s*limit/i],
          outGainFind:[/output\s*gain|\bout\s*gain\b|\boutput\b/i],
          inPeakFind:[/telemetry.*(in|input).*peak/i],
          outPeakFind:[/telemetry.*out.*peak/i],
          grFind:[/telemetry.*\bgr\b|gain\s*reduction/i],
        } }
      ] }
    ]
  },
  {
    id: "rm_compressor",
    match: (name)=>{
      const n = normName(name);
      if (/\bRM[\s_]*Compressor\s*2\b/i.test(n)) return false;
      return /\bRM[\s_]*Compressor\b/i.test(n);
    },
    title: "RM_Compressor",
    sections: [
      { title: "", controls: [
        {type:"rmCompressorPanel", extra:{
          thresholdFind:[/threshold|\bthresh\b/i],
          attackFind:[/\battack\b/i],
          releaseFind:[/\brelease\b/i],
          kneeFind:[/\bknee\b/i],
          ratioFind:[/\bratio\b/i],
          detectFind:[/detect|detector|side\s*chain\s*source|side\s*chain|sidechain|source/i],
          lpFind:[/\blp\b|low\s*pass|lowpass|detector\s*lp/i],
          hpFind:[/\bhp\b|high\s*pass|highpass|detector\s*hp/i],
          bpmSyncFind:[/bpm\s*sync|tempo\s*sync|sync/i],
          autoMakeupFind:[/auto\s*makeup|makeup\b/i],
          limitOutFind:[/limit\s*out|output\s*limit/i],
          outGainFind:[/output\s*gain|\bout\s*gain\b|\boutput\b/i],
          inPeakFind:[/telemetry.*(in|input).*peak/i],
          outPeakFind:[/telemetry.*out.*peak/i],
          grFind:[/telemetry.*\bgr\b|gain\s*reduction/i],
        } }
      ] }
    ]
  },
  {
    id: "rm_limiter2",
    match: (name)=> /\bRM[\s_]*Limiter\s*2\b/i.test(name),
    title: "RM_Limiter2",
    winW: 470,
    winH: 560,
    sections: [
      { title: "", gridClass:"rmL2Grid", controls: [
        {type:"rmL2Panel", label:"", extra:{
          thresholdFind:[/threshold/i],
          outputFind:[/output/i],
          releaseFind:[/release/i],
          maximizerFind:[/maximizer/i],
          inPeakFind:[/telemetry.*in\s*peak/i],
          outPeakFind:[/telemetry.*out\s*peak/i],
          grFind:[/telemetry.*(atten|gr)\b/i]} }
      ] }
    ]
  },
  {
    id: "rm_kicker50hz",
    match: (name)=> /\bRM[\s_]*Kicker(\s*50\s*hz)?\b/i.test(name),
    title: "RM_Kicker",
    winW: 520,
    winH: 520,
    sections: [
	      { title: "", controls: [
	        {type:"rmKickerL2Panel", extra:{
          freqFind:[/frequency|freq/i],
          dryFind:[/\bdry\b/i],
          wetFind:[/\bwet\b/i],
          outPeakFind:[/telemetry.*out\s*peak/i]
        }}
      ] }
    ]
  },
  {
    id: "rm_delaymachine",
    match: (name)=> /\bRM[\s_]*Delay\s*Machine\b/i.test(name),
    title: "RM_DelayMachine",
    winW: 920,
    winH: 520,
    sections: [
      { title: "", controls: [
        {type:"rmDelayMachinePanel", extra:{
          delayFind:[/delay\s*\(ms\)|\bdelay\b|time\s*\(ms\)|\btime\b/i],
          fbFind:[/feedback/i],
          mixInFind:[/mix\s*in/i],
          dryWetFind:[/dry\/?wet|dry\s*wet|mix\s*dry|mix\s*dry\/wet/i],
          widthFind:[/ping\s*\-?pong\s*width|width/i],
          syncFind:[/tempo\s*sync/i],
          distFind:[/distortion|dist/i],
          tapeFind:[/tape/i],
          crushFind:[/crush/i],
          hpfFind:[/hpf/i],
          lpfFind:[/\blpf\b/i]
        }}
      ] }
    ]
  },
  {
    id: "rm_vox",
    match: (name)=> /\bRM[\s_]*R?Vox\b/i.test(name),
    title: "RM_Vox",
    winW: 480,
    winH: 520,
    sections: [
      { title: "", controls: [
        {type:"rmVoxPanel", extra:{
          gateFind:[/\bgate\b/i],
          compFind:[/\bcomp\b/i],
          gainFind:[/\bgain\b/i],
          inFind:[/telemetry.*in.*peak/i],
          grFind:[/telemetry.*\bgr\b/i],
          outFind:[/telemetry.*out.*peak/i]
        }}
      ] }
    ]
  },
  {
    id: "rm_saturator",
    match: (name)=> /\bRM[\s_]*Saturator\b/i.test(name),
    title: "RM_Saturator",
    winW: 900,
    winH: 640,
    sections: [
      { title: "", controls: [
        {type:"rmSaturatorPanel", extra:{
          driveFind:[/\bdrive\b/i],
          punishFind:[/\bpunish\b/i],
          styleFind:[/\bstyle\b/i],
          biasFind:[/\bbias\b/i],
          toneFind:[/\btone\b/i],
          locutFind:[/\blocut\b/i],
          hicutFind:[/\bhicut\b/i],
          hpSlopeFind:[/\bhp\s*slope\b/i],
          lpSlopeFind:[/\blp\s*slope\b/i],
          autoFind:[/\bauto\b/i],
          outFind:[/\boutput\b/i],
          mixFind:[/\bmix\b/i]
        }}
      ] }
    ]
  },
  {
    id: "rm_eqt1a",
    match: (name)=> /\bRM[\s_]*EQT\s*-?1A\b/i.test(name),
    title: "RM_EQT1A",
    sections: [
      { title: "", controls: [
        {type:"rmEqt1aPanel", extra:{
          lsfFind:[/lsf/i],
          pushFind:[/push/i],
          pullFind:[/pull/i],
          peakFreqFind:[/freq\s*peak|peak\s*freq/i],
          midQFind:[/mid\s*q|\bq\b/i],
          midGainFind:[/^gain\s*\(db\)$/i,/\bmid\b.*gain/i,/^gain$/i],
          hsfFind:[/hsf/i],
          highGainFind:[/gain\s*\(db\).*hsf|high.*gain/i],
          attenSelFind:[/atten.*(sel|freq|select)/i,/\bfreq\s*h\b/i],
          bypassFind:[/bypass|power|enable|active|on\/off/i],
          outFind:[/output|volume/i]
        }}
      ] }
    ]
  },
  {
    id: "rm_lexikan2",
    match: (name)=> /\bRM[\s_]*Lexikan\s*2\b/i.test(name),
    title: "RM_Lexikan2",
    winW: 820,
    winH: 560,
    sections: [
      { title: "", controls: [
        {type:"rmLexi2Panel", extra:{
          densityFind:[/\bdensity\b/i],
          preDelayFind:[/predelay/i],
          erTailFind:[/er\s*vs\.?\s*tail|er\s*tail|er\/tail/i],
          gapFind:[/gapdelay|gap\s*delay/i],
          lpfFind:[/filter\s*\(lowpass|lowpass|filter/i],
          tiltFind:[/\btilt\b/i],
          dryWetFind:[/drywet|dry\s*wet/i],
          stereoFind:[/stereospread|stereo\s*spread|width/i],
          syncFind:[/tempo\s*sync/i],
          lenNoteFind:[/length\s*sync\s*note|length\s*note/i],
          preNoteFind:[/predelay\s*sync\s*note|predelay\s*note/i],
          bpmFind:[/telemetry\s*bpm|bpm/i]
        }}
      ] }
    ]
  },
  {
    id: "rm_air",
    match: (name)=> /\bRM[\s_]*Air\b/i.test(name),
    title: "RM_AIR",
    // 1.5x UI scale + enough space so it doesn't sit under the window header.
    winW: 860,
    winH: 520,
    scaleMult: 1.5,
    sections: [
      { title: "", controls: [
        {type:"rmAirPanel", extra:{
          midFind:[/mid\s*air/i],
          highFind:[/high\s*air/i],
          trimFind:[/\btrim\b/i],
        }}
      ] }
    ]
  }
];

  const normName = (s)=>String(s||"").trim();
  function pickLayout(fxName){
    const n = normName(fxName);
    for (const L of PLUG_LAYOUTS){
      try{ if (L.match(n)) return L; }catch(_){ }
    }
    return null;
  }

  const cleanParamName = (s)=>{
    return String(s||"")
      .replace(/^[\s\-\u2013\u2014]+/g, "")  // leading dashes/spaces
      .replace(/[\_:\(\)\[\]\{\}]/g, " ")
      .replace(/[^\w\s]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  };

  function findParamByPatterns(params, patterns){
    const list = Array.isArray(params) ? params : [];
    const pats = Array.isArray(patterns) ? patterns : [];
    for (const re of pats){
      try{
        const hit = list.find(p=>{
          const nm = String(p.name||"");
          try{ re.lastIndex = 0; }catch(_){}
          if (re.test(nm)) return true;
          const cn = cleanParamName(nm);
          try{ re.lastIndex = 0; }catch(_){}
          return cn ? re.test(cn) : false;
        });
        if (hit) return hit;
      }catch(_){ }
    }
    return null;
  }

  function setParamNormalized(win, paramIndex, value){
    const v = Math.max(0, Math.min(1, value));
    wsSend({type:"setFxParam", guid: win.guid, fxIndex: win.fxIndex, param: paramIndex, value: v});
  }

  function suppressPoll(win, ms=450){
    win._suppressPoll = true;
    if (win._supT) clearTimeout(win._supT);
    win._supT = setTimeout(()=>{ win._suppressPoll = false; }, ms);
  }

  // While dragging a control, keep meters updating and prevent remote refresh from snapping the edited param back.
  function beginParamDrag(win, paramIndex){
    if (!win) return;
    if (!win._dragParams) win._dragParams = new Set();
    if (!win._dragValues) win._dragValues = new Map();
    win._dragParams.add(paramIndex);
  }
  function setDraggedParamValue(win, paramIndex, value){
    if (!win || !win._dragValues) return;
    win._dragValues.set(paramIndex, value);
  }
  function endParamDrag(win, paramIndex){
    if (!win || !win._dragParams || !win._dragValues) return;
    win._dragParams.delete(paramIndex);
    win._dragValues.delete(paramIndex);
  }


  
  function mergeFxParamsIntoWin(win, incoming){
    const inc = Array.isArray(incoming) ? incoming : [];
    if (!Array.isArray(win.params)) win.params = [];
    const byIdx = new Map(win.params.map(p=>[p.index, p]));
    for (const ip of inc){
      const idx = ip && Number.isFinite(ip.index) ? ip.index : null;
      if (idx==null) continue;
      const op = byIdx.get(idx);
      const isDragging = win._dragParams && win._dragParams.has(idx);
      const dragVal = (win._dragValues && win._dragValues.has(idx)) ? win._dragValues.get(idx) : null;
      if (op){
        op.name = ip.name;
        op.fmt = ip.fmt;
        op.min = ip.min;
        op.max = ip.max;
        op.raw = ip.raw;
        if (!isDragging){
          op.value = ip.value;
        }else if (dragVal!=null){
          op.value = dragVal;
        }
      }else{
        const np = Object.assign({}, ip);
        if (isDragging && dragVal!=null) np.value = dragVal;
        win.params.push(np);
        byIdx.set(idx, np);
      }
    }
    win.params.sort((a,b)=>(a.index||0)-(b.index||0));
  }
function formatParam(p){
    if (!p) return "";
    const fmt = (p.fmt!=null && String(p.fmt).trim()!=="") ? String(p.fmt) : null;
    if (fmt) return fmt;
    const v = Math.round((p.value||0)*1000)/1000;
    return v.toFixed(3);
  }

  function knobAngleFromNorm(n){
    // -135deg .. +135deg
    const a = -135 + (Math.max(0, Math.min(1, n)) * 270);
    return a;
  }

  function getParamForCtrl(win, ctrl){
    if (!ctrl) return null;
    if (typeof ctrl.pIndex === "number" && ctrl.pIndex >= 0){
      const hit = (win.params||[]).find(x=>x.index===ctrl.pIndex);
      if (hit) return hit;
    }
    return findParamByPatterns(win.params, ctrl.patterns||[]);
  }

  function buildKnobControl(win, ctrl){
    const card = document.createElement("div");
    card.className = "plugCtrl";
    const knob = document.createElement("div");
    knob.className = "knob";
    knob.innerHTML = `<div class="kArc"></div><div class="kInd"></div>`;
    const lbl = document.createElement("div");
    lbl.className = "clbl";
    lbl.textContent = ctrl.label || "Param";
    const val = document.createElement("div");
    val.className = "cval";
    val.textContent = "";
    card.appendChild(knob);
    card.appendChild(lbl);
    card.appendChild(val);

    const fmtVal = (p)=>{
      try{
        if (ctrl && typeof ctrl.formatValue === "function") return String(ctrl.formatValue(p));
      }catch(_){ }
      return formatParam(p);
    };
    const setHot = (p)=>{
      try{
        const hot = !!(ctrl && typeof ctrl.hotPredicate === "function" && ctrl.hotPredicate(p));
        card.classList.toggle("hot", hot);
      }catch(_){ }
    };

    const setHeat = (p)=>{
      try{
        if (!ctrl || typeof ctrl.heat01 !== "function"){
          // reset defaults
          card.style.removeProperty("--airTextR");
          card.style.removeProperty("--airTextG");
          card.style.removeProperty("--airTextB");
          card.style.removeProperty("--airArcR");
          card.style.removeProperty("--airArcG");
          card.style.removeProperty("--airArcB");
          return;
        }
        let h = ctrl.heat01(p);
        h = Math.max(0, Math.min(1, Number(h)));
        if (!Number.isFinite(h)) h = 0;
        const blend = (a,b)=> Math.round(a + (b-a)*h);
        // Default -> Hot palette (used by RM_Air)
        card.style.setProperty("--airTextR", String(blend(117, 196)));
        card.style.setProperty("--airTextG", String(blend(132, 59)));
        card.style.setProperty("--airTextB", String(blend(149, 59)));
        card.style.setProperty("--airArcR", String(blend(120, 220)));
        card.style.setProperty("--airArcG", String(blend(150, 70)));
        card.style.setProperty("--airArcB", String(blend(190, 70)));
      }catch(_){ }
    };

    // state
    const st = {
      base: null,
      current: 0,
    };

    const update = ()=>{
      const p = getParamForCtrl(win, ctrl);
      if (!p){
        knob.style.setProperty("--a", knobAngleFromNorm(0) + "deg");
        knob.style.setProperty("--p", "0deg");
        val.textContent = "—";
        lbl.textContent = ctrl.label || "Param";
        card.classList.remove("hot");
        setHeat(null);
        return;
      }
      if (st.base == null && typeof p.value === "number") st.base = p.value;
      st.current = (typeof p.value === "number") ? p.value : (st.current||0);
      lbl.textContent = ctrl.label || String(p.name||"Param");
      knob.style.setProperty("--a", knobAngleFromNorm(st.current) + "deg");
      knob.style.setProperty("--p", (st.current*270) + "deg");
      val.textContent = fmtVal(p);
      setHot(p);
      setHeat(p);
    };
    update();

    const fireUserSet = (p, v, meta)=>{
      try{
        if (ctrl && typeof ctrl.onUserSet === "function"){
          ctrl.onUserSet({win, paramIndex: p.index, value: v, meta: meta||{}});
        }
      }catch(_){ }
    };

    // drag
    let drag = null;
    knob.addEventListener("pointerdown", (ev)=>{
      const p = getParamForCtrl(win, ctrl);
      if (!p) return;
      if (ev.button !== 0) return;
      bringPluginToFront(win);
      beginParamDrag(win, p.index);
      suppressPoll(win);
      const start = (typeof p.value === "number") ? p.value : (st.current||0);
      drag = {id: ev.pointerId, y: ev.clientY, start};
      knob.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    knob.addEventListener("pointermove", (ev)=>{
      if (!drag || ev.pointerId !== drag.id) return;
      const p = getParamForCtrl(win, ctrl);
      if (!p) return;
      const dy = drag.y - ev.clientY;
      // scale: ~0.004 per px (fine enough on touch)
      const next = drag.start + dy * 0.004;
      st.current = Math.max(0, Math.min(1, next));
      p.value = st.current;
      setDraggedParamValue(win, p.index, st.current);
      suppressPoll(win, 600);
      knob.style.setProperty("--a", knobAngleFromNorm(st.current) + "deg");
      knob.style.setProperty("--p", (st.current*270) + "deg");
      val.textContent = fmtVal(p);
      setHot(p);
      setHeat(p);
      setParamNormalized(win, p.index, st.current);
      fireUserSet(p, st.current, {source:"drag"});
    });
    const endDrag = (ev)=>{ if (drag && ev.pointerId === drag.id){
      try{ const p = getParamForCtrl(win, ctrl); if (p) endParamDrag(win, p.index); }catch(_){ }
      drag = null;
    } };
    knob.addEventListener("pointerup", endDrag);
    knob.addEventListener("pointercancel", ()=>{
      try{ const p = getParamForCtrl(win, ctrl); if (p) endParamDrag(win, p.index); }catch(_){ }
      drag = null;
    });

    // wheel (desktop)
    knob.addEventListener("wheel", (ev)=>{
      const p = getParamForCtrl(win, ctrl);
      if (!p) return;
      bringPluginToFront(win);
      suppressPoll(win);
      const delta = (ev.deltaY > 0) ? -0.02 : 0.02;
      const cur = (typeof p.value === "number") ? p.value : (st.current||0);
      st.current = Math.max(0, Math.min(1, cur + delta));
      p.value = st.current;
      knob.style.setProperty("--a", knobAngleFromNorm(st.current) + "deg");
      knob.style.setProperty("--p", (st.current*270) + "deg");
      val.textContent = fmtVal(p);
      setHot(p);
      setParamNormalized(win, p.index, st.current);
      fireUserSet(p, st.current, {source:"wheel"});
      ev.preventDefault();
    }, {passive:false});

    // double click/tap -> reset to base
    knob.addEventListener("dblclick", ()=>{
      const p = getParamForCtrl(win, ctrl);
      if (!p) return;
      bringPluginToFront(win);
      suppressPoll(win);
      const tgt = (typeof st.base === "number") ? st.base : 0.5;
      st.current = Math.max(0, Math.min(1, tgt));
      p.value = st.current;
      knob.style.setProperty("--a", knobAngleFromNorm(st.current) + "deg");
      knob.style.setProperty("--p", (st.current*270) + "deg");
      val.textContent = fmtVal(p);
      setHot(p);
      setParamNormalized(win, p.index, st.current);
      fireUserSet(p, st.current, {source:"reset"});
    });

    return {el: card, update, ctrl, _refs:{knob, lbl, val}};
  }

  
  function buildVfaderControl(win, ctrl){
    const card = document.createElement("div");
    card.className = "plugCtrl vfader";
    const lbl = document.createElement("div");
    lbl.className = "clbl";
    lbl.textContent = ctrl.label || "Fader";
    const val = document.createElement("div");
    val.className = "cval";
    val.textContent = "—";

    const f = document.createElement("div");
    f.className = "pFader";
    const tr = document.createElement("div");
    tr.className = "pFaderTrack";
    const fill = document.createElement("div");
    fill.className = "pFaderFill";
    const th = document.createElement("div");
    th.className = "pFaderThumb";
    tr.appendChild(fill);
    tr.appendChild(th);
    f.appendChild(tr);

    card.appendChild(lbl);
    card.appendChild(f);
    card.appendChild(val);

    let drag = null;
    let lastSent = 0;
    const send = (pIndex, v)=>{
      const now = performance.now();
      if (now - lastSent < 35){ // simple throttle
        // still update UI immediately
        return setParamNormalized(win, pIndex, v);
      }
      lastSent = now;
      setParamNormalized(win, pIndex, v);
    };

    const setFromClientY = (ev)=>{
      const p = getParamForCtrl(win, ctrl);
      if (!p) return;
      const r = tr.getBoundingClientRect();
      const y = Math.max(r.top, Math.min(r.bottom, ev.clientY));
      const n = 1 - ((y - r.top) / Math.max(1, r.height));
      send(p.index, n);
      // local UI update for responsiveness
      p.value = n;
      update();
    };

    th.addEventListener("pointerdown", (ev)=>{
      const p = getParamForCtrl(win, ctrl);
      if (!p) return;
      bringPluginToFront(win);
      suppressPoll(win, 500);
      drag = {id: ev.pointerId};
      th.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    th.addEventListener("pointermove", (ev)=>{
      if (!drag || ev.pointerId !== drag.id) return;
      setFromClientY(ev);
    });
    th.addEventListener("pointerup", (ev)=>{
      if (!drag || ev.pointerId !== drag.id) return;
      drag = null;
      try{ th.releasePointerCapture(ev.pointerId); }catch(_){}
    });
    th.addEventListener("pointercancel", ()=>{ drag = null; });

    const update = ()=>{
      const p = getParamForCtrl(win, ctrl);
      if (!p){ val.textContent = "—"; fill.style.height = "0%"; th.style.top = "100%"; return; }
      const v = Math.max(0, Math.min(1, p.value||0));
      val.textContent = formatParam(p);
      fill.style.height = (v*100) + "%";
      th.style.top = ((1 - v)*100) + "%";
    };
    update();
    return {el: card, update, ctrl};
  }

  // ===== Patch v1.2.3: custom DAW-like panels =====
  function _num100(p){
    if (!p) return "—";
    const fmt = (p.fmt!=null && String(p.fmt).trim()!=="") ? String(p.fmt).trim() : null;
    // If formatted looks like a number, use it; else convert 0..1 -> 0..100
    if (fmt && /^-?\d+(\.\d+)?$/.test(fmt)) return (Math.round(parseFloat(fmt)*10)/10).toFixed(1);
    return (Math.round((p.value||0)*1000)/10).toFixed(1);
  }

  function buildNS1PanelControl(win, ctrl){
    const root = document.createElement("div");
    root.className = "ns1Panel";

    const faderCol = document.createElement("div"); faderCol.className="ns1FaderCol";
    // CSS expects .ns1FaderTrack
    const fader = document.createElement("div"); fader.className="ns1FaderTrack";
    const fThumb = document.createElement("div"); fThumb.className="ns1FaderThumb";
    fader.appendChild(fThumb); faderCol.appendChild(fader);

    const readout = document.createElement("div"); readout.className="ns1Readout"; readout.textContent="—";
    faderCol.appendChild(readout);

    const extra = ctrl.extra||{};
    const brandText = (extra.brand != null) ? String(extra.brand) : "NS1";
    if (brandText.trim()){
      const brand = document.createElement("div");
      brand.className = "ns1Brand";
      brand.textContent = brandText;
      root.appendChild(brand);
    }
    root.appendChild(faderCol);

    const clamp01 = (x)=>Math.max(0, Math.min(1, x));

    const getFaderParam = ()=>{
      let p = null;
      if (Number.isFinite(extra.paramIndex)){
        p = (win.params||[]).find(x=>x.index===extra.paramIndex) || null;
      }
      if (!p) p = findParamByPatterns(win.params||[], extra.faderFind||[]);
      return p;
    };

    function setThumb(v){
      const yPct = (1 - clamp01(v)) * 86 + 7; // within the slot
      fThumb.style.top = yPct + "%";
    }

    const update = ()=>{
      const pf = getFaderParam();
      const amt = pf ? (pf.value||0) : 0;
      if (pf){
        setThumb(amt);
        readout.textContent = _num100(pf);
      } else {
        setThumb(0);
        readout.textContent = "—";
      }
    };

    // Drag only when grabbing the thumb
    let drag = null;
    fThumb.addEventListener("pointerdown", (ev)=>{
      const pf = getFaderParam();
      if (!pf) return;
      bringPluginToFront(win);
      fThumb.setPointerCapture(ev.pointerId);
      drag = {id: ev.pointerId, startY: ev.clientY, start: pf.value||0};
      ev.preventDefault();
      ev.stopPropagation();
    });
    fThumb.addEventListener("pointermove", (ev)=>{
      if (!drag || drag.id !== ev.pointerId) return;
      const pf = getFaderParam();
      if (!pf) return;
      const dy = (ev.clientY - drag.startY);
      const disp = clamp01(drag.start - dy*0.004);
      const next = drag.inv ? (1-disp) : disp;
      suppressPoll(win, 600);
      setParamNormalized(win, pf.index, next);
      pf.value = next;
      update();
    });
    const end = (ev)=>{ if (drag && drag.id===ev.pointerId) drag=null; };
    fThumb.addEventListener("pointerup", end);
    fThumb.addEventListener("pointercancel", end);

    // Note: the "closure" meter was removed by request (it was unreliable across builds).
    const updateTrackMeter = ()=>{};

    update();
    return {el: root, update, updateTrackMeter, ctrl};
  }

  function buildRMGatePanelControl(win, ctrl){
    const root = document.createElement("div");
    root.className = "rmGatePanel";

    const title = document.createElement("div");
    title.className = "rmGateTitle";
    title.textContent = "Gate";

    const wrap = document.createElement("div");
    wrap.className = "rmGateMeterWrap";

    const meter = document.createElement("div");
    meter.className = "rmGateMeter";
	    // Two-half meter:
	    // - left: input level (bottom-up), turns grey when gate is closing
	    // - right: gate activity (top-down red) when closing
	    const inHalf = document.createElement("div");
	    inHalf.className = "rmGateHalf in";
	    const inFill = document.createElement("div");
	    inFill.className = "rmGateInFill";
	    inHalf.appendChild(inFill);
	
	    const divider = document.createElement("div");
	    divider.className = "rmGateDivider";
	
	    const actHalf = document.createElement("div");
	    actHalf.className = "rmGateHalf act";
	    const actFill = document.createElement("div");
	    actFill.className = "rmGateActFill";
	    actHalf.appendChild(actFill);
    const thumb = document.createElement("div");
    thumb.className = "rmGateThreshThumb";
	    meter.appendChild(inHalf);
	    meter.appendChild(divider);
	    meter.appendChild(actHalf);
	    meter.appendChild(thumb);

    const readout = document.createElement("div");
    readout.className = "rmGateReadout";
    readout.textContent = "—";

    wrap.appendChild(meter);
    wrap.appendChild(readout);

    const knobsRow = document.createElement("div");
    knobsRow.className = "rmGateMiniKnobs";

    // Reuse the existing knob control for the smaller parameters.
    const mkKnob = (label, find)=>{
      const p = findParamByPatterns(win.params||[], find);
      const c = {pIndex: p ? p.index : -1, patterns: find, label, type: null, extra: null};
      const ui = buildKnobControl(win, c);
      return ui;
    };
    const uiAttack  = mkKnob("Attack",  [/^Attack\b/i]);
    const uiRelease = mkKnob("Release", [/^Release\b/i]);
    const uiRange   = mkKnob("Range",   [/^Range\b/i]);
    knobsRow.appendChild(uiAttack.el);
    knobsRow.appendChild(uiRelease.el);
    knobsRow.appendChild(uiRange.el);

    root.appendChild(title);
    root.appendChild(wrap);
    root.appendChild(knobsRow);

    const clamp01 = (x)=>Math.max(0, Math.min(1, x));
	    // Smoothed meters (targets updated from poll / track meter updates)
	    let pkT = 0, pkC = 0;
	    let clT = 0, clC = 0;
	    // Prefer plugin-side telemetry for true *input* level
	    let idxInL = null, idxInR = null;
	    let useInTelemetry = false;

    const getThreshParam = ()=>{
      // Primary control: Threshold
      return findParamByPatterns(win.params||[], [/^Threshold\b/i]) || (win.params||[]).find(p=>p.index===0) || null;
    };
    const getClosureParam = ()=>{
      return findParamByPatterns(win.params||[], [/Gate\s*Closure/i]) || null;
    };
	    const resolveInPeakParams = ()=>{
	      if (idxInL != null && idxInR != null) return;
	      const ps = win.params || [];
	      const pL = findParamByPatterns(ps, [/\-z\s*telemetry\s*:\s*in\s*peak\s*\(l\)/i, /\bin\s*peak\s*\(l\)/i, /\bin\s*pk\s*\(l\)/i]);
	      const pR = findParamByPatterns(ps, [/\-z\s*telemetry\s*:\s*in\s*peak\s*\(r\)/i, /\bin\s*peak\s*\(r\)/i, /\bin\s*pk\s*\(r\)/i]);
	      if (pL && pR){ idxInL = pL.index; idxInR = pR.index; useInTelemetry = true; }
	    };

    const setThumb = (v)=>{
      // Keep it within the slot visually.
      const yPct = (1 - clamp01(v)) * 86 + 7;
      thumb.style.top = yPct + "%";
    };

    const linToVuNorm = (pk)=>{
      // Convert linear peak (0..1) into a -60..0 dB fill (0 dB = full).
      const p = Math.max(1e-9, pk||0);
      const db = 20 * Math.log10(p);
      const cdb = Math.max(-60, Math.min(0, db));
      return (cdb + 60) / 60;
    };

	    const setLevel = (pk)=>{
	      const n = linToVuNorm(pk);
	      inFill.style.height = (n*100) + "%";
	    };
	    const setClosure = (cl)=>{
	      const h = clamp01(cl) * 100;
	      actFill.style.height = h + "%";
	      meter.classList.toggle("closing", cl > 0.02);
	    };

	    // Local animation loop for smoothness
	    const tick = ()=>{
	      pkC += (pkT - pkC) * 0.22;
	      clC += (clT - clC) * 0.22;
	      setLevel(pkC);
	      setClosure(clC);
	      requestAnimationFrame(tick);
	    };
	    requestAnimationFrame(tick);

    const update = ()=>{
	      resolveInPeakParams();
      const pTh = getThreshParam();
      const pCl = getClosureParam();
      if (pTh){
        setThumb(pTh.value||0);
        readout.textContent = formatParam(pTh);
      }else{
        setThumb(0);
        readout.textContent = "—";
      }
	      clT = pCl ? (pCl.value||0) : 0;
	      if (useInTelemetry && idxInL != null && idxInR != null){
	        const pL = (win.params||[]).find(p=>p.index===idxInL);
	        const pR = (win.params||[]).find(p=>p.index===idxInR);
	        const inPk = Math.max(0, Math.min(1, Math.max((pL&&pL.value)||0, (pR&&pR.value)||0)));
	        pkT = inPk;
	      }

      try{ uiAttack.update(); }catch(_){ }
      try{ uiRelease.update(); }catch(_){ }
      try{ uiRange.update(); }catch(_){ }
    };

    // Drag threshold directly on the meter/thumbnail.
    let drag = null;
    const beginDrag = (ev)=>{
      const pTh = getThreshParam();
      if (!pTh) return;
      bringPluginToFront(win);
      meter.setPointerCapture(ev.pointerId);
      drag = {id: ev.pointerId};
      ev.preventDefault();
      ev.stopPropagation();
      moveDrag(ev);
    };
    const moveDrag = (ev)=>{
      if (!drag || drag.id !== ev.pointerId) return;
      const pTh = getThreshParam();
      if (!pTh) return;
      const r = meter.getBoundingClientRect();
      const y = Math.max(0, Math.min(r.height, ev.clientY - r.top));
      const norm = 1 - (y / Math.max(1, r.height));
      const next = clamp01(norm);
      suppressPoll(win, 700);
      setParamNormalized(win, pTh.index, next);
      pTh.value = next;
      update();
    };
    meter.addEventListener("pointerdown", beginDrag);
    meter.addEventListener("pointermove", moveDrag);
    meter.addEventListener("pointerup", (ev)=>{ if (drag && drag.id===ev.pointerId) drag=null; });
    meter.addEventListener("pointercancel", ()=>{ drag=null; });

	    const updateTrackMeter = (pkL, pkR)=>{
	      // fallback: use track peaks only if we don't have plugin input telemetry
	      if (useInTelemetry) return;
	      pkT = Math.max(0, Math.min(1, Math.max(pkL||0, pkR||0)));
	    };

    update();
    return {el: root, update, updateTrackMeter, ctrl};
  }


  function buildRMCompressorPanelControl(win, ctrl){
    const ex = ctrl.extra || {};
    const root = document.createElement("div");
    root.className = "rmCompPanel";

    const clamp01 = (v)=> Math.max(0, Math.min(1, v));
    const getP = (patterns)=> findParamByPatterns(win.params, patterns||[]);
    const normFromParam = (p, fallbackMin=0, fallbackMax=1)=>{
      if (!p) return 0;
      if (p.raw != null && Number.isFinite(p.min) && Number.isFinite(p.max) && p.max !== p.min){
        return clamp01((p.raw - p.min) / (p.max - p.min));
      }
      if (p.raw != null && Number.isFinite(fallbackMin) && Number.isFinite(fallbackMax) && fallbackMax !== fallbackMin){
        return clamp01((p.raw - fallbackMin) / (fallbackMax - fallbackMin));
      }
      return clamp01(p.value || 0);
    };
    const setParamValue = (p, value)=>{
      if (!p) return;
      suppressPoll(win, 700);
      setParamNormalized(win, p.index, value);
    };
    const setParamRaw = (p, rawTarget, fallbackMin=0, fallbackMax=1)=>{
      if (!p) return;
      const mn = (p.min!=null && Number.isFinite(p.min)) ? p.min : fallbackMin;
      const mx = (p.max!=null && Number.isFinite(p.max)) ? p.max : fallbackMax;
      const rt = Math.max(mn, Math.min(mx, rawTarget));
      const next = (mx===mn) ? 0 : ((rt-mn)/(mx-mn));
      setParamValue(p, next);
    };

    const left = document.createElement("div");
    left.className = "rmCompCol rmCompLeft";
    const mid = document.createElement("div");
    mid.className = "rmCompCol rmCompMid";
    const right = document.createElement("div");
    right.className = "rmCompCol rmCompRight";
    root.appendChild(left);
    root.appendChild(mid);
    root.appendChild(right);

    const threshCard = document.createElement("div");
    threshCard.className = "rmCompCard rmCompThreshold";
    threshCard.innerHTML = `
      <div class="rmCompCardTitle">THRESHOLD</div>
      <div class="rmCompThresholdRow">
        <div class="rmCompVTrack rmCompThreshTrack">
          <div class="rmCompVUMeter"></div>
          <div class="rmCompVThumb"></div>
        </div>
        <div class="rmCompGrMeter"><div class="rmCompGrFill"></div></div>
      </div>
      <div class="rmCompMeterReadouts">
        <div class="rmCompMeterReadout rmCompInPeakVal">—</div>
        <div class="rmCompVal rmCompThreshVal">—</div>
        <div class="rmCompMeterReadout rmCompGrPeakVal">—</div>
      </div>
    `;
    left.appendChild(threshCard);

    const threshTrack = threshCard.querySelector(".rmCompThreshTrack");
    const threshThumb = threshCard.querySelector(".rmCompVThumb");
    const threshVu = threshCard.querySelector(".rmCompVUMeter");
    const grFill = threshCard.querySelector(".rmCompGrFill");
    const threshVal = threshCard.querySelector(".rmCompThreshVal");
    const inPeakVal = threshCard.querySelector(".rmCompInPeakVal");
    const grPeakVal = threshCard.querySelector(".rmCompGrPeakVal");

    let threshDrag = null;
    let threshLastSent = 0;
    const setThreshUI = (n, fmt)=>{
      const cl = clamp01(n);
      threshThumb.style.top = ((1 - cl) * 100) + "%";
      if (threshVal) threshVal.textContent = fmt || "—";
    };
    threshThumb.addEventListener("pointerdown", (ev)=>{
      const p = getP(ex.thresholdFind);
      if (!p || ev.button !== 0) return;
      bringPluginToFront(win);
      suppressPoll(win, 700);
      threshDrag = {id: ev.pointerId};
      threshThumb.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    threshThumb.addEventListener("pointermove", (ev)=>{
      if (!threshDrag || threshDrag.id !== ev.pointerId) return;
      const p = getP(ex.thresholdFind);
      if (!p) return;
      const r = threshTrack.getBoundingClientRect();
      const y = Math.max(r.top, Math.min(r.bottom, ev.clientY));
      const n = 1 - ((y - r.top) / Math.max(1, r.height));
      const v = clamp01(n);
      setThreshUI(v, formatParam(p));
      const now = performance.now();
      if (now - threshLastSent > 35){
        threshLastSent = now;
        setParamValue(p, v);
      }
    });
    const endThresh = (ev)=>{ if (threshDrag && ev.pointerId === threshDrag.id) threshDrag = null; };
    threshThumb.addEventListener("pointerup", endThresh);
    threshThumb.addEventListener("pointercancel", endThresh);

    const outCard = document.createElement("div");
    outCard.className = "rmCompCard rmCompOutput";
    outCard.innerHTML = `
      <div class="rmCompCardTitle">OUTPUT</div>
      <div class="rmCompVTrack rmCompOutTrack">
        <div class="rmCompVUMeter"></div>
        <div class="rmCompVThumb"></div>
      </div>
      <div class="rmCompVal">—</div>
    `;
    right.appendChild(outCard);
    const outTrack = outCard.querySelector(".rmCompOutTrack");
    const outThumb = outCard.querySelector(".rmCompVThumb");
    const outVu = outCard.querySelector(".rmCompVUMeter");
    const outVal = outCard.querySelector(".rmCompVal");

    let outDrag = null;
    let outLastSent = 0;
    const setOutUI = (n, fmt)=>{
      const cl = clamp01(n);
      outThumb.style.top = ((1 - cl) * 100) + "%";
      if (outVal) outVal.textContent = fmt || "—";
    };
    outThumb.addEventListener("pointerdown", (ev)=>{
      const p = getP(ex.outGainFind);
      if (!p || ev.button !== 0) return;
      bringPluginToFront(win);
      suppressPoll(win, 700);
      outDrag = {id: ev.pointerId};
      outThumb.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    outThumb.addEventListener("pointermove", (ev)=>{
      if (!outDrag || outDrag.id !== ev.pointerId) return;
      const p = getP(ex.outGainFind);
      if (!p) return;
      const r = outTrack.getBoundingClientRect();
      const y = Math.max(r.top, Math.min(r.bottom, ev.clientY));
      const n = 1 - ((y - r.top) / Math.max(1, r.height));
      const v = clamp01(n);
      setOutUI(v, formatParam(p));
      const now = performance.now();
      if (now - outLastSent > 35){
        outLastSent = now;
        setParamValue(p, v);
      }
    });
    const endOut = (ev)=>{ if (outDrag && ev.pointerId === outDrag.id) outDrag = null; };
    outThumb.addEventListener("pointerup", endOut);
    outThumb.addEventListener("pointercancel", endOut);

    const mkHSlider = (label, patterns, formatter)=>{
      const row = document.createElement("div");
      row.className = "rmCompHRow";
      row.innerHTML = `
        <div class="rmCompLabel">${escapeHtml(label)}</div>
        <input type="range" min="0" max="1" step="0.001" value="0">
        <div class="rmCompVal">—</div>
      `;
      const sl = row.querySelector("input");
      const val = row.querySelector(".rmCompVal");
      let lastSent = 0;
      sl.addEventListener("input", ()=>{
        const p = getP(patterns);
        if (!p) return;
        const v = parseFloat(sl.value);
        if (val){
          val.textContent = formatter ? formatter(p) : formatParam(p);
        }
        p.value = v;
        const now = performance.now();
        if (now - lastSent > 25){
          lastSent = now;
          setParamValue(p, v);
        }
      });
      return {row, sl, val, patterns};
    };

    const envCard = document.createElement("div");
    envCard.className = "rmCompCard";
    envCard.innerHTML = `<div class="rmCompCardTitle">ENVELOPE</div>`;
    const formatReleaseValue = (p)=>{
      const syncOn = (()=>{ const ps = getP(ex.bpmSyncFind); return ps ? (ps.value||0) >= 0.5 : false; })();
      const bpm = transportLive.data ? Number(transportLive.data.bpm) : NaN;
      return syncOn ? formatReleaseSync(p, bpm) : formatParam(p);
    };
    const rowAttack = mkHSlider("Attack", ex.attackFind);
    const rowRelease = mkHSlider("Release", ex.releaseFind, formatReleaseValue);
    const rowRatio = mkHSlider("Ratio", ex.ratioFind);
    const rowKnee = mkHSlider("Knee", ex.kneeFind);
    envCard.appendChild(rowAttack.row);
    envCard.appendChild(rowRelease.row);
    envCard.appendChild(rowRatio.row);
    envCard.appendChild(rowKnee.row);
    mid.appendChild(envCard);

    const detectRow = document.createElement("div");
    detectRow.className = "rmCompDetectRow rmCompDetectRowThreshold";
    const detectToggle = document.createElement("button");
    detectToggle.type = "button";
    detectToggle.className = "rmCompMiniBtn rmCompDetectToggle";
    detectToggle.textContent = "Main";
    const returnsBtn = document.createElement("button");
    returnsBtn.type = "button";
    returnsBtn.className = "rmCompMiniBtn";
    returnsBtn.textContent = "Returns";
    returnsBtn.addEventListener("click", ()=>{
      openTrackMenu(win.guid, "sends");
    });
    detectRow.appendChild(detectToggle);
    detectRow.appendChild(returnsBtn);
    threshCard.appendChild(detectRow);

    const filterCard = document.createElement("div");
    filterCard.className = "rmCompCard";
    filterCard.innerHTML = `<div class="rmCompCardTitle">FILTER</div>`;
    const rowLP = mkHSlider("LP", ex.lpFind);
    const rowHP = mkHSlider("HP", ex.hpFind);
    filterCard.appendChild(rowLP.row);
    filterCard.appendChild(rowHP.row);
    mid.appendChild(filterCard);

    const options = document.createElement("div");
    options.className = "rmCompButtonRow rmCompBottomRow";
    const mkToggleBtn = (label, patterns)=>{
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.addEventListener("click", ()=>{
        const p = getP(patterns);
        if (!p) return;
        const next = (p.value||0) >= 0.5 ? 0 : 1;
        setParamValue(p, next);
      });
      return btn;
    };
    const btnSync = mkToggleBtn("BPM Sync", ex.bpmSyncFind);
    const btnMakeup = mkToggleBtn("Auto Makeup", ex.autoMakeupFind);
    const btnLimit = mkToggleBtn("Limit Out", ex.limitOutFind);
    options.appendChild(btnSync);
    options.appendChild(btnMakeup);
    options.appendChild(btnLimit);
    mid.appendChild(options);

    const getParamRawValue = (p, fallbackMin=0, fallbackMax=1)=>{
      if (!p) return 0;
      if (p.raw != null && Number.isFinite(p.raw)) return p.raw;
      if (p.min != null && p.max != null && Number.isFinite(p.min) && Number.isFinite(p.max)){
        return p.min + (p.value || 0) * (p.max - p.min);
      }
      return (p.value || 0);
    };
    const formatPeakValue = (p, raw)=>{
      if (!p || !Number.isFinite(raw)) return "—";
      const fmt = (p.fmt != null && String(p.fmt).trim() !== "") ? String(p.fmt) : "";
      const match = fmt.match(/-?\d+(?:\.\d+)?\s*(.*)$/);
      const unit = match && match[1] ? match[1].trim() : "";
      const val = raw.toFixed(1);
      return unit ? `${val} ${unit}` : val;
    };

    const formatReleaseSync = (p, bpm)=>{
      if (!p || !Number.isFinite(bpm) || bpm <= 0) return formatParam(p);
      const notes = [
        {label:"1/64t", beats: 1/24},
        {label:"1/64", beats: 1/16},
        {label:"1/32t", beats: 1/12},
        {label:"1/32", beats: 1/8},
        {label:"1/16t", beats: 1/6},
        {label:"1/16", beats: 1/4},
        {label:"1/8t", beats: 1/3},
        {label:"1/8", beats: 1/2},
        {label:"1/4t", beats: 2/3},
        {label:"1/4", beats: 1},
        {label:"1/2t", beats: 4/3},
        {label:"1/2", beats: 2},
      ];
      const fmt = (p.fmt != null && String(p.fmt).trim() !== "") ? String(p.fmt) : "";
      const unitMatch = fmt.match(/[a-z%]+/i);
      const unit = unitMatch ? unitMatch[0].toLowerCase() : "";
      const raw = getParamRawValue(p, 0, 1000);
      const useMs = unit.includes("ms") || unit.includes("sec") || unit === "s" || raw > 4;
      if (useMs){
        const ms = unit === "s" || unit.includes("sec") ? raw * 1000 : raw;
        const msPerBeat = 60000 / bpm;
        if (Number.isFinite(msPerBeat) && msPerBeat > 0){
          const beats = ms / msPerBeat;
          let best = notes[0];
          let bestDiff = Math.abs(beats - best.beats);
          for (const n of notes){
            const diff = Math.abs(beats - n.beats);
            if (diff < bestDiff){
              best = n;
              bestDiff = diff;
            }
          }
          return best.label;
        }
      }
      const norm = clamp01(p.value || 0);
      const idx = Math.round(norm * (notes.length - 1));
      return (notes[idx] || notes[0]).label;
    };

    const meterState = {in:0, out:0, gr:0, peakInRaw:null, peakGrRaw:null};

    const update = ()=>{
      const pThresh = getP(ex.thresholdFind);
      if (pThresh) setThreshUI(pThresh.value||0, formatParam(pThresh));
      else setThreshUI(0, "—");

      const pOut = getP(ex.outGainFind);
      if (pOut) setOutUI(pOut.value||0, formatParam(pOut));
      else setOutUI(0, "—");

      const pInPk = getP(ex.inPeakFind);
      const inTarget = clamp01(pInPk ? normFromParam(pInPk, 0, 1) : 0);
      const inAttack = 0.4;
      const inRelease = 0.06;
      meterState.in = inTarget > meterState.in
        ? meterState.in + (inTarget - meterState.in) * inAttack
        : meterState.in + (inTarget - meterState.in) * inRelease;
      if (threshVu) threshVu.style.height = (meterState.in * 100) + "%";

      const pOutPk = getP(ex.outPeakFind);
      const outTarget = clamp01(pOutPk ? normFromParam(pOutPk, 0, 1) : 0);
      const outAttack = 0.4;
      const outRelease = 0.06;
      meterState.out = outTarget > meterState.out
        ? meterState.out + (outTarget - meterState.out) * outAttack
        : meterState.out + (outTarget - meterState.out) * outRelease;
      if (outVu) outVu.style.height = (meterState.out * 100) + "%";

      const pGr = getP(ex.grFind);
      const grTarget = clamp01(pGr ? normFromParam(pGr, 0, 30) : 0);
      const grAttack = 0.35;
      const grRelease = 0.05;
      meterState.gr = grTarget > meterState.gr
        ? meterState.gr + (grTarget - meterState.gr) * grAttack
        : meterState.gr + (grTarget - meterState.gr) * grRelease;
      if (grFill) grFill.style.height = (meterState.gr * 100) + "%";
      if (pInPk){
        const raw = getParamRawValue(pInPk, 0, 1);
        meterState.peakInRaw = meterState.peakInRaw == null ? raw : Math.max(raw, meterState.peakInRaw * 0.96);
      }
      if (pGr){
        const raw = getParamRawValue(pGr, 0, 30);
        meterState.peakGrRaw = meterState.peakGrRaw == null ? raw : Math.max(raw, meterState.peakGrRaw * 0.96);
      }
      if (inPeakVal) inPeakVal.textContent = pInPk ? formatPeakValue(pInPk, meterState.peakInRaw ?? getParamRawValue(pInPk, 0, 1)) : "—";
      if (grPeakVal) grPeakVal.textContent = pGr ? formatPeakValue(pGr, meterState.peakGrRaw ?? getParamRawValue(pGr, 0, 30)) : "—";

      const updateRow = (row)=>{
        const p = getP(row.patterns);
        if (!p){
          row.sl.disabled = true;
          row.val.textContent = "—";
          row.sl.value = "0";
          return;
        }
        row.sl.disabled = false;
        if (document.activeElement !== row.sl) row.sl.value = String(p.value||0);
        row.val.textContent = (row === rowRelease) ? formatReleaseValue(p) : formatParam(p);
      };
      [rowAttack, rowRelease, rowRatio, rowKnee, rowLP, rowHP].forEach(updateRow);

      const pDetect = getP(ex.detectFind);
      if (pDetect){
        const raw = (pDetect.raw != null) ? pDetect.raw : (pDetect.min != null && pDetect.max != null ? pDetect.min + (pDetect.value||0) * (pDetect.max - pDetect.min) : pDetect.value||0);
        const midVal = (pDetect.min != null && pDetect.max != null) ? (pDetect.min + pDetect.max) / 2 : 0.5;
        const isSc = raw > midVal;
        detectToggle.textContent = isSc ? "SC" : "Main";
        detectToggle.classList.toggle("on", isSc);
        detectToggle.disabled = false;
      } else {
        detectToggle.textContent = "Main";
        detectToggle.classList.remove("on");
        detectToggle.disabled = true;
      }

      const toggleState = (btn, patterns)=>{
        const p = getP(patterns);
        const on = p ? ((p.value||0) >= 0.5) : false;
        btn.classList.toggle("on", on);
        btn.disabled = !p;
      };
      toggleState(btnSync, ex.bpmSyncFind);
      toggleState(btnMakeup, ex.autoMakeupFind);
      toggleState(btnLimit, ex.limitOutFind);
    };

    detectToggle.addEventListener("click", ()=>{
      const p = getP(ex.detectFind);
      if (!p) return;
      const raw = (p.raw != null) ? p.raw : (p.min != null && p.max != null ? p.min + (p.value||0) * (p.max - p.min) : p.value||0);
      const midVal = (p.min != null && p.max != null) ? (p.min + p.max) / 2 : 0.5;
      const isSc = raw > midVal;
      const target = isSc
        ? ((p.min != null && p.max != null) ? p.min : 0)
        : ((p.min != null && p.max != null) ? p.max : 1);
      setParamRaw(p, target, 0, 1);
    });

    update();
    return {el: root, update, ctrl};
  }


  function buildLA1APanelControl(win, ctrl){
  // Pixel-accurate layout taken from the original JSFX coordinates (LA-1A @gfx 800x238).
  // Our background image is 800x237, so we apply a tiny Y scale to keep it 1:1.
  const BASE_W = 800, BASE_H = 237;
  const YS = 237/238;
  const ex = (ctrl && ctrl.extra) ? ctrl.extra : {};

  const host = document.createElement("div");
  host.className = "tukanHost";
  const stage = document.createElement("div");
  stage.className = "tukanStage";
  host.appendChild(stage);

  // IMPORTANT: tukanSkin is absolutely positioned; the stage itself must have a size
  // so layout scaling can measure baseW/baseH correctly.
  stage.style.width = BASE_W + "px";
  stage.style.height = BASE_H + "px";

  const skin = document.createElement("div");
  skin.className = "tukanSkin laSkin";
  skin.style.width = BASE_W + "px";
  skin.style.height = BASE_H + "px";
  stage.appendChild(skin);

  const clamp01 = (x)=>Math.max(0, Math.min(1, x));
  const setSpriteFrame = (el, frame, frames)=>{
    const f = Math.max(0, Math.min(frames-1, frame|0));
    if (el.classList.contains("tkKnob")){
      const pct = (frames<=1) ? 0 : (f/(frames-1));
      const a0 = (el.dataset && el.dataset.a0!=null) ? parseFloat(el.dataset.a0) : -135;
      const as = (el.dataset && el.dataset.as!=null) ? parseFloat(el.dataset.as) : 270;
      const deg = a0 + pct * as;
      el.style.setProperty("--rot", deg + "deg");
      return;
    }
    if (el.classList.contains("tkSwitch")){
      el.classList.toggle("on", f >= 1);
      return;
    }
    const pct = (frames<=1) ? 0 : (f/(frames-1))*100;
    el.style.backgroundPositionY = pct + "%";
  };
  const frameFromNorm = (n, frames, invert=false)=>{
    n = clamp01(n);
    if (invert) n = 1-n;
    return Math.round(n*(frames-1));
  };

  const mk = (cls, x, y, w, h)=>{
    const el = document.createElement("div");
    el.className = "tkSprite " + cls;
    el.style.left = Math.round(x) + "px";
    el.style.top  = Math.round(y*YS) + "px";
    el.style.width  = Math.round(w) + "px";
    el.style.height = Math.round(h*YS) + "px";
    skin.appendChild(el);
    return el;
  };

  // Controls (top-left coordinates)
  const swLC = mk("tkSwitch", 55, 118, 48, 60);         // LIMIT/COMPRESS
  const swSC = mk("tkSwitch", 665, 118, 48, 60);        // SIDECHAIN INT (mapped to Side chain)
  const kbGain = mk("tkKnob arc", 165, 130, 70, 80);        // GAIN
  const kbPR   = mk("tkKnob arc", 565, 130, 70, 80);        // PEAK REDUCTION
  kbGain.style.height = kbGain.style.width;
  kbPR.style.height = kbPR.style.width;


  // Knob arc mapping: 0 at ~8 o'clock, max at ~4 o'clock (matches scales).
  [kbGain, kbPR].forEach((k)=>{ try{ k.dataset.a0 = "240"; k.dataset.as = "240"; }catch(_){ } });

  // Invert Peak Reduction knob direction: left = minimum reduction, right = maximum reduction.
  // Under the hood this knob drives Threshold (dB), where *lower* values mean *more* reduction.
  kbPR.dataset.inv = "1";

  // Meter face (CCVU2 is drawn inside the legacy LA frame)
  const vuFace = mk("tkVuFace", 305, 85, 190, 92);

  // Needle (pivot is slightly below the visible face, matching the JSFX line draw)
  // Shift pivot a bit left so the 0-mark lines up visually with GR=0.
  const needleLen = 105;
  const pivotX = 385;
  const pivotY = 200 * YS; // JSFX uses y=200 in 238px canvas
  const needle = document.createElement("div");
  needle.className = "tkNeedle";
  needle.style.left = Math.round(pivotX) + "px";
  needle.style.top  = Math.round(pivotY - needleLen) + "px";
  needle.style.height = needleLen + "px";
  needle.style.transform = "translateX(-50%) rotate(25deg)";
  skin.appendChild(needle);

  const mkLabel = (cls, text, x, y, w)=>{
    const el = document.createElement("div");
    el.className = cls;
    el.textContent = text;
    el.style.left = x + "px";
    el.style.top = y + "px";
    if (w) el.style.width = w + "px";
    skin.appendChild(el);
    return el;
  };
  mkLabel("laLabel", "LIMIT", 46, 92, 66);
  mkLabel("laLabel small", "COMPRESS", 38, 196, 82);
  mkLabel("laLabel", "SC", 665, 92, 48);
  mkLabel("laLabel small", "INT", 665, 196, 48);
  mkLabel("laLabel", "GAIN", 168, 208, 70);
  mkLabel("laLabel", "PEAK REDUCTION", 520, 208, 160);

  // Dial markings inside the knob faces (reference style: numbers + dots, no outer spokes).
  const addInnerDialScale = (knobEl, maxVal=100, majorStepVal=10, minorStepVal=5)=>{
    const svgns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgns, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.classList.add("tkDialScale", "la", "inner");
    svg.style.position = "absolute";
    svg.style.inset = "0";
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.pointerEvents = "none";
    knobEl.appendChild(svg);

    const mid = 50;
    const rDot  = 44;
    const rText = 34;
    const startDeg = 240;
    const endDeg = 120;
    const endAdj = (endDeg < startDeg) ? (endDeg + 360) : endDeg;
    const sweep = endAdj - startDeg;

    const steps = Math.max(4, Math.round(maxVal / minorStepVal));
    for (let i=0;i<=steps;i++){
      const val = minorStepVal * i;
      const isMajor = (Math.round(val) % majorStepVal) === 0;
      const deg = startDeg + sweep*(i/steps);
      const rad = deg * Math.PI/180;

      const xDot = mid + Math.sin(rad) * rDot;
      const yDot = mid - Math.cos(rad) * rDot;

      if (!isMajor){
        const c = document.createElementNS(svgns, "circle");
        c.setAttribute("cx", xDot.toFixed(2));
        c.setAttribute("cy", yDot.toFixed(2));
        c.setAttribute("r", "1.4");
        c.setAttribute("class", "dot");
        svg.appendChild(c);
      }else{
        const tx = mid + Math.sin(rad) * rText;
        const ty = mid - Math.cos(rad) * rText;
        const t = document.createElementNS(svgns, "text");
        t.textContent = String(Math.round(val));
        t.setAttribute("x", tx.toFixed(2));
        t.setAttribute("y", ty.toFixed(2));
        t.setAttribute("text-anchor", "middle");
        t.setAttribute("dominant-baseline", "middle");
        t.setAttribute("class", "label");
        svg.appendChild(t);
      }
    }
  };
  addInnerDialScale(kbGain, 100, 10, 5);
  addInnerDialScale(kbPR,   100, 10, 5);


  const addVuScale = (face)=>{
    const scale = document.createElement("div");
    scale.className = "vuScale";
    const ticks = [
      {t:"20", x:10},
      {t:"10", x:24},
      {t:"7",  x:36},
      {t:"5",  x:46},
      {t:"3",  x:56},
      {t:"1",  x:66},
      {t:"0",  x:76},
      {t:"1",  x:84, pos:1},
      {t:"2",  x:92, pos:1},
      {t:"+",  x:98, pos:1},
    ];
    ticks.forEach((tick)=>{
      const span = document.createElement("span");
      span.textContent = tick.t;
      if (tick.pos) span.classList.add("pos");
      span.style.left = tick.x + "%";
      scale.appendChild(span);
    });
    face.appendChild(scale);
  };
  addVuScale(vuFace);

  // Sprites
  const setKnobSprite = (el, _url, frames)=>{
    el.dataset.frames = String(frames);
  };
  const setSwitchSprite = (el, _url)=>{
    el.dataset.frames = "2";
  };
  setKnobSprite(kbGain, "", 61);
  setKnobSprite(kbPR,   "", 61);
  setSwitchSprite(swLC, "");
  setSwitchSprite(swSC, "");

  // --- Dynamic param mapping (do NOT capture param objects, only indices) ---
  let idxGain = null, idxThr = null, idxPRLegacy = null, idxMode = null, idxSC = null, idxGR = null;
  const getP = (idx)=> (Number.isFinite(idx)) ? (win.params||[]).find(p=>p.index===idx) : null;

  const remap = ()=>{
    const ps = Array.isArray(win.params) ? win.params : [];
    const pGain = findParamByPatterns(ps, ex.gainFind||[]) || ps.find(p=>/\b(output|gain)\b/i.test(String(p.name||""))) || ps.find(p=>p.index===2) || null;
    // LA-1A has multiple "Threshold"-related params (some are hidden with -DONT).
    // The *actual* knob should drive the user-facing Threshold (dB) (typically index 6),
    // not the internal "-DONT Peak Reduction" meter param.
    const pThr  = findParamByPatterns(ps, ex.thresholdFind||[])
      || ps.find(p=>{ const cn = cleanParamName(p.name); return cn.startsWith('threshold') && !cn.includes('dont'); })
      || ps.find(p=>p.index===6) || null;
    const pPRL  = findParamByPatterns(ps, ex.peakFind||[]) 
      || ps.find(p=>/peak\s*reduction/i.test(String(p.name||""))) 
      || ps.find(p=>p.index===8) || null;
    const pMode = findParamByPatterns(ps, (ex.modeFind||ex.ratioFind||[])) || ps.find(p=>/\bmode\b|compress|limit|\bratio\b/i.test(String(p.name||""))) || ps.find(p=>p.index===1) || null;
    const pSC   = findParamByPatterns(ps, ex.sidechainFind||[]) || ps.find(p=>/side\s*chain/i.test(String(p.name||""))) || ps.find(p=>p.index===4) || null;
    // optional telemetry GR for RM_LA1A (slider name contains "Telemetry: GR")
    const pGR   = findParamByPatterns(ps, ex.grFind||[]) || ps.find(p=>/telemetry.*\bgr\b/i.test(String(p.name||""))) || null;

    if (pGain) idxGain = pGain.index;
    if (pThr)  idxThr = pThr.index;
    if (pPRL)  idxPRLegacy = pPRL.index;
    if (pMode) idxMode = pMode.index;
    if (pSC)   idxSC   = pSC.index;
    if (pGR)   idxGR   = pGR.index;

    if (Number.isFinite(idxGain)) kbGain.dataset.idx = String(idxGain);
    if (Number.isFinite(idxThr))  kbPR.dataset.idx   = String(idxThr);
    if (Number.isFinite(idxMode)) swLC.dataset.idx  = String(idxMode);
    if (Number.isFinite(idxSC))   swSC.dataset.idx   = String(idxSC);
  };

  const rawFromParam = (p, fallbackMin=null, fallbackMax=null)=>{
    if (!p) return 0;
    if (p.raw!=null && Number.isFinite(p.raw)) return p.raw;
    const hasMin = (p.min!=null && Number.isFinite(p.min));
    const hasMax = (p.max!=null && Number.isFinite(p.max));
    const mn = hasMin ? p.min : (fallbackMin!=null ? fallbackMin : 0);
    const mx = hasMax ? p.max : (fallbackMax!=null ? fallbackMax : 1);
    return mn + (Number(p.value||0))*(mx-mn);
  };
  const setParamRaw = (p, rawTarget)=>{
    if (!p) return;
    const mn = (p.min!=null && Number.isFinite(p.min)) ? p.min : 0;
    const mx = (p.max!=null && Number.isFinite(p.max)) ? p.max : 1;
    const rt = Math.max(mn, Math.min(mx, rawTarget));
    const next = (mx===mn) ? 0 : ((rt-mn)/(mx-mn));
    suppressPoll(win, 700);
    setParamNormalized(win, p.index, next);
    // local prediction for smooth UI
    p.value = next;
          try{ setDraggedParamValue(win, p.index, next); }catch(_){ }
p.raw = rt;
  };

  let lastNonAllRaw = 0; // 4:1 raw value

  // If this is the Telemetry FX instance, write params into the "main" RM_LA1A FX on the same track.
  const _laFxName = (()=>{ try{ return getFxNameFromCache(win.guid, win.fxIndex) || ""; }catch(_){ return ""; } })();
  const _laIsTelemetry = /\bTelemetry\b/i.test(_laFxName);
  let _laTargetFxIndex = null;
  function _laResolveTargetFxIndex(){
    if (!_laIsTelemetry) return null;
    if (Number.isFinite(_laTargetFxIndex)) return _laTargetFxIndex;
    try{
      const cached = fxCache.get(win.guid);
      const fxList = cached && Array.isArray(cached.fx) ? cached.fx : null;
      if (!fxList) return null;
      for (let i=0;i<fxList.length;i++){
        const f = fxList[i];
        const nm = String((f && f.name) ? f.name : "");
        if (/\bRM[\s_]*LA1A\b/i.test(nm) && !/\bTelemetry\b/i.test(nm)){
          _laTargetFxIndex = (f && Number.isFinite(f.index)) ? f.index : i;
          break;
        }
      }
    }catch(_){}
    return Number.isFinite(_laTargetFxIndex) ? _laTargetFxIndex : null;
  }
  function _laSetParamNorm(paramIndex, value){
    const v = Math.max(0, Math.min(1, value));
    // Some sessions use an extra [Telemetry] FX. When present, try to drive BOTH
    // the Telemetry instance (so UI doesn't snap back) and the non-telemetry audio FX.
    const tFx = _laResolveTargetFxIndex();
    if (_laIsTelemetry){
      if (Number.isFinite(tFx) && tFx !== win.fxIndex){
        wsSend({type:"setFxParam", guid: win.guid, fxIndex: tFx, param: paramIndex, value: v});
      }
      setParamNormalized(win, paramIndex, v);
      return;
    }
    setParamNormalized(win, paramIndex, v);
  }



  // Interaction: knob drag (cache param index so Telemetry layouts don't "lose" the mapping mid-drag)
  function bindKnob(el){
    let drag = null;

    const endDrag = (ev)=>{
      if (!drag || drag.id !== ev.pointerId) return;
      try{ endParamDrag(win, drag.pIdx); }catch(_){ }
      drag = null;
      try{ el.releasePointerCapture(ev.pointerId); }catch(_){ }
    };

    el.addEventListener("pointerdown", (ev)=>{
      remap();
      const pIdx = parseInt(el.dataset.idx,10);
      if (!Number.isFinite(pIdx)) return;
      const p = getP(pIdx);
      if (!p) return;

      bringPluginToFront(win);
      beginParamDrag(win, pIdx);
      suppressPoll(win, 900);

      try{ el.setPointerCapture(ev.pointerId); }catch(_){ }
      const inv = (el.dataset.inv === "1");
      drag = {id: ev.pointerId, pIdx, startY: ev.clientY, start: inv ? (1-(p.value||0)) : (p.value||0), inv,
              frames: parseInt(el.dataset.frames||"61",10) || 61};

      ev.preventDefault();
      ev.stopPropagation();
    });

    el.addEventListener("pointermove", (ev)=>{
      if (!drag || drag.id !== ev.pointerId) return;
      const p = getP(drag.pIdx);
      if (!p) return;

      bringPluginToFront(win);
      const dy = (ev.clientY - drag.startY);
      const disp = clamp01(drag.start - dy*0.004);
      const next = drag.inv ? (1-disp) : disp;

      suppressPoll(win, 900);
      _laSetParamNorm(drag.pIdx, next);
      p.value = next;
      try{ setDraggedParamValue(win, drag.pIdx, next); }catch(_){ }

      setSpriteFrame(el, frameFromNorm(next, drag.frames, drag.inv), drag.frames);
    });

    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
    el.addEventListener("dblclick", ()=>{
      remap();
      const pIdx = parseInt(el.dataset.idx,10);
      const p = getP(pIdx);
      if (!p) return;
      const tgt = Number.isFinite(p.default) ? p.default
        : Number.isFinite(p.def) ? p.def
        : Number.isFinite(p.defval) ? p.defval
        : 0.5;
      bringPluginToFront(win);
      suppressPoll(win, 700);
      setParamNormalized(win, pIdx, tgt);
      p.value = tgt;
      try{ setDraggedParamValue(win, pIdx, tgt); }catch(_){ }
      const frames = parseInt(el.dataset.frames||"61",10);
      setSpriteFrame(el, frameFromNorm(tgt, frames, el.dataset.inv === "1"), frames);
    });
  }
  bindKnob(kbGain);
  bindKnob(kbPR);

  // Sidechain switch (bool)
  const bindBoolSwitch = (el)=>{
    el.addEventListener("click", ()=>{
      remap();
      const pIdx = parseInt(el.dataset.idx,10);
      const p = getP(pIdx);
      if (!p) return;
      bringPluginToFront(win);
      suppressPoll(win, 700);
      const next = ((p.value||0) >= 0.5) ? 0.0 : 1.0;
      _laSetParamNorm(pIdx, next);
      p.value = next;
            try{ setDraggedParamValue(win, pIdx, next); }catch(_){ }
update();
    });
  };
  bindBoolSwitch(swSC);

  // Compress/Limit toggle (Mode 0..1)
  swLC.addEventListener("click", ()=>{
    remap();
    const pIdx = parseInt(swLC.dataset.idx,10);
    const p = getP(pIdx);
    if (!p) return;
    bringPluginToFront(win);
    suppressPoll(win, 700);
    const next = ((p.value||0) >= 0.5) ? 0.0 : 1.0;
    _laSetParamNorm(pIdx, next);
    p.value = next;
    try{ setDraggedParamValue(win, pIdx, next); }catch(_){ }
    update();
  });

  // Meter: simple "GR-ish" needle driven by Peak Reduction raw value (0..60 mapped to 0..24).
  let grTarget = 0;
  let grCur = 0;
  const angleFromGR = (gr)=>{
    // Perceptual-ish mapping so small GR moves visibly, while still reaching left stop by ~24 dB.
    const g = Math.max(0, Math.min(24, gr));
    const t = Math.pow(g/24, 0.65);
    const a0 = 25;   // 0 dB (right)
    const a1 = -72;  // 24 dB (left)
    return a0 + (a1-a0)*t;
  };
  function tick(){
    grCur += (grTarget - grCur) * 0.18;
    needle.style.transform = `translateX(-50%) rotate(${angleFromGR(grCur)}deg)`;
    if (win && win._isOpen !== false) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  const updateTrackMeter = ()=>{
    remap();
    const pGR = getP(idxGR);
    if (pGR){
      const rawGR = rawFromParam(pGR, 0, 24);
      grTarget = Math.max(0, Math.min(24, rawGR));
      return;
    }
    const pPR = getP(idxPRLegacy);
    const rawPR = rawFromParam(pPR); // 0..60
    grTarget = Math.max(0, Math.min(24, rawPR));
  };

  const fit_1956 = ()=>{
    const bodyEl = host.closest(".pluginWinBody");
    const ctrlEl = host.closest(".plugCtrl");
    const scope = ctrlEl || bodyEl || host.closest(".pluginParamList") || host;
    const pad = 0;
    const availW = Math.max(10, scope.clientWidth - pad*2);
    const availH = Math.max(10, scope.clientHeight - pad*2);
    let sc = Math.min(availW/BASE_W, availH/BASE_H);
    const maxScale = (win && win.el && win.el.classList && win.el.classList.contains("fullscreen")) ? 2.0 : 1.0;
    sc = Math.max(0.25, Math.min(maxScale, sc));
    stage.style.width = (BASE_W*sc) + "px";
    stage.style.height = (BASE_H*sc) + "px";
    stage.style.margin = "auto";
    stage.style.alignSelf = "center";
    skin.style.transform = `scale(${sc})`;
  };
  try{
    const ro = new ResizeObserver(()=>fit_1956());
    const obs = host.closest(".pluginParamList") || host;
    ro.observe(obs);
    host._ro = ro;
  }catch(_){}
  requestAnimationFrame(fit_1956);

  const update = ()=>{
    remap();
    const pGain = getP(idxGain);
    const pPR   = getP(idxThr);
    const pMode = getP(idxMode);
    const pSC   = getP(idxSC);

    if (pGain) setSpriteFrame(kbGain, frameFromNorm(pGain.value||0, 61, false), 61);
    if (pPR)   setSpriteFrame(kbPR,   frameFromNorm(pPR.value||0, 61, (kbPR.dataset.inv === "1")), 61);

    // Switch sprites: 0=down, 1=up
    setSpriteFrame(swLC, (!!pMode && (pMode.value||0) >= 0.5) ? 1 : 0, 2);
    setSpriteFrame(swSC, (!!pSC && (pSC.value||0) >= 0.5) ? 1 : 0, 2);
  };

  remap();
  update();
  return {el: host, update, updateTrackMeter, ctrl};
}

function buildNC76PanelControl(win, ctrl){
  // Pixel-accurate layout from the original JSFX coordinates (NC76B @gfx 906x213).
  const BASE_W = 906, BASE_H = 213;
  const ex = (ctrl && ctrl.extra) ? ctrl.extra : {};

  const host = document.createElement("div");
  host.className = "tukanHost";
  const stage = document.createElement("div");
  stage.className = "tukanStage";
  host.appendChild(stage);

  // Stage must have an explicit size; children are absolutely positioned.
  // Without this, layout scaling/centering becomes unstable and hit-testing breaks.
  stage.style.width = BASE_W + "px";
  stage.style.height = BASE_H + "px";

  const skin = document.createElement("div");
  skin.className = "tukanSkin nc76Skin";
  skin.style.width = BASE_W + "px";
  skin.style.height = BASE_H + "px";
  stage.appendChild(skin);

  // Auto-fit (and allow RM_1175 to be 1.5x like the reference screenshot).
  const _fxName = (()=>{ try{ return getFxNameFromCache(win.guid, win.fxIndex) || ""; }catch(_){ return ""; } })();
  const _is1175 = /\bRM[\s_]*1175\b/i.test(_fxName) || /\b1175\b/i.test(_fxName);
  const _targetScale = _is1175 ? 0.88 : 1.0;
  const fit_2026 = ()=>{
    const bodyEl = host.closest(".pluginWinBody");
    const ctrlEl = host.closest(".plugCtrl");
    const scope = ctrlEl || bodyEl || host.closest(".pluginParamList") || host;
    const pad = 0;
    const availW = Math.max(10, scope.clientWidth - pad*2);
    const availH = Math.max(10, scope.clientHeight - pad*2);
    let sc = Math.min(availW/BASE_W, availH/BASE_H);
    const maxScale = (win && win.el && win.el.classList && win.el.classList.contains("fullscreen"))
      ? (_targetScale * 1.35)
      : _targetScale;
    sc = Math.max(0.25, Math.min(maxScale, sc));
    stage.style.width = (BASE_W*sc) + "px";
    stage.style.height = (BASE_H*sc) + "px";
    stage.style.margin = "auto";
    stage.style.alignSelf = "center";
    skin.style.transform = `scale(${sc})`;
  };
  try{
    const ro = new ResizeObserver(()=>fit_2026());
    const obs = host.closest(".pluginParamList") || host;
    ro.observe(obs);
    host._ro = ro;
  }catch(_){ }
  requestAnimationFrame(fit_2026);

  const clamp01 = (x)=>Math.max(0, Math.min(1, x));
  const setSpriteFrame = (el, frame, frames)=>{
    const f = Math.max(0, Math.min(frames-1, frame|0));
    if (el.classList.contains("tkKnob")){
      const pct = (frames<=1) ? 0 : (f/(frames-1));
      const a0 = (el.dataset && el.dataset.a0!=null) ? parseFloat(el.dataset.a0) : -135;
      const as = (el.dataset && el.dataset.as!=null) ? parseFloat(el.dataset.as) : 270;
      const deg = a0 + pct * as;
      el.style.setProperty("--rot", deg + "deg");
      return;
    }
    if (el.classList.contains("tkSwitch")){
      el.classList.toggle("on", f >= 1);
      return;
    }
    const pct = (frames<=1) ? 0 : (f/(frames-1))*100;
    el.style.backgroundPositionY = pct + "%";
  };
  const frameFromNorm = (n, frames, invert=false)=>{
    n = clamp01(n);
    if (invert) n = 1-n;
    return Math.round(n*(frames-1));
  };

  const mk = (cls, x, y, w, h)=>{
    const el = document.createElement("div");
    el.className = "tkSprite " + cls;
    el.style.left = Math.round(x) + "px";
    el.style.top  = Math.round(y) + "px";
    el.style.width  = Math.round(w) + "px";
    el.style.height = Math.round(h) + "px";
    skin.appendChild(el);
    return el;
  };

  const kbIn  = mk("tkKnob arc", 80, 60, 100, 100);
  const kbOut = mk("tkKnob arc", 270, 60, 100, 100);
  const kbAtt = mk("tkKnob arc", 460, 53, 40, 40);
  const kbRel = mk("tkKnob arc", 460, 133, 40, 40);


  // Knob arc mapping: 0 at ~8 o'clock, max at ~4 o'clock (matches numeric scales).
  [kbIn, kbOut, kbAtt, kbRel].forEach((k)=>{ try{ k.dataset.a0 = "240"; k.dataset.as = "240"; }catch(_){ } });

  // 1176-style reverse timing: display is inverted vs parameter
  kbAtt.dataset.inv = "1";
  kbRel.dataset.inv = "1";

  const vuFace = mk("tkVuFace", 605, 55, 190, 92);

  // VU meter window is 92px tall (y=55..147). Keep the pivot on the bottom edge.
  const needleLen = 78;
  const pivotX = 700;
  const pivotY = 147;
  const needle = document.createElement("div");
  needle.className = "tkNeedle";
  needle.style.left = pivotX + "px";
  needle.style.top  = (pivotY - needleLen) + "px";
  needle.style.height = needleLen + "px";
  needle.style.transform = "translateX(-50%) rotate(25deg)";
  skin.appendChild(needle);

  const mkLabel = (cls, text, x, y, w)=>{
    const el = document.createElement("div");
    el.className = cls;
    el.textContent = text;
    el.style.left = x + "px";
    el.style.top = y + "px";
    if (w) el.style.width = w + "px";
    skin.appendChild(el);
    return el;
  };
  mkLabel("nc76Label", "INPUT", 80, 170, 100);
  mkLabel("nc76Label", "OUTPUT", 270, 170, 100);
  mkLabel("nc76Label small", "ATTACK", 440, 30, 80);
  mkLabel("nc76Label small", "RELEASE", 435, 112, 90);
  mkLabel("nc76Label small", "SLOW", 425, 86, 50);
  mkLabel("nc76Label small", "FAST", 485, 86, 50);
  mkLabel("nc76Label small", "SLOW", 425, 166, 50);
  mkLabel("nc76Label small", "FAST", 485, 166, 50);

  // Dial markings (reference style: numbers + small dots between numbers; no spokes).
  const addDialScale = (cx, cy, boxSize, startDeg, endDeg, maxVal, majorStepVal, minorStepVal=2)=>{
    const svgns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgns, "svg");
    svg.setAttribute("viewBox", `0 0 ${boxSize} ${boxSize}`);
    svg.classList.add("tkDialScale", "nc");
    svg.style.left = (cx - boxSize/2) + "px";
    svg.style.top  = (cy - boxSize/2) + "px";
    svg.style.width = boxSize + "px";
    svg.style.height = boxSize + "px";
    skin.appendChild(svg);

    const mid = boxSize/2;
    const rDot  = boxSize*0.42;
    const rText = boxSize*0.46;

    const endAdj = (endDeg < startDeg) ? (endDeg + 360) : endDeg;
    const sweep = endAdj - startDeg;

    const steps = Math.max(4, Math.round(maxVal / minorStepVal));
    for (let i=0;i<=steps;i++){
      const val = minorStepVal * i;
      const isMajor = (Math.round(val) % majorStepVal) === 0;
      const deg = startDeg + sweep*(i/steps);
      const rad = deg * Math.PI/180;

      const xDot = mid + Math.sin(rad) * rDot;
      const yDot = mid - Math.cos(rad) * rDot;

      if (!isMajor){
        const c = document.createElementNS(svgns, "circle");
        c.setAttribute("cx", xDot.toFixed(2));
        c.setAttribute("cy", yDot.toFixed(2));
        c.setAttribute("r", (boxSize*0.010).toFixed(2));
        c.setAttribute("class", "dot");
        svg.appendChild(c);
      }else{
        const tx = mid + Math.sin(rad) * rText;
        const ty = mid - Math.cos(rad) * rText;
        const t = document.createElementNS(svgns, "text");
        t.textContent = String(Math.round(val));
        t.setAttribute("x", tx.toFixed(2));
        t.setAttribute("y", ty.toFixed(2));
        t.setAttribute("text-anchor", "middle");
        t.setAttribute("dominant-baseline", "middle");
        t.setAttribute("class", "label");
        svg.appendChild(t);
      }
    }
  };

  // Arc goes over the top: left-bottom (8 o'clock) -> right-bottom (4 o'clock).
  addDialScale(130, 110, 190, 240, 120, 48, 6);
  addDialScale(320, 110, 190, 240, 120, 48, 6);


  // Timing knobs: add intermediate dots between SLOW and FAST (no spokes from center).
  const addTimingDots = (cx, cy, boxSize, startDeg, endDeg, countBetween=5)=>{
    const svgns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgns, "svg");
    svg.setAttribute("viewBox", `0 0 ${boxSize} ${boxSize}`);
    svg.classList.add("tkDialScale", "timing");
    svg.style.left = (cx - boxSize/2) + "px";
    svg.style.top  = (cy - boxSize/2) + "px";
    svg.style.width = boxSize + "px";
    svg.style.height = boxSize + "px";
    skin.appendChild(svg);

    const mid = boxSize/2;
    const rDot = boxSize*0.44;
    const endAdj = (endDeg < startDeg) ? (endDeg + 360) : endDeg;
    const sweep = endAdj - startDeg;

    const total = Math.max(1, countBetween+1);
    for (let i=1;i<total;i++){
      const deg = startDeg + sweep*(i/total);
      const rad = deg * Math.PI/180;
      const c = document.createElementNS(svgns, "circle");
      c.setAttribute("cx", (mid + Math.sin(rad)*rDot).toFixed(2));
      c.setAttribute("cy", (mid - Math.cos(rad)*rDot).toFixed(2));
      c.setAttribute("r", (boxSize*0.018).toFixed(2));
      c.setAttribute("class", "dot");
      svg.appendChild(c);
    }
  };
  addTimingDots(480, 73, 78, 240, 120, 5);
  addTimingDots(480, 153, 78, 240, 120, 5);


  const addVuScale = (face)=>{
    const scale = document.createElement("div");
    scale.className = "vuScale";
    const ticks = [
      {t:"20", x:10},
      {t:"10", x:24},
      {t:"7",  x:36},
      {t:"5",  x:46},
      {t:"3",  x:56},
      {t:"1",  x:66},
      {t:"0",  x:76},
      {t:"1",  x:84, pos:1},
      {t:"2",  x:92, pos:1},
      {t:"+",  x:98, pos:1},
    ];
    ticks.forEach((tick)=>{
      const span = document.createElement("span");
      span.textContent = tick.t;
      if (tick.pos) span.classList.add("pos");
            span.style.left = tick.x + "%";
      scale.appendChild(span);
    });
    face.appendChild(scale);
  };
  addVuScale(vuFace);


  const setKnobSprite = (el, url, frames)=>{
    el.dataset.frames = String(frames);
  };
  setKnobSprite(kbIn,  "", 61);
  setKnobSprite(kbOut, "", 61);
  setKnobSprite(kbAtt, "", 61);
  setKnobSprite(kbRel, "", 61);

  // RM_1175 Ratio is an enum 0..4 {4,8,12,20,ALL}
  const ratioBtns = [
    {raw:3, x:540, y:40},  // 20
    {raw:2, x:540, y:75},  // 12
    {raw:1, x:540, y:110}, // 8
    {raw:0, x:540, y:145}, // 4
  ].map(b=>{
    const el = mk("tkBtn", b.x, b.y, 35, 35);
    el.dataset.raw = String(b.raw);
    el.textContent = String(b.raw === 3 ? 20 : b.raw === 2 ? 12 : b.raw === 1 ? 8 : 4);
    return el;
  });

  const optPunch = mk("tkBtn", 820, 40, 35, 35);
  const optSCKey = mk("tkBtn", 820, 75, 35, 35);
  const optTrick = mk("tkBtn", 820, 110, 35, 35);
  const optAllIn = mk("tkBtn", 820, 145, 35, 35);
  optPunch.textContent = "P";
  optSCKey.textContent = "SC";
  optTrick.textContent = "TR";
  optAllIn.textContent = "ALL";

  // --- Dynamic param mapping ---
  let idxIn=null, idxOut=null, idxAtt=null, idxRel=null, idxRatio=null, idxPunch=null, idxSCKey=null, idxTrick=null, idxGR=null;
  const getP = (idx)=> (Number.isFinite(idx)) ? (win.params||[]).find(p=>p.index===idx) : null;

  const remap = ()=>{
    const ps = Array.isArray(win.params) ? win.params : [];
    const find = (arr)=> (arr && Array.isArray(ps)) ? findParamByPatterns(ps, arr) : null;

    const pIn    = find(ex.inputFind)
      || ps.find(p=>/^\s*input\b/i.test(String(p.name||"")))
      || ps.find(p=>/\bin\s*gain\b/i.test(String(p.name||"")))
      || ps.find(p=>p.index===0) || ps.find(p=>p.index===5) || null;
    const pOut   = find(ex.outputFind)
      || ps.find(p=>/^\s*output\b/i.test(String(p.name||"")))
      || ps.find(p=>/\bout\s*gain\b/i.test(String(p.name||"")))
      || ps.find(p=>p.index===1) || null;
    const pAtt   = find(ex.attackFind)
      || ps.find(p=>/^\s*attack\b/i.test(String(p.name||"")))
      || ps.find(p=>p.index===2) || null;
    const pRel   = find(ex.releaseFind)
      || ps.find(p=>/^\s*release\b/i.test(String(p.name||"")))
      || ps.find(p=>p.index===3) || null;
    const pRatio = find(ex.ratioFind)
      || ps.find(p=>/^\s*ratio\b/i.test(String(p.name||"")))
      || ps.find(p=>p.index===4) || null;
    const pPunch = find(ex.punchFind)  || ps.find(p=>/\bpunch\b/i.test(String(p.name||"")))        || ps.find(p=>p.index===6) || null;
    const pSCKey = find(ex.sckeyFind)  || ps.find(p=>/\bsc[\-\s]*key\b/i.test(String(p.name||""))) || ps.find(p=>p.index===7) || null;
    const pTrick = find(ex.trickFind)  || ps.find(p=>/\btrick\b/i.test(String(p.name||"")))        || ps.find(p=>p.index===8) || null;
    const pGR    = find(ex.grFind)
      || ps.find(p=>/gain\s*reduction/i.test(String(p.name||"")))
      || ps.find(p=>/^\s*gr\b/i.test(String(p.name||"")))
      || ps.find(p=>/\bgr\b/i.test(String(p.name||"")))
      || null;
    if (pIn) idxIn = pIn.index;
    if (pOut) idxOut = pOut.index;
    if (pAtt) idxAtt = pAtt.index;
    if (pRel) idxRel = pRel.index;
    if (pRatio) idxRatio = pRatio.index;
    if (pPunch) idxPunch = pPunch.index;
    if (pSCKey) idxSCKey = pSCKey.index;
    if (pTrick) idxTrick = pTrick.index;
    if (pGR) idxGR = pGR.index;

    if (Number.isFinite(idxIn))  kbIn.dataset.idx = String(idxIn);
    if (Number.isFinite(idxOut)) kbOut.dataset.idx = String(idxOut);
    if (Number.isFinite(idxAtt)) kbAtt.dataset.idx = String(idxAtt);
    if (Number.isFinite(idxRel)) kbRel.dataset.idx = String(idxRel);
    if (Number.isFinite(idxRatio)) optAllIn.dataset.idx = String(idxRatio);
    if (Number.isFinite(idxPunch)) optPunch.dataset.idx = String(idxPunch);
    if (Number.isFinite(idxSCKey)) optSCKey.dataset.idx = String(idxSCKey);
    if (Number.isFinite(idxTrick)) optTrick.dataset.idx = String(idxTrick);
  };

  function bindKnob(el){
    let drag = null;
    el.addEventListener("pointerdown", (ev)=>{
      remap();
      const pIdx = parseInt(el.dataset.idx,10);
      const p = getP(pIdx);
      if (!p) return;
      bringPluginToFront(win);
            beginParamDrag(win, pIdx);
el.setPointerCapture(ev.pointerId);
      const inv = (el.dataset.inv === "1");
      drag = {id: ev.pointerId, startY: ev.clientY, start: inv ? (1-(p.value||0)) : (p.value||0), inv};
      ev.preventDefault();
      ev.stopPropagation();
    });
    el.addEventListener("pointermove", (ev)=>{
      if (!drag || drag.id !== ev.pointerId) return;
      remap();
      const pIdx = parseInt(el.dataset.idx,10);
      const p = getP(pIdx);
      if (!p) return;
      const dy = (ev.clientY - drag.startY);
      const disp = clamp01(drag.start - dy*0.004);
      const next = drag.inv ? (1-disp) : disp;
      suppressPoll(win, 700);
      setParamNormalized(win, pIdx, next);
      p.value = next;
            try{ setDraggedParamValue(win, pIdx, next); }catch(_){ }
const frames = parseInt(el.dataset.frames||"61",10);
      const inv = drag.inv;
      setSpriteFrame(el, frameFromNorm(next, frames, inv), frames);
    });
    const end = (ev)=>{ if (drag && drag.id===ev.pointerId){
      try{ remap(); const pIdx = parseInt(el.dataset.idx,10); if (Number.isFinite(pIdx)) endParamDrag(win, pIdx); }catch(_){ }
      drag = null;
    } };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("dblclick", ()=>{
      remap();
      const pIdx = parseInt(el.dataset.idx,10);
      const p = getP(pIdx);
      if (!p) return;
      const tgt = Number.isFinite(p.default) ? p.default
        : Number.isFinite(p.def) ? p.def
        : Number.isFinite(p.defval) ? p.defval
        : 0.5;
      bringPluginToFront(win);
      suppressPoll(win, 700);
      setParamNormalized(win, pIdx, tgt);
      p.value = tgt;
      try{ setDraggedParamValue(win, pIdx, tgt); }catch(_){ }
      const frames = parseInt(el.dataset.frames||"61",10);
      setSpriteFrame(el, frameFromNorm(tgt, frames, el.dataset.inv === "1"), frames);
    });
  }
  bindKnob(kbIn); bindKnob(kbOut); bindKnob(kbAtt); bindKnob(kbRel);

  const rawFromParam = (p, fallbackMin=0, fallbackMax=4)=>{
    if (!p) return 0;
    if (p.raw!=null && Number.isFinite(p.raw)) return p.raw;
    const mn = (p.min!=null && Number.isFinite(p.min)) ? p.min : fallbackMin;
    const mx = (p.max!=null && Number.isFinite(p.max)) ? p.max : fallbackMax;
    return mn + (Number(p.value||0))*(mx-mn);
  };
  const setParamRaw = (p, rawTarget, fallbackMin=0, fallbackMax=4)=>{
    if (!p) return;
    const mn = (p.min!=null && Number.isFinite(p.min)) ? p.min : fallbackMin;
    const mx = (p.max!=null && Number.isFinite(p.max)) ? p.max : fallbackMax;
    const rt = Math.max(mn, Math.min(mx, rawTarget));
    const next = (mx===mn) ? 0 : ((rt-mn)/(mx-mn));
    suppressPoll(win, 700);
    setParamNormalized(win, p.index, next);
    p.value = next;
          try{ setDraggedParamValue(win, p.index, next); }catch(_){ }
p.raw = rt;
  };

  let lastNonAllRaw = 0; // 4:1 raw value

  ratioBtns.forEach(btn=>{
    btn.addEventListener("click", ()=>{
      remap();
      const pRatio = getP(idxRatio);
      if (!pRatio) return;
      bringPluginToFront(win);
      const raw = parseFloat(btn.dataset.raw||"0");
      lastNonAllRaw = raw;
      setParamRaw(pRatio, raw, 0, 4);
      update();
    });
  });

  optAllIn.addEventListener("click", ()=>{
    remap();
    const pRatio = getP(idxRatio);
    if (!pRatio) return;
    bringPluginToFront(win);

    const cur = rawFromParam(pRatio, 0, 4);
    const isAll = (cur >= 3.5);

    // Toggle ALL-IN. When turning OFF, restore the last selected non-ALL ratio.
    if (!isAll){
      // Remember current ratio before going ALL.
      if (cur <= 3.0) lastNonAllRaw = cur;
      setParamRaw(pRatio, 4, 0, 4);
    }else{
      setParamRaw(pRatio, (lastNonAllRaw!=null ? lastNonAllRaw : 0), 0, 4);
    }
    update();
  });

  const bindBoolBtn = (el)=>{
    el.addEventListener("click", ()=>{
      remap();
      const pIdx = parseInt(el.dataset.idx,10);
      const p = getP(pIdx);
      if (!p) return;
      bringPluginToFront(win);
      const next = ((p.value||0) >= 0.5) ? 0.0 : 1.0;
      suppressPoll(win, 700);
      setParamNormalized(win, pIdx, next);
      p.value = next;
            try{ setDraggedParamValue(win, pIdx, next); }catch(_){ }
update();
    });
  };
  bindBoolBtn(optPunch);
  bindBoolBtn(optSCKey);
  bindBoolBtn(optTrick);

  // Meter: prefer direct GR param (if present), else estimate -> needle angle.
  let grTarget = 0;
  let grCur = 0;
  const angleFromGR = (gr)=>{
    // Perceptual-ish mapping so small GR moves visibly, while still reaching left stop by ~24 dB.
    const g = Math.max(0, Math.min(24, gr));
    const t = Math.pow(g/24, 0.65);
    const a0 = 25;   // 0 dB (right, near "0" mark)
    const a1 = -72;  // 24 dB (left)
    return a0 + (a1-a0)*t;
  };
  function tick(){
    grCur += (grTarget - grCur) * 0.18;
    needle.style.transform = `translateX(-50%) rotate(${angleFromGR(grCur)}deg)`;
    if (win && win._isOpen !== false) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  const computeGR = ()=>{
    remap();
    const pGR = getP(idxGR);
    if (pGR){
      const g = rawFromParam(pGR, 0, 24);
      return Math.max(0, Math.min(24, g));
    }
    const pIn = getP(idxIn);
    const pRatio = getP(idxRatio);
    const pAtt = getP(idxAtt);
    const pRel = getP(idxRel);
    const inRaw = rawFromParam(pIn);     // 0..4
    const rRaw = rawFromParam(pRatio);   // 0..9 (enum)
    const att = pAtt ? (pAtt.value||0) : 0.5;
    const rel = pRel ? (pRel.value||0) : 0.5;
    // Simple heuristic that at least moves like the real meter:
    const ratioFactor = 0.55 + 0.65*(rRaw/4);
    const timeFactor  = 0.6 + 0.4*(1-rel) * (0.7 + 0.3*(1-att));
    return Math.max(0, Math.min(24, inRaw*6*ratioFactor*timeFactor));
  };

  const updateTrackMeter = ()=>{ grTarget = computeGR(); };


  const update = ()=>{
    remap();
    const pIn  = getP(idxIn);
    const pOut = getP(idxOut);
    const pAtt = getP(idxAtt);
    const pRel = getP(idxRel);
    const pRatio = getP(idxRatio);
    const pPunch = getP(idxPunch);
    const pSCKey = getP(idxSCKey);
    const pTrick = getP(idxTrick);

    if (pIn) setSpriteFrame(kbIn, frameFromNorm(pIn.value||0, 61, false), 61);
    if (pOut) setSpriteFrame(kbOut, frameFromNorm(pOut.value||0, 61, false), 61);
    if (pAtt) setSpriteFrame(kbAtt, frameFromNorm(pAtt.value||0, 61, true), 61);
    if (pRel) setSpriteFrame(kbRel, frameFromNorm(pRel.value||0, 61, true), 61);

    const rraw = rawFromParam(pRatio, 0, 4);
    const all = (rraw >= 3.5); // 4 = ALL
    ratioBtns.forEach(btn=>{
      const raw = parseFloat(btn.dataset.raw||"0");
      btn.classList.toggle("on", all || Math.abs(rraw-raw) < 0.51);
    });
    optAllIn.classList.toggle("on", all);
    optPunch.classList.toggle("on", !!pPunch && (pPunch.value||0) >= 0.5);
    optSCKey.classList.toggle("on", !!pSCKey && (pSCKey.value||0) >= 0.5);
    optTrick.classList.toggle("on", !!pTrick && (pTrick.value||0) >= 0.5);
  };

  remap();
  update();
  return {el: host, update, updateTrackMeter, ctrl};
}

function buildPreAmpPanelControl(win, ctrl){
  // Pixel-accurate layout from the original JSFX coordinates (PreAmp @gfx 350x410).
  const BASE_W = 350, BASE_H = 410;
  // VU fill should end at the start of the right grey strip.
  const PRE_VU_MAX = 1.0;// fill full slot width
  const ex = (ctrl && ctrl.extra) ? ctrl.extra : {};

  const host = document.createElement("div");
  host.className = "tukanHost";
  const stage = document.createElement("div");
  stage.className = "tukanStage";
  host.appendChild(stage);

  const skin = document.createElement("div");
  skin.className = "tukanSkin preSkin";
  skin.style.width = BASE_W + "px";
  skin.style.height = BASE_H + "px";
  stage.appendChild(skin);

  const clamp01 = (x)=>Math.max(0, Math.min(1, x));
  const setSpriteFrame = (el, frame, frames)=>{
    const f = Math.max(0, Math.min(frames-1, frame|0));
    if (el.classList.contains("tkKnob")){
      const pct = (frames<=1) ? 0 : (f/(frames-1));
      const a0 = (el.dataset && el.dataset.a0!=null) ? parseFloat(el.dataset.a0) : -135;
      const as = (el.dataset && el.dataset.as!=null) ? parseFloat(el.dataset.as) : 270;
      const deg = a0 + pct * as;
      el.style.setProperty("--rot", deg + "deg");
      return;
    }
    if (el.classList.contains("tkSwitch")){
      el.classList.toggle("on", f >= 1);
      return;
    }
    const pct = (frames<=1) ? 0 : (f/(frames-1))*100;
    el.style.backgroundPositionY = pct + "%";
  };
  const frameFromNorm = (n, frames, invert=false)=>{
    n = clamp01(n);
    if (invert) n = 1-n;
    return Math.round(n*(frames-1));
  };
  const mk = (cls, x, y, w, h)=>{
    const el = document.createElement("div");
    el.className = "tkSprite " + cls;
    el.style.left = Math.round(x) + "px";
    el.style.top  = Math.round(y) + "px";
    el.style.width  = Math.round(w) + "px";
    el.style.height = Math.round(h) + "px";
    skin.appendChild(el);
    return el;
  };

  // Controls (top-left coordinates)
  const kbIn   = mk("tkKnob preKnob inputRing", 120, 50, 110, 110);
  const kbOut  = mk("tkKnob preKnob outputRing", 120, 250, 110, 110);
  const kbLow  = mk("tkKnob preKnob preKnobSmall eqRing", 30, 275, 60, 60);
  const kbHigh = mk("tkKnob preKnob preKnobSmall eqRing", 260, 275, 60, 60);
  const swDist = mk("tkSwitch", 30, 81, 48, 60);   // DIST
  const swPre  = mk("tkSwitch", 260, 81, 48, 60);  // PRE ON/OFF


  // Preamp knob arc mapping (rm_air-style): start ~7 o'clock, end ~5 o'clock (clockwise).
  [kbIn, kbOut, kbLow, kbHigh].forEach((k)=>{ try{ k.dataset.a0 = "210"; k.dataset.as = "300"; }catch(_){ } });

  const mkLabel = (cls, text, x, y, w)=>{
    const el = document.createElement("div");
    el.className = cls;
    el.textContent = text;
    el.style.left = x + "px";
    el.style.top = y + "px";
    if (w) el.style.width = w + "px";
    skin.appendChild(el);
    return el;
  };
  mkLabel("preLabel", "MODE", 14, 38, 80);
  mkLabel("preLabel", "DIST", 20, 64, 64);
  mkLabel("preLabel small muted", "PRE", 22, 146, 64);

  mkLabel("preLabel", "PRE STAGE", 246, 38, 90);
  mkLabel("preLabel small", "ON", 254, 64, 70);
  mkLabel("preLabel small muted", "OFF", 254, 146, 70);

  mkLabel("preLabel", "INPUT", 130, 24, 90);

  mkLabel("preLabel", "OUTPUT", 130, 226, 90);
  mkLabel("preLabel", "LOW EQ", 16, 244, 70);
  mkLabel("preLabel", "HI EQ", 255, 244, 70);

  const knobValue = (el)=>{
    const v = document.createElement("div");
    v.className = "preKnobValue";
    v.textContent = "0";
    el.appendChild(v);
    return v;
  };
  const kbInVal = knobValue(kbIn);
  const kbOutVal = knobValue(kbOut);
  const kbLowVal = knobValue(kbLow);
  const kbHighVal = knobValue(kbHigh);

  const setKnobSprite = (el, url, frames)=>{
    el.dataset.frames = String(frames);
  };
  const setSwitchSprite = (el, url)=>{
    el.dataset.frames = "2";
  };
  setKnobSprite(kbIn,  "", 101);
  setKnobSprite(kbOut, "", 101);
  setKnobSprite(kbLow, "", 101);
  setKnobSprite(kbHigh,"", 101);
  setSwitchSprite(swDist, "");
  setSwitchSprite(swPre,  "");

// --- VU overlays (telemetry sliders) ---
const vuInSlot = document.createElement("div");
vuInSlot.className = "preVuSlot in";
const vuInFill = document.createElement("div");
vuInFill.className = "preVuFill";
	const vuInSeg = document.createElement("div");
	vuInSeg.className = "preVuSeg";
const vuInPeak = document.createElement("div");
vuInPeak.className = "preVuPeak";
	vuInSlot.appendChild(vuInFill);
	vuInSlot.appendChild(vuInSeg);
	vuInSlot.appendChild(vuInPeak);
skin.appendChild(vuInSlot);

const vuOutSlot = document.createElement("div");
vuOutSlot.className = "preVuSlot out";
const vuOutFill = document.createElement("div");
vuOutFill.className = "preVuFill";
	const vuOutSeg = document.createElement("div");
	vuOutSeg.className = "preVuSeg";
const vuOutPeak = document.createElement("div");
vuOutPeak.className = "preVuPeak";
	vuOutSlot.appendChild(vuOutFill);
	vuOutSlot.appendChild(vuOutSeg);
	vuOutSlot.appendChild(vuOutPeak);
skin.appendChild(vuOutSlot);

// Clip LED under "OVER"
const overLed = document.createElement("div");
overLed.className = "preOverLed";
  // Slightly to the right so it aligns under the printed "OVER" like the reference.
  overLed.style.left = "236px";
  overLed.style.top  = "262px";
skin.appendChild(overLed);

  // --- Dynamic mapping ---
  let idxIn=null, idxOut=null, idxLow=null, idxHigh=null, idxDist=null, idxPre=null;
  let idxInVu=null, idxInPk=null, idxOutVu=null, idxOutPk=null, idxClip=null;
  const getP = (idx)=> (Number.isFinite(idx)) ? (win.params||[]).find(p=>p.index===idx) : null;

  const remap = ()=>{
    const ps = Array.isArray(win.params) ? win.params : [];
    const find = (arr)=> (arr && Array.isArray(ps)) ? findParamByPatterns(ps, arr) : null;

    const pIn   = find(ex.driveFind) || ps.find(p=>/\binput\b/i.test(String(p.name||""))) || ps.find(p=>p.index===0) || null;
    const pOut  = find(ex.outFind)   || ps.find(p=>/\boutput\b/i.test(String(p.name||"")))|| ps.find(p=>p.index===8) || null;
    const pLow  = ps.find(p=>/\blow\s*eq\b/i.test(String(p.name||"")))  || ps.find(p=>p.index===6) || null;
    const pHigh = ps.find(p=>/\bhigh\s*eq\b/i.test(String(p.name||""))) || ps.find(p=>p.index===7) || null;
    const pDist = ps.find(p=>/\bdist\b/i.test(String(p.name||"")))      || ps.find(p=>p.index===9) || null;
    const pPre  = ps.find(p=>/\bpre\s*on\/off\b/i.test(String(p.name||""))) || ps.find(p=>/\bpre\b/i.test(String(p.name||""))) || ps.find(p=>p.index===10) || null;

const pInVu  = ps.find(p=>/telemetry.*in\s*vu/i.test(String(p.name||"")))  || ps.find(p=>/\bin\s*vu\b/i.test(String(p.name||"")))  || null;
const pInPk  = ps.find(p=>/telemetry.*in\s*peak/i.test(String(p.name||"")))|| ps.find(p=>/\bin\s*peak\b/i.test(String(p.name||"")))|| null;
const pOutVu = ps.find(p=>/telemetry.*out\s*vu/i.test(String(p.name||""))) || ps.find(p=>/\bout\s*vu\b/i.test(String(p.name||""))) || null;
const pOutPk = ps.find(p=>/telemetry.*out\s*peak/i.test(String(p.name||"")))|| ps.find(p=>/\bout\s*peak\b/i.test(String(p.name||"")))|| null;

const pClip = ps.find(p=>/\bclip\b/i.test(String(p.name||""))) || ps.find(p=>/\bover\b/i.test(String(p.name||""))) || null;

    if (pIn) idxIn = pIn.index;
    if (pOut) idxOut = pOut.index;
    if (pLow) idxLow = pLow.index;
    if (pHigh) idxHigh = pHigh.index;
    if (pDist) idxDist = pDist.index;
    if (pPre) idxPre = pPre.index;
    if (pInVu) idxInVu = pInVu.index;
    if (pInPk) idxInPk = pInPk.index;
    if (pOutVu) idxOutVu = pOutVu.index;
    if (pOutPk) idxOutPk = pOutPk.index;
    if (pClip) idxClip = pClip.index;

    if (Number.isFinite(idxIn)) kbIn.dataset.idx = String(idxIn);
    if (Number.isFinite(idxOut)) kbOut.dataset.idx = String(idxOut);
    if (Number.isFinite(idxLow)) kbLow.dataset.idx = String(idxLow);
    if (Number.isFinite(idxHigh)) kbHigh.dataset.idx = String(idxHigh);
    if (Number.isFinite(idxDist)) swDist.dataset.idx = String(idxDist);
    if (Number.isFinite(idxPre)) swPre.dataset.idx  = String(idxPre);
  };

  function bindKnob(el){
    let drag = null;
    el.addEventListener("pointerdown", (ev)=>{
      remap();
      const pIdx = parseInt(el.dataset.idx,10);
      const p = getP(pIdx);
      if (!p) return;
      bringPluginToFront(win);
            beginParamDrag(win, pIdx);
el.setPointerCapture(ev.pointerId);
      const inv = (el.dataset.inv === "1");
      drag = {id: ev.pointerId, startY: ev.clientY, start: inv ? (1-(p.value||0)) : (p.value||0), inv};
      ev.preventDefault();
      ev.stopPropagation();
    });
    el.addEventListener("pointermove", (ev)=>{
      if (!drag || drag.id !== ev.pointerId) return;
      remap();
      const pIdx = parseInt(el.dataset.idx,10);
      const p = getP(pIdx);
      if (!p) return;
      const dy = (ev.clientY - drag.startY);
      const disp = clamp01(drag.start - dy*0.004);
      const next = drag.inv ? (1-disp) : disp;
      suppressPoll(win, 700);
      setParamNormalized(win, pIdx, next);
      p.value = next;
            try{ setDraggedParamValue(win, pIdx, next); }catch(_){ }
const frames = parseInt(el.dataset.frames||"101",10);
      const inv = (el.dataset.inv === "1");
      setSpriteFrame(el, frameFromNorm(next, frames, inv), frames);
    });
    const end = (ev)=>{ if (drag && drag.id===ev.pointerId){
      try{ remap(); const pIdx = parseInt(el.dataset.idx,10); if (Number.isFinite(pIdx)) endParamDrag(win, pIdx); }catch(_){ }
      drag = null;
    } };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("dblclick", ()=>{
      remap();
      const pIdx = parseInt(el.dataset.idx,10);
      const p = getP(pIdx);
      if (!p) return;
      const tgt = Number.isFinite(p.default) ? p.default
        : Number.isFinite(p.def) ? p.def
        : Number.isFinite(p.defval) ? p.defval
        : 0.5;
      bringPluginToFront(win);
      suppressPoll(win, 700);
      setParamNormalized(win, pIdx, tgt);
      p.value = tgt;
      try{ setDraggedParamValue(win, pIdx, tgt); }catch(_){ }
      const frames = parseInt(el.dataset.frames||"101",10);
      setSpriteFrame(el, frameFromNorm(tgt, frames, el.dataset.inv === "1"), frames);
    });
  }
  bindKnob(kbIn); bindKnob(kbOut); bindKnob(kbLow); bindKnob(kbHigh);

  const bindBoolSwitch = (el)=>{
    el.addEventListener("click", ()=>{
      remap();
      const pIdx = parseInt(el.dataset.idx,10);
      const p = getP(pIdx);
      if (!p) return;
      bringPluginToFront(win);
      suppressPoll(win, 700);
      const next = ((p.value||0) >= 0.5) ? 0.0 : 1.0;
      setParamNormalized(win, pIdx, next);
      p.value = next;
            try{ setDraggedParamValue(win, pIdx, next); }catch(_){ }
update();
    });
  };
  bindBoolSwitch(swDist);
  bindBoolSwitch(swPre);

  const fit_2763 = ()=>{
    const bodyEl = host.closest(".pluginWinBody");
    const ctrlEl = host.closest(".plugCtrl");
    const scope = ctrlEl || bodyEl || host.closest(".pluginParamList") || host;
    const pad = 0;
    const availW = Math.max(10, scope.clientWidth - pad*2);
    const availH = Math.max(10, scope.clientHeight - pad*2);
    let sc = Math.min(availW/BASE_W, availH/BASE_H);
    const maxScale = (win && win.el && win.el.classList && win.el.classList.contains("fullscreen")) ? 4.2 : 3.6;
    sc = Math.max(0.25, Math.min(maxScale, sc));
    stage.style.width = (BASE_W*sc) + "px";
    stage.style.height = (BASE_H*sc) + "px";
    skin.style.transform = `scale(${sc})`;
  };
  try{
    const ro = new ResizeObserver(()=>fit_2763());
    const obs = host.closest(".pluginParamList") || host;
    ro.observe(obs);
    host._ro = ro;
  }catch(_){}
  requestAnimationFrame(fit_2763);

  const update = ()=>{
    remap();
    const pIn = getP(idxIn);
    const pOut = getP(idxOut);
    const pLow = getP(idxLow);
    const pHigh = getP(idxHigh);
    const pDist = getP(idxDist);
    const pPre = getP(idxPre);

    if (pIn) setSpriteFrame(kbIn, frameFromNorm(pIn.value||0, 101, false), 101);
    if (pOut) setSpriteFrame(kbOut, frameFromNorm(pOut.value||0, 101, false), 101);
    if (pLow) setSpriteFrame(kbLow, frameFromNorm(pLow.value||0, 101, false), 101);
    if (pHigh) setSpriteFrame(kbHigh, frameFromNorm(pHigh.value||0, 101, false), 101);

    const setKnobValue = (el, val, min, max, color)=>{
      const pct = (max === min) ? 0 : Math.max(0, Math.min(1, (val - min) / (max - min)));
      // For CSS ring fill (0..1). Actual sweep/offset are handled in CSS to match RM_AIR.
      el.style.setProperty("--ring-pct", pct.toFixed(3));
      if (color) el.style.setProperty("--ring-color", color);
      return Math.round(val);
    };
    const readDb = (p, min, max)=>{
      if (!p) return min;
      if (p.raw != null && Number.isFinite(p.raw)) return p.raw;
      return min + (Number(p.value||0)) * (max - min);
    };
    const inDb = readDb(pIn, 0, 30);
    const outDb = readDb(pOut, 0, 30);
    const lowDb = readDb(pLow, -20, 20);
    const highDb = readDb(pHigh, -20, 20);
    kbInVal.textContent = setKnobValue(kbIn, inDb, 0, 30, "rgba(255,120,120,0.9)") + "dB";
    kbOutVal.textContent = setKnobValue(kbOut, outDb, 0, 30, "rgba(255,120,120,0.9)") + "dB";
    kbLowVal.textContent = setKnobValue(kbLow, lowDb, -20, 20, "rgba(120,170,255,0.9)") + "dB";
    kbHighVal.textContent = setKnobValue(kbHigh, highDb, -20, 20, "rgba(120,170,255,0.9)") + "dB";
    setSpriteFrame(swDist, (!!pDist && (pDist.value||0) >= 0.5) ? 1 : 0, 2);
    setSpriteFrame(swPre,  (!!pPre && (pPre.value||0) >= 0.5) ? 1 : 0, 2);

const pInVu = getP(idxInVu);
const pInPk = getP(idxInPk);
const pOutVu = getP(idxOutVu);
const pOutPk = getP(idxOutPk);
const pClip = getP(idxClip);

// --- smooth VU + clip latch ---
if (!host._vuState){
  host._vuState = {
    tIn:0, tInPk:0, tOut:0, tOutPk:0,
    cIn:0, cInPk:0, cOut:0, cOutPk:0,
    tClip:0, clipUntil:0,
    raf:0, lastT:0
  };
  overLed.addEventListener("pointerdown", (ev)=>{
    ev.preventDefault(); ev.stopPropagation();
    host._vuState.clipUntil = 0;
    overLed.classList.remove("on");
  });
}

const st = host._vuState;
// For Tukān-style meters, treat 0 dBFS as full scale (peak=1.0).
// Use PEAK for the fill (more intuitive), and still draw a faster peak line.
const inPk  = (pInPk  && (pInPk.value||0))  || 0;
const outPk = (pOutPk && (pOutPk.value||0)) || 0;
st.tIn   = Math.max(0, Math.min(1, inPk || ((pInVu && (pInVu.value||0))  || 0)));
st.tInPk = Math.max(0, Math.min(1, inPk));
st.tOut  = Math.max(0, Math.min(1, outPk || ((pOutVu && (pOutVu.value||0)) || 0)));
st.tOutPk= Math.max(0, Math.min(1, outPk));
st.tClip = ((pClip && (pClip.value||0)) >= 0.5) ? 1 : 0;

const renderVu = ()=>{
  const maxPct = PRE_VU_MAX*100;
  vuInFill.style.width   = (st.cIn*maxPct) + "%";
  vuInPeak.style.left    = (Math.min(1, st.cInPk)*maxPct) + "%";
  vuOutFill.style.width  = (st.cOut*maxPct) + "%";
  vuOutPeak.style.left   = (Math.min(1, st.cOutPk)*maxPct) + "%";
  const on = (performance.now() < st.clipUntil);
  overLed.classList.toggle("on", on);
};

const step = (t)=>{
  if (!st.lastT) st.lastT = t;
  const dt = Math.max(0, Math.min(200, t - st.lastT));
  st.lastT = t;

  // time constants (ms)
  const aVU  = 1 - Math.exp(-dt/60);
  const aPK  = 1 - Math.exp(-dt/35);

  st.cIn   += (st.tIn   - st.cIn)   * aVU;
  st.cOut  += (st.tOut  - st.cOut)  * aVU;
  st.cInPk += (st.tInPk - st.cInPk) * aPK;
  st.cOutPk+= (st.tOutPk- st.cOutPk)* aPK;

  if (st.tClip >= 0.5) st.clipUntil = performance.now() + 5000;

  renderVu();
  if (win && win._isOpen !== false) st.raf = requestAnimationFrame(step);
  else st.raf = 0;
};

if (!st.raf){
  renderVu();
  st.raf = requestAnimationFrame(step);
}
  };

  remap();
  update();
  return {el: host, update, ctrl};
}

  // ---- RM_Limiter2: Waves L2-style panel (web) ----

function buildRML2PanelControl(win, ctrl){
  const stage = document.createElement("div");
  stage.className = "rmL2Stage";
  const skin = document.createElement("div");
  skin.className = "rmL2Skin";
  const root = document.createElement("div");
  root.className = "rmL2Panel";
  skin.appendChild(root);
  stage.appendChild(skin);

  // Auto-scale to always fit in the plugin window.
  const BASE_W = 560, BASE_H = 360;
  const fit_2910 = ()=>{
    const bodyEl = stage.closest(".pluginWinBody");
    const ctrlEl = stage.closest(".plugCtrl");
    const scope = ctrlEl || bodyEl || stage.closest(".pluginParamList") || stage;
    const availW = Math.max(10, scope.clientWidth);
    const availH = Math.max(10, scope.clientHeight);
    let sc = Math.min(availW/BASE_W, availH/BASE_H);
    const maxScale = (win && win.el && win.el.classList && win.el.classList.contains("fullscreen")) ? 2.0 : 1.0;
    sc = Math.max(0.25, Math.min(maxScale, sc));
    stage.style.width = (BASE_W*sc) + "px";
    stage.style.height = (BASE_H*sc) + "px";
    skin.style.transform = `scale(${sc})`;
  };
  try{
    const ro = new ResizeObserver(()=>fit_2910());
    const obs = stage.closest(".pluginParamList") || stage;
    ro.observe(obs);
    stage._ro = ro;
  }catch(_){ }
  requestAnimationFrame(fit_2910);

  const extra = ctrl.extra || {};
  const getP = (patterns)=> findParamByPatterns(win.params||[], patterns||[]);

  const pThr = ()=> getP(extra.thresholdFind);
  const pOut = ()=> getP(extra.outputFind);
  const pRel = ()=> getP(extra.releaseFind);
  const pMax = ()=> getP(extra.maximizerFind);

  const pInPk  = ()=> getP(extra.inPeakFind);
  const pOutPk = ()=> getP(extra.outPeakFind);
  const pAtt   = ()=> getP(extra.grFind); // Atten (dB) 0..30

  const clamp01 = (x)=> Math.max(0, Math.min(1, x||0));
  // track peak (used as 'input' meter inside THRESHOLD fader)
  let inPk = 0;

  
  // hold peak attenuation a bit longer (like Waves L2)
  let attHoldDb = 0;
  let attHoldUntil = 0;
const rawFromParamLocal = (p, fbMin=0, fbMax=1)=>{
    if (!p) return fbMin;
    if (p.raw!=null && Number.isFinite(p.raw)) return p.raw;
    const hasMin = (p.min!=null && Number.isFinite(p.min));
    const hasMax = (p.max!=null && Number.isFinite(p.max));
    const mn = hasMin ? p.min : fbMin;
    const mx = hasMax ? p.max : fbMax;
    return mn + (Number(p.value||0))*(mx-mn);
  };

  const fmtDbFromPeak = (pk)=>{
    const v = Math.max(0, pk||0);
    if (v <= 1e-6) return "−∞";
    const db = 20*Math.log10(v);
    const r = Math.round(db*10)/10;
    return (r > 0 ? "+" : "") + r.toFixed(1);
  };

  const isLinkOn = ()=>{
    const p = pMax();
    return !!p && (p.value||0) >= 0.5;
  };

  // Throttle param sending a bit (touch drags)
  let lastSent = 0;
  const send = (pIndex, v)=>{
    const now = performance.now();
    lastSent = now;
    setParamNormalized(win, pIndex, v);
  };

  function makeFader(label, getParamFn, getVuFn, peerParamFn){
    const wrap = document.createElement("div");
    wrap.className = "rmL2FaderWrap";
    const lbl = document.createElement("div");
    lbl.className = "rmL2FaderLbl";
    lbl.textContent = label;

    const box = document.createElement("div");
    box.className = "rmL2Fader";
    const tr = document.createElement("div");
    tr.className = "rmL2FaderTrack";
    const vu = document.createElement("div");
    vu.className = "rmL2FaderVu";
    const vuFill = document.createElement("div");
    vuFill.className = "rmL2FaderVuFill";
    vu.appendChild(vuFill);

    const th = document.createElement("div");
    th.className = "rmL2FaderThumb";

    tr.appendChild(vu);
    tr.appendChild(th);
    box.appendChild(tr);

    const val = document.createElement("div");
    val.className = "rmL2FaderVal";
    val.textContent = "—";

    wrap.appendChild(lbl);
    wrap.appendChild(box);
    wrap.appendChild(val);

    let drag = null;

    const setFromClientY = (ev)=>{
      const p = getParamFn();
      if (!p) return;
	    const r = tr.getBoundingClientRect();
	    // Keep the thumb fully inside the track so it's always easy to grab.
	    const M = 10; // px
	    const y = Math.max(r.top + M, Math.min(r.bottom - M, ev.clientY));
	    const n = 1 - ((y - (r.top + M)) / Math.max(1, r.height - 2*M));
      const next = clamp01(n);

      bringPluginToFront(win);
      suppressPoll(win, 500);

      const prev = clamp01(p.value||0);

      // update self
      send(p.index, next);
      p.value = next;
      try{ setDraggedParamValue(win, p.index, next); }catch(_){}

      // link peer (UI-level linking, like Waves L2 Maximizer)
      if (isLinkOn() && peerParamFn){
        const peer = peerParamFn();
        if (peer){
          const peerPrev = clamp01(peer.value||0);
          const peerNext = clamp01(peerPrev + (next - prev));
          send(peer.index, peerNext);
          peer.value = peerNext;
          try{ setDraggedParamValue(win, peer.index, peerNext); }catch(_){}
        }
      }

      update();
    };

    const startDrag = (ev)=>{
      const p = getParamFn();
      if (!p) return;
      bringPluginToFront(win);
      beginParamDrag(win, p.index);
      suppressPoll(win, 800);
      drag = {id: ev.pointerId};
      // Capture on the track so the thumb remains draggable even at the extremes.
      tr.setPointerCapture(ev.pointerId);
      setFromClientY(ev);
      ev.preventDefault();
      ev.stopPropagation();
    };
    tr.addEventListener("pointerdown", startDrag);
    th.addEventListener("pointerdown", startDrag);

    tr.addEventListener("pointermove", (ev)=>{
      if (!drag || ev.pointerId !== drag.id) return;
      setFromClientY(ev);
    });
    const end = (ev)=>{
      if (!drag || ev.pointerId !== drag.id) return;
      drag = null;
      try{ const p = getParamFn(); if (p) endParamDrag(win, p.index); }catch(_){}
      try{ tr.releasePointerCapture(ev.pointerId); }catch(_){}
    };
    tr.addEventListener("pointerup", end);
    tr.addEventListener("pointercancel", end);

    const update = ()=>{
      const p = getParamFn();
      if (!p){
        val.textContent = "—";
	        th.style.top = "calc(100% - 10px)";
      } else {
        const v = clamp01(p.value);
        val.textContent = formatParam(p);
	        const h = tr.clientHeight || 1;
	        const M = 10;
	        const y = M + (1 - v) * Math.max(1, (h - 2*M));
	        th.style.top = y + "px";
      }

      const vuP = getVuFn ? getVuFn() : null;
      const vuV = vuP ? clamp01(vuP.value) : 0;
      vuFill.style.height = (vuV*100) + "%";
    };

    return {el: wrap, update};
  }

  // layout
  const colL = document.createElement("div"); colL.className = "rmL2Col";
  const colM = document.createElement("div"); colM.className = "rmL2Col rmL2ColMid";
  const colR = document.createElement("div"); colR.className = "rmL2Col";

  const fThr = makeFader("INPUT", pThr, pInPk, pOut);
  const fOut = makeFader("OUTPUT", pOut, pOutPk, pThr);

  // Atten meter (separate, like Waves L2)
  const attWrap = document.createElement("div");
  attWrap.className = "rmL2AttWrap";
  const attMeter = document.createElement("div");
  attMeter.className = "rmL2AttMeter";
  const attFill = document.createElement("div");
  attFill.className = "rmL2AttFill";
  attMeter.appendChild(attFill);
  const attLbl = document.createElement("div");
  attLbl.className = "rmL2AttLbl";
  attLbl.textContent = "ATTEN";
  const attVal = document.createElement("div");
  attVal.className = "rmL2AttVal";
  attVal.textContent = "—";
  attWrap.appendChild(attMeter);
  attWrap.appendChild(attLbl);
  attWrap.appendChild(attVal);

  // Release
  const relWrap = document.createElement("div");
  relWrap.className = "rmL2RelWrap";
  const relTop = document.createElement("div");
  relTop.className = "rmL2RelTop";
  relTop.innerHTML = `<span>RELEASE</span><span class="rmL2RelVal">—</span>`;
  const relValEl = relTop.querySelector(".rmL2RelVal");
  const rel = document.createElement("input");
  rel.type = "range";
  rel.className = "rmL2Slider";
  rel.min = "0"; rel.max = "1"; rel.step = "0.001";
  rel.addEventListener("input", ()=>{
    const p = pRel();
    if (!p) return;
    bringPluginToFront(win);
    suppressPoll(win, 500);
    const v = clamp01(parseFloat(rel.value));
    setParamNormalized(win, p.index, v);
    p.value = v;
    try{ setDraggedParamValue(win, p.index, v); }catch(_){}
    update();
  });
  relWrap.appendChild(relTop);
  relWrap.appendChild(rel);

  // Maximizer button (also links the faders in UI)
  const maxBtn = document.createElement("button");
  maxBtn.className = "rmL2MaxBtn";
  maxBtn.textContent = "MAXIMIZER";
  maxBtn.addEventListener("click", ()=>{
    const p = pMax();
    if (!p) return;
    bringPluginToFront(win);
    suppressPoll(win, 500);
    const next = (p.value||0) >= 0.5 ? 0.0 : 1.0;
    setParamNormalized(win, p.index, next);
    p.value = next;
    try{ setDraggedParamValue(win, p.index, next); }catch(_){}
    update();
  });

  colL.appendChild(fThr.el);
  colR.appendChild(fOut.el);

  colM.appendChild(attWrap);
  colM.appendChild(relWrap);
  colM.appendChild(maxBtn);

  root.appendChild(colL);
  root.appendChild(colM);
  root.appendChild(colR);

  function update(){
    try{ fThr.update(); }catch(_){}
    try{ fOut.update(); }catch(_){}

    const pM = pMax();
    const on = pM && (pM.value||0) >= 0.5;
    maxBtn.classList.toggle("on", !!on);
    maxBtn.classList.toggle("blink", !!on);

    const rP = pRel();
    if (rP){
      rel.value = String(clamp01(rP.value));
      relValEl.textContent = formatParam(rP);
    } else {
      relValEl.textContent = "—";
    }

    const attP = pAtt();
    const attDb = attP ? Math.max(0, Math.min(30, rawFromParamLocal(attP, 0, 30))) : 0;
    const now = performance.now();
    if (attDb >= attHoldDb - 0.001){
      attHoldDb = attDb;
      attHoldUntil = now + 1400; // ms
    } else if (now > attHoldUntil){
      // decay slowly towards current value
      attHoldDb = Math.max(attDb, attHoldDb - 0.35);
      attHoldUntil = now + 120;
    }
    const attDisp = attHoldDb;
    attFill.style.height = ((attDisp/30)*100) + "%";
    attVal.textContent = (attDisp < 0.05) ? "0.0" : ("−" + (Math.round(attDisp*10)/10).toFixed(1));
  }

  update();
  return {el: stage, update, ctrl};
}




function buildRMKickerL2PanelControl(win, ctrl){
  // Kicker50hz: two faders (Dry/Wet), Output VU between, Frequency as horizontal fader under the VU.
  const stage = document.createElement("div");
  stage.className = "rmK2Stage";
  const skin = document.createElement("div");
  skin.className = "rmK2Skin";
  const root = document.createElement("div");
  root.className = "rmK2Panel";
  skin.appendChild(root);
  stage.appendChild(skin);

  const BASE_W = 680, BASE_H = 360;
  const fit_3232 = ()=>{
    const bodyEl = stage.closest(".pluginWinBody");
    const ctrlEl = stage.closest(".plugCtrl");
    const scope = ctrlEl || bodyEl || stage.closest(".pluginParamList") || stage;
    const availW = Math.max(10, scope.clientWidth);
    const availH = Math.max(10, scope.clientHeight);
    let sc = Math.min(availW/BASE_W, availH/BASE_H);
    const maxScale = (win && win.el && win.el.classList && win.el.classList.contains("fullscreen")) ? 2.0 : 1.0;
    sc = Math.max(0.25, Math.min(maxScale, sc));
    stage.style.width = (BASE_W*sc) + "px";
    stage.style.height = (BASE_H*sc) + "px";
    skin.style.transform = `scale(${sc})`;
  };
  try{
    const ro = new ResizeObserver(()=>fit_3232());
    const obs = stage.closest(".pluginParamList") || stage;
    ro.observe(obs);
    stage._ro = ro;
  }catch(_){}
  requestAnimationFrame(fit_3232);

  const ex = ctrl.extra || {};
  const getP = (patterns)=> findParamByPatterns(win.params||[], patterns||[]);

  const pDry = ()=> getP(ex.dryFind);
  const pWet = ()=> getP(ex.wetFind);
  const pFreq = ()=> getP(ex.freqFind);
  const pOutPk = ()=> getP(ex.outPeakFind);

  const clamp01 = (x)=> Math.max(0, Math.min(1, x||0));

  function makeFader(label, getParamFn){
    const wrap = document.createElement("div");
    wrap.className = "rmL2FaderWrap";
    const lbl = document.createElement("div");
    lbl.className = "rmL2FaderLbl";
    lbl.textContent = label;

    const box = document.createElement("div");
    box.className = "rmL2Fader";
    const tr = document.createElement("div");
    tr.className = "rmL2FaderTrack";
    const th = document.createElement("div");
    th.className = "rmL2FaderThumb";
    tr.appendChild(th);
    box.appendChild(tr);

    const val = document.createElement("div");
    val.className = "rmL2FaderVal";
    val.textContent = "—";

    wrap.appendChild(lbl);
    wrap.appendChild(box);
    wrap.appendChild(val);

    let drag = null;
    const setFromClientY = (ev)=>{
      const p = getParamFn();
      if (!p) return;
      const r = tr.getBoundingClientRect();
      const M = 10;
      const y = Math.max(r.top + M, Math.min(r.bottom - M, ev.clientY));
      const n = 1 - ((y - (r.top + M)) / Math.max(1, r.height - 2*M));
      const next = clamp01(n);

      bringPluginToFront(win);
      suppressPoll(win, 500);
      setParamNormalized(win, p.index, next);
      p.value = next;
      try{ setDraggedParamValue(win, p.index, next); }catch(_){}
      update();
    };

    const startDrag = (ev)=>{
      const p = getParamFn();
      if (!p) return;
      bringPluginToFront(win);
      beginParamDrag(win, p.index);
      suppressPoll(win, 800);
      drag = {id: ev.pointerId};
      tr.setPointerCapture(ev.pointerId);
      setFromClientY(ev);
      ev.preventDefault();
      ev.stopPropagation();
    };

    tr.addEventListener("pointerdown", startDrag);
    th.addEventListener("pointerdown", startDrag);

    tr.addEventListener("pointermove", (ev)=>{
      if (!drag || ev.pointerId !== drag.id) return;
      setFromClientY(ev);
    });

    const end = (ev)=>{
      if (!drag || ev.pointerId !== drag.id) return;
      drag = null;
      try{ const p = getParamFn(); if (p) endParamDrag(win, p.index); }catch(_){}
      try{ tr.releasePointerCapture(ev.pointerId); }catch(_){}
    };
    tr.addEventListener("pointerup", end);
    tr.addEventListener("pointercancel", end);

    const update = ()=>{
      const p = getParamFn();
      if (!p){
        val.textContent = "—";
        th.style.top = "calc(100% - 10px)";
      } else {
        const v = clamp01(p.value);
        val.textContent = formatParam(p);
        const h = tr.clientHeight || 1;
        const M = 10;
        const y = M + (1 - v) * Math.max(1, (h - 2*M));
        th.style.top = y + "px";
      }
    };

    return {el: wrap, update};
  }

  // Left/Right faders
  const fDry = makeFader("DRY", pDry);
  const fWet = makeFader("WET", pWet);

  // Center: Output meter + Frequency (horizontal)
  const mid = document.createElement("div");
  mid.className = "rmK2MeterCol";

  const m = document.createElement("div");
  m.className = "rmK2OutMeter";
  const fill = document.createElement("div");
  fill.className = "rmK2OutFill";
  m.appendChild(fill);

  const ml = document.createElement("div");
  ml.className = "rmK2OutLbl";
  ml.textContent = "OUT";
  const mv = document.createElement("div");
  mv.className = "rmK2OutVal";
  mv.textContent = "—";

  const freqWrap = document.createElement("div");
  freqWrap.className = "rmK2FreqWrap";
  const freqTop = document.createElement("div");
  freqTop.className = "rmK2FreqTop";
  freqTop.innerHTML = `<span>FREQ</span><span class="rmK2FreqVal">—</span>`;
  const freqValEl = freqTop.querySelector(".rmK2FreqVal");
  const freq = document.createElement("input");
  freq.type = "range";
  freq.className = "rmK2FreqSlider";
  freq.min = "0"; freq.max = "1"; freq.step = "0.001";
  freq.addEventListener("input", ()=>{
    const p = pFreq();
    if (!p) return;
    bringPluginToFront(win);
    suppressPoll(win, 500);
    const v = clamp01(parseFloat(freq.value));
    setParamNormalized(win, p.index, v);
    p.value = v;
    try{ setDraggedParamValue(win, p.index, v); }catch(_){}
    update();
  });
  freqWrap.appendChild(freqTop);
  freqWrap.appendChild(freq);

  mid.appendChild(m);
  mid.appendChild(ml);
  mid.appendChild(mv);
  mid.appendChild(freqWrap);

  // Layout: DRY | MID | WET
  root.appendChild(fDry.el);
  root.appendChild(mid);
  root.appendChild(fWet.el);

  function fmtDbFromPeak(pk){
    const v = Math.max(0, pk||0);
    if (v <= 1e-6) return "−∞";
    const db = 20*Math.log10(v);
    const r = Math.round(db*10)/10;
    return (r > 0 ? "+" : "") + r.toFixed(1);
  }

  function update(){
    try{ fDry.update(); }catch(_){}
    try{ fWet.update(); }catch(_){}

    const pk = pOutPk();
    const v = pk ? clamp01(pk.value) : 0;
    fill.style.height = (v*100) + "%";
    mv.textContent = pk ? fmtDbFromPeak(v) : "—";

    const fp = pFreq();
    if (fp){
      freq.value = String(clamp01(fp.value));
      freqValEl.textContent = formatParam(fp);
    } else {
      freqValEl.textContent = "—";
    }
  }

  ctrl.update = ()=>update();
  update();
  return {el: stage, update, ctrl};
}

function buildRMDelayMachinePanelControl(win, ctrl){
  // New HTML/CSS DelayMachine UI (no DAW skin). LED segments + animated updates.
  const ex = (ctrl && ctrl.extra) ? ctrl.extra : {};
  const DESIGN_W = 980;
  const DESIGN_H = 360;

  const P = (i)=> (win && Array.isArray(win.params)) ? (win.params[i] || null) : null;

  const clamp01 = (v)=> Math.max(0, Math.min(1, v));
  const normFromRaw = (raw, min, max)=>{
    if (!Number.isFinite(raw) || !Number.isFinite(min) || !Number.isFinite(max) || max===min) return 0;
    return clamp01((raw - min) / (max - min));
  };
  const rawFromNorm = (n, min, max)=>{
    n = clamp01(n);
    return min + (max - min) * n;
  };

  const fmtK = (hz)=>{
    if (!Number.isFinite(hz)) return "—";
    if (hz >= 10000) return `${Math.round(hz/1000)}k`;
    return String(Math.round(hz));
  };

  const host = document.createElement('div');
  host.className = 'tukanHost rmDM2Host';
  host.innerHTML = '';

  const panel = document.createElement('div');
  panel.className = 'rmDM2Panel';
  host.appendChild(panel);

  // --- LED bar (segments)
  const led = document.createElement('div');
  led.className = 'rmDM2LedBar';
  panel.appendChild(led);

  const mkSeg = (key, label)=>{
    const seg = document.createElement('div');
    seg.className = 'rmDM2LedSeg';
    const lab = document.createElement('div');
    lab.className = 'rmDM2LedLabel';
    lab.textContent = label;
    const val = document.createElement('div');
    val.className = 'rmDM2LedValue';
    val.textContent = '—';
    seg.appendChild(lab);
    seg.appendChild(val);
    led.appendChild(seg);
    return {seg, val, key, last:''};
  };

  const segTime  = mkSeg('time',  'TIME');
  const segDamp  = mkSeg('damp',  'DAMP');
  const segHPF   = mkSeg('hpf',   'HPF');
  const segLPF   = mkSeg('lpf',   'LPF');
  const segWidth = mkSeg('width', 'WIDTH');
  const segMix   = mkSeg('mix',   'MIX');
  const segBpm   = mkSeg('bpm',   'BPM');

  const flashSeg = (segObj, text)=>{
    const t = String(text ?? '—');
    if (segObj.last === t) return;
    segObj.last = t;
    segObj.val.textContent = t;
    segObj.seg.classList.remove('rmDM2Flash');
    // force reflow to restart animation
    void segObj.seg.offsetWidth;
    segObj.seg.classList.add('rmDM2Flash');
    clearTimeout(segObj._t);
    segObj._t = setTimeout(()=>segObj.seg.classList.remove('rmDM2Flash'), 280);
  };

  // --- Controls layout
  const main = document.createElement('div');
  main.className = 'rmDM2Main';
  panel.appendChild(main);

  const knobs = document.createElement('div');
  knobs.className = 'rmDM2Knobs';
  main.appendChild(knobs);

  const right = document.createElement('div');
  right.className = 'rmDM2Right';
  main.appendChild(right);

  // Helpers: params indices (0-based)
  const IDX = {
    delayMs: 0,      // slider1
    fbDb:    1,      // slider2
    mix:     3,      // slider4 (0..1 wet)
    width:   5,      // slider6 (0..100)
    tape:    8,      // slider9
    timeSig: 9,      // slider10 (0..5)
    timeSpec:10,     // slider11 (0..2)
    hpf:     11,     // slider12 (0..1000 Hz)
    lpfLog:  13,     // slider14 (0..1)
    crush:   14,     // slider15 (0/1)
    start:   15,     // slider16 (0..2)
    bpmTel:  17      // slider18 (telemetry BPM)
  };

  const setParam = (idx, nVal)=>{
    if (!win) return;
    setParamNormalized(win, idx, clamp01(nVal));
    setDraggedParamValue(win, idx, clamp01(nVal));
  };

  const setParamRaw = (idx, raw, min, max)=>{
    setParam(idx, normFromRaw(raw, min, max));
  };

  // --- Knob widget
  function mkKnob(label, options){
    const {
      idx,
      minRaw,
      maxRaw,
      valueToText,
      onUserStart,
      onUserChangeEnd,
      paramToKnob,
      knobToParam
    } = options;

    const wrap = document.createElement('div');
    wrap.className = 'rmDM2KnobWrap';

    const title = document.createElement('div');
    title.className = 'rmDM2KnobLabel';
    title.textContent = label;

    const k = document.createElement('div');
    k.className = 'rmDM2Knob';
    k.tabIndex = 0;

    const dotRing = document.createElement('div');
    dotRing.className = 'rmDM2DotRing';
    // static dots (do NOT rotate)
    for (let i=0;i<19;i++){
      const d = document.createElement('span');
      d.className = 'rmDM2Dot';
      const a = (-135 + (270*(i/18))) * Math.PI/180;
      const r = 15;
      d.style.left = (22 + Math.cos(a)*r) + 'px';
      d.style.top  = (22 + Math.sin(a)*r) + 'px';
      dotRing.appendChild(d);
    }

    const needle = document.createElement('div');
    needle.className = 'rmDM2Needle';

    const val = document.createElement('div');
    val.className = 'rmDM2KnobValue';
    val.textContent = '—';

    k.appendChild(dotRing);
    k.appendChild(needle);

    wrap.appendChild(title);
    wrap.appendChild(k);
    wrap.appendChild(val);

    const state = {n:0, dragging:false, lastText:''};

    const setVisual = (n, text)=>{
      state.n = clamp01(n);
      const deg = -135 + 270*state.n;
      needle.style.transform = `translate(-50%, -90%) rotate(${deg}deg)`;
      if (text!=null){
        const t = String(text);
        if (t !== state.lastText){
          state.lastText = t;
          val.textContent = t;
          // subtle flash on value changes
          val.classList.remove('rmDM2FlashText');
          void val.offsetWidth;
          val.classList.add('rmDM2FlashText');
          clearTimeout(state._vt);
          state._vt = setTimeout(()=>val.classList.remove('rmDM2FlashText'), 220);
        }
      }
    };

    const getNFromParam = ()=>{
      const p = P(idx);
      if (!p) return 0;
      const n = clamp01(p.value ?? 0);
      return paramToKnob ? clamp01(paramToKnob(n, p)) : n;
    };

    const getTextFromParam = ()=>{
      const p = P(idx);
      if (!p) return '—';
      const n = clamp01(p.value ?? 0);
      const raw = rawFromNorm(n, minRaw, maxRaw);
      try{
        return valueToText ? valueToText(n, raw, p) : String(Math.round(raw));
      }catch(_){
        return String(Math.round(raw));
      }
    };

    const applyN = (n)=>{
      const paramN = knobToParam ? clamp01(knobToParam(n)) : n;
      setParam(idx, paramN);
      setVisual(n, getTextFromParam());
    };

    let startY = 0;
    let startN = 0;

    const onMove = (ev)=>{
      if (!state.dragging) return;
      ev.preventDefault();
      const dy = (startY - ev.clientY);
      const fine = ev.shiftKey ? 0.0035 : 0.01;
      const n = clamp01(startN + dy * fine);
      applyN(n);
    };
    const onUp = (ev)=>{
      if (!state.dragging) return;
      state.dragging = false;
      try{ endParamDrag(win, idx); }catch(_){}
      try{ suppressPoll(win, 520); }catch(_){}
      window.removeEventListener('pointermove', onMove, {passive:false});
      window.removeEventListener('pointerup', onUp, {passive:true});
      try{ onUserChangeEnd && onUserChangeEnd(); }catch(_){}
    };

    k.addEventListener('pointerdown', (ev)=>{
      ev.preventDefault();
      try{ onUserStart && onUserStart(); }catch(_){}
      state.dragging = true;
      startY = ev.clientY;
      startN = getNFromParam();
      try{ beginParamDrag(win, idx); }catch(_){}
      k.setPointerCapture?.(ev.pointerId);
      window.addEventListener('pointermove', onMove, {passive:false});
      window.addEventListener('pointerup', onUp, {passive:true});
    });

    return {wrap, setVisual, getNFromParam, getTextFromParam, idx, minRaw, maxRaw};
  }

  // Sync state
  let syncTS = 0;   // 0..5
  let syncSP = 0;   // 0..2
  let syncNote = 0; // 1|2|4|8|16
  let lastBpm = null;
  let suppressSyncClearOnce = false;

  const getBpmProject = ()=>{
    // prefer telemetry bpm if present
    const p = P(IDX.bpmTel);
    const raw = p && Number.isFinite(p.raw) ? p.raw : null;
    // if raw isn't provided, derive from normalized using 0..300 range (slider18 definition)
    if (raw!=null) return raw;
    if (p && Number.isFinite(p.value)){
      return rawFromNorm(p.value, 0, 300);
    }
    return null;
  };

  const calcMsFromSync = (bpm, ts, sp)=>{
    if (!Number.isFinite(bpm) || bpm<=0) return null;
    let base = 60;
    ts==1 ? base=240 :
    ts==2 ? base=120 :
    ts==3 ? base=60  :
    ts==4 ? base=30  :
    ts==5 ? base=15  : base=60;
    let ms = 1000*(base/bpm);
    sp==1 ? ms *= (2/3) :
    sp==2 ? ms *= 1.5 : 0;
    if (ms<0) ms=0;
    if (ms>3000) ms=3000;
    return ms;
  };

  const clearSync = ()=>{
    if (suppressSyncClearOnce){ suppressSyncClearOnce = false; return; }
    syncTS = 0; syncSP = 0; syncNote = 0;
    setParamRaw(IDX.timeSig, 0, 0, 5);
    setParamRaw(IDX.timeSpec, 0, 0, 2);
    updateButtons();
  };

  // --- Create knobs
  const kbTime = mkKnob('TIME', {
    idx: IDX.delayMs,
    minRaw: 0, maxRaw: 3000,
    valueToText: (n, raw)=>{
      return `${Math.round(raw)}ms`;
    },
    onUserStart: ()=>{ clearSync(); },
  });

  const dampPctFromRaw = (raw)=>{
    if (!Number.isFinite(raw)) return 0;
    if (raw <= -5){
      return ((raw + 40) / 35) * 40;
    }
    return 40 + ((raw + 5) / 5) * 60;
  };
  const dampRawFromPct = (pct)=>{
    const p = clamp01(pct / 100) * 100;
    if (p <= 40){
      return -40 + (p / 40) * 35;
    }
    return -5 + ((p - 40) / 60) * 5;
  };
  const dampPctFromNorm = (n)=> dampPctFromRaw(rawFromNorm(clamp01(n), -40, 0));
  const dampNormFromPct = (pct)=> normFromRaw(dampRawFromPct(pct), -40, 0);

  const kbDamp = mkKnob('DAMP', {
    idx: IDX.fbDb,
    minRaw: -40, maxRaw: 0,
    valueToText: (n, raw)=>`${Math.round(dampPctFromRaw(raw))}%`,
    paramToKnob: (n)=> dampPctFromNorm(n) / 100,
    knobToParam: (n)=> dampNormFromPct(n * 100)
  });

  const kbHPF = mkKnob('HPF', {
    idx: IDX.hpf,
    minRaw: 0, maxRaw: 1000,
    valueToText: (n, raw)=>`${Math.round(raw)}`
  });

  const kbLPF = mkKnob('LPF', {
    idx: IDX.lpfLog,
    // slider14 is log2(freq) in Hz (1000..22000)
    minRaw: 9.96, maxRaw: 14.2877123,
    valueToText: (n, raw)=>{
      const hz = Math.pow(2, raw);
      return fmtK(hz);
    }
  });

  const kbWidth = mkKnob('WIDTH', {
    idx: IDX.width,
    minRaw: 0, maxRaw: 100,
    valueToText: (n, raw)=>`${Math.round(raw)}%`,
  });

  const kbMix = mkKnob('MIX', {
    idx: IDX.mix,
    minRaw: 0, maxRaw: 1,
    valueToText: (n)=>`${Math.round(n*100)}%`,
  });

  for (const k of [kbTime, kbDamp, kbHPF, kbLPF, kbWidth, kbMix]){
    knobs.appendChild(k.wrap);
  }

  // --- Right column: toggles + start
  const mkToggle = (label)=>{
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rmDM2Toggle';
    b.textContent = label;
    return b;
  };

  const row1 = document.createElement('div');
  row1.className = 'rmDM2Row';
  right.appendChild(row1);

  const btTape = mkToggle('TAPE');
  const btCrush = mkToggle('CRUSH');
  row1.appendChild(btTape);
  row1.appendChild(btCrush);

  const row2 = document.createElement('div');
  row2.className = 'rmDM2Row';
  right.appendChild(row2);

  const btStart = document.createElement('button');
  btStart.type = 'button';
  btStart.className = 'rmDM2Start';
  btStart.innerHTML = `<span class="rmDM2StartLed L"></span><span class="rmDM2StartTxt">START</span><span class="rmDM2StartLed R"></span>`;
  row2.appendChild(btStart);

  // --- Bottom sync buttons
  const bottom = document.createElement('div');
  bottom.className = 'rmDM2Bottom';
  panel.appendChild(bottom);

  const mkBtn = (txt, wide=false)=>{
    const b=document.createElement('button');
    b.type='button';
    b.className = wide ? 'rmDM2Btn wide' : 'rmDM2Btn';
    b.textContent = txt;
    const led = document.createElement('span');
    led.className = 'rmDM2BtnLed';
    b.appendChild(led);
    return b;
  };

  const bT  = mkBtn('T');
  const bD  = mkBtn('D');
  const b16 = mkBtn('16');
  const b8  = mkBtn('8');
  const b4  = mkBtn('4');
  const b2  = mkBtn('2');
  const b1  = mkBtn('1');

  bottom.appendChild(bT);
  bottom.appendChild(bD);
  const divs = document.createElement('div');
  divs.className='rmDM2Divs';
  for (const b of [b16,b8,b4,b2,b1]) divs.appendChild(b);
  bottom.appendChild(divs);

  // --- Button state helpers
  const setBtnOn = (btn, on)=>{
    btn.classList.toggle('on', !!on);
  };

  const updateButtons = ()=>{
    setBtnOn(bT,  syncSP===1);
    setBtnOn(bD,  syncSP===2);
    setBtnOn(b16, syncNote===16);
    setBtnOn(b8,  syncNote===8);
    setBtnOn(b4,  syncNote===4);
    setBtnOn(b2,  syncNote===2);
    setBtnOn(b1,  syncNote===1);

    const pTape = P(IDX.tape);
    const tapeOn = !!pTape && (pTape.value||0) >= 0.5;
    btTape.classList.toggle('on', tapeOn);

    const pCr = P(IDX.crush);
    const crOn = !!pCr && (pCr.value||0) >= 0.5;
    btCrush.classList.toggle('on', crOn);

    const pSt = P(IDX.start);
    const st = pSt ? Math.round(clamp01(pSt.value||0) * 2) : 0;
    btStart.classList.toggle('l', st===1);
    btStart.classList.toggle('r', st===2);
  };

  const applySync = ()=>{
    // push TS/SP to params
    setParamRaw(IDX.timeSig, syncTS, 0, 5);
    setParamRaw(IDX.timeSpec, syncSP, 0, 2);
    updateButtons();

    // set Delay(ms) to computed value so TIME knob follows, and keep it updated on BPM changes
    const bpm = getBpmProject();
    const ms = calcMsFromSync(bpm, syncTS, syncSP);
    if (ms!=null){
      suppressSyncClearOnce = true; // avoid clearing when we programmatically move TIME
      setParamRaw(IDX.delayMs, ms, 0, 3000);
    }
  };

  const setNote = (note)=>{
    // note: 16/8/4/2/1
    if (syncNote === note){
      // toggle off
      syncNote = 0; syncTS = 0;
      applySync();
      return;
    }
    syncNote = note;
    // map to TimeSig: 1=whole,2=half,3=quarter,4=eighth,5=sixteenth
    syncTS = (note===1)?1:(note===2)?2:(note===4)?3:(note===8)?4:5;
    applySync();
  };

  const setSpec = (sp)=>{
    if (syncSP === sp){
      syncSP = 0;
    }else{
      syncSP = sp;
    }
    applySync();
  };

  bT.addEventListener('click', ()=>{ setSpec(1); });
  bD.addEventListener('click', ()=>{ setSpec(2); });
  b16.addEventListener('click', ()=>{ setNote(16); });
  b8.addEventListener('click', ()=>{ setNote(8); });
  b4.addEventListener('click', ()=>{ setNote(4); });
  b2.addEventListener('click', ()=>{ setNote(2); });
  b1.addEventListener('click', ()=>{ setNote(1); });

  btTape.addEventListener('click', ()=>{
    const p = P(IDX.tape);
    const on = !!p && (p.value||0)>=0.5;
    setParamRaw(IDX.tape, on ? 0 : 1, 0, 1);
    updateButtons();
  });
  btCrush.addEventListener('click', ()=>{
    const p = P(IDX.crush);
    const on = !!p && (p.value||0)>=0.5;
    setParamRaw(IDX.crush, on ? 0 : 1, 0, 1);
    updateButtons();
  });

  btStart.addEventListener('click', ()=>{
    const p = P(IDX.start);
    const st = p ? Math.round(clamp01(p.value||0) * 2) : 0;
    const next = (st + 1) % 3;
    setParamRaw(IDX.start, next, 0, 2);
    updateButtons();
  });

  // --- Fit scaling
  const fit_3949 = ()=>{
    const parent = host.parentElement || host;
    const r = parent.getBoundingClientRect ? parent.getBoundingClientRect() : {width: DESIGN_W, height: DESIGN_H};
    const availW = Math.max(50, r.width || parent.clientWidth || DESIGN_W);
    const availH = Math.max(50, r.height || parent.clientHeight || DESIGN_H);
    const pad = 16;
    const sc = Math.min(1, (availW - pad) / DESIGN_W, (availH - pad) / DESIGN_H);
    panel.style.transform = `scale(${Math.max(0.5, sc)})`;
  };
  let ro = null;
  try{
    ro = new ResizeObserver(()=>{ requestAnimationFrame(fit_3949); });
    ro.observe(host.parentElement || host);
  }catch(_){}
  requestAnimationFrame(fit_3949);

  // --- Update loop
  function update(){
    // read params
    const bpm = getBpmProject();
    if (Number.isFinite(bpm)) flashSeg(segBpm, String(Math.round(bpm)));
    else flashSeg(segBpm, '—');

    // sync params
    const pTS = P(IDX.timeSig);
    const pSP = P(IDX.timeSpec);
    syncTS = pTS ? (pTS.raw!=null ? (pTS.raw|0) : Math.round(clamp01(pTS.value||0)*5)) : 0;
    syncSP = pSP ? (pSP.raw!=null ? (pSP.raw|0) : Math.round(clamp01(pSP.value||0)*2)) : 0;

    // derive note for UI
    syncNote = (syncTS===1)?1:(syncTS===2)?2:(syncTS===3)?4:(syncTS===4)?8:(syncTS===5)?16:0;

    // if bpm changed and sync is active -> recompute delay(ms) to keep TIME knob in sync
    if (Number.isFinite(bpm) && syncTS>0){
      if (lastBpm==null) lastBpm = bpm;
      if (Math.abs(bpm - lastBpm) > 0.0001){
        lastBpm = bpm;
        const ms = calcMsFromSync(bpm, syncTS, syncSP);
        if (ms!=null){
          suppressSyncClearOnce = true;
          setParamRaw(IDX.delayMs, ms, 0, 3000);
        }
      }
    }else{
      lastBpm = bpm;
    }

    // Knob visuals
    for (const k of [kbTime, kbDamp, kbHPF, kbLPF, kbWidth, kbMix]){
      const n = k.getNFromParam();
      const text = k.getTextFromParam();
      k.setVisual(n, text);
    }

    // LED values
    // TIME segment: show computed ms + note if synced
    let timeText = '—';
    if (syncTS>0 && Number.isFinite(bpm)){
      const ms = calcMsFromSync(bpm, syncTS, syncSP);
      const noteStr = syncNote ? `1/${syncNote}` : '';
      const specStr = (syncSP===1)?'T':(syncSP===2)?'D':'';
      timeText = `${Math.round(ms)}ms ${noteStr}${specStr}`;
    }else{
      const p = P(IDX.delayMs);
      const raw = p && Number.isFinite(p.raw) ? p.raw : (p ? rawFromNorm(clamp01(p.value||0), 0, 3000) : null);
      timeText = raw!=null ? `${Math.round(raw)}ms` : '—';
    }
    flashSeg(segTime, timeText);

    const pFb = P(IDX.fbDb);
    const fbRaw = pFb && Number.isFinite(pFb.raw) ? pFb.raw : (pFb ? rawFromNorm(clamp01(pFb.value||0), -40, 0) : null);
    const fbPct = fbRaw!=null ? dampPctFromRaw(fbRaw) : null;
    flashSeg(segDamp, fbPct!=null ? `${Math.round(fbPct)}%` : '—');

    // HPF is in Hz (0..1000)
    const pH = P(IDX.hpf);
    const hRaw = (pH && Number.isFinite(pH.raw)) ? pH.raw : rawFromNorm(clamp01(pH ? (pH.value||0) : 0), 0, 1000);
    flashSeg(segHPF, `${Math.round(hRaw)}`);

    // LPF uses log2(freq) raw (slider14)
    const pL = P(IDX.lpfLog);
    const lRaw = (pL && Number.isFinite(pL.raw)) ? pL.raw : rawFromNorm(clamp01(pL ? (pL.value||0) : 0), 9.96, 14.2877123);
    flashSeg(segLPF, fmtK(Math.pow(2, lRaw)));

    const pW = P(IDX.width);
    const wRaw = pW && Number.isFinite(pW.raw) ? pW.raw : (pW ? rawFromNorm(clamp01(pW.value||0), 0, 100) : null);
    flashSeg(segWidth, wRaw!=null ? `${Math.round(wRaw)}%` : '—');

    const pMix = P(IDX.mix);
    const mixN = pMix ? clamp01(pMix.value||0) : 0;
    flashSeg(segMix, `${Math.round(mixN*100)}%`);

    updateButtons();
  }

  ctrl.update = ()=>update();
  update();
  return {el: host, update, ctrl};
}

function buildRMVoxPanelControl(win, ctrl){
  const ex = (ctrl && ctrl.extra) ? ctrl.extra : {};
  const host = document.createElement("div");
  host.className = "rmVoxHost";
  const panel = document.createElement("div");
  panel.className = "rmVoxPanel";
  host.appendChild(panel);

  const header = document.createElement("div");
  header.className = "rmVoxHeader";
  header.innerHTML = `<div class="rmVoxSub">Gate • Comp • Gain</div>`;
  panel.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "rmVoxGrid";
  panel.appendChild(grid);

  const ps = ()=> (Array.isArray(win.params) ? win.params : []);
  const find = (patterns)=> findParamByPatterns(ps(), patterns||[]);

  const pGate = ()=> find(ex.gateFind) || ps().find(p=>/\bgate\b/i.test(String(p.name||""))) || null;
  const pComp = ()=> find(ex.compFind) || ps().find(p=>/\bcomp\b/i.test(String(p.name||""))) || null;
  const pGain = ()=> find(ex.gainFind) || ps().find(p=>/\bgain\b/i.test(String(p.name||""))) || null;

  const pIn  = ()=> find(ex.inFind)  || ps().find(p=>/telemetry.*in.*peak/i.test(String(p.name||""))) || null;
  const pGR  = ()=> find(ex.grFind)  || ps().find(p=>/telemetry.*\bgr\b/i.test(String(p.name||""))) || null;
  const pOut = ()=> find(ex.outFind) || ps().find(p=>/telemetry.*out.*peak/i.test(String(p.name||""))) || null;

  const clamp01 = (v)=> Math.max(0, Math.min(1, v||0));
  const meterNorm = (p, maxVal=1)=>{
    if (!p) return 0;
    if (Number.isFinite(p.raw)){
      const mx = Number.isFinite(p.max) ? p.max : maxVal;
      if (Number.isFinite(mx) && mx > 0) return clamp01(p.raw / mx);
    }
    if (Number.isFinite(p.value)){
      if (Number.isFinite(p.max) && p.max > 1) return clamp01(p.value / p.max);
      return clamp01(p.value);
    }
    return 0;
  };
  const fmtPeakDb = (v)=>{
    const val = Math.max(0, v || 0);
    if (val <= 1e-6) return "-inf";
    const db = 20 * Math.log10(val);
    return db.toFixed(1);
  };

  function mkMeterFader(opts){
    const wrap = document.createElement("div");
    wrap.className = `rmVoxCol ${opts.className||""}`.trim();
    const title = document.createElement("div");
    title.className = "rmVoxColTitle";
    title.textContent = opts.title || "";
    wrap.appendChild(title);

    const meterWrap = document.createElement("div");
    meterWrap.className = "rmVoxMeterWrap";
    if (opts.scaleLabels && opts.scaleLabels.length){
      const scale = document.createElement("div");
      scale.className = "rmVoxScale";
      opts.scaleLabels.forEach(l=>{
        const span = document.createElement("span");
        span.textContent = l;
        scale.appendChild(span);
      });
      meterWrap.appendChild(scale);
    }

    const track = document.createElement("div");
    track.className = `rmVoxTrack ${opts.trackClass||""}`.trim();
    const meter = document.createElement("div");
    meter.className = "rmVoxMeter";
    const meterFill = document.createElement("div");
    meterFill.className = "rmVoxMeterFill";
    meter.appendChild(meterFill);

    const fill = document.createElement("div");
    fill.className = "rmVoxFaderFill";
    const thumb = document.createElement("div");
    thumb.className = "rmVoxThumb";
    track.appendChild(meter);
    track.appendChild(fill);
    track.appendChild(thumb);
    meterWrap.appendChild(track);
    wrap.appendChild(meterWrap);

    const val = document.createElement("div");
    val.className = "rmVoxValue";
    val.textContent = "—";
    const sub = document.createElement("div");
    sub.className = "rmVoxValueSub";
    sub.textContent = "—";
    wrap.appendChild(val);
    wrap.appendChild(sub);

    let drag = null;
    let meterState = 0;
    const setFromClientY = (ev)=>{
      const p = opts.getParam();
      if (!p) return;
      const r = track.getBoundingClientRect();
      const y = Math.max(r.top, Math.min(r.bottom, ev.clientY));
      const n = 1 - ((y - r.top) / Math.max(1, r.height));
      const v = clamp01(n);
      setParamNormalized(win, p.index, v);
      p.value = v;
      try{ setDraggedParamValue(win, p.index, v); }catch(_){ }
      suppressPoll(win, 600);
      update();
    };

    const startDrag = (ev)=>{
      const p = opts.getParam();
      if (!p) return;
      if (ev.button !== 0) return;
      bringPluginToFront(win);
      beginParamDrag(win, p.index);
      suppressPoll(win, 600);
      drag = {id: ev.pointerId};
      try{ track.setPointerCapture(ev.pointerId); }catch(_){ }
      ev.preventDefault();
      setFromClientY(ev);
    };

    thumb.addEventListener("pointerdown", startDrag);
    track.addEventListener("pointerdown", (ev)=>{
      if (ev.target === thumb) return;
      startDrag(ev);
    });
    track.addEventListener("pointermove", (ev)=>{
      if (!drag || ev.pointerId !== drag.id) return;
      setFromClientY(ev);
    });
    const endDrag = (ev)=>{
      if (!drag || ev.pointerId !== drag.id) return;
      const p = opts.getParam();
      if (p) endParamDrag(win, p.index);
      drag = null;
      try{ track.releasePointerCapture(ev.pointerId); }catch(_){ }
    };
    track.addEventListener("pointerup", endDrag);
    track.addEventListener("pointercancel", endDrag);

    const update = ()=>{
      const p = opts.getParam();
      if (p){
        const v = (p.raw != null && Number.isFinite(p.min) && Number.isFinite(p.max) && p.max !== p.min)
          ? clamp01((p.raw - p.min) / (p.max - p.min))
          : clamp01(p.value||0);
        fill.style.height = (v*100) + "%";
        thumb.style.top = ((1 - v)*100) + "%";
        val.textContent = formatParam(p);
      }else{
        fill.style.height = "0%";
        thumb.style.top = "100%";
        val.textContent = "—";
      }

      const m = opts.getMeter ? opts.getMeter() : null;
      const mv = meterNorm(m, opts.meterMax || 1);
      const attack = 0.45;
      const release = 0.07;
      meterState = mv > meterState ? (meterState + (mv - meterState) * attack) : (meterState + (mv - meterState) * release);
      meterFill.style.height = (meterState*100) + "%";
      if (m){
        if (opts.meterMax && opts.meterMax > 1){
          const raw = Number.isFinite(m.raw) ? m.raw : (Number.isFinite(m.value) ? (m.value * opts.meterMax) : 0);
          sub.textContent = `${opts.meterLabel || ""} ${Math.max(0, raw).toFixed(1)}`.trim();
        }else{
          const raw = Number.isFinite(m.raw) ? m.raw : (Number.isFinite(m.value) ? m.value : 0);
          sub.textContent = `${opts.meterLabel || ""} ${fmtPeakDb(raw)}`.trim();
        }
      }else{
        sub.textContent = "—";
      }
    };

    update();
    return {el: wrap, update};
  }

  const gateCol = mkMeterFader({
    title: "Gate",
    className: "rmVoxColGate",
    trackClass: "rmVoxTrackNarrow",
    scaleLabels: ["12","24","36","48","60","72"],
    getParam: pGate,
    getMeter: pIn,
    meterLabel: "Energy",
    meterMax: 1
  });
  const compCol = mkMeterFader({
    title: "Comp",
    className: "rmVoxColComp",
    trackClass: "rmVoxTrackWide",
    scaleLabels: ["6","12","18","24","30","36"],
    getParam: pComp,
    getMeter: pGR,
    meterLabel: "GR",
    meterMax: 30
  });
  const gainCol = mkMeterFader({
    title: "Gain",
    className: "rmVoxColGain",
    trackClass: "rmVoxTrackNarrow",
    scaleLabels: [],
    getParam: pGain,
    getMeter: pOut,
    meterLabel: "Output",
    meterMax: 1
  });

  grid.appendChild(gateCol.el);
  grid.appendChild(compCol.el);
  grid.appendChild(gainCol.el);

  const update = ()=>{
    gateCol.update();
    compCol.update();
    gainCol.update();
  };
  ctrl.update = ()=>update();
  update();
  return {el: host, update, ctrl};
}

function buildRMAirPanelControl(win, ctrl){
  const host = document.createElement("div");
  host.className = "rmAirHost";
  const panel = document.createElement("div");
  panel.className = "rmAirPanel";
  host.appendChild(panel);

  // Parse numeric value from param (prefers formatted string, falls back to raw/min/max).
  const paramNumber = (p)=>{
    if (!p) return 0;
    const tryNum = (x)=>{
      const n = parseFloat(String(x).replace(",", "."));
      return Number.isFinite(n) ? n : null;
    };
    let n = tryNum(p.fmt);
    if (n == null) n = (Number.isFinite(p.raw) ? p.raw : null);
    if (n == null && Number.isFinite(p.min) && Number.isFinite(p.max) && p.max !== p.min){
      n = p.min + (Number(p.value||0))*(p.max-p.min);
    }
    if (n == null) n = Number(p.value||0);
    return Number.isFinite(n) ? n : 0;
  };
  const intNoDecimals = (p)=> String(Math.trunc(paramNumber(p)));
  const clamp01 = (v)=> Math.max(0, Math.min(1, (v==null?0:v)));

  const midCtrl = {
    pIndex: -1,
    patterns: ctrl.extra?.midFind || [],
    label: "MID AIR",
    formatValue: intNoDecimals,
    heat01: (p)=> clamp01(paramNumber(p) / 100)
  };
  const highCtrl = {
    pIndex: -1,
    patterns: ctrl.extra?.highFind || [],
    label: "HIGH AIR",
    formatValue: intNoDecimals,
    heat01: (p)=> clamp01(paramNumber(p) / 100)
  };
  const trimCtrl = {pIndex: -1, patterns: ctrl.extra?.trimFind || [], label: "TRIM"};

  let linked = false;
  let linkOffset = 0; // (high - mid) captured when LINK is enabled
  const link = document.createElement("div");
  link.className = "rmAirLink";
  link.textContent = "LINK";
  const setLinked = (v)=>{
    linked = !!v;
    link.classList.toggle("on", linked);
    if (linked){
      // Capture current offset and preserve it (do NOT snap values).
      try{
        const pMid = getParamForCtrl(win, midCtrl);
        const pHigh = getParamForCtrl(win, highCtrl);
        if (pMid && pHigh && typeof pMid.value === "number" && typeof pHigh.value === "number"){
          linkOffset = (pHigh.value - pMid.value);
        }else{
          linkOffset = 0;
        }
      }catch(_){ linkOffset = 0; }
    }
  };
  link.addEventListener("click", (ev)=>{
    ev.preventDefault();
    ev.stopPropagation();
    setLinked(!linked);
  });

  // Mirror knob changes when LINK is enabled: move both together preserving offset.
  const mirror = (src, dst, v)=>{
    try{
      const pDst = getParamForCtrl(win, dst);
      if (!pDst) return;
      let want = v;
      if (src === midCtrl && dst === highCtrl) want = v + linkOffset;
      else if (src === highCtrl && dst === midCtrl) want = v - linkOffset;
      want = Math.max(0, Math.min(1, want));
      if (Math.abs((pDst.value||0) - want) < 0.0005) return;
      suppressPoll(win, 700);
      setParamNormalized(win, pDst.index, want);
      pDst.value = want;
    }catch(_){ }
  };
  midCtrl.onUserSet = ({value})=>{
    if (!linked) return;
    mirror(midCtrl, highCtrl, value);
  };
  highCtrl.onUserSet = ({value})=>{
    if (!linked) return;
    mirror(highCtrl, midCtrl, value);
  };

  const mid = buildKnobControl(win, midCtrl);
  mid.el.classList.add("rmAirKnob", "rmAirKnobLarge", "rmAirMid");
  const high = buildKnobControl(win, highCtrl);
  high.el.classList.add("rmAirKnob", "rmAirKnobLarge", "rmAirHigh");
  const trim = buildKnobControl(win, trimCtrl);
  trim.el.classList.add("rmAirKnob", "rmAirKnobSmall", "rmAirTrim");

  panel.appendChild(mid.el);
  panel.appendChild(link);
  panel.appendChild(high.el);
  panel.appendChild(trim.el);

  const update = ()=>{
    mid.update();
    high.update();
    trim.update();
  };
  update();
  return {el: host, update, ctrl};
}

function buildRMSaturatorPanelControl(win, ctrl){
  const ex = (ctrl && ctrl.extra) ? ctrl.extra : {};
  const host = document.createElement("div");
  host.className = "rmSatHost";
  const panel = document.createElement("div");
  panel.className = "rmSatPanel";
  host.appendChild(panel);

  const header = document.createElement("div");
  header.className = "rmSatHeader";
  header.innerHTML = `<div class="rmSatTitle">RM SATURATOR</div><div class="rmSatSub">Analog drive</div>`;
  panel.appendChild(header);

  const styleRow = document.createElement("div");
  styleRow.className = "rmSatStyleRow";
  panel.appendChild(styleRow);

  const main = document.createElement("div");
  main.className = "rmSatMain";
  panel.appendChild(main);

  const left = document.createElement("div");
  left.className = "rmSatBlock";
  const right = document.createElement("div");
  right.className = "rmSatBlock";
  main.appendChild(left);
  main.appendChild(right);

  const slopeRow = document.createElement("div");
  slopeRow.className = "rmSatSlopeRow";
  panel.appendChild(slopeRow);

  const extra = document.createElement("div");
  extra.className = "rmSatExtra";
  panel.appendChild(extra);

  const ps = ()=> (Array.isArray(win.params) ? win.params : []);
  const find = (patterns)=> findParamByPatterns(ps(), patterns||[]);
  const getRaw = (p, fbMin=0, fbMax=1)=>{
    if (!p) return fbMin;
    if (Number.isFinite(p.raw)) return p.raw;
    const mn = Number.isFinite(p.min) ? p.min : fbMin;
    const mx = Number.isFinite(p.max) ? p.max : fbMax;
    return mn + (Number(p.value||0))*(mx-mn);
  };

  const clamp01 = (v)=> Math.max(0, Math.min(1, v||0));

  const pDrive = ()=> find(ex.driveFind);
  const pPunish = ()=> find(ex.punishFind);
  const pStyle = ()=> find(ex.styleFind);
  const pBias = ()=> find(ex.biasFind);
  const pTone = ()=> find(ex.toneFind);
  const pLocut = ()=> find(ex.locutFind);
  const pHicut = ()=> find(ex.hicutFind);
  const pHpSlope = ()=> find(ex.hpSlopeFind);
  const pLpSlope = ()=> find(ex.lpSlopeFind);
  const pAuto = ()=> find(ex.autoFind);
  const pOut = ()=> find(ex.outFind);
  const pMix = ()=> find(ex.mixFind);

  const formatDb = (p)=>{
    const raw = getRaw(p, -60, 60);
    const rounded = Math.round(raw*10)/10;
    return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}`;
  };
  const formatHz = (p, fallbackMin, fallbackMax)=>{
    const raw = getRaw(p, fallbackMin, fallbackMax);
    if (raw >= 1000) return `${(raw/1000).toFixed(1)}k`;
    return `${Math.round(raw)}`;
  };
  const formatPct = (p, fallbackMin, fallbackMax)=>{
    const raw = getRaw(p, fallbackMin, fallbackMax);
    return `${Math.round(raw)}%`;
  };

  const styleLabels = ["Tape","Tube","Diode","Trans","Rect"];
  const styleButtons = styleLabels.map((label, idx)=>{
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rmSatStyleBtn";
    b.textContent = label.toUpperCase();
    b.addEventListener("click", ()=>{
      const p = pStyle();
      if (!p) return;
      bringPluginToFront(win);
      suppressPoll(win, 600);
      const v = idx / (styleLabels.length - 1);
      setParamNormalized(win, p.index, v);
      p.value = v;
      update();
    });
    styleRow.appendChild(b);
    return b;
  });

  const driveDial = buildRmDialControl(win, "DRIVE", pDrive, { valueFormatter: formatDb });
  const biasDial = buildRmDialControl(win, "BIAS", pBias, { valueFormatter: (p)=> getRaw(p, -0.5, 0.5).toFixed(2) });
  const toneDial = buildRmDialControl(win, "TONE", pTone, { valueFormatter: formatDb });
  const outDial = buildRmDialControl(win, "OUTPUT", pOut, { valueFormatter: formatDb });
  const loDial = buildRmDialControl(win, "LOCUT", pLocut, { valueFormatter: (p)=> formatHz(p, 20, 300) });
  const hiDial = buildRmDialControl(win, "HICUT", pHicut, { valueFormatter: (p)=> formatHz(p, 4000, 20000) });
  const mixDial = buildRmDialControl(win, "MIX", pMix, { valueFormatter: (p)=> formatPct(p, 0, 100) });

  const mkDialWrap = (dial)=> {
    const wrap = document.createElement("div");
    wrap.className = "rmSatDialWrap";
    wrap.appendChild(dial.el);
    return wrap;
  };

  left.appendChild(mkDialWrap(driveDial));
  left.appendChild(mkDialWrap(loDial));
  left.appendChild(mkDialWrap(toneDial));
  right.appendChild(mkDialWrap(outDial));
  right.appendChild(mkDialWrap(hiDial));
  right.appendChild(mkDialWrap(mixDial));
  right.appendChild(mkDialWrap(biasDial));

  const switchRow = document.createElement("div");
  switchRow.className = "rmSatSwitchRow";
  const autoBtn = document.createElement("button");
  autoBtn.type = "button";
  autoBtn.className = "rmSatMiniBtn";
  autoBtn.textContent = "AUTO";
  const punishBtn = document.createElement("button");
  punishBtn.type = "button";
  punishBtn.className = "rmSatMiniBtn";
  punishBtn.textContent = "PUNISH";
  switchRow.appendChild(autoBtn);
  switchRow.appendChild(punishBtn);
  left.appendChild(switchRow);

  const slopeValues = [6,12,18,24,48,96];
  const mkSlopeSelect = (label, getParam)=>{
    const wrap = document.createElement("div");
    wrap.className = "rmSatSlopeSelect";
    const t = document.createElement("div");
    t.className = "rmSatSlopeLabel";
    t.textContent = label;
    const sel = document.createElement("select");
    slopeValues.forEach((val, idx)=>{
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = `${val} dB/oct`;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", ()=>{
      const p = getParam();
      if (!p) return;
      bringPluginToFront(win);
      suppressPoll(win, 600);
      const idx = parseInt(sel.value, 10);
      const v = idx / (slopeValues.length - 1);
      setParamNormalized(win, p.index, v);
      p.value = v;
      update();
    });
    wrap.appendChild(t);
    wrap.appendChild(sel);
    return {wrap, sel};
  };

  const hpSlope = mkSlopeSelect("HP SLOPE", pHpSlope);
  const lpSlope = mkSlopeSelect("LP SLOPE", pLpSlope);
  slopeRow.appendChild(hpSlope.wrap);
  slopeRow.appendChild(lpSlope.wrap);

  extra.remove();

  const update = ()=>{
    driveDial.update();
    biasDial.update();
    toneDial.update();
    loDial.update();
    hiDial.update();
    outDial.update();
    mixDial.update();

    const pPun = pPunish();
    punishBtn.disabled = !pPun;
    const punishOn = pPun ? clamp01(pPun.value) >= 0.5 : false;
    punishBtn.classList.toggle("on", punishOn);

    const pSt = pStyle();
    const styleRaw = getRaw(pSt, 0, styleLabels.length - 1);
    styleButtons.forEach((b, idx)=> b.classList.toggle("on", Math.round(styleRaw) === idx));

    const pHp = pHpSlope();
    const hpRaw = getRaw(pHp, 0, slopeValues.length - 1);
    hpSlope.sel.value = String(Math.round(hpRaw));

    const pLp = pLpSlope();
    const lpRaw = getRaw(pLp, 0, slopeValues.length - 1);
    lpSlope.sel.value = String(Math.round(lpRaw));

    const pAu = pAuto();
    autoBtn.disabled = !pAu;
    autoBtn.classList.toggle("on", pAu ? clamp01(pAu.value) >= 0.5 : false);
  };

  punishBtn.addEventListener("click", ()=>{
    const p = pPunish();
    if (!p) return;
    bringPluginToFront(win);
    suppressPoll(win, 600);
    const next = clamp01(p.value) >= 0.5 ? 0 : 1;
    setParamNormalized(win, p.index, next);
    p.value = next;
    update();
  });

  autoBtn.addEventListener("click", ()=>{
    const p = pAuto();
    if (!p) return;
    bringPluginToFront(win);
    suppressPoll(win, 600);
    const next = clamp01(p.value) >= 0.5 ? 0 : 1;
    setParamNormalized(win, p.index, next);
    p.value = next;
    update();
  });

  ctrl.update = ()=>update();
  update();
  return {el: host, update, ctrl};
}

function buildRmDialControl(win, label, getParamFn, options = {}){
  const {steps = null, valueFormatter = null} = options;
  const wrap = document.createElement("div");
  wrap.className = "rmDial";

  const lab = document.createElement("div");
  lab.className = "rmDialLabel";
  lab.textContent = label;
  const face = document.createElement("div");
  face.className = "rmDialFace";
  const needle = document.createElement("div");
  needle.className = "rmDialNeedle";
  face.appendChild(needle);
  const val = document.createElement("div");
  val.className = "rmDialValue";
  val.textContent = "—";

  wrap.appendChild(lab);
  wrap.appendChild(face);
  wrap.appendChild(val);

  const clamp01 = (x)=>Math.max(0, Math.min(1, x||0));

  let drag = null;
  face.addEventListener("pointerdown", (ev)=>{
    const p = getParamFn();
    if (!p) return;
    bringPluginToFront(win);
    beginParamDrag(win, p.index);
    suppressPoll(win, 800);
    drag = {id: ev.pointerId, y: ev.clientY, start: clamp01(p.value||0), idx: p.index};
    face.setPointerCapture(ev.pointerId);
    ev.preventDefault();
    ev.stopPropagation();
  });
  face.addEventListener("pointermove", (ev)=>{
    if (!drag || drag.id !== ev.pointerId) return;
    const p = getParamFn();
    if (!p) return;
    const dy = ev.clientY - drag.y;
    let next = clamp01(drag.start - dy*0.004);
    if (steps && steps > 1){
      const step = 1/(steps-1);
      next = Math.round(next/step) * step;
    }
    setParamNormalized(win, p.index, next);
    p.value = next;
    try{ setDraggedParamValue(win, p.index, next); }catch(_){}
    update();
  });
  const end = (ev)=>{
    if (!drag || drag.id !== ev.pointerId) return;
    drag = null;
    const p = getParamFn();
    if (p) endParamDrag(win, p.index);
    try{ face.releasePointerCapture(ev.pointerId); }catch(_){}
  };
  face.addEventListener("pointerup", end);
  face.addEventListener("pointercancel", end);

  const update = ()=>{
    const p = getParamFn();
    const n = p ? clamp01(p.value) : 0;
    const angle = -135 + (270 * n);
    needle.style.transform = `translate(-50%,-100%) rotate(${angle}deg)`;
    if (!p) val.textContent = "—";
    else if (valueFormatter) val.textContent = valueFormatter(p);
    else val.textContent = formatParam(p);
  };

  update();
  return {el: wrap, update};
}

function buildRMEqt1aPanelControl(win, ctrl){
  const ex = (ctrl && ctrl.extra) ? ctrl.extra : {};
  const host = document.createElement("div");
  host.className = "rmPultecHost";
  const panel = document.createElement("div");
  panel.className = "rmPultecPanel";
  host.appendChild(panel);

  const header = document.createElement("div");
  header.className = "rmPultecHeader";
  header.innerHTML = `<div class="rmPultecTitle">RM EQT-1A</div><div class="rmPultecSub">PULTEC STYLE EQ</div>`;
  panel.appendChild(header);

  const layout = document.createElement("div");
  layout.className = "rmPultecLayout";
  panel.appendChild(layout);

  const ps = ()=> (Array.isArray(win.params) ? win.params : []);
  const find = (arr)=> findParamByPatterns(ps(), arr||[]);

  const byIndex = (idx)=> (ps()[idx] || null);
  const pLF     = ()=> byIndex(0) || find(ex.lsfFind)     || ps().find(p=>/\blow\s*frequency\b|\blsf\b/i.test(String(p.name||""))) || null;
  const pLBoost = ()=> byIndex(1) || find(ex.pushFind)     || ps().find(p=>/\bpush\b|\blow\b.*\bboost\b/i.test(String(p.name||""))) || null;
  const pLAtt   = ()=> byIndex(2) || find(ex.pullFind)     || ps().find(p=>/\bpull\b|\blow\b.*\batten\b/i.test(String(p.name||""))) || null;
  const pPeakFreq = ()=> byIndex(3) || find(ex.peakFreqFind) || ps().find(p=>/\bpeak\b|\bfreq\s*peak\b|\bpeak\s*freq\b/i.test(String(p.name||""))) || null;
  const pBW     = ()=> byIndex(4) || find(ex.midQFind)     || ps().find(p=>/\bbandwidth\b|\bmid\s*q\b|\bq\b/i.test(String(p.name||""))) || null;
  const pHBoost = ()=> byIndex(5) || find(ex.highGainFind) || ps().find(p=>/\bhigh\b.*\bgain\b|\bhigh\b.*\bboost\b/i.test(String(p.name||""))) || null;
  const pHAtt   = ()=> byIndex(7) || find(ex.midGainFind)  || ps().find(p=>/\batten\b/i.test(String(p.name||"")) && !/\bpull\b/i.test(String(p.name||""))) || null;
  const pHAttSel = ()=> byIndex(6) || find(ex.hsfFind)    || ps().find(p=>/\bhsf\b|\bhigh\s*frequency\b/i.test(String(p.name||""))) || null;
  const pOut    = ()=> byIndex(8) || find(ex.outFind)      || ps().find(p=>/\boutput\b|\bvolume\b/i.test(String(p.name||""))) || null;
  const pBypass = ()=> find(ex.bypassFind)   || ps().find(p=>/\bbypass\b|\bon\/off\b|\bpower\b|\benable\b|\bactive\b/i.test(String(p.name||""))) || null;

  const clamp01 = (x)=> Math.max(0, Math.min(1, x||0));
  const fixedValueFormatter = (values, suffix = "")=> (p)=>{
    if (!p) return "—";
    const idx = Math.round(clamp01(p.value) * (values.length - 1));
    return `${values[idx]}${suffix}`;
  };
  const formatOutput = (p)=>{
    if (!p) return "—";
    let raw = Number.isFinite(p.raw) ? p.raw : null;
    if (raw == null){
      if (Number.isFinite(p.min) && Number.isFinite(p.max)){
        raw = p.min + (p.max - p.min) * clamp01(p.value);
      }else{
        raw = -12 + clamp01(p.value) * 24;
      }
    }
    if (raw <= -11.9) return "−∞";
    const rounded = Math.round(raw * 10) / 10;
    return `${rounded > 0 ? "+" : ""}${rounded}`;
  };

  const topRow = document.createElement("div");
  topRow.className = "rmPultecRow rmPultecTop";
  layout.appendChild(topRow);

  const bottomRow = document.createElement("div");
  bottomRow.className = "rmPultecRow rmPultecBottom";
  layout.appendChild(bottomRow);

  const lBoost = buildRmDialControl(win, "BOOST", pLBoost);
  const lAtt = buildRmDialControl(win, "ATTEN", pLAtt);
  const hBoost = buildRmDialControl(win, "BOOST", pHBoost);
  const hAtt = buildRmDialControl(win, "ATTEN", pHAtt);
  const hAttSel = buildRmDialControl(win, "ATTEN SEL", pHAttSel, {
    steps: 3,
    valueFormatter: fixedValueFormatter([5, 10, 20])
  });

  [lBoost, lAtt, hBoost, hAtt, hAttSel].forEach(d=>topRow.appendChild(d.el));

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "rmPultecToggle";
  toggle.textContent = "IN";

  const lowFreq = buildRmDialControl(win, "LOW FREQ", pLF, {
    steps: 4,
    valueFormatter: fixedValueFormatter([20, 30, 60, 100])
  });
  const bwDial = buildRmDialControl(win, "BANDWIDTH", pBW);
  const highFreq = buildRmDialControl(win, "HIGH FREQ", pPeakFreq, {
    steps: 7,
    valueFormatter: fixedValueFormatter([3, 4, 5, 8, 10, 12, 16])
  });

  const led = document.createElement("div");
  led.className = "rmPultecLed";

  const outDial = buildRmDialControl(win, "VOLUME", pOut, { valueFormatter: formatOutput });

  bottomRow.appendChild(toggle);
  bottomRow.appendChild(lowFreq.el);
  bottomRow.appendChild(bwDial.el);
  bottomRow.appendChild(highFreq.el);
  bottomRow.appendChild(led);
  bottomRow.appendChild(outDial.el);

  toggle.addEventListener("click", ()=>{
    const p = pBypass();
    if (!p) return;
    const isBypass = /\bbypass\b/i.test(String(p.name||""));
    const on = isBypass ? (p.value||0) < 0.5 : (p.value||0) >= 0.5;
    const next = isBypass ? (on ? 1 : 0) : (on ? 0 : 1);
    setParamNormalized(win, p.index, clamp01(next));
    p.value = clamp01(next);
    try{ setDraggedParamValue(win, p.index, clamp01(next)); }catch(_){}
    update();
  });

  const update = ()=>{
    lBoost.update();
    lAtt.update();
    hBoost.update();
    hAtt.update();
    hAttSel.update();
    lowFreq.update();
    bwDial.update();
    highFreq.update();
    outDial.update();

    const p = pBypass();
    if (!p){
      toggle.classList.remove("on");
      led.classList.remove("on");
    }else{
      const isBypass = /\bbypass\b/i.test(String(p.name||""));
      const on = isBypass ? (p.value||0) < 0.5 : (p.value||0) >= 0.5;
      toggle.classList.toggle("on", on);
      led.classList.toggle("on", on);
    }
  };

  ctrl.update = ()=>update();
  update();
  return {el: host, update, ctrl};
}

function buildRMLexi2PanelControl(win, ctrl){
  const ex = (ctrl && ctrl.extra) ? ctrl.extra : {};
  const host = document.createElement("div");
  host.className = "rmLexiHost";
  const panel = document.createElement("div");
  panel.className = "rmLexiPanel";
  host.appendChild(panel);

  const header = document.createElement("div");
  header.className = "rmLexiHeader";
  header.innerHTML = `<div class="rmLexiTitle">Lexikan 2</div><div class="rmLexiSub">Tukan Digital Reverb</div>`;
  panel.appendChild(header);

  const buttons = document.createElement("div");
  buttons.className = "rmLexiButtons";
  panel.appendChild(buttons);

  const algoRow = document.createElement("div");
  algoRow.className = "rmLexiBtnRow rmLexiAlgoRow";
  buttons.appendChild(algoRow);

  const modeRow = document.createElement("div");
  modeRow.className = "rmLexiBtnRow rmLexiModeRow";
  buttons.appendChild(modeRow);

  const ledBar = document.createElement("div");
  const infoRow = document.createElement("div");
  infoRow.className = "rmLexiInfoRow";
  panel.appendChild(infoRow);

  ledBar.className = "rmLexiLedBar";
  infoRow.appendChild(ledBar);

  const syncBtn = document.createElement("button");
  syncBtn.type = "button";
  syncBtn.className = "rmLexiSyncBtn";
  syncBtn.textContent = "SYNC";
  infoRow.appendChild(syncBtn);

  const knobs = document.createElement("div");
  knobs.className = "rmLexiKnobs";
  panel.appendChild(knobs);

  const ps = ()=> (Array.isArray(win.params) ? win.params : []);
  const find = (arr)=> findParamByPatterns(ps(), arr||[]);

  const pAlgo    = ()=> find(ex.algoFind)      || ps().find(p=>/\balgorithm\b/i.test(String(p.name||""))) || null;
  const pWetSolo = ()=> find(ex.wetFind)       || ps().find(p=>/wet\s*solo|wetsolo/i.test(String(p.name||""))) || null;
  const pBypass  = ()=> find(ex.bypassFind)    || ps().find(p=>/\bbypass\b/i.test(String(p.name||""))) || null;
  const pEqMode  = ()=> find(ex.eqModeFind)    || ps().find(p=>/lpf\s*\/\s*tilt|lpf\s*tilt/i.test(String(p.name||""))) || null;
  const pLength  = ()=> find(ex.lengthFind)    || ps().find(p=>/\bdensity\b/i.test(String(p.name||""))) || null;
  const pPre     = ()=> find(ex.preDelayFind)  || ps().find(p=>/pre\s*delay|predelay/i.test(String(p.name||""))) || null;
  const pTilt    = ()=> find(ex.tiltFind)      || ps().find(p=>/\btilt\b/i.test(String(p.name||""))) || null;
  const pDryWet  = ()=> find(ex.dryWetFind)    || ps().find(p=>/dry\s*wet|drywet/i.test(String(p.name||""))) || null;
  const pStereo  = ()=> find(ex.stereoFind)    || ps().find(p=>/stereo\s*spread|stereospread|width/i.test(String(p.name||""))) || null;
  const pSync    = ()=> find(ex.syncFind)      || ps().find(p=>/tempo\s*sync/i.test(String(p.name||""))) || null;
  const pLenNote = ()=> find(ex.lenNoteFind)   || ps().find(p=>/length\s*sync\s*note|length\s*note/i.test(String(p.name||""))) || null;
  const pPreNote = ()=> find(ex.preNoteFind)   || ps().find(p=>/predelay\s*sync\s*note|predelay\s*note/i.test(String(p.name||""))) || null;
  const pBpm     = ()=> find(ex.bpmFind)       || ps().find(p=>/telemetry\s*bpm|\bbpm\b/i.test(String(p.name||""))) || null;

  const clamp01 = (x)=> Math.max(0, Math.min(1, x||0));
  const getRaw = (p, fallbackMin = 0, fallbackMax = 1)=>{
    if (!p) return null;
    if (Number.isFinite(p.raw)) return p.raw;
    if (Number.isFinite(p.min) && Number.isFinite(p.max)){
      return p.min + (p.max - p.min) * clamp01(p.value||0);
    }
    return fallbackMin + (fallbackMax - fallbackMin) * clamp01(p.value||0);
  };
  const setParamRaw = (p, raw, fallbackMin = 0, fallbackMax = 1)=>{
    if (!p) return;
    const min = Number.isFinite(p.min) ? p.min : fallbackMin;
    const max = Number.isFinite(p.max) ? p.max : fallbackMax;
    const denom = (max - min) || 1;
    const n = clamp01((raw - min) / denom);
    setParamNormalized(win, p.index, n);
    p.value = n;
    try{ setDraggedParamValue(win, p.index, n); }catch(_){}
  };

  const notes = [
    {label:"1/64t", factor: 1/96},
    {label:"1/64", factor: 1/16},
    {label:"1/64d", factor: 3/32},
    {label:"1/32t", factor: 1/48},
    {label:"1/32", factor: 1/8},
    {label:"1/32d", factor: 3/16},
    {label:"1/16t", factor: 1/24},
    {label:"1/16", factor: 1/4},
    {label:"1/16d", factor: 3/8},
    {label:"1/8t", factor: 1/12},
    {label:"1/8", factor: 1/2},
    {label:"1/8d", factor: 3/4},
    {label:"1/4t", factor: 1/6},
    {label:"1/4", factor: 1},
    {label:"1/4d", factor: 3/2},
    {label:"1/2t", factor: 1/3},
    {label:"1/2", factor: 2},
    {label:"1/2d", factor: 3},
    {label:"1 bar", factor: 4},
    {label:"2 bar", factor: 8}
  ];

  const getBpm = ()=>{
    const p = pBpm();
    if (!p) return null;
    if (Number.isFinite(p.raw)) return p.raw;
    if (Number.isFinite(p.min) && Number.isFinite(p.max)){
      return p.min + (p.max - p.min) * clamp01(p.value||0);
    }
    return 300 * clamp01(p.value||0);
  };

  const isSyncOn = ()=>{
    const p = pSync();
    return !!p && clamp01(p.value||0) >= 0.5;
  };

  const noteIndexFromParam = (p)=>{
    if (!p) return 0;
    return Math.round(clamp01(p.value||0) * (notes.length - 1));
  };

  const noteLabelFromParam = (p)=>{
    const idx = noteIndexFromParam(p);
    return notes[idx] ? notes[idx].label : "—";
  };

  const findClosestNote = (ms, bpm)=>{
    if (!Number.isFinite(ms) || !Number.isFinite(bpm) || bpm <= 0) return 0;
    const quarter = 60000 / bpm;
    let best = 0;
    let min = Infinity;
    notes.forEach((note, idx)=>{
      const diff = Math.abs(quarter * note.factor - ms);
      if (diff < min){
        min = diff;
        best = idx;
      }
    });
    return best;
  };

  const mkBtn = (label)=>{
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rmLexiBtn";
    btn.textContent = label;
    const led = document.createElement("span");
    led.className = "rmLexiBtnLed";
    btn.appendChild(led);
    return btn;
  };

  const algoButtons = [
    {label:"AMB", value:0},
    {label:"ROOM", value:1},
    {label:"SMALL", value:2},
    {label:"BIG", value:3},
    {label:"PLATE", value:4}
  ].map(({label, value})=>{
    const btn = mkBtn(label);
    btn.addEventListener("click", ()=>{
      const p = pAlgo();
      if (!p) return;
      bringPluginToFront(win);
      suppressPoll(win, 500);
      setParamRaw(p, value, 0, 4);
      update();
    });
    algoRow.appendChild(btn);
    return {btn, value};
  });

  const wetBtn = mkBtn("WET");
  wetBtn.addEventListener("click", ()=>{
    const p = pWetSolo();
    if (!p) return;
    bringPluginToFront(win);
    suppressPoll(win, 500);
    const on = clamp01(p.value||0) >= 0.5;
    setParamRaw(p, on ? 0 : 1, 0, 1);
    update();
  });
  modeRow.appendChild(wetBtn);

  const bypassBtn = mkBtn("BYPASS");
  bypassBtn.addEventListener("click", ()=>{
    const p = pBypass();
    if (!p) return;
    bringPluginToFront(win);
    suppressPoll(win, 500);
    const on = clamp01(p.value||0) >= 0.5;
    setParamRaw(p, on ? 0 : 1, 0, 1);
    update();
  });
  modeRow.appendChild(bypassBtn);

  const brightBtn = mkBtn("BRIGHT");
  brightBtn.addEventListener("click", ()=>{
    const p = pEqMode();
    if (!p) return;
    bringPluginToFront(win);
    suppressPoll(win, 500);
    setParamRaw(p, 0, 0, 1);
    update();
  });
  modeRow.appendChild(brightBtn);

  const tiltBtn = mkBtn("TILT");
  tiltBtn.addEventListener("click", ()=>{
    const p = pEqMode();
    if (!p) return;
    bringPluginToFront(win);
    suppressPoll(win, 500);
    setParamRaw(p, 1, 0, 1);
    update();
  });
  modeRow.appendChild(tiltBtn);

  syncBtn.addEventListener("click", ()=>{
    const p = pSync();
    if (!p) return;
    bringPluginToFront(win);
    suppressPoll(win, 500);
    const on = clamp01(p.value||0) >= 0.5;
    const next = on ? 0 : 1;
    setParamRaw(p, next, 0, 1);
    if (!on){
      const bpm = getBpm();
      const lenIdx = findClosestNote(getRaw(pLength(), 0, 4000), bpm);
      const preIdx = findClosestNote(getRaw(pPre(), 0, 4000), bpm);
      const lenNote = pLenNote();
      const preNote = pPreNote();
      if (lenNote) setParamRaw(lenNote, lenIdx, 0, notes.length - 1);
      if (preNote) setParamRaw(preNote, preIdx, 0, notes.length - 1);
    }
    update();
  });

  const mkLedSeg = (label)=>{
    const seg = document.createElement("div");
    seg.className = "rmLexiLedSeg";
    const lab = document.createElement("div");
    lab.className = "rmLexiLedLabel";
    lab.textContent = label;
    const val = document.createElement("div");
    val.className = "rmLexiLedValue";
    val.textContent = "—";
    seg.appendChild(lab);
    seg.appendChild(val);
    ledBar.appendChild(seg);
    return {seg, val, last:""};
  };

  const ledLength = mkLedSeg("LENGTH");
  const ledPre = mkLedSeg("PREDELAY");
  const ledMix = mkLedSeg("DRY/WET");
  const ledStereo = mkLedSeg("STEREO");

  const flashSeg = (segObj, text)=>{
    const t = String(text ?? "—");
    if (segObj.last === t) return;
    segObj.last = t;
    segObj.val.textContent = t;
    segObj.seg.classList.remove("rmLexiFlash");
    void segObj.seg.offsetWidth;
    segObj.seg.classList.add("rmLexiFlash");
    clearTimeout(segObj._t);
    segObj._t = setTimeout(()=>segObj.seg.classList.remove("rmLexiFlash"), 280);
  };

  const formatTimeMs = (raw)=>{
    if (!Number.isFinite(raw)) return "—";
    if (raw > 1000){
      return `${(raw/1000).toFixed(2)} s`;
    }
    return `${Math.round(raw)} ms`;
  };
  const formatMs = (p, fallbackMax)=>{
    if (!p) return "—";
    const raw = getRaw(p, 0, fallbackMax);
    return formatTimeMs(raw);
  };
  const formatPercent = (p)=>{
    if (!p) return "—";
    const raw = getRaw(p, 0, 1);
    if (!Number.isFinite(raw)) return "—";
    return `${Math.round(raw * 100)}%`;
  };
  const formatTilt = (p)=>{
    if (!p) return "—";
    const raw = getRaw(p, -6, 6);
    if (!Number.isFinite(raw)) return "—";
    const rounded = Math.round(raw * 10) / 10;
    return `${rounded > 0 ? "+" : ""}${rounded} dB`;
  };

  const buildLexiDial = (label, getParamFn, options = {})=>{
    const {valueFormatter, getSyncOn, getNoteParamFn} = options;
    const wrap = document.createElement("div");
    wrap.className = "rmDial";

    const lab = document.createElement("div");
    lab.className = "rmDialLabel";
    lab.textContent = label;
    const face = document.createElement("div");
    face.className = "rmDialFace";
    const needle = document.createElement("div");
    needle.className = "rmDialNeedle";
    face.appendChild(needle);
    const val = document.createElement("div");
    val.className = "rmDialValue";
    val.textContent = "—";

    wrap.appendChild(lab);
    wrap.appendChild(face);
    wrap.appendChild(val);

    let drag = null;
    const clamp = (x)=>Math.max(0, Math.min(1, x||0));
    const getParams = ()=>{
      const noteParam = getNoteParamFn ? getNoteParamFn() : null;
      const syncOn = !!noteParam && getSyncOn && getSyncOn();
      return {syncOn, valueParam: getParamFn(), noteParam};
    };

    face.addEventListener("pointerdown", (ev)=>{
      const {syncOn, valueParam, noteParam} = getParams();
      const p = syncOn ? noteParam : valueParam;
      if (!p) return;
      bringPluginToFront(win);
      beginParamDrag(win, p.index);
      suppressPoll(win, 800);
      drag = {id: ev.pointerId, y: ev.clientY, start: clamp(p.value||0), idx: p.index, syncOn};
      face.setPointerCapture(ev.pointerId);
      ev.preventDefault();
      ev.stopPropagation();
    });
    face.addEventListener("pointermove", (ev)=>{
      if (!drag || drag.id !== ev.pointerId) return;
      const dy = ev.clientY - drag.y;
      let next = clamp(drag.start - dy*0.004);
      if (drag.syncOn){
        const step = 1/(notes.length-1);
        next = Math.round(next/step) * step;
      }
      setParamNormalized(win, drag.idx, next);
      try{ setDraggedParamValue(win, drag.idx, next); }catch(_){}
      update();
    });
    const end = (ev)=>{
      if (!drag || drag.id !== ev.pointerId) return;
      const {syncOn, valueParam, noteParam} = getParams();
      const p = syncOn ? noteParam : valueParam;
      drag = null;
      if (p) endParamDrag(win, p.index);
      try{ face.releasePointerCapture(ev.pointerId); }catch(_){}
    };
    face.addEventListener("pointerup", end);
    face.addEventListener("pointercancel", end);

    const updateDial = ()=>{
      const {syncOn, valueParam, noteParam} = getParams();
      const needleParam = syncOn ? noteParam : valueParam;
      const n = needleParam ? clamp(needleParam.value) : 0;
      const angle = -135 + (270 * n);
      needle.style.transform = `translate(-50%,-100%) rotate(${angle}deg)`;
      if (!valueParam && !noteParam){
        val.textContent = "—";
      }else if (valueFormatter){
        val.textContent = valueFormatter(valueParam, syncOn, noteParam);
      }else if (syncOn && noteParam){
        val.textContent = noteLabelFromParam(noteParam);
      }else{
        val.textContent = valueParam ? formatParam(valueParam) : "—";
      }
    };

    updateDial();
    return {el: wrap, update: updateDial};
  };

  const dLength = buildLexiDial("LENGTH", pLength, {
    getSyncOn: isSyncOn,
    getNoteParamFn: pLenNote,
    valueFormatter: (p, syncOn, noteParam)=> syncOn ? noteLabelFromParam(noteParam) : formatMs(p, 4000)
  });
  const dPre = buildLexiDial("PREDELAY", pPre, {
    getSyncOn: isSyncOn,
    getNoteParamFn: pPreNote,
    valueFormatter: (p, syncOn, noteParam)=> syncOn ? noteLabelFromParam(noteParam) : formatMs(p, 4000)
  });
  const dTilt = buildRmDialControl(win, "TILT", pTilt, {
    valueFormatter: formatTilt
  });
  const dMix = buildRmDialControl(win, "DRY/WET", pDryWet, {
    valueFormatter: formatPercent
  });
  const dStereo = buildRmDialControl(win, "STEREO", pStereo, {
    valueFormatter: formatPercent
  });

  [dLength, dPre, dTilt, dMix, dStereo].forEach(d=>knobs.appendChild(d.el));

  const update = ()=>{
    dLength.update();
    dPre.update();
    dTilt.update();
    dMix.update();
    dStereo.update();

    const algoParam = pAlgo();
    const algoRaw = getRaw(algoParam, 0, 4);
    algoButtons.forEach(({btn, value})=>{
      btn.disabled = !algoParam;
      btn.classList.toggle("on", Number.isFinite(algoRaw) && Math.round(algoRaw) === value);
    });

    const wetParam = pWetSolo();
    wetBtn.disabled = !wetParam;
    wetBtn.classList.toggle("on", wetParam ? clamp01(wetParam.value||0) >= 0.5 : false);

    const bypassParam = pBypass();
    bypassBtn.disabled = !bypassParam;
    bypassBtn.classList.toggle("on", bypassParam ? clamp01(bypassParam.value||0) >= 0.5 : false);

    const eqParam = pEqMode();
    const eqRaw = getRaw(eqParam, 0, 1);
    brightBtn.disabled = !eqParam;
    tiltBtn.disabled = !eqParam;
    brightBtn.classList.toggle("on", Number.isFinite(eqRaw) && Math.round(eqRaw) === 0);
    tiltBtn.classList.toggle("on", Number.isFinite(eqRaw) && Math.round(eqRaw) === 1);

    const syncParam = pSync();
    const syncOn = isSyncOn();
    syncBtn.disabled = !syncParam;
    syncBtn.classList.toggle("on", syncOn);

    const lengthLabel = syncOn && pLenNote() ? noteLabelFromParam(pLenNote()) : formatMs(pLength(), 4000);
    const preLabel = syncOn && pPreNote() ? noteLabelFromParam(pPreNote()) : formatMs(pPre(), 4000);
    flashSeg(ledLength, lengthLabel);
    flashSeg(ledPre, preLabel);
    flashSeg(ledMix, formatPercent(pDryWet()));
    flashSeg(ledStereo, formatPercent(pStereo()));
  };

  ctrl.update = ()=>update();
  update();
  return {el: host, update, ctrl};
}


function buildRMDeesserPanelControl(win, ctrl){
  // Waves-ish DeEsser panel:
  // - THRESHOLD fader with an "input" style meter inside (we drive it from GR telemetry since there is no true input telemetry)
  // - ATTEN (GR) VU meter in the middle (red, top->down) styled like the Limiter ATTEN meter
  // - No OUTPUT fader (per request)
  const stage = document.createElement("div");
  stage.className = "rmDeStage";

  const skin = document.createElement("div");
  skin.className = "rmDeSkin";
  const root = document.createElement("div");
  root.className = "rmDePanel";
  skin.appendChild(root);
  stage.appendChild(skin);

  // Auto-scale
  const BASE_W = 640, BASE_H = 320;
  const fit_5300 = ()=>{
    const bodyEl = stage.closest(".pluginWinBody");
    const ctrlEl = stage.closest(".plugCtrl");
    const scope = ctrlEl || bodyEl || stage.closest(".pluginParamList") || stage;
    const availW = Math.max(10, scope.clientWidth);
    const availH = Math.max(10, scope.clientHeight);
    let sc = Math.min(availW/BASE_W, availH/BASE_H);
    const maxScale = (win && win.el && win.el.classList && win.el.classList.contains("fullscreen")) ? 2.0 : 1.0;
    sc = Math.max(0.25, Math.min(maxScale, sc));
    stage.style.width = (BASE_W*sc) + "px";
    stage.style.height = (BASE_H*sc) + "px";
    skin.style.transform = `scale(${sc})`;
  };
  try{
    const ro = new ResizeObserver(()=>fit_5300());
    const obs = stage.closest(".pluginParamList") || stage;
    ro.observe(obs);
    stage._ro = ro;
  }catch(_){ }
  requestAnimationFrame(fit_5300);

  const extra = ctrl.extra || {};
  const getP = (patterns)=> findParamByPatterns(win.params||[], patterns||[]);
  const pThr   = ()=> getP(extra.thrFind);
  const pFreq  = ()=> getP(extra.freqFind);
  const pRange = ()=> getP(extra.rangeFind);
  const pType  = ()=> getP(extra.typeFind);
  const pGR    = ()=> getP(extra.grFind); // 0..24 dB

  const clamp01 = (x)=> Math.max(0, Math.min(1, x||0));

  const rawFromParamLocal = (p, fbMin=0, fbMax=1)=>{
    if (!p) return fbMin;
    if (p.raw!=null && Number.isFinite(p.raw)) return p.raw;
    const hasMin = (p.min!=null && Number.isFinite(p.min));
    const hasMax = (p.max!=null && Number.isFinite(p.max));
    const mn = hasMin ? p.min : fbMin;
    const mx = hasMax ? p.max : fbMax;
    return mn + (Number(p.value||0))*(mx-mn);
  };

  // Header
  const head = document.createElement("div");
  head.className = "rmDeHead";
  const brand = document.createElement("div");
  brand.className = "rmDeBrand";
  brand.textContent = "DE-ESSER";
  const sub = document.createElement("div");
  sub.className = "rmDeSub";
  sub.textContent = "RM";
  head.appendChild(brand);
  head.appendChild(sub);
  root.appendChild(head);

  const body = document.createElement("div");
  body.className = "rmDeBody";
  root.appendChild(body);

  // ===== Left: Threshold fader (Limiter-style track + colored meter) =====
  const fWrap = document.createElement("div");
  fWrap.className = "rmDeFWrap";
  const fLbl = document.createElement("div");
  fLbl.className = "rmDeFLbl";
  fLbl.textContent = "THRESHOLD";
  const fBox = document.createElement("div");
  fBox.className = "rmDeFader";
  const tr = document.createElement("div");
  tr.className = "rmDeFTrack";

  // "Input" meter inside the threshold track (colored like Limiter meters).
  const inVu = document.createElement("div");
  inVu.className = "rmL2FaderVu"; // reuse limiter styling
  const inFill = document.createElement("div");
  inFill.className = "rmL2FaderVuFill";
  inVu.appendChild(inFill);

  // Thumb
  const th = document.createElement("div");
  th.className = "rmDeFThumb";

  tr.appendChild(inVu);
  tr.appendChild(th);
  fBox.appendChild(tr);

  const fVal = document.createElement("div");
  fVal.className = "rmDeFVal";
  fVal.textContent = "—";

  fWrap.appendChild(fLbl);
  fWrap.appendChild(fBox);
  fWrap.appendChild(fVal);

  // Drag behavior
  let drag = null;
  const setFromClientY = (ev)=>{
    const p = pThr();
    if (!p) return;
    const r = tr.getBoundingClientRect();
    const M = 10;
    const y = Math.max(r.top + M, Math.min(r.bottom - M, ev.clientY));
    const n = 1 - ((y - (r.top + M)) / Math.max(1, r.height - 2*M));
    const next = clamp01(n);

    bringPluginToFront(win);
    suppressPoll(win, 500);
    setParamNormalized(win, p.index, next);
    p.value = next;
    try{ setDraggedParamValue(win, p.index, next); }catch(_){ }
    update();
  };
  const startDrag = (ev)=>{
    const p = pThr();
    if (!p) return;
    bringPluginToFront(win);
    beginParamDrag(win, p.index);
    suppressPoll(win, 800);
    drag = {id: ev.pointerId};
    tr.setPointerCapture(ev.pointerId);
    setFromClientY(ev);
    ev.preventDefault();
    ev.stopPropagation();
  };
  tr.addEventListener("pointerdown", startDrag);
  th.addEventListener("pointerdown", startDrag);
  tr.addEventListener("pointermove", (ev)=>{
    if (!drag || ev.pointerId !== drag.id) return;
    setFromClientY(ev);
  });
  const end = (ev)=>{
    if (!drag || ev.pointerId !== drag.id) return;
    drag = null;
    try{ const p = pThr(); if (p) endParamDrag(win, p.index); }catch(_){ }
    try{ tr.releasePointerCapture(ev.pointerId); }catch(_){ }
  };
  tr.addEventListener("pointerup", end);
  tr.addEventListener("pointercancel", end);

  // ===== Middle: ATTEN meter (Limiter-style, red top->down) =====
  const attWrap = document.createElement("div");
  attWrap.className = "rmL2AttWrap";
  const attMeter = document.createElement("div");
  attMeter.className = "rmL2AttMeter";
  const attFill = document.createElement("div");
  attFill.className = "rmL2AttFill";
  attMeter.appendChild(attFill);
  const attLbl = document.createElement("div");
  attLbl.className = "rmL2AttLbl";
  attLbl.textContent = "ATTEN";
  const attVal = document.createElement("div");
  attVal.className = "rmL2AttVal";
  attVal.textContent = "—";
  attWrap.appendChild(attMeter);
  attWrap.appendChild(attLbl);
  attWrap.appendChild(attVal);

  // ===== Right: Type buttons + knobs =====
  function makeKnob(label, getParamFn){
    const kWrap = document.createElement("div");
    kWrap.className = "rmDeKWrap";
    const kLbl = document.createElement("div");
    kLbl.className = "rmDeKLbl";
    kLbl.textContent = label;

    const k = document.createElement("div");
    k.className = "rmDeKnob";
    const ind = document.createElement("div");
    ind.className = "rmDeKnobInd";
    k.appendChild(ind);

    const v = document.createElement("div");
    v.className = "rmDeKVal";
    v.textContent = "—";

    kWrap.appendChild(kLbl);
    kWrap.appendChild(k);
    kWrap.appendChild(v);

    let kd = null;
    k.addEventListener("pointerdown", (ev)=>{
      const p = getParamFn();
      if (!p) return;
      bringPluginToFront(win);
      beginParamDrag(win, p.index);
      suppressPoll(win, 800);
      kd = {id: ev.pointerId, startY: ev.clientY, start: clamp01(p.value||0)};
      k.setPointerCapture(ev.pointerId);
      ev.preventDefault();
      ev.stopPropagation();
    });
    k.addEventListener("pointermove", (ev)=>{
      if (!kd || ev.pointerId !== kd.id) return;
      const p = getParamFn();
      if (!p) return;
      const dy = (ev.clientY - kd.startY);
      const next = clamp01(kd.start - dy*0.004);
      setParamNormalized(win, p.index, next);
      p.value = next;
      try{ setDraggedParamValue(win, p.index, next); }catch(_){}
      update();
    });
    const kend = (ev)=>{
      if (!kd || ev.pointerId !== kd.id) return;
      const p = getParamFn();
      kd = null;
      try{ if (p) endParamDrag(win, p.index); }catch(_){}
      try{ k.releasePointerCapture(ev.pointerId); }catch(_){}
    };
    k.addEventListener("pointerup", kend);
    k.addEventListener("pointercancel", kend);

    const update = ()=>{
      const p = getParamFn();
      if (!p){
        v.textContent = "—";
        ind.style.transform = "translateX(-50%) rotate(-90deg)";
        return;
      }
      v.textContent = formatParam(p);
      const n = clamp01(p.value);
      const a0 = -135, a1 = 135;
      ind.style.transform = `translateX(-50%) rotate(${a0 + (a1-a0)*n}deg)`;
    };
    return {el: kWrap, update};
  }

  const typeRow = document.createElement("div");
  typeRow.className = "rmDeType";
  const bBell = document.createElement("button");
  bBell.className = "rmDeTypeBtn";
  bBell.textContent = "BELL";
  const bShelf = document.createElement("button");
  bShelf.className = "rmDeTypeBtn";
  bShelf.textContent = "SHELF";
  typeRow.appendChild(bBell);
  typeRow.appendChild(bShelf);

  const setType = (v)=>{
    const p = pType();
    if (!p) return;
    bringPluginToFront(win);
    suppressPoll(win, 500);
    const next = v ? 1.0 : 0.0;
    setParamNormalized(win, p.index, next);
    p.value = next;
    try{ setDraggedParamValue(win, p.index, next); }catch(_){ }
    update();
  };
  bBell.addEventListener("click", ()=>setType(0));
  bShelf.addEventListener("click", ()=>setType(1));

  const knobs = document.createElement("div");
  knobs.className = "rmDeKnobs";
  const kFreq = makeKnob("FREQ", pFreq);
  const kRange = makeKnob("RANGE", pRange);
  knobs.appendChild(kFreq.el);
  knobs.appendChild(kRange.el);

  const right = document.createElement("div");
  right.className = "rmDeMid";
  right.appendChild(typeRow);
  right.appendChild(knobs);

  body.appendChild(fWrap);
  body.appendChild(attWrap);
  body.appendChild(right);

  // ---- Debug overlay (text-only) ----
  let dbg = null;
  if (RM_DEBUG){
    dbg = rmDbgMake(root);
  }


  // track input peak from track meters
  let inPk = 0;

  const IN_VU_GAMMA = 0.323; // -6 dB (~0.501) -> ~80% fill

  const updateTrackMeter = (pkL, pkR)=>{
    inPk = clamp01(Math.max(pkL||0, pkR||0));
  };

  function update(){
    // threshold
    const p = pThr();
    if (p){
      const n = clamp01(p.value);
      const h = tr.clientHeight || 1;
      const M = 10;
      th.style.top = (M + (1 - n) * Math.max(1, (h - 2*M))) + "px";
      fVal.textContent = formatParam(p);
    } else {
      fVal.textContent = "—";
    }

    // Input meter inside THRESHOLD fader uses track peak (pkL/pkR)
    inFill.style.height = (Math.pow(clamp01(inPk), IN_VU_GAMMA) * 100) + "%";

    // ATTEN meter uses GR telemetry (0..24 dB), styled like Limiter
    const gP = pGR();
    const grDb = gP ? Math.max(0, Math.min(24, rawFromParamLocal(gP, 0, 24))) : 0;
    const grN = grDb / 24;
    attFill.style.height = (grN * 100) + "%";
    attVal.textContent = (grDb < 0.05) ? "0.0" : ("−" + (Math.round(grDb*10)/10).toFixed(1));

    const tP = pType();
    const isShelf = !!tP && (tP.value||0) >= 0.5;
    bBell.classList.toggle("on", !isShelf);
    bShelf.classList.toggle("on", isShelf);

    try{ kFreq.update(); }catch(_){}
    try{ kRange.update(); }catch(_){}

    if (dbg){
      const thrName = p ? (p.name||"Threshold") : "Threshold";
      const thrVal = p ? formatParam(p) : "—";
      const grName = gP ? (gP.name||"GR") : "GR";
      dbg.textContent = `${thrName}: ${thrVal}\n${grName}: ${attVal.textContent}\nFREQ: ${kFreq && kFreq.update ? (pFreq()?formatParam(pFreq()):"—") : "—"}\nRANGE: ${kRange && kRange.update ? (pRange()?formatParam(pRange()):"—") : "—"}`;
    }
  }

  update();
  return {el: stage, update, updateTrackMeter, ctrl};
}

function buildRMEqProQPanelControl(win, ctrl){
  const opts = ctrl.extra || {};
  const brandLabel = String(opts.brand || "RM_EQ");
  const maxBands = Number.isFinite(opts.maxBands) ? Math.max(1, Math.round(opts.maxBands)) : 4;
  const allowAddBands = !!opts.allowAdd;
  const root = document.createElement("div");
  root.className = "rmEqProQ";
  root.tabIndex = 0; // keyboard navigation (←/→)
  const isPhoneLikeLocal = ()=>{
    try{
      if (document.body.classList.contains("phoneLandscape")) return true;
      return !!window.matchMedia("(max-width: 900px)").matches;
    }catch{ return false; }
  };

  const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));
  const clamp01 = (x)=>clamp(x,0,1);
  let specSmooth = [];

  // ===== Graph wrapper =====
  const wrap = document.createElement("div");
  wrap.className = "rmEqCanvasWrap";
  root.appendChild(wrap);

  const canvas = document.createElement("canvas");
  canvas.className = "rmEqCanvas";
  wrap.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  // Pro-Q chrome (visual only)
  const decoTop = document.createElement("div");
  decoTop.className = "rmEqDecoTop";
  decoTop.innerHTML = `<div class="rmEqBrand"><span class="rmEqPro">${escapeHtml(brandLabel)}</span></div><div class="rmEqTopHint">Analyzer</div>`;
  wrap.appendChild(decoTop);

  const decoRight = document.createElement("div");
  decoRight.className = "rmEqDecoRight";
  decoRight.innerHTML = `<div>+12</div><div>+6</div><div>0</div><div>-6</div><div>-12</div>`;
  wrap.appendChild(decoRight);

  const decoKeys = document.createElement("div");
  decoKeys.className = "rmEqDecoKeys";
  wrap.appendChild(decoKeys);

  // ===== Bottom row (Output / Spectrum / Snap) =====
  const bottomRow = document.createElement("div");
  bottomRow.className = "rmEqBottomRow";
  bottomRow.innerHTML = `
    <div class="rmEqBottomLeft">
      <div class="rmEqMiniLabel">Output</div>
      <input class="rmEqOut" type="range" min="-18" max="18" step="0.1" value="0">
      <div class="rmEqOutVal">0.0 dB</div>
    </div>
    <div class="rmEqBottomRight">
      <button class="pill" data-role="spec">Spectrum</button>
      <button class="pill" data-role="snap">Snap</button>
      <button class="pill" data-role="add">Add</button>
      <button class="pill" data-role="zero">0 dB</button>
    </div>
  `;
  root.appendChild(bottomRow);

  const outSl = bottomRow.querySelector(".rmEqOut");
  const outVal = bottomRow.querySelector(".rmEqOutVal");
  const specBtn = bottomRow.querySelector('[data-role="spec"]');
  const snapBtn = bottomRow.querySelector('[data-role="snap"]');
  const addBtn = bottomRow.querySelector('[data-role="add"]');
  const zeroBtn = bottomRow.querySelector('[data-role="zero"]');

  // ===== Point panel (Pro-Q-like) =====
  const pointPanel = document.createElement("div");
  pointPanel.className = "rmEqPointPanel";
  pointPanel.innerHTML = `
    <div class="rmEqPointHdr">
      <button class="miniBtn rmEqNav" data-nav="-1">‹</button>
      <div class="rmEqPointTitle">
        <div class="rmEqPointName">B2</div>
        <div class="rmEqPointSub">—</div>
      </div>
      <div class="rmEqHdrRight">
        <button class="miniBtn rmEqDelete" data-role="delete">Delete</button>
        <button class="miniBtn rmEqToggle" data-role="toggle">On</button>
        <button class="miniBtn rmEqNav" data-nav="1">›</button>
        <button class="miniBtn rmEqCollapse" data-role="collapse" title="Hide panel">▾</button>
      </div>
    </div>

    <div class="rmEqPointBody">
      <div class="rmEqTypeBlock">
        <div class="rmEqTypeBtns" data-role="typeBtns">
          <button class="pill" data-type="0">Bell</button>
          <button class="pill" data-type="1">Lo</button>
          <button class="pill" data-type="2">Hi</button>
          <button class="pill" data-type="3">Tilt</button>
        </div>
        <div class="rmEqSlopeBtns" data-role="slopeBtns" style="display:none">
          <button class="pill" data-slope="0">12</button>
          <button class="pill" data-slope="1">18</button>
          <button class="pill" data-slope="2">24</button>
          <button class="pill" data-slope="3">36</button>
        </div>
      </div>

      <div class="rmEqKnobRow">
        <div class="rmEqKnob" data-k="freq">
          <div class="rmEqKnobFace"></div>
          <div class="rmEqKnobVal">1000</div>
          <div class="rmEqKnobLab">FREQ</div>
        </div>
        <div class="rmEqKnob" data-k="gain">
          <div class="rmEqKnobFace"></div>
          <div class="rmEqKnobVal">0.0</div>
          <div class="rmEqKnobLab">GAIN</div>
        </div>
        <div class="rmEqKnob" data-k="q">
          <div class="rmEqKnobFace"></div>
          <div class="rmEqKnobVal">1.00</div>
          <div class="rmEqKnobLab">Q</div>
        </div>
      </div>
    </div>
  `;

  // Floating show-panel button (phones)
  const panelFab = document.createElement("button");
  panelFab.className = "miniBtn rmEqPanelFab";
  panelFab.textContent = "▴";
  panelFab.title = "Show panel";
  wrap.appendChild(panelFab);

  // On desktop/tablet: overlay inside graph. On phone: move under graph.
  const placePointPanel = ()=>{
    if (isPhoneLikeLocal()){
      if (pointPanel.parentElement !== root){
        try{ pointPanel.remove(); }catch(_){}
        root.insertBefore(pointPanel, bottomRow);
      }
    }else{
      if (pointPanel.parentElement !== wrap){
        try{ pointPanel.remove(); }catch(_){}
        wrap.appendChild(pointPanel);
      }
    }
  };
  placePointPanel();
  window.addEventListener("resize", ()=>{ placePointPanel(); applyPanelCollapsed(); }, {passive:true});

  const ttlName = pointPanel.querySelector(".rmEqPointName");
  const ttlSub  = pointPanel.querySelector(".rmEqPointSub");
  const toggleBtn = pointPanel.querySelector('[data-role="toggle"]');
  const deleteBtn = pointPanel.querySelector('[data-role="delete"]');
  const collapseBtn = pointPanel.querySelector('[data-role="collapse"]');
  const typeBtnsWrap = pointPanel.querySelector('[data-role="typeBtns"]');
  const slopeBtnsWrap = pointPanel.querySelector('[data-role="slopeBtns"]');
  const knobEls = {
    freq: pointPanel.querySelector('.rmEqKnob[data-k="freq"]'),
    gain: pointPanel.querySelector('.rmEqKnob[data-k="gain"]'),
    q:    pointPanel.querySelector('.rmEqKnob[data-k="q"]'),
  };

  // ===== Panel collapse (phone usability) =====
  let panelCollapsed = false;
  const readCollapsedPref = ()=>{
    try{
      const v = localStorage.getItem("rmEqPanelCollapsed");
      if (v !== null) return v === "1";
    }catch(_){}
    // default: collapsed on phone-like screens
    return isPhoneLikeLocal();
  };
  const applyPanelCollapsed = ()=>{
    panelCollapsed = !!panelCollapsed;
    pointPanel.classList.toggle("collapsed", panelCollapsed);
    root.classList.toggle("panelCollapsed", panelCollapsed);
    if (collapseBtn){
      collapseBtn.textContent = panelCollapsed ? "▴" : "▾";
      collapseBtn.title = panelCollapsed ? "Show panel" : "Hide panel";
    }
    // On phones we hide the sheet when collapsed, so expose a floating button to open it
    if (panelFab){
      const showFab = panelCollapsed && isPhoneLikeLocal();
      panelFab.style.display = showFab ? "block" : "none";
    }
    try{ localStorage.setItem("rmEqPanelCollapsed", panelCollapsed ? "1" : "0"); }catch(_){}
  };
  panelCollapsed = readCollapsedPref();
  applyPanelCollapsed();
  if (collapseBtn){
    collapseBtn.addEventListener("click", (ev)=>{
      panelCollapsed = !panelCollapsed;
      applyPanelCollapsed();
      ev.preventDefault();
      ev.stopPropagation();
      draw();
    });
  }

  if (panelFab){
    panelFab.addEventListener("click", (ev)=>{
      panelCollapsed = false;
      applyPanelCollapsed();
      ev.preventDefault();
      ev.stopPropagation();
      draw();
    });
  }


  // ===== Param mapping =====
  let idx = {
    lcOn:null, lcFreq:null, lcSlope:null,
    hcOn:null, hcFreq:null, hcSlope:null,
    bands: Array.from({length: maxBands}, ()=>({on:null, freq:null, gain:null, q:null, type:null})),
    outGain:null,
    specOn:null,
    specBins:[]
  };

  const getP = (i)=> (Number.isFinite(i)) ? (win.params||[]).find(p=>p.index===i) : null;

  const rawFromParam = (p, fallbackMin=0, fallbackMax=1)=>{
    if (!p) return 0;
    if (p.raw!=null && Number.isFinite(p.raw)) return p.raw;
    const hasMin = (p.min!=null && Number.isFinite(p.min));
    const hasMax = (p.max!=null && Number.isFinite(p.max));
    const mn = hasMin ? p.min : fallbackMin;
    const mx = hasMax ? p.max : fallbackMax;
    return mn + (Number(p.value||0))*(mx-mn);
  };
  const setParamRaw = (p, rawTarget, fallbackMin=0, fallbackMax=1)=>{
    if (!p) return;
    const mn = (p.min!=null && Number.isFinite(p.min)) ? p.min : fallbackMin;
    const mx = (p.max!=null && Number.isFinite(p.max)) ? p.max : fallbackMax;
    const rt = clamp(rawTarget, mn, mx);
    const next = (mx===mn) ? 0 : ((rt-mn)/(mx-mn));
    suppressPoll(win, 700);
    setParamNormalized(win, p.index, next);
    p.value = next;
    try{ setDraggedParamValue(win, p.index, next); }catch(_){}
    p.raw = rt;
  };

  const remap = ()=>{
    const ps = Array.isArray(win.params) ? win.params : [];
    const pick = (reOrArr)=> {
      if (Array.isArray(reOrArr)) return findParamByPatterns(ps, reOrArr);
      return ps.find(p=> reOrArr.test(String(p.name||"")));
    };

    const lcOn = pick(/locut\s*on/i) || pick(/\blo\s*cut\s*on/i) || pick(/locut\b/i);
    const lcFr = pick(/locut\s*freq/i) || pick(/\blo\s*cut\s*freq/i);
    const lcSl = pick(/locut\s*slope/i);

    const hcOn = pick(/hicut\s*on/i) || pick(/\bhi\s*cut\s*on/i) || pick(/hicut\b/i);
    const hcFr = pick(/hicut\s*freq/i) || pick(/\bhi\s*cut\s*freq/i);
    const hcSl = pick(/hicut\s*slope/i);

    const bOn = (n)=> pick(new RegExp(`\\bb${n}\\s*on\\b`,"i"));
    const bFr = (n)=> pick(new RegExp(`\\bb${n}\\s*freq\\b`,"i"));
    const bGn = (n)=> pick(new RegExp(`\\bb${n}\\s*gain\\b`,"i"));
    const bQ  = (n)=> pick(new RegExp(`\\bb${n}\\s*q\\b`,"i"));
    const bTy = (n)=> pick(new RegExp(`\\bb${n}\\s*type\\b`,"i"));

    const out = pick(/\boutput\s*gain\b/i) || pick(/\bout\s*gain\b/i);
    const spec = pick(/\bspectrum\b/i);

    if (lcOn) idx.lcOn = lcOn.index;
    if (lcFr) idx.lcFreq = lcFr.index;
    if (lcSl) idx.lcSlope = lcSl.index;

    if (hcOn) idx.hcOn = hcOn.index;
    if (hcFr) idx.hcFreq = hcFr.index;
    if (hcSl) idx.hcSlope = hcSl.index;

    for (let n=1; n<=maxBands; n++){
      const pon=bOn(n), pfr=bFr(n), pgn=bGn(n), pq=bQ(n), pty=bTy(n);
      const slot = idx.bands[n-1];
      if (!slot) continue;
      slot.on = pon ? pon.index : null;
      slot.freq = pfr ? pfr.index : null;
      slot.gain = pgn ? pgn.index : null;
      slot.q = pq ? pq.index : null;
      slot.type = pty ? pty.index : null;
    }

    if (out) idx.outGain = out.index;
    if (spec) idx.specOn = spec.index;

    // Spectrum bins
    const bins = ps
      .map(pp=>{
        const m = String(pp.name||"").match(/spec\s*(\d+)/i);
        return m ? {n:parseInt(m[1],10), idx:pp.index} : null;
      })
      .filter(Boolean)
      .sort((a,b)=>a.n-b.n)
      .map(o=>o.idx);
    if (bins.length) idx.specBins = bins;
  };

  // ===== Bands/points =====
  const bandColors = [
    "#66e36f", "#ffb24a", "#57a6ff", "#d96bff", "#ff6b88",
    "#56e0d7", "#ffd34a", "#8be3ff", "#b9ff8d", "#ffa0e7",
  ];
  const pointDefs = [{id:"LC", label:"LoCut", color:"#d7d7d7", kind:"cut"}];
  for (let i=1; i<=maxBands; i++){
    pointDefs.push({
      id:`B${i}`,
      label:`B${i}`,
      color: bandColors[(i-1) % bandColors.length],
      kind:"band",
    });
  }
  pointDefs.push({id:"HC", label:"HiCut", color:"#d7d7d7", kind:"cut"});
  const pointOrder = pointDefs.map(d=>d.id);
  const pointEls = {};
  let selected = "LC";
  const deletedBands = new Set();
  if (allowAddBands){
    for (let i=1;i<=maxBands;i++) deletedBands.add(`B${i}`);
  }

  const getOnParamFor = (id)=>{
    if (id==="LC") return getP(idx.lcOn);
    if (id==="HC") return getP(idx.hcOn);
    if (id.startsWith("B")){
      const n = parseInt(id.slice(1),10);
      const slot = idx.bands[n-1];
      return slot ? getP(slot.on) : null;
    }
    return null;
  };
  const getFreqParamFor = (id)=>{
    if (id==="LC") return getP(idx.lcFreq);
    if (id==="HC") return getP(idx.hcFreq);
    if (id.startsWith("B")){
      const n = parseInt(id.slice(1),10);
      const slot = idx.bands[n-1];
      return slot ? getP(slot.freq) : null;
    }
    return null;
  };
  const getGainParamFor = (id)=>{
    if (id.startsWith("B")){
      const n = parseInt(id.slice(1),10);
      const slot = idx.bands[n-1];
      return slot ? getP(slot.gain) : null;
    }
    return null;
  };
  const getQParamFor = (id)=>{
    if (id.startsWith("B")){
      const n = parseInt(id.slice(1),10);
      const slot = idx.bands[n-1];
      return slot ? getP(slot.q) : null;
    }
    return null;
  };
  const getTypeParamFor = (id)=>{
    if (!id.startsWith("B")) return null;
    const n = parseInt(id.slice(1),10);
    const slot = idx.bands[n-1];
    return slot ? getP(slot.type) : null;
  };
  const getSlopeParamFor = (id)=>{
    if (id==="LC") return getP(idx.lcSlope);
    if (id==="HC") return getP(idx.hcSlope);
    return null;
  };
  const isBandId = (id)=> id && id.startsWith("B");
  const bandIsOn = (id)=>{
    const pOn = getOnParamFor(id);
    return pOn ? ((pOn.value||0) >= 0.5) : false;
  };
  const findNextAvailableBand = ()=>{
    if (!allowAddBands) return null;
    for (let i=0;i<maxBands;i++){
      const id = `B${i+1}`;
      if (deletedBands.has(id)) return id;
    }
    return null;
  };
  const ensureSelectedActive = ()=>{
    if (!allowAddBands || !isBandId(selected)) return;
    if (bandIsOn(selected)) return;
    if (deletedBands.has(selected)){
      selected = "LC";
      return;
    }
    const active = pointOrder.find(id=> isBandId(id) && bandIsOn(id));
    if (active) selected = active;
    else selected = "LC";
  };

  // ===== Freq snapping (1/12 octave) =====
  let snapOn = false;
  const setSnapUI = ()=>{ try{ snapBtn.classList.toggle('on', snapOn); }catch(_){ } };
  const snapFreq = (f)=>{
    const fMin = 20, fMax = 20000;
    const ff = clamp(f, fMin, fMax);
    const base = 20;
    const steps = 12;
    const n = Math.round(Math.log2(ff/base) * steps);
    return clamp(base * Math.pow(2, n/steps), fMin, fMax);
  };

  // ===== XY mapping =====
  const DB_MIN = -12, DB_MAX = 12, DB_RANGE = DB_MAX - DB_MIN;

  function xToFreq(x, w){
    const fMin = 20, fMax = 20000;
    const t = clamp01(x / Math.max(1,w));
    return fMin * Math.pow(fMax/fMin, t);
  }
  function freqToX(f, w){
    const fMin = 20, fMax = 20000;
    const t = Math.log(f / fMin) / Math.log(fMax / fMin);
    return clamp01(t) * w;
  }
  function yToGain(y, h){
    const t = 1 - clamp01(y / Math.max(1,h));
    return DB_MIN + t*DB_RANGE;
  }
  function gainToY(g, h){
    const t = (g - DB_MIN) / DB_RANGE;
    return (1 - clamp01(t)) * h;
  }

  // ===== Points DOM =====
  function mkPoint(def){
    const el = document.createElement("div");
    el.className = "rmEqPoint";
    el.style.background = def.color;
    el.dataset.id = def.id;
    wrap.appendChild(el);
    pointEls[def.id] = el;

    let drag = null;

    el.addEventListener("pointerdown", (ev)=>{
      remap();
      bringPluginToFront(win);
      root.focus({preventScroll:true});
      el.setPointerCapture(ev.pointerId);

      try{
        const pF = getFreqParamFor(def.id);
        const pG = getGainParamFor(def.id);
        if (pF) beginParamDrag(win, pF.index);
        if (pG) beginParamDrag(win, pG.index);
      }catch(_){}

      drag = {id:ev.pointerId, sx:ev.clientX, sy:ev.clientY, moved:false};
      selected = def.id;
      root.classList.add("draggingPoint");
      updatePanel();
      draw();
      ev.preventDefault();
      ev.stopPropagation();
    });

    el.addEventListener("pointermove", (ev)=>{
      if (!drag || drag.id !== ev.pointerId) return;
      const dx = ev.clientX - drag.sx;
      const dy = ev.clientY - drag.sy;
      if (Math.abs(dx)+Math.abs(dy) > 3) drag.moved = true;

      const rect = wrap.getBoundingClientRect();
      const x = clamp(ev.clientX - rect.left, 0, rect.width);
      const y = clamp(ev.clientY - rect.top, 0, rect.height);

      let f = xToFreq(x, rect.width);
      if (snapOn) f = snapFreq(f);

      if (def.id === "LC"){
        const pF = getP(idx.lcFreq);
        if (pF) setParamRaw(pF, f, 20, 20000);
      } else if (def.id === "HC"){
        const pF = getP(idx.hcFreq);
        if (pF) setParamRaw(pF, f, 20, 20000);
      } else {
        const n = parseInt(def.id.slice(1),10);
        const slot = idx.bands[n-1];
        const pF = slot ? getP(slot.freq) : null;
        const pG = slot ? getP(slot.gain) : null;
        if (pF) setParamRaw(pF, f, 20, 20000);
        if (pG){
          const g = yToGain(y, rect.height);
          // allow full knob range, but keep drag mapping Pro-Q-like
          setParamRaw(pG, clamp(g, -18, 18), -18, 18);
        }
      }
      updatePanel();
      draw();
    });

    const end = (ev)=>{
      if (!drag || drag.id !== ev.pointerId) return;
      try{ el.releasePointerCapture(ev.pointerId); }catch(_){}
      try{
        const pF = getFreqParamFor(def.id);
        const pG = getGainParamFor(def.id);
        if (pF) endParamDrag(win, pF.index);
        if (pG) endParamDrag(win, pG.index);
      }catch(_){}

      // tap: toggle on/off
      if (!drag.moved){
        remap();
        const onP = getOnParamFor(def.id);
        if (onP){
          const cur = (onP.value||0) >= 0.5;
          setParamRaw(onP, cur ? 0 : 1, 0, 1);
        }
      }
      drag = null;
      root.classList.remove("draggingPoint");
      updatePanel();
      draw();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }
  pointDefs.forEach(mkPoint);

  // ===== Panel interactions =====
  const cycleSelected = (dir)=>{
    const order = allowAddBands
      ? pointOrder.filter(id=> !isBandId(id) || bandIsOn(id) || !deletedBands.has(id))
      : pointOrder.slice();
    const useOrder = order.length ? order : pointOrder;
    const i = useOrder.indexOf(selected);
    const ni = (i<0) ? 0 : (i + dir + useOrder.length) % useOrder.length;
    selected = useOrder[ni];
    updatePanel();
    draw();
  };

  pointPanel.querySelectorAll(".rmEqNav").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const d = parseInt(btn.getAttribute("data-nav"),10) || 0;
      cycleSelected(d);
    });
  });

  root.addEventListener("keydown", (ev)=>{
    if (ev.key === "ArrowLeft"){ cycleSelected(-1); ev.preventDefault(); }
    else if (ev.key === "ArrowRight"){ cycleSelected(1); ev.preventDefault(); }
  });

  toggleBtn.addEventListener("click", ()=>{
    remap();
    const pOn = getOnParamFor(selected);
    if (!pOn) return;
    bringPluginToFront(win);
    const cur = (pOn.value||0) >= 0.5;
    setParamRaw(pOn, cur ? 0 : 1, 0, 1);
    ensureSelectedActive();
    updatePanel();
    draw();
  });

  if (deleteBtn){
    deleteBtn.addEventListener("click", ()=>{
      if (!selected.startsWith("B")) return;
      remap();
      const pOn = getOnParamFor(selected);
      if (!pOn) return;
      bringPluginToFront(win);
      setParamRaw(pOn, 0, 0, 1);
      deletedBands.add(selected);
      ensureSelectedActive();
      updatePanel();
      draw();
    });
  }

  typeBtnsWrap.querySelectorAll("button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      remap();
      const pT = getTypeParamFor(selected);
      if (!pT) return;
      const t = parseInt(btn.getAttribute("data-type"), 10);
      setParamRaw(pT, t, 0, 3);
      updatePanel();
      draw();
    });
  });

  slopeBtnsWrap.querySelectorAll("button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      remap();
      const pS = getSlopeParamFor(selected);
      if (!pS) return;
      const s = parseInt(btn.getAttribute("data-slope"), 10);
      setParamRaw(pS, s, 0, 3);
      updatePanel();
      draw();
    });
  });

  // ===== Knob logic =====
  const knobRanges = {
    freq: {min:20, max:20000, mode:"log"},
    gain: {min:-18, max:18, mode:"lin"},
    q:    {min:0.2, max:10, mode:"lin"},
  };

  const knobValueToNorm = (k, v)=>{
    const r = knobRanges[k];
    if (!r) return 0;
    if (r.mode==="log"){
      const t = Math.log(clamp(v,r.min,r.max)/r.min)/Math.log(r.max/r.min);
      return clamp01(t);
    }
    return clamp01((v-r.min)/(r.max-r.min));
  };

  const knobNormToValue = (k, t)=>{
    const r = knobRanges[k];
    if (!r) return 0;
    t = clamp01(t);
    if (r.mode==="log"){
      return r.min * Math.pow(r.max/r.min, t);
    }
    return r.min + t*(r.max-r.min);
  };

  const setKnobAngle = (k, t)=>{
    const face = knobEls[k].querySelector(".rmEqKnobFace");
    // Pro-Q-ish: -135..+135
    const a = -135 + clamp01(t)*270;
    face.style.setProperty("--ang", a.toFixed(2) + "deg");
  };

  const hookKnob = (k, getterParam, setterRaw, fmt)=>{
    const el = knobEls[k];
    if (!el) return;
    let drag = null;

    el.addEventListener("pointerdown", (ev)=>{
      remap();
      const p = getterParam();
      if (p) beginParamDrag(win, p.index);
      el.setPointerCapture(ev.pointerId);
      root.focus({preventScroll:true});
      const v0 = getterParam() ? rawFromParam(getterParam(), knobRanges[k].min, knobRanges[k].max) : knobRanges[k].min;
      drag = {id: ev.pointerId, y0: ev.clientY, v0};
      ev.preventDefault();
      ev.stopPropagation();
    });

    el.addEventListener("pointermove", (ev)=>{
      if (!drag || drag.id !== ev.pointerId) return;
      remap();
      const p = getterParam();
      if (!p) return;
      const dy = drag.y0 - ev.clientY;
      const fine = ev.shiftKey ? 0.25 : 1.0;
      const r = knobRanges[k];
      let v = drag.v0;

      if (r.mode==="log"){
        const t0 = knobValueToNorm(k, drag.v0);
        const t = clamp01(t0 + (dy/180) * fine);
        v = knobNormToValue(k, t);
        // nicer steps for freq
        v = Math.round(v);
      }else{
        const span = (r.max - r.min);
        v = v + (dy/180) * span * 0.25 * fine;
        if (k==="gain") v = Math.round(v*10)/10;
        if (k==="q") v = Math.round(v*100)/100;
      }

      setterRaw(p, v);
      updatePanel();
      draw();
    });

    const end = (ev)=>{
      if (!drag || drag.id !== ev.pointerId) return;
      remap();
      const p = getterParam();
      if (p) endParamDrag(win, p.index);
      try{ el.releasePointerCapture(ev.pointerId); }catch(_){}
      drag = null;
      updatePanel();
      draw();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };

  hookKnob("freq", ()=>getFreqParamFor(selected), (p,v)=>setParamRaw(p, v, 20, 20000));
  hookKnob("gain", ()=>getGainParamFor(selected), (p,v)=>setParamRaw(p, v, -18, 18));
  hookKnob("q",    ()=>getQParamFor(selected),    (p,v)=>setParamRaw(p, v, 0.2, 10));

  // Output / spectrum controls
  const hookSlider = (sl, getter)=>{
    sl.addEventListener("pointerdown", ()=>{
      remap(); const p = getter(); if (p) beginParamDrag(win, p.index);
    });
    const endDrag = ()=>{
      remap(); const p = getter(); if (p) endParamDrag(win, p.index);
    };
    sl.addEventListener("pointerup", endDrag);
    sl.addEventListener("pointercancel", endDrag);
    sl.addEventListener("input", ()=>{
      remap();
      const p = getter();
      if (!p) return;
      bringPluginToFront(win);
      setParamRaw(p, parseFloat(sl.value), -18, 18);
      updatePanel();
      draw();
    });
  };
  hookSlider(outSl, ()=>getP(idx.outGain));

  zeroBtn.addEventListener("click", ()=>{
    remap();
    const pOut = getP(idx.outGain);
    if (pOut) setParamRaw(pOut, 0, -18, 18);
    updatePanel(); draw();
  });

  specBtn.addEventListener("click", ()=>{
    remap();
    const pSpec = getP(idx.specOn);
    if (!pSpec) return;
    const cur = (pSpec.value||0) >= 0.5;
    setParamRaw(pSpec, cur ? 0 : 1, 0, 1);
    updatePanel(); draw();
  });

  snapBtn.addEventListener("click", ()=>{
    snapOn = !snapOn;
    setSnapUI();
  });

  const addBandAt = (clientX, clientY)=>{
    if (!allowAddBands) return;
    remap();
    const nextId = findNextAvailableBand();
    if (!nextId) return;
    const rect = wrap.getBoundingClientRect();
    const cx = (clientX != null) ? clientX : (rect.left + rect.width/2);
    const cy = (clientY != null) ? clientY : (rect.top + rect.height/2);
    const x = clamp(cx - rect.left, 0, rect.width);
    const y = clamp(cy - rect.top, 0, rect.height);
    const f = xToFreq(x, rect.width);
    const g = yToGain(y, rect.height);

    const pOn = getOnParamFor(nextId);
    const pF = getFreqParamFor(nextId);
    const pG = getGainParamFor(nextId);
    const pQ = getQParamFor(nextId);
    const pT = getTypeParamFor(nextId);

    if (pOn) setParamRaw(pOn, 1, 0, 1);
    if (pF) setParamRaw(pF, f, 20, 20000);
    if (pG) setParamRaw(pG, clamp(g, -18, 18), -18, 18);
    if (pQ) setParamRaw(pQ, 1, 0.2, 10);
    if (pT) setParamRaw(pT, 0, 0, 3);

    selected = nextId;
    deletedBands.delete(nextId);
    updatePanel();
    draw();
  };

  if (addBtn){
    addBtn.style.display = allowAddBands ? "" : "none";
    addBtn.addEventListener("click", ()=> addBandAt(null, null));
  }
  wrap.addEventListener("dblclick", (ev)=>{
    if (!allowAddBands) return;
    addBandAt(ev.clientX, ev.clientY);
  });

  // ===== Filter response helpers (match JSFX) =====
  function biquadMag(coeff, freq, sr){
    const w = 2*Math.PI*freq/sr;
    const c1 = Math.cos(w), s1 = Math.sin(w);
    const c2 = Math.cos(2*w), s2 = Math.sin(2*w);
    const b0=coeff.b0, b1=coeff.b1, b2=coeff.b2, a1=coeff.a1, a2=coeff.a2;
    const numRe = b0 + b1*c1 + b2*c2;
    const numIm = -b1*s1 - b2*s2;
    const denRe = 1 + a1*c1 + a2*c2;
    const denIm = -a1*s1 - a2*s2;
    const num = Math.sqrt(numRe*numRe + numIm*numIm);
    const den = Math.sqrt(denRe*denRe + denIm*denIm);
    return den>0 ? (num/den) : 1;
  }
  function onepoleMag(b0,b1,a1,freq,sr){
    const w = 2*Math.PI*freq/sr;
    const c = Math.cos(w), s = Math.sin(w);
    const zr = c, zi = -s; // z^-1
    const numRe = b0 + b1*zr;
    const numIm = b1*zi;
    const denRe = 1 + a1*zr;
    const denIm = a1*zi;
    const num = Math.sqrt(numRe*numRe + numIm*numIm);
    const den = Math.sqrt(denRe*denRe + denIm*denIm);
    return den>0 ? (num/den) : 1;
  }

  function coeffPeak(fc, q, gainDB, sr){
    const A = Math.pow(10, gainDB/40);
    const w0 = 2*Math.PI*fc/sr;
    const alpha = Math.sin(w0)/(2*Math.max(0.0001,q));
    const c = Math.cos(w0);
    let b0 = 1 + alpha*A;
    let b1 = -2*c;
    let b2 = 1 - alpha*A;
    let a0 = 1 + alpha/A;
    let a1 = -2*c;
    let a2 = 1 - alpha/A;
    b0/=a0; b1/=a0; b2/=a0; a1/=a0; a2/=a0;
    return {b0,b1,b2,a1,a2};
  }
  function coeffHP(fc, q, sr){
    const w0 = 2*Math.PI*fc/sr;
    const alpha = Math.sin(w0)/(2*Math.max(0.0001,q));
    const c = Math.cos(w0);
    let b0 = (1+c)/2;
    let b1 = -(1+c);
    let b2 = (1+c)/2;
    let a0 = 1+alpha;
    let a1 = -2*c;
    let a2 = 1-alpha;
    b0/=a0; b1/=a0; b2/=a0; a1/=a0; a2/=a0;
    return {b0,b1,b2,a1,a2};
  }
  function coeffLP(fc, q, sr){
    const w0 = 2*Math.PI*fc/sr;
    const alpha = Math.sin(w0)/(2*Math.max(0.0001,q));
    const c = Math.cos(w0);
    let b0 = (1-c)/2;
    let b1 = 1-c;
    let b2 = (1-c)/2;
    let a0 = 1+alpha;
    let a1 = -2*c;
    let a2 = 1-alpha;
    b0/=a0; b1/=a0; b2/=a0; a1/=a0; a2/=a0;
    return {b0,b1,b2,a1,a2};
  }
  function coeffLowShelf(fc, S, gainDB, sr){
    const A = Math.pow(10, gainDB/40);
    const w0 = 2*Math.PI*fc/sr;
    const cw = Math.cos(w0), sw = Math.sin(w0);
    S = Math.max(0.0001, S);
    const alpha = sw/2 * Math.sqrt((A + 1/A) * (1/S - 1) + 2);
    const beta = 2*Math.sqrt(A)*alpha;

    let b0 = A*((A+1) - (A-1)*cw + beta);
    let b1 = 2*A*((A-1) - (A+1)*cw);
    let b2 = A*((A+1) - (A-1)*cw - beta);
    let a0 = (A+1) + (A-1)*cw + beta;
    let a1 = -2*((A-1) + (A+1)*cw);
    let a2 = (A+1) + (A-1)*cw - beta;

    b0/=a0; b1/=a0; b2/=a0; a1/=a0; a2/=a0;
    return {b0,b1,b2,a1,a2};
  }
  function coeffHighShelf(fc, S, gainDB, sr){
    const A = Math.pow(10, gainDB/40);
    const w0 = 2*Math.PI*fc/sr;
    const cw = Math.cos(w0), sw = Math.sin(w0);
    S = Math.max(0.0001, S);
    const alpha = sw/2 * Math.sqrt((A + 1/A) * (1/S - 1) + 2);
    const beta = 2*Math.sqrt(A)*alpha;

    let b0 = A*((A+1) + (A-1)*cw + beta);
    let b1 = -2*A*((A-1) + (A+1)*cw);
    let b2 = A*((A+1) + (A-1)*cw - beta);
    let a0 = (A+1) - (A-1)*cw + beta;
    let a1 = 2*((A-1) - (A+1)*cw);
    let a2 = (A+1) - (A-1)*cw - beta;

    b0/=a0; b1/=a0; b2/=a0; a1/=a0; a2/=a0;
    return {b0,b1,b2,a1,a2};
  }
  function onepoleCoefsLP(fc, sr){
    const k = Math.tan(Math.PI*fc/sr);
    const b0 = k/(1+k);
    const b1 = b0;
    const a1 = (k-1)/(k+1);
    return {b0,b1,a1};
  }
  function onepoleCoefsHP(fc, sr){
    const k = Math.tan(Math.PI*fc/sr);
    const b0 = 1/(1+k);
    const b1 = -b0;
    const a1 = (k-1)/(k+1);
    return {b0,b1,a1};
  }

  // ===== Draw =====
  function draw(){
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(10, Math.floor(rect.width));
    const h = Math.max(10, Math.floor(rect.height));
    canvas.width = Math.floor(w*dpr);
    canvas.height = Math.floor(h*dpr);
    canvas.style.width = w+"px";
    canvas.style.height = h+"px";
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,w,h);

    // grid (Pro-Q-ish)
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(255,255,255,.08)";
    ctx.lineWidth = 1;

    const hzLines = [20,50,100,200,500,1000,2000,5000,10000,20000];
    hzLines.forEach(f=>{
      const x = freqToX(f,w);
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
    });
    for (let db=-12; db<=12; db+=6){
      const y = gainToY(db,h);
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,180,64,.85)";
    ctx.beginPath(); ctx.moveTo(0,gainToY(0,h)); ctx.lineTo(w,gainToY(0,h)); ctx.stroke();

    remap();

    const sr = 48000; // UI-only. close enough for shape.
    const pOut = getP(idx.outGain);
    const outGain = pOut ? rawFromParam(pOut, -18, 18) : 0;

    const bandEnabled = (id)=>{
      const pOn = getOnParamFor(id);
      return pOn ? ((pOn.value||0) >= 0.5) : false;
    };

    // ---- Spectrum overlay ----
    const pSpec = getP(idx.specOn);
    const specOn2 = pSpec ? ((pSpec.value||0) >= 0.5) : false;
    if (specOn2 && idx.specBins && idx.specBins.length){
      const binCount = idx.specBins.length;
      const fMin = 20;
      const fMax = 20000;
      const dbMin = -90;
      const dbMax = 12;
      const tiltRef = 1000;
      const tiltDbPerOct = 1.5;
      const dbRange = dbMax - dbMin;
      const yForSpec = (db)=> (1 - ((db - dbMin) / dbRange)) * h;
      if (!specSmooth || specSmooth.length !== binCount){
        specSmooth = new Array(binCount).fill(0);
      }
      const bins = new Array(binCount);
      for (let i=0;i<binCount;i++){
        const pp = getP(idx.specBins[i]);
        bins[i] = pp ? clamp01(pp.value||0) : 0;
      }
      for (let i=0;i<binCount;i++){
        const t = i / Math.max(1, binCount - 1);
        const lowBoost = Math.pow(1 - t, 0.35);
        const cur = specSmooth[i];
        const target = bins[i];
        const attack = 0.55 + 0.35 * lowBoost;
        const decay = 0.08 + 0.12 * (1 - lowBoost);
        const a = target > cur ? attack : decay;
        specSmooth[i] = cur + (target - cur) * a;
      }
      const spatial = specSmooth.map((v,i)=>{
        const v0 = specSmooth[Math.max(0,i-1)];
        const v1 = specSmooth[Math.min(binCount-1,i+1)];
        return (v0 + v*2 + v1) / 4;
      });

      const catmull = (p0,p1,p2,p3,t)=>{
        const t2 = t*t;
        const t3 = t2*t;
        return 0.5 * ((2*p1) + (-p0+p2)*t + (2*p0-5*p1+4*p2-p3)*t2 + (-p0+3*p1-3*p2+p3)*t3);
      };

      const stepsPerBin = allowAddBands ? 10 : 7;
      const steps = (binCount - 1) * stepsPerBin;
      ctx.save();
      ctx.strokeStyle = "rgba(235,235,235,.55)";
      ctx.lineWidth = 1.35;
      ctx.shadowColor = "rgba(255,255,255,.20)";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      for (let i=0;i<=steps;i++){
        const t = i / Math.max(1, steps);
        const tWarp = Math.pow(t, 0.6);
        const raw = tWarp * (binCount - 1);
        const idx1 = Math.floor(raw);
        const frac = raw - idx1;
        const idx0 = Math.max(0, idx1 - 1);
        const idx2 = Math.min(binCount - 1, idx1 + 1);
        const idx3 = Math.min(binCount - 1, idx1 + 2);
        const v = catmull(spatial[idx0], spatial[idx1], spatial[idx2], spatial[idx3], frac);
        const f = fMin * Math.pow(fMax/fMin, raw / Math.max(1,(binCount - 1)));
        const x = freqToX(f, w);
        const tilt = tiltDbPerOct * Math.log2(Math.max(1, f) / tiltRef);
        let db = dbMin + clamp01(v) * (0 - dbMin) + tilt;
        db = clamp(db, dbMin, dbMax);
        const y = yForSpec(db);
        if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.stroke();
      ctx.restore();

      const fillGrad = ctx.createLinearGradient(0, yForSpec(0), 0, h);
      fillGrad.addColorStop(0, "rgba(255,255,255,.18)");
      fillGrad.addColorStop(0.65, "rgba(255,255,255,.08)");
      fillGrad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.globalAlpha = 0.12;
      ctx.lineTo(w,h); ctx.lineTo(0,h); ctx.closePath();
      ctx.fillStyle = fillGrad;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // ---- Build per-band curves (colored) + sum curve (white) ----
    const N = 480;
    const sum = new Array(N).fill(1);

    const drawBandCurve = (magArr, color)=>{
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.70;
      ctx.beginPath();
      for (let i=0;i<N;i++){
        const x = (i/(N-1))*w;
        const f = xToFreq(x,w);
        const m = magArr[i];
        let db = 20*Math.log10(Math.max(1e-6,m));
        db = clamp(db, DB_MIN, DB_MAX);
        const y = gainToY(db, h);
        if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    const applyToSum = (magArr)=>{
      for (let i=0;i<N;i++) sum[i] *= magArr[i];
    };

    const makeMagArr = (fnMag)=>{
      const arr = new Array(N);
      for (let i=0;i<N;i++){
        const x = (i/(N-1))*w;
        const f = xToFreq(x,w);
        arr[i] = fnMag(f);
      }
      return arr;
    };

    // LC
    if (bandEnabled("LC")){
      const pf = getP(idx.lcFreq);
      const ps = getP(idx.lcSlope);
      const fc = pf ? rawFromParam(pf, 20, 20000) : 80;
      const slope = ps ? Math.round(rawFromParam(ps, 0, 3)) : 2;

      const arr = makeMagArr((f)=>{
        let m = 1;
        if (slope===0){
          m *= biquadMag(coeffHP(fc, 0.70710678, sr), f, sr);
        } else if (slope===1){
          const op = onepoleCoefsHP(fc, sr);
          m *= onepoleMag(op.b0, op.b1, op.a1, f, sr);
          m *= biquadMag(coeffHP(fc, 1.0, sr), f, sr);
        } else if (slope===2){
          m *= biquadMag(coeffHP(fc, 0.54119610, sr), f, sr);
          m *= biquadMag(coeffHP(fc, 1.30656296, sr), f, sr);
        } else {
          m *= biquadMag(coeffHP(fc, 0.51763809, sr), f, sr);
          m *= biquadMag(coeffHP(fc, 0.70710678, sr), f, sr);
          m *= biquadMag(coeffHP(fc, 1.93185165, sr), f, sr);
        }
        return m;
      });
      applyToSum(arr);
      drawBandCurve(arr, "rgba(215,215,215,.9)");
    }

    // Bands B1..B4
    for (let bn=1; bn<=maxBands; bn++){
      const id = "B"+bn;
      if (!bandEnabled(id)) continue;

      const slot = idx.bands[bn-1];
      const pf = slot ? getP(slot.freq) : null;
      const pg = slot ? getP(slot.gain) : null;
      const pq = slot ? getP(slot.q) : null;
      const pt = slot ? getP(slot.type) : null;

      const fc = pf ? rawFromParam(pf, 20, 20000) : 1000;
      const gd = pg ? rawFromParam(pg, -18, 18) : 0;
      const qv = pq ? rawFromParam(pq, 0.2, 10) : 1;
      const type = pt ? Math.round(rawFromParam(pt, 0, 3)) : 0;
      const S = clamp(qv, 0.2, 10);

      const def = pointDefs.find(d=>d.id===id);
      const col = def ? def.color : "#fff";

      const arr = makeMagArr((f)=>{
        let m = 1;
        if (type===0){
          m *= biquadMag(coeffPeak(fc, Math.max(0.2,qv), gd, sr), f, sr);
        }else if (type===1){
          m *= biquadMag(coeffLowShelf(fc, S, gd, sr), f, sr);
        }else if (type===2){
          m *= biquadMag(coeffHighShelf(fc, S, gd, sr), f, sr);
        }else{
          m *= biquadMag(coeffLowShelf(fc, S, -gd*0.5, sr), f, sr);
          m *= biquadMag(coeffHighShelf(fc, S, gd*0.5, sr), f, sr);
        }
        return m;
      });
      applyToSum(arr);
      drawBandCurve(arr, col);
    }

    // HC
    if (bandEnabled("HC")){
      const pf = getP(idx.hcFreq);
      const ps = getP(idx.hcSlope);
      const fc = pf ? rawFromParam(pf, 20, 20000) : 12000;
      const slope = ps ? Math.round(rawFromParam(ps, 0, 3)) : 2;

      const arr = makeMagArr((f)=>{
        let m = 1;
        if (slope===0){
          m *= biquadMag(coeffLP(fc, 0.70710678, sr), f, sr);
        } else if (slope===1){
          const op = onepoleCoefsLP(fc, sr);
          m *= onepoleMag(op.b0, op.b1, op.a1, f, sr);
          m *= biquadMag(coeffLP(fc, 1.0, sr), f, sr);
        } else if (slope===2){
          m *= biquadMag(coeffLP(fc, 0.54119610, sr), f, sr);
          m *= biquadMag(coeffLP(fc, 1.30656296, sr), f, sr);
        } else {
          m *= biquadMag(coeffLP(fc, 0.51763809, sr), f, sr);
          m *= biquadMag(coeffLP(fc, 0.70710678, sr), f, sr);
          m *= biquadMag(coeffLP(fc, 1.93185165, sr), f, sr);
        }
        return m;
      });
      applyToSum(arr);
      drawBandCurve(arr, "rgba(215,215,215,.9)");
    }

    // Sum curve
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = "rgba(255,255,255,.92)";
    ctx.beginPath();
    for (let i=0;i<N;i++){
      const x = (i/(N-1))*w;
      let db = 20*Math.log10(Math.max(1e-6, sum[i])) + outGain;
      db = clamp(db, DB_MIN, DB_MAX);
      const y = gainToY(db,h);
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();

    ctx.globalAlpha = 0.10;
    ctx.lineTo(w, gainToY(0,h));
    ctx.lineTo(0, gainToY(0,h));
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,.9)";
    ctx.fill();
    ctx.globalAlpha = 1;

    // Points positions & states
    pointDefs.forEach(def=>{
      const el = pointEls[def.id];
      if (!el) return;
      const pOn = getOnParamFor(def.id);
      const isOn = pOn ? ((pOn.value||0) >= 0.5) : false;
      const isDeleted = allowAddBands && isBandId(def.id) && deletedBands.has(def.id);

      const pf = getFreqParamFor(def.id);
      const f = pf ? rawFromParam(pf, 20, 20000) : (def.id==="LC"?80:def.id==="HC"?12000:1000);
      let x = freqToX(f,w);
      let y = gainToY(0,h);

      if (def.id.startsWith("B")){
        const pg = getGainParamFor(def.id);
        const g = pg ? rawFromParam(pg, -18, 18) : 0;
        y = gainToY(clamp(g, DB_MIN, DB_MAX), h);
      }
      el.style.left = x+"px";
      el.style.top = y+"px";
      el.classList.toggle("sel", selected === def.id);
      el.classList.toggle("off", !isOn);
      if (isDeleted && !isOn){
        el.classList.add("hidden");
      } else {
        el.classList.remove("hidden");
      }
    });
  }

  // ===== Update panel =====
  function updatePanel(){
    remap();
    ensureSelectedActive();

    ttlName.textContent = selected;

    const pf = getFreqParamFor(selected);
    const pg = getGainParamFor(selected);
    const pq = getQParamFor(selected);
    const pOn = getOnParamFor(selected);

    const f = pf ? rawFromParam(pf, 20, 20000) : 1000;
    const g = pg ? rawFromParam(pg, -18, 18) : 0;
    const q = pq ? rawFromParam(pq, 0.2, 10) : 1;

    // sub line
    const parts = [];
    parts.push(f.toFixed(0));
    if (selected.startsWith("B")) parts.push(g.toFixed(1));
    parts.push(q.toFixed(2));
    ttlSub.textContent = parts.join(" • ");

    // on/off
    const isOn = pOn ? ((pOn.value||0) >= 0.5) : false;
    toggleBtn.textContent = isOn ? "On" : "Off";
    toggleBtn.classList.toggle("on", isOn);

    // knobs
    const setKnob = (k, v, text)=>{
      const valEl = knobEls[k].querySelector(".rmEqKnobVal");
      valEl.textContent = text;
      const t = knobValueToNorm(k, v);
      setKnobAngle(k, t);
      knobEls[k].classList.toggle("disabled", (k!=="freq" && !selected.startsWith("B")));
    };
    setKnob("freq", f, f>=1000 ? (f/1000).toFixed(2)+"k" : f.toFixed(0));
    setKnob("gain", g, g.toFixed(1));
    setKnob("q", q, q.toFixed(2));

    // type vs slope block
    if (selected.startsWith("B")){
      if (deleteBtn){
        deleteBtn.style.display = allowAddBands ? "" : "none";
        deleteBtn.disabled = !isOn;
      }
      typeBtnsWrap.style.display = "";
      slopeBtnsWrap.style.display = "none";

      const pt = getTypeParamFor(selected);
      const t = pt ? Math.round(rawFromParam(pt, 0, 3)) : 0;
      typeBtnsWrap.querySelectorAll("button").forEach(b=>{
        b.classList.toggle("on", parseInt(b.getAttribute("data-type"),10) === t);
      });

      knobEls.q.querySelector(".rmEqKnobLab").textContent = (t===1 || t===2 || t===3) ? "SLOPE" : "Q";
    }else{
      if (deleteBtn){
        deleteBtn.style.display = "none";
        deleteBtn.disabled = true;
      }
      typeBtnsWrap.style.display = "none";
      slopeBtnsWrap.style.display = "";

      const ps = getSlopeParamFor(selected);
      const s = ps ? Math.round(rawFromParam(ps, 0, 3)) : 2;
      slopeBtnsWrap.querySelectorAll("button").forEach(b=>{
        b.classList.toggle("on", parseInt(b.getAttribute("data-slope"),10) === s);
      });

      knobEls.gain.classList.add("disabled");
      knobEls.q.classList.add("disabled");
      knobEls.q.querySelector(".rmEqKnobLab").textContent = "SLOPE";
    }

    // output
    const pOut = getP(idx.outGain);
    const og = pOut ? rawFromParam(pOut, -18, 18) : 0;
    outSl.value = String(clamp(og, -18, 18));
    outVal.textContent = pOut ? formatParam(pOut) : (og.toFixed(1)+" dB");

    // spectrum toggle
    const pSpec = getP(idx.specOn);
    const sOn = pSpec ? ((pSpec.value||0) >= 0.5) : false;
    specBtn.classList.toggle("on", sOn);

    if (addBtn && allowAddBands){
      const next = findNextAvailableBand();
      addBtn.disabled = !next;
      addBtn.title = next ? "Add band" : "All bands used";
    }
  }

  // ===== Init / observers =====
  try{
    const ro = new ResizeObserver(()=>{ placePointPanel(); draw(); });
    ro.observe(wrap);
    root._ro = ro;
  }catch(_){}

  const update = ()=>{
    updatePanel();
    draw();
  };

  remap();
  setSnapUI();
  updatePanel();
  draw();
  return {el: root, update, ctrl};
}


function buildReaCompPanelControl(win, ctrl){
    const ex = ctrl.extra || {};
    const root = document.createElement("div");
    root.className = "reacompPanel";
    root.innerHTML = `<div style="font-weight:900; opacity:.85; margin:0 0 10px 2px;">ReaComp</div>`;
    const grid = document.createElement("div");
    grid.className = "rcGrid";
    root.appendChild(grid);

    // --- Left: Threshold vertical + meters ---
    const colL = document.createElement("div");
    colL.className = "rcCard rcThreshold";
    colL.innerHTML = `<div class="rcTitle">Threshold</div>
      <div class="rcVTrack"><div class="rcVFill"></div><div class="rcVThumb" title="Drag"></div></div>
      <div class="val" style="width:100%; text-align:center; border-radius:10px;">—</div>
      <div class="rcMeterCol"></div>
    `;
    const vTrack = colL.querySelector(".rcVTrack");
    const vFill = colL.querySelector(".rcVFill");
    const vThumb = colL.querySelector(".rcVThumb");
    const vVal = colL.querySelector(".val");
    const metersWrap = colL.querySelector(".rcMeterCol");

    const mLR = buildTrackMeterLRControl(win, {type:"trackMeterLR", label:"IN", source:"track"});
    metersWrap.appendChild(mLR.el);

    // --- Middle: main controls (Envelope + Detector filters) ---
    const colM = document.createElement("div");
    colM.style.display = "flex";
    colM.style.flexDirection = "column";
    colM.style.gap = "12px";

    const cardEnv = document.createElement("div");
    cardEnv.className = "rcCard";
    cardEnv.innerHTML = `<div class="rcTitle">Envelope</div>`;
    const envRows = [];

    function mkHRow(label, patterns){
      const row = document.createElement("div");
      row.className = "rcHRow";
      row.innerHTML = `<div class="lbl">${escapeHtml(label)}</div>
        <input type="range" min="0" max="1" step="0.001" value="0">
        <div class="val">—</div>`;
      const sl = row.querySelector("input");
      const v = row.querySelector(".val");
      const obj = {row, sl, v, patterns, p:null, lastSent:0};
      sl.addEventListener("input", ()=>{
        const p = findParamByPatterns(win.params, patterns);
        if (!p) return;
        suppressPoll(win, 700);
        const nv = parseFloat(sl.value);
        p.value = nv;
        if (v) v.textContent = formatParam(p);
        const now = performance.now();
        if (now - obj.lastSent > 25){
          obj.lastSent = now;
          wsSend({type:"setFxParam", guid: win.guid, fxIndex: win.fxIndex, param: p.index, value: nv});
        }
      });
      envRows.push(obj);
      return row;
    }

    cardEnv.appendChild(mkHRow("Pre-comp", ex.precompFind||[]));
    cardEnv.appendChild(mkHRow("Attack", ex.attackFind||[]));
    cardEnv.appendChild(mkHRow("Release", ex.releaseFind||[]));

    const cardDet = document.createElement("div");
    cardDet.className = "rcCard";
    cardDet.innerHTML = `<div class="rcTitle">Detector</div>`;
    const detRows = [];
    function mkHRow2(label, patterns){
      const row = mkHRow(label, patterns);
      detRows.push(envRows[envRows.length-1]);
      return row;
    }
    cardDet.appendChild(mkHRow2("Ratio", ex.ratioFind||[]));
    cardDet.appendChild(mkHRow2("Knee size", ex.kneeFind||[]));
    cardDet.appendChild(mkHRow2("Lowpass", ex.lowpassFind||[]));
    cardDet.appendChild(mkHRow2("Highpass", ex.highpassFind||[]));
    cardDet.appendChild(mkHRow2("RMS size", ex.rmsFind||[]));

    colM.appendChild(cardEnv);
    colM.appendChild(cardDet);

    // --- Right: Output mix + checkboxes + GR meter ---
    const colR = document.createElement("div");
    colR.style.display = "flex";
    colR.style.flexDirection = "column";
    colR.style.gap = "12px";

    const cardMix = document.createElement("div");
    cardMix.className = "rcCard";
    cardMix.innerHTML = `<div class="rcTitle">Output mix</div>`;
    const mixGrid = document.createElement("div");
    mixGrid.style.display = "grid";
    mixGrid.style.gridTemplateColumns = "1fr 1fr";
    mixGrid.style.gap = "10px";

    function mkMiniV(label, patterns){
      const box = document.createElement("div");
      box.style.display="flex"; box.style.flexDirection="column"; box.style.alignItems="center"; box.style.gap="8px";
      box.innerHTML = `<div class="lbl" style="font-size:12px; opacity:.85;">${escapeHtml(label)}</div>
        <div class="rcVTrack" style="height:190px; width:40px;"><div class="rcVFill"></div><div class="rcVThumb" style="width:70px;"></div></div>
        <div class="val" style="width:100%; text-align:center;">—</div>`;
      const tr = box.querySelector(".rcVTrack");
      const fill = box.querySelector(".rcVFill");
      const th = box.querySelector(".rcVThumb");
      const val = box.querySelector(".val");
      let drag = null;
      let lastSent = 0;

      const setUI = (n, fmtStr)=>{
        const cl = Math.max(0, Math.min(1, n));
        fill.style.height = (cl*100)+"%";
        th.style.top = ((1-cl)*100)+"%";
        val.textContent = fmtStr || "—";
      };

      th.addEventListener("pointerdown", (ev)=>{
        const p = findParamByPatterns(win.params, patterns);
        if (!p) return;
        if (ev.button!==0) return;
        bringPluginToFront(win);
        suppressPoll(win, 700);
        drag = {id: ev.pointerId};
        th.setPointerCapture(ev.pointerId);
        ev.preventDefault();
      });
      th.addEventListener("pointermove", (ev)=>{
        if (!drag || ev.pointerId!==drag.id) return;
        const p = findParamByPatterns(win.params, patterns);
        if (!p) return;
        const r = tr.getBoundingClientRect();
        const y = Math.max(r.top, Math.min(r.bottom, ev.clientY));
        const n = 1 - ((y - r.top)/Math.max(1, r.height));
        const v = Math.max(0, Math.min(1, n));
        setUI(v, formatParam(p));
        const now = performance.now();
        if (now - lastSent > 35){
          lastSent = now;
          suppressPoll(win, 700);
          wsSend({type:"setFxParam", guid: win.guid, fxIndex: win.fxIndex, param: p.index, value: v});
        }
      });
      const end = (ev)=>{ if (drag && ev.pointerId===drag.id) drag=null; };
      th.addEventListener("pointerup", end);
      th.addEventListener("pointercancel", ()=>{ drag=null; });

      const update = ()=>{
        const p = findParamByPatterns(win.params, patterns);
        if (!p){ setUI(0, "—"); return; }
        setUI(p.value||0, formatParam(p));
      };
      update();
      return {el: box, update};
    }

    const wetV = mkMiniV("Wet", ex.wetFind||[]);
    const dryV = mkMiniV("Dry", ex.dryFind||[]);
    mixGrid.appendChild(wetV.el);
    mixGrid.appendChild(dryV.el);
    cardMix.appendChild(mixGrid);

    // GR meter (ReaComp doesn't expose GR as a parameter; we estimate GR from input level + threshold/ratio)
    const grCard = document.createElement("div");
    grCard.className = "rcCard";
    grCard.innerHTML = `<div class="rcTitle">Gain reduction</div>
      <div style="display:flex; justify-content:center; gap:10px;">
        <div class="pMeter" style="width:16px; min-height:160px;"><div class="pMeterFill"></div></div>
      </div>`;
    const grFill = grCard.querySelector(".pMeterFill");

    let grTarget = 0;
    let grCur = 0;
    const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));
    const normToDb = (p)=>{
      if (!p) return 0;
      // Prefer raw/min/max provided by backend; fallback to mapping 0..1 -> [-60..0] dB
      if (p.raw != null) return Number(p.raw);
      const mn = (p.min!=null)?Number(p.min):-60;
      const mx = (p.max!=null)?Number(p.max):0;
      return mn + (Number(p.value||0) * (mx-mn));
    };
    const normToRatio = (p)=>{
      if (!p) return 1;
      if (p.raw != null) return Math.max(1, Number(p.raw));
      // ReaComp ratio is typically 1..20
      const mn = (p.min!=null)?Number(p.min):1;
      const mx = (p.max!=null)?Number(p.max):20;
      return Math.max(1, mn + (Number(p.value||0) * (mx-mn)));
    };
    const computeGRdb = (pkL, pkR)=>{
      const pk = Math.max(pkL||0, pkR||0);
      const inDb = (pk<=0) ? -120 : (20*Math.log10(pk));
      const pTh = findParamByPatterns(win.params, ex.thresholdFind||[]);
      const pRa = findParamByPatterns(win.params, ex.ratioFind||[]);
      const thDb = normToDb(pTh);
      const ratio = normToRatio(pRa);
      const over = inDb - thDb;
      if (over <= 0) return 0;
      const gr = over * (1 - (1/ratio));
      return clamp(gr, 0, 24);
    };

    const checks = document.createElement("div");
    checks.className = "rcCard";
    checks.innerHTML = `<div class="rcTitle">Options</div><div class="rcChecks"></div>`;
    const checksInner = checks.querySelector(".rcChecks");

    function mkCheck(label, patterns){
      const lab = document.createElement("label");
      lab.innerHTML = `<input type="checkbox"><span>${escapeHtml(label)}</span>`;
      const cb = lab.querySelector("input");
      cb.addEventListener("change", ()=>{
        const p = findParamByPatterns(win.params, patterns);
        if (!p) return;
        suppressPoll(win, 700);
        const v = cb.checked ? 1 : 0;
        wsSend({type:"setFxParam", guid: win.guid, fxIndex: win.fxIndex, param: p.index, value: v});
      });
      return {lab, cb, patterns, update: ()=>{
        const p = findParamByPatterns(win.params, patterns);
        if (!p){ cb.checked = false; cb.disabled = true; return; }
        cb.disabled = false;
        cb.checked = (p.value||0) >= 0.5;
      }};
    }

    const cAutoRel = mkCheck("Auto release", ex.autoReleaseFind||[]);
    const cPrev    = mkCheck("Preview filter", ex.previewFind||[]);
    const cMakeup  = mkCheck("Auto make-up", ex.makeupFind||[]);
    const cLimit   = mkCheck("Limit output", ex.limitOutFind||[]);
    [cAutoRel, cPrev, cMakeup, cLimit].forEach(c=>checksInner.appendChild(c.lab));

    colR.appendChild(cardMix);
    colR.appendChild(grCard);
    colR.appendChild(checks);

    grid.appendChild(colL);
    grid.appendChild(colM);
    grid.appendChild(colR);

    // threshold drag
    let dragT = null;
    let lastSentT = 0;
    const setThreshUI = (n, fmt)=>{
      const cl = Math.max(0, Math.min(1, n));
      vFill.style.height = (cl*100)+"%";
      vThumb.style.top = ((1-cl)*100)+"%";
      vVal.textContent = fmt || "—";
    };

    vThumb.addEventListener("pointerdown", (ev)=>{
      const p = findParamByPatterns(win.params, ex.thresholdFind||[]);
      if (!p) return;
      if (ev.button!==0) return;
      bringPluginToFront(win);
      suppressPoll(win, 700);
      dragT = {id: ev.pointerId};
      vThumb.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    vThumb.addEventListener("pointermove", (ev)=>{
      if (!dragT || ev.pointerId!==dragT.id) return;
      const p = findParamByPatterns(win.params, ex.thresholdFind||[]);
      if (!p) return;
      const r = vTrack.getBoundingClientRect();
      const y = Math.max(r.top, Math.min(r.bottom, ev.clientY));
      const n = 1 - ((y - r.top)/Math.max(1, r.height));
      const v = Math.max(0, Math.min(1, n));
      setThreshUI(v, formatParam(p));
      const now = performance.now();
      if (now - lastSentT > 35){
        lastSentT = now;
        suppressPoll(win, 700);
        wsSend({type:"setFxParam", guid: win.guid, fxIndex: win.fxIndex, param: p.index, value: v});
      }
    });
    const endT = (ev)=>{ if (dragT && ev.pointerId===dragT.id) dragT=null; };
    vThumb.addEventListener("pointerup", endT);
    vThumb.addEventListener("pointercancel", ()=>{ dragT=null; });

    const update = ()=>{
      // threshold
      const pt = findParamByPatterns(win.params, ex.thresholdFind||[]);
      if (pt) setThreshUI(pt.value||0, formatParam(pt)); else setThreshUI(0, "—");

      // hrows
      for (const r of envRows){
        const p = findParamByPatterns(win.params, r.patterns||[]);
        if (!p){ r.sl.disabled = true; r.v.textContent = "—"; continue; }
        r.sl.disabled = false;
        r.sl.value = p.value;
        r.v.textContent = formatParam(p);
      }
      // checkboxes
      cAutoRel.update(); cPrev.update(); cMakeup.update(); cLimit.update();
      // meters
      try{ mLR.update(); }catch(_){}

      // Smooth estimated GR
      grCur += (grTarget - grCur) * 0.22;
      if (grFill) grFill.style.height = (clamp(grCur/24, 0, 1)*100) + "%";

      wetV.update(); dryV.update();
    };

    const updateTrackMeter = (pkL, pkR)=>{
      grTarget = computeGRdb(pkL, pkR);
    };

    update();
    return {el: root, update, updateTrackMeter, ctrl};
  }



  function buildParamMeterControl(win, ctrl){
    const card = document.createElement("div");
    card.className = "plugCtrl pmeter";
    const lbl = document.createElement("div");
    lbl.className = "clbl";
    lbl.textContent = ctrl.label || "Meter";
    const meter = document.createElement("div");
    meter.className = "pMeter";
    const fill = document.createElement("div");
    fill.className = "pMeterFill";
    meter.appendChild(fill);
    const vtxt = document.createElement("div");
    vtxt.className = "cval";
    vtxt.textContent = "—";
    card.appendChild(lbl);
    card.appendChild(meter);
    card.appendChild(vtxt);

    const update = ()=>{
      const p = getParamForCtrl(win, ctrl);
      if (!p){ fill.style.height = "0%"; vtxt.textContent = "—"; return; }
      const v = Math.max(0, Math.min(1, p.value||0));
      fill.style.height = (v*100) + "%";
      vtxt.textContent = formatParam(p);
    };
    update();
    return {el: card, update, ctrl};
  }

  function buildTrackMeterLRControl(win, ctrl){
    const card = document.createElement("div");
    card.className = "plugCtrl pmeter";
    const lbl = document.createElement("div");
    lbl.className = "clbl";
    lbl.textContent = ctrl.label || "Track";
    const wrap = document.createElement("div");
    wrap.className = "pTrackMeterLR";
    const mL = document.createElement("div");
    mL.className = "pMeter";
    const fL = document.createElement("div");
    fL.className = "pMeterFill";
    mL.appendChild(fL);
    const mR = document.createElement("div");
    mR.className = "pMeter";
    const fR = document.createElement("div");
    fR.className = "pMeterFill";
    mR.appendChild(fR);
    wrap.appendChild(mL); wrap.appendChild(mR);

    const vtxt = document.createElement("div");
    vtxt.className = "cval";
    vtxt.textContent = "";

    card.appendChild(lbl);
    card.appendChild(wrap);
    card.appendChild(vtxt);

    const updateTrackMeter = (pkL, pkR)=>{
      const l = Math.max(0, Math.min(1, pkL||0));
      const r = Math.max(0, Math.min(1, pkR||0));
      fL.style.height = (l*100) + "%";
      fR.style.height = (r*100) + "%";
    };

    const update = ()=>{
      // fallback: use latest cached meter values if available
      try{
        const prev = meterEls.get(win.guid);
        if (prev) updateTrackMeter(prev.pL, prev.pR);
      }catch(_){}
    };
    update();
    return {el: card, update, updateTrackMeter, ctrl};
  }

  function buildToggleControl(win, ctrl){
    const card = document.createElement("div");
    card.className = "plugCtrl";
    const btn = document.createElement("button");
    btn.className = "plugBtn";
    btn.textContent = ctrl.label || "Toggle";
    const val = document.createElement("div");
    val.className = "cval";
    val.textContent = "";
    card.appendChild(btn);
    card.appendChild(val);

    const update = ()=>{
      const p = getParamForCtrl(win, ctrl);
      if (!p){ btn.classList.remove("on"); val.textContent = "—"; return; }
      btn.textContent = ctrl.label || String(p.name||"Toggle");
      const on = (p.value||0) >= 0.5;
      btn.classList.toggle("on", on);
      val.textContent = formatParam(p);
    };
    update();

    btn.addEventListener("click", ()=>{
      const p = getParamForCtrl(win, ctrl);
      if (!p) return;
      bringPluginToFront(win);
      suppressPoll(win);
      const next = ((p.value||0) >= 0.5) ? 0.0 : 1.0;
      update();
      setParamNormalized(win, p.index, next);
    });
    return {el: card, update, ctrl};
  }

  const LAYOUT_SCALE_IDS = new Set(["ns1", "rm_ns", "rm_gate", "rm_delaymachine", "rm_air", "rm_deesser", "rm_vox", "rm_kicker50hz", "rm_comp2", "rm_limiter2","rm_preamp"]);

  function clearLayoutScale(win){
    if (!win || !win._layoutUI) return;
    const ui = win._layoutUI;
    if (ui.scaleObserver){
      try{ ui.scaleObserver.disconnect(); }catch(_){}
      ui.scaleObserver = null;
    }
  }

  function setupLayoutScale(win, container){
    if (!win || !win._layoutUI || !win._layoutUI.stage) return;
    const ui = win._layoutUI;
    if (ui.scaleObserver) return;
    const stage = ui.stage;
    const scope = container || stage.closest(".pluginWinBody");
    if (!scope) return;

    const fit_7391 = ()=>{
      if (!ui.baseW || !ui.baseH){
        stage.style.transform = "scale(1)";
        stage.style.width = "auto";
        stage.style.height = "auto";
        const rect = stage.getBoundingClientRect();
        ui.baseW = rect.width || stage.scrollWidth || stage.offsetWidth || 1;
        ui.baseH = rect.height || stage.scrollHeight || stage.offsetHeight || 1;
      }
      const pad = 20;
      const availW = Math.max(10, scope.clientWidth - pad);
      const availH = Math.max(10, scope.clientHeight - pad);
      const scFit = Math.min(availW / ui.baseW, availH / ui.baseH);
      const maxScale = (scope.closest(".pluginWin") && scope.closest(".pluginWin").classList.contains("fullscreen")) ? 1.6 : 1.2;
      const mult = (ui.scaleMult != null) ? Number(ui.scaleMult) : 1;
      // Apply layout multiplier, but never exceed the fit scale (otherwise the UI gets clipped).
      let sc = Math.max(0.5, Math.min(maxScale, scFit)) * (Number.isFinite(mult) ? mult : 1);
      sc = Math.max(0.5, Math.min(sc, scFit));
      stage.style.transform = `scale(${sc})`;
      stage.style.width = ui.baseW + "px";
      stage.style.height = ui.baseH + "px";
      stage.style.margin = "0 auto";
    };

    ui.scaleFit = fit_7391;
    try{
      const ro = new ResizeObserver(()=>fit_7391());
      ro.observe(scope);
      ui.scaleObserver = ro;
    }catch(_){}
    requestAnimationFrame(fit_7391);
  }

  function renderLayoutInto(win, layout, container){
    const useScale = !!(layout && layout.id && LAYOUT_SCALE_IDS.has(layout.id));
    // If we built the UI before params arrived, rebuild once we have params
    // so pattern-based mapping works and we don't get a permanent "Couldn't match..." banner.
    if (win._layoutUI && win._layoutUI.layoutId === layout.id && win._layoutUI.builtWithEmptyParams){
      const hasParamsNow = Array.isArray(win.params) && win.params.length > 0;
      if (hasParamsNow){
        win._layoutUI = null;
        container.innerHTML = "";
      }
    }

    // build once; update on subsequent polls
    if (!win._layoutUI || win._layoutUI.layoutId !== layout.id){
      clearLayoutScale(win);
      win._layoutUI = {
        layoutId: layout.id,
        controls: [],
        builtWithEmptyParams: !(Array.isArray(win.params) && win.params.length > 0),
        stage: null,
        baseW: null,
        baseH: null,
        scaleObserver: null,
        scaleFit: null,
        scaleMult: (layout && layout.scaleMult != null) ? layout.scaleMult : 1,
        useScale,
      };
      container.innerHTML = "";
let foundAny = false;
      let target = container;
      if (useScale){
        const stage = document.createElement("div");
        stage.className = "plugLayoutStage";
        win._layoutUI.stage = stage;
        container.classList.add("layoutScaled");
        container.appendChild(stage);
        target = stage;
      } else {
        container.classList.remove("layoutScaled");
      }
      // If the layout contains a custom panel, we don't require param-name matching.
      // (Those panels can use known indices or do their own mapping.)
      const layoutHasCustomPanel = (layout.sections||[]).some(sec =>
        (sec.controls||[]).some(c => /Panel$/.test(String(c.type||"")))
      );
      for (const sec of (layout.sections||[])){
        const secEl = document.createElement("div");
        secEl.className = "plugSection";
        const st = document.createElement("div");
        st.className = "plugSectionTitle";
        st.textContent = sec.title || "";
        secEl.appendChild(st);

        const grid = document.createElement("div");
        grid.className = "plugGrid";
        if (sec.gridClass) grid.classList.add(sec.gridClass);

        
for (const c of (sec.controls||[])){
  let p = null;
  if (c.find && Array.isArray(c.find) && c.find.length){
    p = findParamByPatterns(win.params, c.find);
  }
  // Custom panels use patterns stored in extra (e.g. thresholdFind, gainFind, etc.)
  if (!p && c.extra && typeof c.extra === "object"){
    for (const k of Object.keys(c.extra)){
      if (!/Find$/.test(k)) continue;
      const arr = c.extra[k];
      if (Array.isArray(arr) && arr.length){
        const pp = findParamByPatterns(win.params, arr);
        if (pp){ p = pp; break; }
      }
    }
  }
  if (p) foundAny = true;
  const ctrl = {pIndex: p ? p.index : -1, patterns: (c.find||null), label: c.label, type: c.type, source: c.source, extra: c.extra||null};
          let ui = null;
          if (c.type === "ns1Panel") ui = buildNS1PanelControl(win, ctrl);
          else if (c.type === "rmGatePanel") ui = buildRMGatePanelControl(win, ctrl);
          else if (c.type === "reacompPanel") ui = buildReaCompPanelControl(win, ctrl);
          else if (c.type === "la1aPanel") ui = buildLA1APanelControl(win, ctrl);
          else if (c.type === "nc76Panel") ui = buildNC76PanelControl(win, ctrl);
          else if (c.type === "preampPanel") ui = buildPreAmpPanelControl(win, ctrl);
          else if (c.type === "rmCompressorPanel") ui = buildRMCompressorPanelControl(win, ctrl);
          else if (c.type === "rmEqProQPanel") ui = buildRMEqProQPanelControl(win, ctrl);
          else if (c.type === "rmL2Panel") ui = buildRML2PanelControl(win, ctrl);
          else if (c.type === "rmKickerL2Panel") ui = buildRMKickerL2PanelControl(win, ctrl);
          else if (c.type === "rmDelayMachinePanel") ui = buildRMDelayMachinePanelControl(win, ctrl);
          else if (c.type === "rmVoxPanel") ui = buildRMVoxPanelControl(win, ctrl);
          else if (c.type === "rmAirPanel") ui = buildRMAirPanelControl(win, ctrl);
          else if (c.type === "rmSaturatorPanel") ui = buildRMSaturatorPanelControl(win, ctrl);
          else if (c.type === "rmEqt1aPanel") ui = buildRMEqt1aPanelControl(win, ctrl);
	          else if (c.type === "rmLexi2Panel") ui = buildRMLexi2PanelControl(win, ctrl);
          else if (c.type === "rmDeesserPanel") ui = buildRMDeesserPanelControl(win, ctrl);
          else if (c.type === "toggle") ui = buildToggleControl(win, ctrl);
          else if (c.type === "vfader") ui = buildVfaderControl(win, ctrl);
          else if (c.type === "paramMeter") ui = buildParamMeterControl(win, ctrl);
          else if (c.type === "trackMeterLR") ui = buildTrackMeterLRControl(win, ctrl);
          else ui = buildKnobControl(win, ctrl);
          win._layoutUI.controls.push(ui);
          grid.appendChild(ui.el);
        }
        secEl.appendChild(grid);
        target.appendChild(secEl);
      }

      const haveParams = Array.isArray(win.params) && win.params.length > 0;
      if (!foundAny && haveParams && !layoutHasCustomPanel){
        const note = document.createElement("div");
        note.className = "plugNote";
        note.innerHTML = `Couldn't match known parameters for this plugin build.<br><br>Use <b>Inspector</b> to view raw params and we can map them.`;
        target.appendChild(note);
      }
      if (useScale) setupLayoutScale(win, container);
    }

    // update: rebind params (in case indices changed) and refresh values
    if (win._layoutUI && win._layoutUI.controls){
      for (const ui of win._layoutUI.controls){
        try{ if (ui && ui.update) ui.update(); }catch(_){ }
      }
    }
  }

  // Tap outside to close fullscreen plugin window (phone)
  pluginOverlay.addEventListener("click", ()=>{
    if (!isPhoneLike()) return;
    for (const k of [...pluginWins.keys()]) closePluginWin(k);
  }, {passive:true});

  const isPhoneLike = () => {
    try{
      // "phoneLandscape" is already our aggressive mobile mode.
      if (document.body.classList.contains("phoneLandscape")) return true;
      return !!window.matchMedia("(max-width: 900px)").matches;
    }catch{ return false; }
  };

  function bringPluginToFront(win){
    pluginZ += 1;
    win.el.style.zIndex = String(pluginZ);
  }

  function closePluginWin(key){
    const win = pluginWins.get(key);
    if (!win) return;
    try{ if (win.pollT) clearInterval(win.pollT); }catch(_){ }
    try{ win.el.remove(); }catch(_){ }
    pluginWins.delete(key);
    // hide overlay if no fullscreen plugin remains
    const anyFullscreen = [...pluginWins.values()].some(w=>w.el.classList.contains("fullscreen"));
    if (!anyFullscreen) pluginOverlay.style.display = "none";
  }

  function getFxNameFromCache(guid, fxIndex){
    try{
      const cached = fxCache.get(guid);
      const list = (cached && cached.fx) ? cached.fx : [];
      const f = list.find(x=>x.index===fxIndex);
      return f ? prettyFxName(f.name||"") : "";
    }catch{ return ""; }
  }

  function renderPluginWin(win){
    const t = trackByGuid.get(win.guid);
    const fxName = getFxNameFromCache(win.guid, win.fxIndex);

    // decide view mode
    const layout = pickLayout(fxName);
    if (!layout) win.viewMode = "raw";
    if (!win.viewMode) win.viewMode = layout ? "layout" : "raw";
    if (layout && win.viewMode === "raw" && !win._viewModeLocked){
      win.viewMode = "layout";
      win._layoutUI = null;
    }

    // view-mode classes (used for mobile/landscape tweaks)
    try{
      win.el.classList.toggle("mode_raw", win.viewMode === "raw");
      win.el.classList.toggle("mode_layout", win.viewMode === "layout");
    }catch(_){ }
    try{
      const isLayout = (win.viewMode === "layout");
      // Toggle layout-specific window classes. Each layout is mapped to ".layout_<id>" in CSS.
      const id = (layout && layout.id) ? String(layout.id) : "";
      for (const L of PLUG_LAYOUTS){
        win.el.classList.toggle("layout_" + L.id, !!(isLayout && id === L.id));
      }
    }catch(_){}


    const title = win.el.querySelector(".pluginTitle");
    if (title){
      const tn = t ? (t.kind==="master" ? "MASTER" : (t.name||"Track")) : "Track";
      title.textContent = fxName ? `${tn} • ${fxName}` : `${tn} • FX #${win.fxIndex}`;
    }

    const toggleBtn = win.el.querySelector("[data-act=toggle]");
    if (toggleBtn){
      const cached = fxCache.get(win.guid);
      const list = (cached && cached.fx) ? cached.fx : [];
      const fx = list.find(f=>f.index===win.fxIndex);
      const enabled = fx ? !!fx.enabled : false;
      toggleBtn.textContent = enabled ? "ON" : "OFF";
      toggleBtn.classList.toggle("on", enabled);
      toggleBtn.disabled = !fx;
      toggleBtn.title = enabled ? "Disable plugin" : "Enable plugin";
    }

    const presetWrap = win.el.querySelector(".pluginPresetBar");
    const presetSelect = win.el.querySelector(".pluginPresetSelect");
    const deletePresetBtn = win.el.querySelector("[data-act=deletePreset]");
    if (presetWrap && presetSelect){
      const fxKey = presetKeyFromName(fxName);
      if (fxKey && win.presetKey !== fxKey){
        win.presetKey = fxKey;
        win.presetSelection = "";
        wsSend({type:"reqFxPresets", guid: win.guid, fxName});
      }
      const cached = fxKey ? fxPresetCache.get(fxKey) : null;
      const presets = cached ? cached.presets : [];
      const listKey = `${fxKey}|${presets.map(p=>`${p.id}:${p.name}`).join("|")}`;
      if (win._presetOptionsKey !== listKey){
        win._presetOptionsKey = listKey;
        presetSelect.innerHTML = "";
        const optDefault = document.createElement("option");
        optDefault.value = "";
        optDefault.textContent = "Default";
        presetSelect.appendChild(optDefault);
        presets.forEach(p=>{
          const opt = document.createElement("option");
          opt.value = String(p.id);
          opt.textContent = p.name || "Preset";
          presetSelect.appendChild(opt);
        });
      }
      if (win.presetSelection && !presets.find(p=>String(p.id) === String(win.presetSelection))){
        win.presetSelection = "";
      }
      if (presetSelect.value !== (win.presetSelection || "")){
        win._presetSetting = true;
        presetSelect.value = win.presetSelection || "";
        win._presetSetting = false;
      }
      presetSelect.disabled = !fxKey;
      if (deletePresetBtn) deletePresetBtn.disabled = !fxKey || !presetSelect.value;
    }

    const listEl = win.el.querySelector(".pluginParamList");
    const searchWrap = win.el.querySelector(".pluginSearch");
    const searchInp = win.el.querySelector(".pluginSearch input");
    const inspectorBtn = win.el.querySelector("[data-act=inspector]");
    if (searchWrap){
      const showRaw = (win.viewMode === "raw");
      // In layout mode, hide the raw-param search row so UI starts right under the window header
      searchWrap.style.display = showRaw ? "flex" : "none";
      if (searchInp) searchInp.style.display = showRaw ? "block" : "none";
      if (inspectorBtn){
        inspectorBtn.textContent = showRaw ? "Layout" : "Inspector";
        inspectorBtn.title = showRaw ? "Show mapped UI" : "Show raw params";
      }
    }
    if (!listEl) return;

    // Render mapped DAW-like layout (when available)
    if (layout && win.viewMode === "layout"){
      renderLayoutInto(win, layout, listEl);
      return;
    }
    clearLayoutScale(win);
    listEl.classList.remove("layoutScaled");
    const q = (win.search||"").trim().toLowerCase();
    const params = Array.isArray(win.params) ? win.params : [];
    const view = q ? params.filter(p=>String(p.name||"").toLowerCase().includes(q) || String(p.index).includes(q)) : params;

    listEl.innerHTML = "";
    if (!view.length){
      const empty = document.createElement("div");
      empty.className = "small";
      empty.textContent = params.length ? "No matches." : "Loading params…";
      listEl.appendChild(empty);
      return;
    }

    for (const p of view){
      const row = document.createElement("div");
      row.className = "paramRow";
      const fmt = (p.fmt!=null && String(p.fmt).trim()!=="") ? String(p.fmt) : (Math.round((p.value||0)*1000)/1000).toFixed(3);
      row.innerHTML = `
        <div class="pname">${escapeHtml(p.name)} <span class="small" style="opacity:.6">#${p.index}</span></div>
        <input type="range" min="0" max="1" step="0.001" value="${p.value}">
        <div class="pval">${escapeHtml(fmt)}</div>
      `;
      const sl = row.querySelector("input");
      const pv = row.querySelector(".pval");
      let supT = null;
      const suppressPoll = ()=>{
        win._suppressPoll = true;
        if (supT) clearTimeout(supT);
        supT = setTimeout(()=>{ win._suppressPoll = false; }, 450);
      };
      sl.addEventListener("input", ()=>{
        const v = parseFloat(sl.value);
        suppressPoll();
        // optimistic
        p.value = v;
        if (pv) pv.textContent = (Math.round(v*1000)/1000).toFixed(3);
        wsSend({type:"setFxParam", guid: win.guid, fxIndex: win.fxIndex, param: p.index, value: v});
      });
      listEl.appendChild(row);
    }
  }


  function setPluginPollInterval(win){
    try{
      const fxName = getFxNameFromCache(win.guid, win.fxIndex);
      const L = pickLayout(fxName);
      const isLayout = (win.viewMode === "layout") && !!L;
      // Layout views often include meters; poll faster for smoother VU.
      const ms = isLayout ? 33 : 250;
      if (win._pollMs === ms && win.pollT) return;
      win._pollMs = ms;
      if (win.pollT) clearInterval(win.pollT);
      win.pollT = setInterval(()=>{
        // Always poll so meters (VU/telemetry) stay live even while editing.
        wsSend({type:"reqFxParams", guid: win.guid, fxIndex: win.fxIndex});
      }, ms);
    }catch(_){}
  }

  function openPluginWin(guid, fxIndex){
    const key = `${guid}:${fxIndex}`;
    const isPhone = isPhoneLike();

    // on phone: single fullscreen window at a time
    if (isPhone){
      for (const k of [...pluginWins.keys()]) closePluginWin(k);
      pluginOverlay.style.display = "block";
      // also close track modal if it was open
      try{ if (typeof closeModal === "function") closeModal(); }catch(_){ }
    }

    let win = pluginWins.get(key);
    if (!win){
      const el = document.createElement("div");
      el.className = "pluginWin" + (isPhone ? " fullscreen" : "");
      el.dataset.key = key;
      el.style.left = isPhone ? "0px" : "80px";
      el.style.top = isPhone ? "0px" : "70px";
      el.style.zIndex = String(++pluginZ);
      const fxName = getFxNameFromCache(guid, fxIndex);
      const layout = pickLayout(fxName);
      if (!isPhone && layout && Number.isFinite(layout.winW) && Number.isFinite(layout.winH)){
        el.style.width = Math.max(240, layout.winW) + "px";
        el.style.height = Math.max(240, layout.winH) + "px";
      }
      el.innerHTML = `
        <div class="pluginWinHeader">
          <div class="pluginTitle">FX</div>
          <div class="pluginHdrBtns">
            <button class="miniBtn" data-act="refresh">Refresh</button>
            <button class="miniBtn" data-act="inspector">Inspector</button>
            <button class="miniBtn" data-act="toggle">ON</button>
            <button class="miniBtn" data-act="close">✕</button>
          </div>
        </div>
        <div class="pluginWinBody">
          <div class="pluginPresetBar">
            <select class="pluginPresetSelect"></select>
            <button class="miniBtn" data-act="savePreset">Save</button>
            <button class="miniBtn" data-act="deletePreset">Delete</button>
          </div>
          <div class="pluginSearch">
            <input type="text" placeholder="Search params…">
          </div>
          <div class="pluginParamList"></div>
        </div>
      `;
      pluginLayer.appendChild(el);
      // default view: layout if known, otherwise raw inspector
      const fxName2 = getFxNameFromCache(guid, fxIndex);
      const hasLayout = !!pickLayout(fxName2);
      win = {key, guid, fxIndex, el, params: [], search: "", pollT: null, _suppressPoll:false, _dragParams:new Set(), _dragValues:new Map(), viewMode: hasLayout ? "layout" : "raw", _layoutUI:null, _viewModeLocked:false, presetSelection:"", presetKey:""};
      pluginWins.set(key, win);

      // interactions
      el.addEventListener("pointerdown", ()=>bringPluginToFront(win), true);
      const inp = el.querySelector(".pluginSearch input");
      inp.addEventListener("input", ()=>{ win.search = inp.value; renderPluginWin(win); });

      const btnRefresh = el.querySelector("[data-act=refresh]");
      try{ btnRefresh.addEventListener("pointerdown", (ev)=>ev.stopPropagation()); }catch(_){ }

      const btnClose = el.querySelector("[data-act=close]");
      // prevent header drag from stealing button clicks
      try{ btnClose.addEventListener("pointerdown", (ev)=>ev.stopPropagation()); }catch(_){ }

      const btnInspector = el.querySelector("[data-act=inspector]");
      try{ btnInspector.addEventListener("pointerdown", (ev)=>ev.stopPropagation()); }catch(_){ }
      const btnToggle = el.querySelector("[data-act=toggle]");
      try{ btnToggle.addEventListener("pointerdown", (ev)=>ev.stopPropagation()); }catch(_){ }

      const presetSelect = el.querySelector(".pluginPresetSelect");
      const btnSavePreset = el.querySelector("[data-act=savePreset]");
      const btnDeletePreset = el.querySelector("[data-act=deletePreset]");

      btnRefresh.addEventListener("click", ()=>wsSend({type:"reqFxParams", guid, fxIndex}));
      btnClose.addEventListener("click", ()=>closePluginWin(key));
      if (btnToggle){
        btnToggle.addEventListener("click", ()=>{
          const cached = fxCache.get(guid);
          const list = (cached && cached.fx) ? cached.fx : [];
          const fx = list.find(f=>f.index===fxIndex);
          if (!fx) return;
          const enabled = !fx.enabled;
          wsSend({type:"setFxEnabled", guid, index: fxIndex, enabled});
          fx.enabled = enabled;
          renderPluginWin(win);
        });
      }
      if (btnInspector){
        btnInspector.addEventListener("click", ()=>{
          win._viewModeLocked = true;
          // toggle between mapped UI and raw param inspector
          const fxName2 = getFxNameFromCache(win.guid, win.fxIndex);
          const L = pickLayout(fxName2);
          if (!L){
            win.viewMode = "raw";
          } else {
            // Make the button behave predictably: "Inspector" => raw, "Layout" => mapped UI
            const next = (win.viewMode === "raw") ? "layout" : "raw";
            win.viewMode = next;
            // When returning from raw -> layout, the container currently holds raw sliders.
            // Force a rebuild so the mapped UI is actually rendered again.
            if (next === "layout") win._layoutUI = null;
          }
          renderPluginWin(win);
          setPluginPollInterval(win);
        });
      }

      if (presetSelect){
        presetSelect.addEventListener("change", ()=>{
          if (win._presetSetting) return;
          win.presetSelection = presetSelect.value || "";
          if (!win.presetSelection) return;
          const fxName = getFxNameFromCache(win.guid, win.fxIndex);
          const keyName = presetKeyFromName(fxName);
          if (!keyName) return;
          const cached = fxPresetCache.get(keyName);
          const presets = cached ? cached.presets : [];
          const preset = presets.find(p=>String(p.id) === String(win.presetSelection));
          if (!preset) return;
          suppressPoll(win, 800);
          for (const prm of (preset.params||[])){
            const idx = Number(prm.index);
            const val = clamp01(Number(prm.value));
            if (!Number.isFinite(idx) || !Number.isFinite(val)) continue;
            wsSend({type:"setFxParam", guid: win.guid, fxIndex: win.fxIndex, param: idx, value: val});
            const local = (win.params||[]).find(p=>p.index===idx);
            if (local) local.value = val;
          }
          renderPluginWin(win);
        });
      }
      if (btnSavePreset){
        btnSavePreset.addEventListener("click", ()=>{
          const fxName = getFxNameFromCache(win.guid, win.fxIndex);
          if (!fxName) return;
          const name = prompt("Preset name?");
          if (!name) return;
          const params = (win.params||[]).filter(p=>{
            const n = String(p.name||"");
            return !/telemetry/i.test(n);
          }).map(p=>({index: p.index, value: clamp01(p.value||0)}));
          wsSend({type:"saveFxPreset", guid: win.guid, fxName, name, params});
          win.presetSelection = "";
          renderPluginWin(win);
        });
      }
      if (btnDeletePreset){
        btnDeletePreset.addEventListener("click", ()=>{
          if (!win.presetSelection) return;
          const fxName = getFxNameFromCache(win.guid, win.fxIndex);
          if (!fxName) return;
          if (!confirm("Delete selected preset?")) return;
          wsSend({type:"deleteFxPreset", guid: win.guid, fxName, presetId: win.presetSelection});
          win.presetSelection = "";
          renderPluginWin(win);
        });
      }


      // drag (desktop only)
      const header = el.querySelector(".pluginWinHeader");
      let drag = null;
      header.addEventListener("pointerdown", (ev)=>{
        if (el.classList.contains("fullscreen")) return;
        if (ev.button !== 0) return;
        // Don't start drag when clicking header buttons/inputs
        const t = ev.target;
        if (t && (t.closest && t.closest(".pluginHdrBtns"))) return;
        if (t && (t.tagName === "BUTTON" || t.tagName === "INPUT")) return;
        bringPluginToFront(win);
        const r = el.getBoundingClientRect();
        drag = {id: ev.pointerId, dx: ev.clientX - r.left, dy: ev.clientY - r.top};
        header.setPointerCapture(ev.pointerId);
        ev.preventDefault();
      });
      header.addEventListener("pointermove", (ev)=>{
        if (!drag || ev.pointerId !== drag.id) return;
        const x = Math.max(6, Math.min(window.innerWidth - 80, ev.clientX - drag.dx));
        const y = Math.max(6, Math.min(window.innerHeight - 60, ev.clientY - drag.dy));
        el.style.left = x + "px";
        el.style.top = y + "px";
      });
      header.addEventListener("pointerup", (ev)=>{
        if (drag && ev.pointerId === drag.id){ drag = null; }
      });
      header.addEventListener("pointercancel", ()=>{ drag = null; });

      // polling while open (keeps in sync with REAPER)
      setPluginPollInterval(win);
} else {
      // if re-opened on phone, force fullscreen
      win.el.classList.toggle("fullscreen", isPhone);
      if (isPhone) pluginOverlay.style.display = "block";
      bringPluginToFront(win);
    }

    renderPluginWin(win);
    wsSend({type:"reqFxParams", guid, fxIndex});
  }



// ---------- Responsive: phone landscape (hide topbar + float controls) ----------
const topbar = document.getElementById("topbar");
const root = document.documentElement;
const mqPhoneLandscape = window.matchMedia("(orientation: landscape) and (max-height: 520px)");
let _rszT = null;

function applyResponsiveMode(){
  const phoneLandscape = !!mqPhoneLandscape.matches;
  document.body.classList.toggle("phoneLandscape", phoneLandscape);

  // Keep layout calc accurate (topbar changes height in mobile CSS)
  if (phoneLandscape){
    root.style.setProperty("--topbarH", "0px");
  } else {
    const h = topbar ? Math.round(topbar.getBoundingClientRect().height) : 46;
    root.style.setProperty("--topbarH", (h || 46) + "px");
  }
}

function scheduleResponsiveMode(){
  if (_rszT) clearTimeout(_rszT);
  _rszT = setTimeout(applyResponsiveMode, 60);
}

window.addEventListener("resize", scheduleResponsiveMode, {passive:true});
window.addEventListener("orientationchange", scheduleResponsiveMode, {passive:true});
if (mqPhoneLandscape.addEventListener) mqPhoneLandscape.addEventListener("change", scheduleResponsiveMode);
else if (mqPhoneLandscape.addListener) mqPhoneLandscape.addListener(scheduleResponsiveMode);
applyResponsiveMode();

  // ---------- Config ----------
    const DEFAULT_CFG = {
    theme: "dark",
    masterEnabled: true,
    masterSide: "left",           // left / right
    masterPinned: false,
    masterCompact: false,
    showFxBar: true,
    showSendsBar: true,
    showPanFader: true,
    showFxSlots: true,
    fxSlotsShown: 4,
    showTrackFrames: true,
    fullscreen: false,
    scene: "default",
    folderView: {},               // guid -> "expanded"|"compact"|"hidden"
    hiddenTracks: {},             // guid -> true (UI only)
    compactTracks: {},            // guid -> true
    spacerWidths: {},             // guid -> "standard"|"narrow"|"wide"
    largeTouch: false,
    fxSlotsScrollHoldEnabled: false,
    fxSlotsScrollHoldSec: 40,
    trackReorderMouseEnabled: true,
    trackReorderTouchEnabled: false,

  };

  function loadCfg(){
    try {
      const raw = localStorage.getItem("rm_cfg_v517");
      if (!raw) return sClone(DEFAULT_CFG);
      const obj = JSON.parse(raw);
      return Object.assign(sClone(DEFAULT_CFG), obj||{});
    } catch {
      return sClone(DEFAULT_CFG);
    }
  }
  function saveCfg(){
    try { localStorage.setItem("rm_cfg_v517", JSON.stringify(cfg)); } catch {}
  }
  let cfg = loadCfg();

  // Defaults
  if (cfg.showColorFooter === undefined) cfg.showColorFooter = true;
  if (cfg.footerIntensity === undefined) cfg.footerIntensity = 0.35;
  if (cfg.showTrackFrames === undefined) cfg.showTrackFrames = true;
  if (!cfg.theme) cfg.theme = "dark";
  if (!cfg.spacerWidths) cfg.spacerWidths = {};
  if (cfg.largeTouch === undefined) cfg.largeTouch = false;

  if (cfg.fxSlotsScrollHoldEnabled === undefined) cfg.fxSlotsScrollHoldEnabled = false;
  if (cfg.fxSlotsScrollHoldSec === undefined) cfg.fxSlotsScrollHoldSec = 40;
  if (cfg.trackReorderMouseEnabled === undefined) cfg.trackReorderMouseEnabled = true;
  if (cfg.trackReorderTouchEnabled === undefined) cfg.trackReorderTouchEnabled = false;

  function applyTheme(){
    document.body.classList.toggle("light", cfg.theme === "light");
  }
  applyTheme();

  function applyTrackFrames(){
    document.body.classList.toggle("noTrackFrames", !cfg.showTrackFrames);
  }
  applyTrackFrames();

  function applyTouchMode(){
    document.body.classList.toggle("largeTouch", !!cfg.largeTouch);
  }
  applyTouchMode();

  // Scenes
  let projectInfo = null;   // {projectId, projectName, ui}
  let sceneState = { projectId: null, scenes: [], current: "main" };
  const sceneSeen = new Map(); // sceneName -> Set(track guids) for empty-scene tracking

  const defaultScenes = ()=>[
    {name:"main", all:true,  guids:[], masterGuid:"MASTER"},
    {name:"mon1", all:false, guids:[], masterGuid:""},
    {name:"mon2", all:false, guids:[], masterGuid:""}
  ];
  const sceneKey = (pid)=> `rm_scenes_${pid||"default"}`;
  const sceneCurrentKey = (pid)=> `rm_scene_current_${pid||"default"}`;

  function loadScenes(pid){
    try{
      const raw = localStorage.getItem(sceneKey(pid));
      const obj = raw ? JSON.parse(raw) : null;
      if (obj && Array.isArray(obj.scenes)){
        return { projectId: pid, scenes: obj.scenes, current: obj.current || "main" };
      }
    }catch{}
    return { projectId: pid, scenes: defaultScenes(), current: "main" };
  }
  function saveScenes(){
    try{
      localStorage.setItem(sceneKey(sceneState.projectId), JSON.stringify({scenes: sceneState.scenes, current: sceneState.current}));
      localStorage.setItem(sceneCurrentKey(sceneState.projectId), sceneState.current);
    }catch{}
  }
  function ensureScenes(pid){
    const next = loadScenes(pid);
    if (!next.scenes.find(s=>s.name==="main")){
      next.scenes = defaultScenes();
      next.current = "main";
    }
    sceneState = next;
    return sceneState;
  }
  function setCurrentScene(name){
    const found = sceneState.scenes.find(s=>s.name===name);
    sceneState.current = found ? name : "main";
    saveScenes();
    updateSceneSelect();
    const cur = getCurrentScene();
    if (cur && !cur.all && cur.name !== "main" && (!cur.guids || cur.guids.length === 0) && lastState){
      sceneSeen.set(cur.name, new Set((lastState.tracks||[]).map(t=>t.guid)));
    }
    if (openModal && openModal.kind === "scenes") renderModal();
    renderOrUpdate(true);
  }
  function getCurrentScene(){
    return sceneState.scenes.find(s=>s.name===sceneState.current) || sceneState.scenes.find(s=>s.name==="main") || {name:"main", all:true, guids:[]};
  }

  // Scenes sync from REAPER (ProjExtState ScenesV1) so ReaImGui changes are reflected in Web UI.
  let _lastReaperScenesJson = "";
  function applyReaperScenesV1(sv1){
    try{
      if (!sv1 || !Array.isArray(sv1.scenes)) return false;
      const raw = JSON.stringify(sv1);
      if (raw && raw === _lastReaperScenesJson) return false;
      _lastReaperScenesJson = raw || "";

      const pid = (projectInfo && projectInfo.projectId) || sceneState.projectId || "default";
      let scenes = sv1.scenes
        .filter(s=>s && typeof s.name === "string" && s.name)
        .map(s=>{
          const nm = String(s.name);
          const all = (nm === "main") ? true : !!s.all;
          const guids = Array.isArray(s.guids) ? s.guids.filter(g=>typeof g === "string" && g) : [];
          // Single-master model:
          // - main always uses built-in MASTER
          // - other scenes may choose any track GUID as master ("" means none)
          let masterGuid = "";
          if (nm === "main"){
            masterGuid = "MASTER";
          } else if (typeof s.masterGuid === "string" && s.masterGuid){
            masterGuid = String(s.masterGuid);
          } else if (Array.isArray(s.masterGuids) && s.masterGuids.length && typeof s.masterGuids[0] === "string"){
            masterGuid = String(s.masterGuids[0] || "");
          }
          if (masterGuid === "MASTER" && nm !== "main") masterGuid = "";
          return { name: nm, all, guids, masterGuid };
        });

      if (!scenes.find(s=>s.name === "main")) scenes.unshift({name:"main", all:true, guids:[], masterGuid:"MASTER"});

      let cur = (typeof sv1.current === "string" && sv1.current) ? sv1.current : "main";
      if (!scenes.find(s=>s.name === cur)) cur = "main";

      sceneState = { projectId: pid, scenes, current: cur };
      // mirror into localStorage for persistence / offline UI (do not echo back to REAPER)
      _suppressSceneSend = true;
      saveScenes();
      _suppressSceneSend = false;
      updateSceneSelect();
      if (openModal && openModal.kind === "scenes") renderModal();
      return true;
    }catch(_e){
      return false;
    }
  }


  // ---------- WS ----------
  const statusEl = document.getElementById("status");

  let _wsStatusBase = "";
  function _countStrips(){
    try{
      const m = document.getElementById("mixer");
      if (!m) return 0;
      return m.querySelectorAll(".strip").length;
    }catch(_e){ return 0; }
  }
  function updateStatus(){
    try{
      const t = (lastState && Array.isArray(lastState.tracks)) ? lastState.tracks.length : 0;
      const s = _countStrips();
      const base = _wsStatusBase || (wsConnected ? "ws connected" : "ws disconnected");
      statusEl.textContent = base + " · tracks:" + t + " · strips:" + s;
    }catch(_e){ }
  }
  function setWsStatus(txt){
    _wsStatusBase = String(txt || "");
    updateStatus();
  }
  const brandEl = document.getElementById("brand");
  let ws = null;
  let wsConnected = false;

  const normalizeProjectName = (name)=>{
    const raw = String(name || "").trim();
    if (!raw) return "new project";
    if (/^\(ReaProject\*?\)/i.test(raw)) return "new project";
    return raw;
  };

  const getProjectLabel = ()=>{
    const proj = (lastState && (lastState.projectName || lastState.project || lastState.projName || lastState.proj || (lastState.project && lastState.project.name))) ||
      (projectInfo && projectInfo.projectName) ||
      (brandEl && brandEl.textContent) ||
      "";
    return normalizeProjectName(proj);
  };

  const formatTimecode = (sec)=>{
    if (!Number.isFinite(sec)) return "00:00:00.00";
    const s = Math.max(0, sec);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = Math.floor(s % 60);
    const frac = Math.floor((s - Math.floor(s)) * 100);
    const pad = (n, l=2)=> String(n).padStart(l, "0");
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}.${pad(frac)}`;
  };

  const applyTransportRefs = (transport, refs)=>{
    if (!transport || !refs) return;
    if (refs.time){
      const position = Number.isFinite(transport.position) ? transport.position : parseFloat(transport.position);
      const next = formatTimecode(Number.isFinite(position) ? position : 0);
      if (refs.time.textContent !== next) refs.time.textContent = next;
    }
    if (refs.bars){
      const rawBar = Number.isFinite(transport.bar) ? transport.bar : parseFloat(transport.bar);
      const rawBeat = Number.isFinite(transport.beat) ? transport.beat : parseFloat(transport.beat);
      const rawFrac = Number.isFinite(transport.beatFrac) ? transport.beatFrac : parseFloat(transport.beatFrac);
      const bar = Number.isFinite(rawBar) && rawBar > 0 ? rawBar : 1;
      const beat = Number.isFinite(rawBeat) && rawBeat > 0 ? rawBeat : 1;
      const sub = Number.isFinite(rawFrac) ? Math.round(rawFrac * 100) : 0;
      const next = `${bar}.${beat}.${String(sub).padStart(2, "0")}`;
      if (refs.bars.textContent !== next) refs.bars.textContent = next;
    }
    if (refs.bpm){
      const bpm = Number.isFinite(transport.bpm) ? Math.round(transport.bpm) : null;
      refs.bpm.textContent = bpm === null ? "—" : `${bpm} BPM`;
    }
    if (refs.bpmInput){
      const bpm = Number.isFinite(transport.bpm) ? Math.round(transport.bpm) : null;
      if (bpm !== null && document.activeElement !== refs.bpmInput){
        refs.bpmInput.value = String(bpm);
        if (openModal) openModal.draftBpm = bpm;
      }
    }
    if (refs.play) refs.play.classList.toggle("on", !!transport.playing && !transport.paused);
    if (refs.pause) refs.pause.classList.toggle("on", !!transport.paused);
    if (refs.rec) refs.rec.classList.toggle("on", !!transport.recording);
    if (refs.stop){
      const stopped = !transport.playing && !transport.paused && !transport.recording;
      refs.stop.classList.toggle("stopped", stopped);
    }
  };

  const updateTransportUI = (transport)=>{
    if (!transport) return;
    transportLive.data = Object.assign({}, transport);
    transportLive.ts = performance.now();
    applyTransportRefs(transport, {
      time: transportTime,
      bars: transportBars,
      bpm: transportBpm,
      play: transportPlay,
      pause: transportPause,
      rec: transportRec,
      stop: transportStop,
    });
    if (openModal && openModal.kind === "transport" && openModal.transportRefs){
      applyTransportRefs(transport, openModal.transportRefs);
    }
  };

  let lastState = null;     // {master, tracks[]}
  let lastMeters = null;    // {frames[]}
  let trackByGuid = new Map();
  let stripEls = new Map(); // guid -> element
  let folderGroupEls = new Map(); // folder start guid -> .folderGroup wrapper
  let folderRanges = new Map(); // guid -> {startGuid,lastGuid,indent,color}
  let meterEls = new Map(); // guid -> {L,R,peakL,peakR}
  // Smooth meter animation (targets are updated by WS "meter" messages)
  let meterAnim = new Map(); // guid -> {tL,tR,curL,curR,pL,pR}
  let meterAnimRaf = 0;
  let meterAnimLastT = 0;
  const transportLive = {data: null, ts: 0};

  function ensureMeterAnim(){
    if (meterAnimRaf) return;
    meterAnimLastT = performance.now();
    const tick = (t)=>{
      const dt = Math.min(80, Math.max(0, t - meterAnimLastT));
      meterAnimLastT = t;

      // Exponential smoothing constant (~110ms time constant)
      const a = 1 - Math.exp(-dt / 110);

      // Peak decay tuned for ~60fps; adapt to dt
      const decay = Math.pow(0.99, dt / 16.7);

      for (const [guid, st] of meterAnim){
        const el = stripEls.get(guid);
        if (!el || !el._refs){
          // track disappeared / re-rendered
          meterAnim.delete(guid);
          continue;
        }
        const r = el._refs;

        st.curL += (st.tL - st.curL) * a;
        st.curR += (st.tR - st.curR) * a;

        const norm = (v)=>{
          if (!Number.isFinite(v)) return 0;
          const clamped = Math.max(0, Math.min(1, v));
          const scaled = Math.min(1, clamped * 1.12);
          return scaled >= 0.995 ? 1 : scaled;
        };
        const cL = norm(st.curL);
        const cR = norm(st.curR);

        r.vuFillL.style.height = (cL*100) + "%";
        r.vuFillR.style.height = (cR*100) + "%";

        st.pL = Math.max(cL, (st.pL||0) * decay);
        st.pR = Math.max(cR, (st.pR||0) * decay);
        r.vuPeakL.style.transform = `translateY(${-(st.pL*100)}%)`;
        r.vuPeakR.style.transform = `translateY(${-(st.pR*100)}%)`;

        if (r.volDb){
          const now = performance.now();
          if (st.clipUntil && st.clipUntil > now && Number.isFinite(st.clipDb)){
            r.volDb.textContent = `CLIP +${st.clipDb.toFixed(1)} dB`;
            r.volDb.classList.add("clip");
          } else if (r.volDb.classList.contains("clip")){
            const t = trackByGuid.get(guid);
            r.volDb.textContent = `${dbFromVol(t ? (t.vol || 1.0) : 1.0)} dB`;
            r.volDb.classList.remove("clip");
          }
        }

        // also update any open plugin windows track meters for this track (smoothed)
        try{
          for (const win of pluginWins.values()){
            if (!win || win.guid !== guid || !win._layoutUI || !win._layoutUI.controls) continue;
            for (const ui of win._layoutUI.controls){
              if (ui && ui.updateTrackMeter) ui.updateTrackMeter(cL, cR);
            }
          }
        }catch(_){}
      }

      meterAnimRaf = requestAnimationFrame(tick);
    };
    meterAnimRaf = requestAnimationFrame(tick);
  }

  let sliderTargets = new Map(); // guid -> targetY (0..1)
  let sliderCurrent = new Map(); // guid -> currentY (0..1)
  let draggingGuid = null;
  let draggingTrackGuid = null;
  let draggingSpacerGuid = null;
  let touchDrag = null;
  let touchDropTarget = null;
  let dragDropState = null;
  let dragDropEl = null;
  let dragDropTargetEl = null;
  let fxSlotDrag = null;

  // Block HTML5 drag-reorder during control interactions (e.g. pan slider).
  // Chromium can sometimes start a drag on the draggable strip even if the gesture began on a range input.
  let dragBlockUntil = 0;
  function blockTrackDrag(ms){
    const until = nowMs() + (ms || 0);
    if (until > dragBlockUntil) dragBlockUntil = until;
  }
  function isTrackDragBlocked(){
    return nowMs() < dragBlockUntil;
  }


  function cancelAnyTrackDrag(){
    try{ document.body.classList.remove('draggingTrack'); }catch(_){}
    draggingTrackGuid = null;
    draggingSpacerGuid = null;
    touchDrag = null;
    touchDropTarget = null;
    clearDropHighlight();
    try{ document.querySelectorAll('.strip.dragging').forEach(el=>el.classList.remove('dragging')); }catch(_){}
    try{ document.querySelectorAll('.strip.dropTarget,.strip.dropAfter,.strip.dropBefore').forEach(el=>el.classList.remove('dropTarget','dropAfter','dropBefore')); }catch(_){}
  }

  // Keep drop target tracking stable across browsers by also updating from document-level dragover.
  document.addEventListener('dragover', (ev)=>{
    if (!cfg.trackReorderMouseEnabled) return;
    if (!draggingTrackGuid && !draggingSpacerGuid) return;
    try{ ev.preventDefault(); }catch(_){}
    try{ updateMouseDropTarget(ev.clientX, ev.clientY); }catch(_){}
  }, {capture:true, passive:false});

  window.addEventListener('blur', ()=>{ if (touchDrag || draggingTrackGuid || draggingSpacerGuid) cancelAnyTrackDrag(); }, {passive:true});
  window.addEventListener('pagehide', ()=>{ if (touchDrag || draggingTrackGuid || draggingSpacerGuid) cancelAnyTrackDrag(); }, {passive:true});
  document.addEventListener('visibilitychange', ()=>{ if (document.hidden && (touchDrag || draggingTrackGuid || draggingSpacerGuid)) cancelAnyTrackDrag(); }, {passive:true});

  function applyOptimisticMove(guid, beforeGuid){
    if (!lastState || !Array.isArray(lastState.tracks)) return;
    if (!guid || !beforeGuid || guid === beforeGuid) return;
    const tracks = lastState.tracks.slice();
    const fromIdx = tracks.findIndex(t=>t.guid === guid);
    const toIdx = tracks.findIndex(t=>t.guid === beforeGuid);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = tracks.splice(fromIdx, 1);
    let insertIdx = toIdx;
    if (fromIdx < toIdx) insertIdx -= 1;
    insertIdx = Math.max(0, Math.min(tracks.length, insertIdx));
    tracks.splice(insertIdx, 0, moved);
    lastState = Object.assign({}, lastState, {tracks});
  }

  function applyOptimisticMoveToIndex(guid, toIndex){
    if (!lastState || !Array.isArray(lastState.tracks)) return;
    if (!guid || !Number.isFinite(toIndex)) return;
    const tracks = lastState.tracks.slice();
    const fromIdx = tracks.findIndex(t=>t.guid === guid);
    if (fromIdx < 0) return;
    const clamped = Math.max(0, Math.min(tracks.length - 1, toIndex));
    const [moved] = tracks.splice(fromIdx, 1);
    let insertIdx = clamped;
    if (fromIdx < clamped) insertIdx -= 1;
    insertIdx = Math.max(0, Math.min(tracks.length, insertIdx));
    tracks.splice(insertIdx, 0, moved);
    lastState = Object.assign({}, lastState, {tracks});
  }

  function getTrackIndexByGuid(guid){
    if (!lastState || !Array.isArray(lastState.tracks)) return null;
    const idx = lastState.tracks.findIndex(t=>t.guid === guid);
    return idx >= 0 ? idx : null;
  }

  function getDropTrackTargetIndex(dropGuid, draggingGuid, after){
    const dropIdx = getTrackIndexByGuid(dropGuid);
    if (dropIdx == null) return null;
    let target = dropIdx + (after ? 1 : 0);
    return Math.max(0, Math.min((lastState.tracks || []).length - 1, target));
  }

  function setTouchDropTarget(el){
    if (touchDropTarget && touchDropTarget !== el){
      touchDropTarget.classList.remove("dropTarget");
    }
    touchDropTarget = el;
    if (touchDropTarget){
      touchDropTarget.classList.add("dropTarget");
    }
  }

  function getDropTargetInfo(strip){
    if (!strip) return null;
    const guid = strip.dataset.targetGuid || strip.dataset.guid || "";
    if (!guid) return null;
    const track = trackByGuid.get(guid) || null;
    const folderGuid = strip.dataset.folderGroup || (track && track.folderDepth > 0 ? guid : "");
    return {guid, track, folderGuid, isSpacer: strip.classList.contains("spacer")};
  }

  function updateTouchDropTarget(x, y){
    const el = document.elementFromPoint(x, y);
    const strip = el ? el.closest(".strip") : null;
    const info = getDropTargetInfo(strip);
    if (!strip || !info || (touchDrag && info.guid === touchDrag.guid)){
      setTouchDropTarget(null);
      clearDropHighlight();
      return;
    }
    setTouchDropTarget(strip);
    try{
      const rect = strip.getBoundingClientRect();
      const after = (x - rect.left) > rect.width / 2;
      setDropHighlight(strip, after);
    }catch(_){ }
    if (touchDrag){
      touchDrag.lastX = x;
      touchDrag.lastY = y;
    }
  }

  function clearDropHighlight(){
    if (dragDropEl){
      dragDropEl.classList.remove("dropBefore", "dropAfter");
      dragDropEl = null;
    }
    if (dragDropTargetEl){
      dragDropTargetEl.classList.remove("dropTarget");
      dragDropTargetEl = null;
    }
    dragDropState = null;
  }

  function startTouchDrag(kind, guid, el, pointerId, x, y){
    touchDrag = {kind, guid, el, pointerId};
    // Safety: auto-cancel if we never receive pointerup/cancel (mobile WebViews can drop events).
    try{
      if (touchDrag._touchDragTimeout) clearTimeout(touchDrag._touchDragTimeout);
      touchDrag._touchDragTimeout = setTimeout(()=>{
        if (touchDrag && touchDrag.pointerId === pointerId){
          cancelAnyTrackDrag();
        }
      }, 12000);
    }catch(_){ }
    if (kind === "spacer") draggingSpacerGuid = guid;
    else draggingTrackGuid = guid;
    el.classList.add("dragging");
    document.body.classList.add("draggingTrack");
    updateTouchDropTarget(x, y);
  }

  function endTouchDrag(applyMove=true){
    if (!touchDrag) return;
    const {guid, el, kind} = touchDrag;
    if (applyMove && touchDropTarget){
      const info = getDropTargetInfo(touchDropTarget);
      if (info && info.guid && info.guid !== guid){
        const baseGuid = (dragDropState && dragDropState.guid) ? dragDropState.guid : info.guid;
        let beforeGuid = baseGuid;
        try{
          const rect = touchDropTarget.getBoundingClientRect();
          const after = touchDrag.lastX != null ? (touchDrag.lastX > rect.left + rect.width / 2) : false;
          if (after){
            const nextGuid = getNextStripGuid(baseGuid);
            if (nextGuid) beforeGuid = nextGuid;
          }
        }catch(_){ }
        if (kind === "spacer"){
          const spacerTarget = beforeGuid || getNextTrackGuid(baseGuid) || baseGuid;
          wsSend({type:"setSpacer", guid, enabled:false});
          wsSend({type:"setSpacer", guid: spacerTarget, enabled:true});
          moveSpacerWidth(guid, spacerTarget);
          renderOrUpdate(true);
          setTimeout(()=>wsSend({type:"reqState"}), 10);
        } else if (info.folderGuid && info.guid === info.folderGuid && info.guid === baseGuid){
          if (after){
            wsSend({type:"moveTrackToFolder", guid, folderGuid: info.folderGuid});
          } else {
            const targetIndex = getDropTrackTargetIndex(baseGuid, guid, false);
            if (targetIndex != null){
              wsSend({type:"moveTrack", guid, toIndex: targetIndex});
              applyOptimisticMoveToIndex(guid, targetIndex);
              renderOrUpdate();
            }
          }
          setTimeout(()=>wsSend({type:"reqState"}), 10);
        } else {
          const after = !!(dragDropState && dragDropState.after);
          const targetIndex = getDropTrackTargetIndex(baseGuid, guid, after);
          if (targetIndex != null){
            wsSend({type:"moveTrack", guid, toIndex: targetIndex});
            applyOptimisticMoveToIndex(guid, targetIndex);
            renderOrUpdate();
            setTimeout(()=>wsSend({type:"reqState"}), 10);
          }
        }
      }
    }
    if (touchDropTarget) touchDropTarget.classList.remove("dropTarget");
    if (el) el.classList.remove("dragging");
    document.body.classList.remove("draggingTrack");
    clearDropHighlight();
    touchDropTarget = null;
    touchDrag = null;
    draggingTrackGuid = null;
    draggingSpacerGuid = null;
  }

  function canStartTouchDrag(target){
    if (!target) return false;
    return !target.closest("input, button, .btn, .faderHit, .thumb, .panBox, .panTop, .panSlider, .slotbtn, .fxSlots, .fxSlotActions, .fxMoreBadge");
  }

  function startHoldDrag(t, el, ev, holdMs){
    if (!canStartTouchDrag(ev.target)) return;
    const startX = ev.clientX;
    const startY = ev.clientY;
    const pointerId = ev.pointerId;
    let active = true;
    const hold = setTimeout(()=>{
      if (!active) return;
      if (el && el._holdMenuOpen) return;
      const kind = t.kind === "spacer" ? "spacer" : "track";
      const guid = t.kind === "spacer" ? t.targetGuid : t.guid;
      startTouchDrag(kind, guid, el, pointerId, startX, startY);
    }, holdMs);

    const move = (e)=>{
      if (!active) return;
      const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (!touchDrag && dist > 10){
        clearTimeout(hold);
        cleanup();
        return;
      }
      if (touchDrag && touchDrag.pointerId === pointerId){
        updateTouchDropTarget(e.clientX, e.clientY);
      }
    };
    const up = ()=>{
      if (!active) return;
      clearTimeout(hold);
      cleanup();
      if (touchDrag && touchDrag.pointerId === pointerId){
        endTouchDrag(true);
      }
    };
    const cancel = ()=>{
      if (!active) return;
      clearTimeout(hold);
      cleanup();
      if (touchDrag && touchDrag.pointerId === pointerId){
        endTouchDrag(false);
      }
    };
    const cleanup = ()=>{
      active = false;
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", cancel, true);
    };
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", cancel, true);
  }

  function attachTouchHoldMenu(el, onOpen){
    if (!el || typeof onOpen !== "function") return;
    el.addEventListener("pointerdown", (ev)=>{
      if (ev.pointerType !== "touch") return;
      if (!canStartTouchDrag(ev.target)) return;
      const startX = ev.clientX;
      const startY = ev.clientY;
      let active = true;
      if (el) el._holdMenuOpen = false;
      const hold = setTimeout(()=>{
        if (!active) return;
        if (el) el._holdMenuOpen = true;
        onOpen(startX, startY);
      }, 650);
      const move = (e)=>{
        if (!active) return;
        if (Math.hypot(e.clientX - startX, e.clientY - startY) > 12){
          clearTimeout(hold);
          cleanup();
        }
      };
      const up = ()=>{
        if (!active) return;
        clearTimeout(hold);
        cleanup();
      };
      const cancel = ()=>{
        if (!active) return;
        clearTimeout(hold);
        cleanup();
      };
      const cleanup = ()=>{
        active = false;
        if (el) el._holdMenuOpen = false;
        document.removeEventListener("pointermove", move, true);
        document.removeEventListener("pointerup", up, true);
        document.removeEventListener("pointercancel", cancel, true);
      };
      document.addEventListener("pointermove", move, true);
      document.addEventListener("pointerup", up, true);
      document.addEventListener("pointercancel", cancel, true);
    });
  }

  // FX slots cache
  let fxCache = new Map(); // guid -> {fx:[], ts}
  let fxReqInFlight = new Set();
  // guid -> FX slots expanded (show list instead of fader)
  let fxExpanded = new Set();


  function wsSend(obj){
    if (!wsConnected) return;
    try{ ws.send(JSON.stringify(obj)); } catch {}
  }

  const sceneSelect = document.getElementById("sceneSelect");
  const sceneManageBtn = document.getElementById("sceneManageBtn");

  function updateSceneSelect(){
    if (!sceneSelect) return;
    sceneSelect.innerHTML = "";
    for (const sc of sceneState.scenes){
      const opt = document.createElement("option");
      opt.value = sc.name;
      opt.textContent = sc.name;
      if (sc.name === sceneState.current) opt.selected = true;
      sceneSelect.appendChild(opt);
    }
  }

  function openSceneManager(){
    if (!projectInfo) return;
    openModal = {kind:"scenes"};
    overlay.style.display = "block";
    modal.style.display = "block";
    renderModal();
  }

  if (sceneSelect){
    sceneSelect.addEventListener("change", ()=> setCurrentScene(sceneSelect.value));
  }
  sceneManageBtn?.addEventListener("click", openSceneManager);


  function connectWS(){
    setWsStatus("ws connecting");
    uiLog("ws connecting");
    const proto = (location.protocol === "https:") ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => { wsConnected = true;
      uiLog("ws connected"); wsSend({type:"reqProjectInfo"}); setWsStatus("ws connected"); wsSend({type:"reqState"}); };
    ws.onclose = () => { wsConnected = false; setWsStatus("ws disconnected"); setTimeout(connectWS, 800); };
    ws.onerror = () => { wsConnected = false; setWsStatus("ws error"); };
    ws.onmessage = (ev) => {
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || !msg.type) return;

      // server compatibility aliases
      if (msg.type === "reaper_state") msg.type = "state";
      if (msg.type === "reaper_meter") msg.type = "meter";

      if (msg.type === "projectInfo"){
        projectInfo = msg;
        // merge server ui prefs
        if (projectInfo.ui){
          if (typeof projectInfo.ui.showColorFooter === "boolean") cfg.showColorFooter = projectInfo.ui.showColorFooter;
          if (typeof projectInfo.ui.footerIntensity === "number") cfg.footerIntensity = projectInfo.ui.footerIntensity;
          saveCfg();
        }
        ensureScenes(projectInfo.projectId);
        const savedScene = localStorage.getItem(sceneCurrentKey(projectInfo.projectId));
        if (savedScene) sceneState.current = savedScene;
        updateSceneSelect();
        // Update brand
        if (brandEl) brandEl.textContent = normalizeProjectName(projectInfo.projectName);
        return;
      }

      if (msg.type === "state"){
        lastState = msg;
        // Project name -> header + document title
        const proj = msg.projectName || msg.project || msg.projName || msg.proj || (msg.project && msg.project.name) || "";
        const normProj = normalizeProjectName(proj);
        if (brandEl) brandEl.textContent = normProj;
        if (normProj) document.title = normProj;
        updateTransportUI(msg.transport);

        // Sync scenes coming from REAPER/ProjExtState so updates made in ReaImGui are reflected here.
        if (msg.scenesV1){
          applyReaperScenesV1(msg.scenesV1);
        }

        const curScene = getCurrentScene();
        if (curScene && !curScene.all && curScene.name !== "main" && (!curScene.guids || curScene.guids.length === 0)){
          let seen = sceneSeen.get(curScene.name);
          if (!seen){
            seen = new Set((msg.tracks||[]).map(t=>t.guid));
            sceneSeen.set(curScene.name, seen);
          } else {
            let added = false;
            (msg.tracks||[]).forEach(t=>{
              if (!seen.has(t.guid)){
                seen.add(t.guid);
                curScene.guids = curScene.guids || [];
                curScene.guids.push(t.guid);
                added = true;
              }
            });
            if (added) saveScenes();
          }
        }

        rebuildIndices();
        renderOrUpdate();
        return;
      }
      if (msg.type === "meter"){
        lastMeters = msg;
        applyMeters(msg);
        return;
      }
      if (msg.type === "fxList"){ 
        const prevFx = (fxCache.get(msg.guid) && fxCache.get(msg.guid).fx) ? fxCache.get(msg.guid).fx : [];
        fxCache.set(msg.guid, {fx: (msg.fx||[]), ts: Date.now()});
        fxReqInFlight.delete(msg.guid);
        const el = stripEls.get(msg.guid);
        if (el) updateFxSlotsUI(el, msg.guid);

        // If we just added an FX from the slots menu, auto-open its UI.
        try{
          const pending = fxPendingOpen.get(msg.guid);
          if (pending){
            const pendingKey = presetKeyFromName(pending.name || "");
            const prevIdx = new Set((prevFx||[]).map(f=>f.index));
            const added = (msg.fx||[]).filter(f=>!prevIdx.has(f.index));
            let target = null;
            if (pendingKey){
              target = added.find(f=>presetKeyFromName(f.name) === pendingKey) || (msg.fx||[]).find(f=>presetKeyFromName(f.name) === pendingKey) || null;
            }
            if (!target && added.length) target = added[0];
            if (target){
              openPluginWin(msg.guid, target.index);
              fxPendingOpen.delete(msg.guid);
            }else if (Date.now() - (pending.ts||0) > 3000){
              fxPendingOpen.delete(msg.guid);
            }
          }
        }catch(_){ }

        if (openModal && openModal.guid === msg.guid && openModal.tab === "fx"){
          openModal.fxList = msg.fx || [];
          renderModal();
        }
        // Update any open plugin windows for enable state or renamed FX.
        try{
          for (const win of pluginWins.values()){
            if (win && win.guid === msg.guid) renderPluginWin(win);
          }
        }catch(_){ }
        return;
      }
      if (msg.type === "fxParams"){
        // Update plugin window (if open)
        try{
          const k = `${msg.guid}:${msg.fxIndex}`;
          const w = pluginWins.get(k);
          if (w){
            w.params = msg.params || [];
            renderPluginWin(w);
          }
        }catch(_){ }
        if (openModal && openModal.guid === msg.guid && openModal.tab === "fxparams"){
          openModal.fxParams = msg.params || [];
          renderModal();
        }
        return;
      }
      if (msg.type === "fxPresets"){
        const key = presetKeyFromName(msg.fxName || "");
        if (!key) return;
        fxPresetCache.set(key, {presets: msg.presets || [], ts: Date.now()});
        try{
          for (const win of pluginWins.values()){
            if (!win) continue;
            const fxName = getFxNameFromCache(win.guid, win.fxIndex);
            if (presetKeyFromName(fxName) === key){
              renderPluginWin(win);
            }
          }
        }catch(_){ }
        return;
      }
    };
  }

  function rebuildIndices(){
    trackByGuid.clear();
    if (!lastState) return;
    if (lastState.master) trackByGuid.set(lastState.master.guid, lastState.master);
    for (const t of (lastState.tracks||[])) trackByGuid.set(t.guid, t);
  }

  // -----
  function escapeHtml(s){ return String(s||"").replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c])); }

  function prettyFxName(s){
    const str = String(s||"");
    // remove common REAPER prefixes in UI
    return str.replace(/^\s*(JS|AU|VST3?|VST):\s*/i, "").trim();
  }

  function presetKeyFromName(name){
    return prettyFxName(String(name||"")).trim().toLowerCase();
  }

  // ----- Helpers ----------
  function dbFromVol(vol){
    if (vol <= 0) return "-inf";
    const db = 20 * Math.log10(vol);
    return (Math.round(db*10)/10).toFixed(1);
  }
  function volFromDb(db){
    if (db <= -150) return 0;
    return Math.pow(10, db/20);
  }
  function panLabel(p){
    if (Math.abs(p) < 0.001) return "C";
    const v = Math.round(Math.abs(p)*100);
    return (p<0) ? (v+"L") : (v+"R");
  }
  function normFromDb(db){
    // map [-60..+12] to [0..1] with log feel. keep simple.
    const min=-60, max=12;
    const cl = Math.max(min, Math.min(max, db));
    return (cl - min) / (max - min);
  }
  function meterFromPeak(pk){
    if (!Number.isFinite(pk) || pk <= 0) return 0;
    const db = 20 * Math.log10(pk);
    const clamped = Math.max(-60, Math.min(0, db));
    return normFromDb(clamped);
  }
  function dbFromNorm(n){
    const min=-60, max=12;
    return min + n*(max-min);
  }
  const faderDbFromVol = (vol)=> (vol<=0) ? -150 : (20*Math.log10(vol));
  const faderYForDb = (db)=>{
    const yZero = 1 - normFromDb(0);
    if (db >= 0){
      const n = normFromDb(db);
      return 1 - n;
    }
    if (db >= -20){
      const t = Math.abs(db) / 20;
      return yZero + (0.75 - yZero) * t;
    }
    const clamped = Math.max(-60, db);
    const t = (Math.abs(clamped) - 20) / 40;
    return 0.75 + (0.25 * t);
  };
  function yFromVol(vol){
    const db = faderDbFromVol(vol);
    return Math.max(0, Math.min(1, faderYForDb(db)));
  }
  function volFromY(y){
    const clamped = Math.max(0, Math.min(1, y));
    if (clamped >= 0.995) return 0;
    const yZero = 1 - normFromDb(0);
    let db = -150;
    if (clamped <= yZero){
      const n = 1 - clamped;
      db = dbFromNorm(n);
    }else if (clamped <= 0.75){
      const t = (clamped - yZero) / (0.75 - yZero);
      db = -20 * t;
    }else{
      const t = (clamped - 0.75) / 0.25;
      db = -20 - (40 * t);
    }
    if (db <= -60) return 0;
    return volFromDb(db);
  }
  function hexOrEmpty(c){ return (typeof c==="string" && c.startsWith("#") && c.length===7) ? c : ""; }
  function hexToRgb(h){
    h = hexOrEmpty(h);
    if (!h) return null;
    return {r: parseInt(h.slice(1,3),16), g: parseInt(h.slice(3,5),16), b: parseInt(h.slice(5,7),16)};
  }


  // Folder view state
  function getFolderMode(guid){
    return cfg.folderView[guid] || "expanded";
  }
  function cycleFolderMode(guid){
    const cur = getFolderMode(guid);
    const nxt = (cur==="expanded") ? "compact" : (cur==="compact" ? "hidden" : "expanded");
    cfg.folderView[guid]=nxt; saveCfg();
    renderOrUpdate(true);
  }

  // Build visible track list with folder collapse/compact + hiddenTracks
  function buildVisibleTracks(){
  const tracks = (lastState && lastState.tracks) ? lastState.tracks : [];
  const scene = getCurrentScene();
  const expandWithParents = (allowedSet)=>{
    if (!allowedSet) return null;
    const parentsByDepth = [];
    const include = new Set(allowedSet);
    for (const t of tracks){
      const d = Number(t.indent||0);
      parentsByDepth.length = d;
      if (include.has(t.guid)){
        for (const p of parentsByDepth) include.add(p.guid);
      }
      if (Number(t.folderDepth||0) > 0){
        parentsByDepth[d] = { guid: t.guid };
      }
    }
    return include;
  };
  let sceneAllowed = null;
  if (scene && !(scene.all || scene.name === "main")){
    const base = new Set(scene.guids || []);
    // Always include the scene master track (so it renders even if not selected).
    // If the master is a folder, include its descendants too.
    const addFolderChildren = (guid, set)=>{
      if (!guid || !set) return;
      const idx = tracks.findIndex(tt=>tt && tt.guid === guid);
      if (idx < 0) return;
      const start = tracks[idx];
      const startIndent = Number(start.indent || 0);
      if (Number(start.folderDepth || 0) <= 0) return;
      for (let i = idx + 1; i < tracks.length; i++){
        const tt = tracks[i];
        const ind = Number(tt.indent || 0);
        if (ind <= startIndent) break;
        set.add(tt.guid);
      }
    };

    const masterGuid = (typeof scene.masterGuid === "string") ? scene.masterGuid : "";
    if (masterGuid){
      base.add(masterGuid);
      addFolderChildren(masterGuid, base);
    }
    sceneAllowed = expandWithParents(base);
}
  const out = [];
  const stack = []; // {guid, indent, lastVisibleGuid}
  const gapL = new Set();
  const gapR = new Set();
  const groupColors = new Map();
  const ranges = new Map();

  const closeFolder = ()=>{
    const ended = stack.pop();
    if (!ended) return;
    // Only add a "group end" gap for top-level folders.
    // Nested folders (folder-inside-folder) should not create extra spacing.
    if (ended.lastVisibleGuid && stack.length === 0) gapR.add(ended.lastVisibleGuid);
  };
  const closeFoldersToDepth = (depth)=>{
    while (stack.length > depth){
      closeFolder();
    }
  };
  const closeFoldersByCount = (count)=>{
    let left = count;
    while (left > 0 && stack.length){
      closeFolder();
      left -= 1;
    }
  };

  for (const t of tracks){
    if (sceneAllowed && !sceneAllowed.has(t.guid)){
      continue;
    }
    const indentDepth = Math.max(0, Number(t.indent || 0));
    closeFoldersToDepth(indentDepth);

    // determine if hidden/compact by any ancestor folder mode
    let hiddenByParent = false;
    let compactByParent = false;
    for (const p of stack){
      const mode = getFolderMode(p.guid);
      if (mode === "hidden"){ hiddenByParent = true; break; }
      if (mode === "compact"){ compactByParent = true; }
    }

    if (cfg.hiddenTracks[t.guid]) {
      // still need to keep folder stack in sync if a hidden track is a folder-start (rare),
      // but since it's hidden explicitly, we treat it as not starting a visible group.
      continue;
    }

    const isVisible = !hiddenByParent;
    if (isVisible){
      const groupId = (stack.length > 0) ? stack[stack.length - 1].guid : (t.folderDepth > 0 ? t.guid : null);
      if (t.spacerAbove){
        const spacerGroupId = (stack.length > 0 || t.folderDepth <= 0) ? groupId : null;
        out.push({
          kind: "spacer",
          guid: `spacer:${t.guid}`,
          targetGuid: t.guid,
          width: (cfg.spacerWidths && cfg.spacerWidths[t.guid]) ? cfg.spacerWidths[t.guid] : "standard",
          _compact: compactByParent || !!cfg.compactTracks[t.guid],
          _folderGroupId: spacerGroupId,
        });
      }
      if (t.folderDepth > 0){
        groupColors.set(t.guid, t.color || "");
        ranges.set(t.guid, {startGuid: t.guid, lastGuid: t.guid, indent: t.indent, color: t.color || ""});
      }
      const groupColor = groupId ? (groupColors.get(groupId) || "") : "";
      const item = Object.assign({}, t, { _compact: compactByParent || !!cfg.compactTracks[t.guid], _folderGroupId: groupId, _folderGroupColor: groupColor });
      out.push(item);

      // group start gap
      // Only add a "group start" gap for top-level folders.
      // Nested folders should not have an extra left gap.
      if (t.folderDepth > 0 && stack.length === 0){
        gapL.add(t.guid);
      }

      // update last visible for all open folders
      for (const p of stack){
        p.lastVisibleGuid = t.guid;
        if (p.range) p.range.lastGuid = t.guid;
      }

      // push folder start
      if (t.folderDepth > 0){
        const range = ranges.get(t.guid);
        stack.push({guid: t.guid, indent: t.indent, lastVisibleGuid: t.guid, range});
      }
    } else {
      // if parent is compact we still consider it hidden? (no) — hidden means not rendered, so skip.
      // Do not push hidden folder starts; their children are already hidden by ancestor.
    }

    if (t.folderDepth < 0){
      closeFoldersByCount(Math.abs(t.folderDepth));
    }
  }

  // close remaining folders at end
  closeFoldersToDepth(0);

  // update ranges for folder frames
  folderRanges = ranges;

  // attach gap flags
  return out.map(it=>Object.assign(it, {
    _gapL: gapL.has(it.guid),
    _gapR: gapR.has(it.guid),
  }));
}


  // ---------- Rendering ----------
  const mixer = document.getElementById("mixer");
  const mixerWrap = document.getElementById("mixerWrap");
  let folderFrames = null;
  let folderFrameRaf = 0;

  function ensureFolderFrames(){
    if (!mixerWrap) return null;
    if (!folderFrames){
      folderFrames = document.getElementById("folderFrames");
      if (!folderFrames){
        folderFrames = document.createElement("div");
        folderFrames.id = "folderFrames";
        mixerWrap.appendChild(folderFrames);
      }
    }
    return folderFrames;
  }

  function updateFolderFrames(){
    const layer = ensureFolderFrames();
    if (!layer || !mixerWrap) return;
    // Show/hide the overlay layer depending on whether we have any folder ranges.
    // (CSS defaults to display:none.)
    const hasFrames = !!(folderRanges && folderRanges.size);
    layer.style.display = hasFrames ? "block" : "none";
    layer.innerHTML = "";
    if (!hasFrames) return;
    const wrapRect = mixerWrap.getBoundingClientRect();

    // If a nested folder shares an outer edge (same startGuid or lastGuid) with a
    // shallower (parent) folder, their borders would overlap visually.
    // We detect this and inset the nested border slightly on the shared edge.
    const minIndentByStart = new Map();
    const minIndentByEnd = new Map();
    for (const info of folderRanges.values()){
      const il = Math.max(0, Math.min(8, Number(info.indent || 0)));
      const s = info.startGuid, e = info.lastGuid;
      if (s != null){
        const cur = minIndentByStart.get(s);
        if (cur == null || il < cur) minIndentByStart.set(s, il);
      }
      if (e != null){
        const cur = minIndentByEnd.get(e);
        if (cur == null || il < cur) minIndentByEnd.set(e, il);
      }
    }
    // Visual nesting: deeper folders should appear "stepped" and shorter (reduced height)
    // so hierarchy is obvious. We shrink frames inward on X (to sit in the 8px gap) and
    // shift the top down proportionally to indent level.
    const GAP = 8; // #mixer gap
    // The folderGroup rect already includes equal left/right padding for the border.
    const PAD_X = 3;
    const PAD_Y = 3;
    const SHARED_EDGE_INSET = 8; // px
    for (const info of folderRanges.values()){
      const startEl = stripEls.get(info.startGuid) || null;
      let groupEl = folderGroupEls.get(info.startGuid) || (startEl ? startEl.closest(".folderGroup") : null);
      if (!groupEl && startEl && startEl.parentElement){
        // fallback: if folder wrapper missing, frame the start->end strip range
        groupEl = null;
      }
      if (!groupEl){
        const endEl = stripEls.get(info.lastGuid) || startEl;
        if (!startEl || !endEl) continue;
        const rs = startEl.getBoundingClientRect();
        const re = endEl.getBoundingClientRect();
        const left = Math.min(rs.left, re.left) - wrapRect.left + mixerWrap.scrollLeft;
        const right = Math.max(rs.right, re.right) - wrapRect.left + mixerWrap.scrollLeft;
        const top = Math.min(rs.top, re.top) - wrapRect.top + mixerWrap.scrollTop;
        const bottom = Math.max(rs.bottom, re.bottom) - wrapRect.top + mixerWrap.scrollTop;
        // Create a synthetic rect-like object for unified logic below.
        groupEl = { getBoundingClientRect: ()=>({left: left+wrapRect.left-mixerWrap.scrollLeft, right: right+wrapRect.left-mixerWrap.scrollLeft, top: top+wrapRect.top-mixerWrap.scrollTop, bottom: bottom+wrapRect.top-mixerWrap.scrollTop}) };
      }
      // Compute frame bounds from the *visible strips* inside the folder group.
// Using the folderGroup wrapper rect can include extra hierarchy insets (margins/padding),
// which makes frames look loose and inconsistent across browsers.
let rg = null;
try{
  if (groupEl && groupEl.querySelectorAll){
    const stripNodes = groupEl.querySelectorAll(".strip");
    if (stripNodes && stripNodes.length){
      let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
      stripNodes.forEach((sn)=>{
        if (!sn || !sn.getBoundingClientRect) return;
        const rr = sn.getBoundingClientRect();
        // Ignore zero-size nodes (can happen during transitions/remounts)
        if (!rr || rr.width <= 0 || rr.height <= 0) return;
        minL = Math.min(minL, rr.left);
        minT = Math.min(minT, rr.top);
        maxR = Math.max(maxR, rr.right);
        maxB = Math.max(maxB, rr.bottom);
      });
      if (Number.isFinite(minL) && Number.isFinite(minT) && Number.isFinite(maxR) && Number.isFinite(maxB)){
        rg = {left:minL, top:minT, right:maxR, bottom:maxB};
      }
    }
  }
}catch(_){ }
if (!rg && groupEl && groupEl.getBoundingClientRect) rg = groupEl.getBoundingClientRect();
if (!rg) continue;
const left = rg.left - wrapRect.left + mixerWrap.scrollLeft;
const right = rg.right - wrapRect.left + mixerWrap.scrollLeft;
const top = rg.top - wrapRect.top + mixerWrap.scrollTop;
const bottom = rg.bottom - wrapRect.top + mixerWrap.scrollTop;

const indentLevel = Math.max(0, Math.min(8, Number(info.indent || 0)));
      const shareLeft = (minIndentByStart.get(info.startGuid) ?? indentLevel) < indentLevel;
      const shareRight = (minIndentByEnd.get(info.lastGuid) ?? indentLevel) < indentLevel;

      const frame = document.createElement("div");
      frame.className = "folderFrame";
      // Place the border inside the outer gap.
      // The actual "shorter nested" look is driven by CSS vertical padding on .folderGroup
      // (tracks shrink), so the frame should follow the visible strips without applying
      // an additional Y-step here (avoids double-stepping).
      let frameLeft = left - PAD_X;
      const frameTop = top - PAD_Y;
      let frameRight = right + PAD_X;
      const frameBottom = bottom + PAD_Y;

      const symInset = (shareLeft || shareRight) ? Math.max(2, Math.floor(SHARED_EDGE_INSET/2)) : 0;
      if (symInset){ frameLeft += symInset; frameRight -= symInset; }
      frame.style.left = frameLeft + "px";
      frame.style.top = frameTop + "px";
      frame.style.width = Math.max(0, frameRight - frameLeft) + "px";
      frame.style.height = Math.max(0, frameBottom - frameTop) + "px";
      frame.style.opacity = String(1 - Math.min(0.35, indentLevel * 0.06));
      if (info.color) frame.style.borderColor = info.color;
      layer.appendChild(frame);
    }
  }

  function scheduleFolderFrames(){
    if (folderFrameRaf) cancelAnimationFrame(folderFrameRaf);
    folderFrameRaf = requestAnimationFrame(()=>{
      folderFrameRaf = 0;
      updateFolderFrames();
    });
  }

  function layoutMixer(items){
    mixer.innerHTML = "";
    folderGroupEls.clear();
    const root = mixer;
    const groupStack = [];
    const appendToCurrent = (el)=>{
      const parent = groupStack.length ? groupStack[groupStack.length - 1] : root;
      parent.appendChild(el);
    };
    for (const it of items){
      const el = stripEls.get(it.guid);
      if (!el) continue;
      if (it.kind === "master"){
        root.appendChild(el);
        continue;
      }
      if (it.kind === "spacer"){
        appendToCurrent(el);
        continue;
      }
      if (it.folderDepth > 0){
        const group = document.createElement("div");
        group.className = "folderGroup";
        folderGroupEls.set(it.guid, group);
        const indentValue = Math.max(0, Math.min(8, Number(it.indent || 0)));
        group.dataset.indent = String(indentValue);
        const col = hexOrEmpty(it.color);
        if (col) group.style.setProperty("--trackColor", col);
        appendToCurrent(group);
        group.appendChild(el);
        groupStack.push(group);
      } else {
        appendToCurrent(el);
      }
      if (it.folderDepth < 0){
        let left = Math.abs(it.folderDepth);
        while (left > 0 && groupStack.length){
          groupStack.pop();
          left -= 1;
        }
      }
    }
  }

  if (mixerWrap){
    mixerWrap.addEventListener("scroll", scheduleFolderFrames, {passive:true});
    mixerWrap.addEventListener("dragover", (ev)=>{
      if (!draggingTrackGuid && !draggingSpacerGuid) return;
      ev.preventDefault();
      updateMouseDropTarget(ev.clientX, ev.clientY);
      ev.dataTransfer.dropEffect = "move";
    });
    mixerWrap.addEventListener("dragleave", (ev)=>{
      if (!draggingTrackGuid && !draggingSpacerGuid) return;
      if (ev.relatedTarget && ev.relatedTarget.closest && ev.relatedTarget.closest(".strip")) return;
      clearDropHighlight();
    });
    mixerWrap.addEventListener("dblclick", (ev)=>{
      if (ev.target.closest(".strip")) return;
      wsSend({type:"addTrack"});
      setTimeout(()=>wsSend({type:"reqState"}), 120);
    });
    mixerWrap.addEventListener("contextmenu", (ev)=>{
      if (ev.target.closest(".strip")) return;
      ev.preventDefault();
      openMixerContextMenu(ev.clientX, ev.clientY);
    });
    mixerWrap.addEventListener("pointerdown", (ev)=>{
      if (ev.pointerType !== "touch") return;
      if (ev.target.closest(".strip")) return;
      const startX = ev.clientX;
      const startY = ev.clientY;
      let active = true;
      const hold = setTimeout(()=>{
        if (!active) return;
        openMixerContextMenu(startX, startY);
      }, 650);
      const move = (e)=>{
        if (!active) return;
        if (Math.hypot(e.clientX - startX, e.clientY - startY) > 12){
          clearTimeout(hold);
          cleanup();
        }
      };
      const up = ()=>{
        if (!active) return;
        clearTimeout(hold);
        cleanup();
      };
      const cancel = ()=>{
        if (!active) return;
        clearTimeout(hold);
        cleanup();
      };
      const cleanup = ()=>{
        active = false;
        document.removeEventListener("pointermove", move, true);
        document.removeEventListener("pointerup", up, true);
        document.removeEventListener("pointercancel", cancel, true);
      };
      document.addEventListener("pointermove", move, true);
      document.addEventListener("pointerup", up, true);
      document.addEventListener("pointercancel", cancel, true);
    });
  }
  window.addEventListener("resize", scheduleFolderFrames, {passive:true});

  function clearMixer(){
    mixer.innerHTML = "";
    folderGroupEls.clear();
    stripEls.clear();
    meterEls.clear();
    if (folderFrames) folderFrames.innerHTML = "";
  }

  function getSceneMasterItem(){
    try{
      if (!cfg.masterEnabled || !lastState) return null;
      const cur = getCurrentScene ? getCurrentScene() : null;
      // Main/all scenes: built-in MASTER
      if (!cur || cur.name === "main" || cur.all) return lastState.master || null;

      // Other scenes: optionally use a track as the scene master
      const mg0 = (typeof cur.masterGuid === "string") ? cur.masterGuid : "";
      const mg = (mg0 === "MASTER") ? "" : mg0;
      if (!mg) return null;

      const tr = (lastState.tracks || []).find(t=>t && t.guid === mg);
      if (!tr) return null;

      // Render this track as the master strip (controls will target this track via its GUID)
      return Object.assign({}, tr, { kind: "master", _sceneMaster: true });
    }catch(_e){
      return null;
    }
  }

  function orderedItems(){
    const items = [];
    if (!lastState) return items;

    const sceneMaster = getSceneMasterItem();
    let vis = buildVisibleTracks();

    // Avoid duplicate: if a scene master track is rendered as master strip, remove it from the normal list.
    if (sceneMaster && sceneMaster.guid && sceneMaster.guid !== "MASTER"){
      vis = vis.filter(t=>t && t.guid !== sceneMaster.guid);
    }

    if (sceneMaster && cfg.masterSide === "left") items.push(sceneMaster);
    for (const t of vis) items.push(t);
    if (sceneMaster && cfg.masterSide === "right") items.push(sceneMaster);
    return items;
  }

  function renderOrUpdate(forceRebuild=false){
    try{
      if (!lastState) return;
      const items = orderedItems();
      const wantOrder = items.map(x=>x.guid).join("|");
      const haveOrder = mixer.getAttribute("data-order") || "";
      const orderChanged = haveOrder !== wantOrder;
      const mustRebuild = forceRebuild || stripEls.size === 0;

      // SOLO dim logic
      const anySolo = (lastState.tracks||[]).some(t=>t.solo);
      document.body.classList.toggle("dimOthers", anySolo);

      if (mustRebuild){
        clearMixer();
        mixer.setAttribute("data-order", wantOrder);
        for (const it of items){
          const el = createStrip(it);
          stripEls.set(it.guid, el);
        }
      } else if (orderChanged){
        const firstRects = new Map();
        for (const [guid, el] of stripEls){
          if (!el || !el.getBoundingClientRect) continue;
          firstRects.set(guid, el.getBoundingClientRect());
        }
        const wanted = new Set(items.map(it=>it.guid));
        for (const [guid, el] of stripEls){
          if (wanted.has(guid)) continue;
          try{ el.remove(); }catch(_){ }
          stripEls.delete(guid);
        }
        for (const it of items){
          let el = stripEls.get(it.guid);
          if (!el){
            el = createStrip(it);
            stripEls.set(it.guid, el);
          }
        }
        mixer.setAttribute("data-order", wantOrder);
        for (const it of items){
          const el = stripEls.get(it.guid);
          if (!el) continue;
          updateStrip(el, it);
          const first = firstRects.get(it.guid);
          if (!first) continue;
          const last = el.getBoundingClientRect();
          const dx = first.left - last.left;
          const dy = first.top - last.top;
          if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5){
            el.style.transition = "none";
            el.style.transform = `translate(${dx}px, ${dy}px)`;
            el.getBoundingClientRect();
            requestAnimationFrame(()=>{
              el.style.transition = "transform 180ms ease";
              el.style.transform = "";
            });
          }
        }
      } else {
        for (const it of items){
          const el = stripEls.get(it.guid);
          if (el) updateStrip(el, it);
        }
      }

      layoutMixer(items);
      try{ if (mixer && mixer.children && mixer.children.length===0 && items && items.length){ uiLog("mixer_dom_empty_after_layout items="+items.length+" order="+(mixer.getAttribute("data-order")||"")); } }catch(_e){}

      // Apply meters to ensure elements exist
      if (lastMeters) applyMeters(lastMeters);
      scheduleFolderFrames();
      updateStatus();

    } catch (e){
      showError(e && e.message ? e.message : String(e));
    }
  }

  function updateSpacerStrip(el, t){
    if (!el) return;
    el.classList.add("spacer");
    el.setAttribute("data-guid", t.guid);
    const label = el._spacerLabel;
    if (label){
      label.textContent = "";
    }
    el.classList.toggle("narrow", !!t._compact || t.width === "narrow");
    el.classList.toggle("wide", !t._compact && t.width === "wide");
    el.dataset.targetGuid = t.targetGuid || "";
    if (t._folderGroupId){
      el.dataset.folderGroup = t._folderGroupId;
    } else {
      delete el.dataset.folderGroup;
    }
  }

  function getNextStripGuid(guid){
    if (!guid) return "";
    const items = orderedItems();
    const idx = items.findIndex(it => it.guid === guid);
    if (idx < 0) return "";
    for (let i = idx + 1; i < items.length; i += 1){
      const next = items[i];
      if (next && next.guid) return next.guid;
    }
    return "";
  }

  function getNextTrackGuid(guid){
    if (!guid) return "";
    const items = orderedItems();
    const idx = items.findIndex(it => it.guid === guid);
    if (idx < 0) return "";
    for (let i = idx + 1; i < items.length; i += 1){
      const next = items[i];
      if (!next) continue;
      if (next.kind === "spacer") continue;
      if (next.kind === "master") continue;
      return next.guid;
    }
    return "";
  }

  function getNextTrackGuidAfter(guid, skipGuid){
    if (!guid) return "";
    const items = orderedItems();
    const idx = items.findIndex(it => it.guid === guid);
    if (idx < 0) return "";
    for (let i = idx + 1; i < items.length; i += 1){
      const next = items[i];
      if (!next || !next.guid) continue;
      if (next.guid === skipGuid) continue;
      if (next.kind === "spacer") continue;
      if (next.kind === "master") continue;
      return next.guid;
    }
    return "";
  }

  function getNextProjectTrackGuid(guid, skipGuid){
    if (!lastState || !Array.isArray(lastState.tracks)) return '';
    const tracks = lastState.tracks;
    const idx = tracks.findIndex(t=>t && t.guid === guid);
    if (idx < 0) return '';
    for (let i = idx + 1; i < tracks.length; i += 1){
      const t = tracks[i];
      if (!t || !t.guid) continue;
      if (t.guid === skipGuid) continue;
      return t.guid;
    }
    return '';
  }

  function moveSpacerWidth(oldGuid, newGuid){
    if (!oldGuid || !newGuid || oldGuid === newGuid) return;
    const widths = cfg.spacerWidths || {};
    if (!Object.prototype.hasOwnProperty.call(widths, oldGuid)) return;
    widths[newGuid] = widths[oldGuid];
    delete widths[oldGuid];
    cfg.spacerWidths = widths;
    saveCfg();
  }

  function setDropHighlight(el, after){
    if (!el) return;
    if (dragDropEl && dragDropEl !== el){
      dragDropEl.classList.remove("dropBefore", "dropAfter");
    }
    dragDropEl = el;
    el.classList.toggle("dropAfter", !!after);
    el.classList.toggle("dropBefore", !after);
    dragDropState = {guid: el.dataset.targetGuid || el.dataset.guid || "", after: !!after};
  }

  function setDragDropTarget(el){
    if (dragDropTargetEl && dragDropTargetEl !== el){
      dragDropTargetEl.classList.remove("dropTarget");
    }
    dragDropTargetEl = el;
    if (dragDropTargetEl){
      dragDropTargetEl.classList.add("dropTarget");
    }
  }

  function updateMouseDropTarget(x, y){
    const el = document.elementFromPoint(x, y);
    const strip = el ? el.closest(".strip") : null;
    const info = getDropTargetInfo(strip);
    if (!strip || !info || info.guid === draggingTrackGuid || info.guid === draggingSpacerGuid){
      clearDropHighlight();
      return;
    }
    setDragDropTarget(strip);
    try{
      const rect = strip.getBoundingClientRect();
      const after = (x - rect.left) > rect.width / 2;
      setDropHighlight(strip, after);
    }catch(_){ }
  }

  function attachTrackReorder(el, t){
    if (!el || t.kind === "master") return;

    // Drag reorder (mouse)
    if (!cfg.trackReorderMouseEnabled){
      try{ el.setAttribute('draggable','false'); }catch(_){}
    }

    // Drag reorder (mouse)
    if (cfg.trackReorderMouseEnabled) el.setAttribute("draggable", "true");
    else el.setAttribute("draggable","false");
    el.addEventListener("dragstart", (ev)=>{
      if (isTrackDragBlocked()){
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      // Don't start drag-reorder when the gesture begins on interactive controls.
      if (ev.target && ev.target.closest && ev.target.closest("input, button, .btn, .thumb, .faderHit, .faderBox, .panBox, .panSlider, .fxSlots, .fxSlot, .fxSlotActions, .slotbtn")){
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      draggingTrackGuid = t.guid;
      el.classList.add("dragging");
      document.body.classList.add("draggingTrack");
      ev.dataTransfer.effectAllowed = "move";
      try{ ev.dataTransfer.setData("text/plain", t.guid); }catch(_){}
    });
    el.addEventListener("dragenter", (ev)=>{
      if (draggingTrackGuid && draggingTrackGuid !== t.guid) el.classList.add("dropTarget");
      if (draggingSpacerGuid && draggingSpacerGuid !== t.guid) el.classList.add("dropTarget");
    });
    el.addEventListener("dragleave", ()=>{
      el.classList.remove("dropTarget");
      el.classList.remove("dropAfter", "dropBefore");
      if (dragDropEl === el) clearDropHighlight();
    });
    el.addEventListener("dragover", (ev)=>{
      if (!draggingTrackGuid && !draggingSpacerGuid) return;
      if (draggingTrackGuid === t.guid || draggingSpacerGuid === t.guid) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
      const rect = el.getBoundingClientRect();
      const after = (ev.clientX - rect.left) > rect.width / 2;
      setDropHighlight(el, after);
    });
    el.addEventListener("drop", (ev)=>{
      ev.preventDefault();
      const dropState = dragDropState ? {guid: dragDropState.guid, after: dragDropState.after} : null;
      el.classList.remove("dropTarget");
      el.classList.remove("dropAfter", "dropBefore");
      clearDropHighlight();
      const dropGuid = (dropState && dropState.guid) ? dropState.guid : t.guid;
      if (draggingSpacerGuid && draggingSpacerGuid !== dropGuid){
        const beforeGuid = (dropState && dropState.after)
          ? (getNextTrackGuidAfter(dropGuid, draggingSpacerGuid) || dropGuid)
          : dropGuid;
        wsSend({type:"setSpacer", guid: draggingSpacerGuid, enabled:false});
        wsSend({type:"setSpacer", guid: beforeGuid, enabled:true});
        moveSpacerWidth(draggingSpacerGuid, beforeGuid);
        renderOrUpdate(true);
        draggingSpacerGuid = null;
        setTimeout(()=>wsSend({type:"reqState"}), 10);
        return;
      }
      if (!draggingTrackGuid || draggingTrackGuid === dropGuid) return;
      const info = getDropTargetInfo(el);
      const after = !!(dropState && dropState.after);
      if (info && info.folderGuid && info.guid === info.folderGuid && info.guid === dropGuid && after){
        wsSend({type:"moveTrackToFolder", guid: draggingTrackGuid, folderGuid: info.folderGuid});
      } else {
        const targetIndex = getDropTrackTargetIndex(dropGuid, draggingTrackGuid, after);
        if (targetIndex != null){
          const beforeGuid = after ? (getNextProjectTrackGuid(dropGuid, draggingTrackGuid) || '') : dropGuid;
          if (beforeGuid){
            wsSend({type:"moveTrack", guid: draggingTrackGuid, beforeGuid});
            applyOptimisticMove(draggingTrackGuid, beforeGuid);
          } else {
            const beforeGuid = after ? (getNextProjectTrackGuid(dropGuid, draggingTrackGuid) || '') : dropGuid;
          if (beforeGuid){
            wsSend({type:"moveTrack", guid: draggingTrackGuid, beforeGuid});
            applyOptimisticMove(draggingTrackGuid, beforeGuid);
          } else {
            wsSend({type:"moveTrack", guid: draggingTrackGuid, toIndex: targetIndex});
            applyOptimisticMoveToIndex(draggingTrackGuid, targetIndex);
          }
          }
          renderOrUpdate();
        }
      }
      draggingTrackGuid = null;
      setTimeout(()=>wsSend({type:"reqState"}), 10);
    });
    el.addEventListener("dragend", ()=>{
      draggingTrackGuid = null;
      el.classList.remove("dragging");
      el.classList.remove("dropTarget");
      el.classList.remove("dropAfter", "dropBefore");
      clearDropHighlight();
      document.body.classList.remove("draggingTrack");
    });

    // Touch hold-to-drag
    el.addEventListener("pointerdown", (ev)=>{
      if (!cfg.trackReorderTouchEnabled) return;
      if (ev.pointerType !== "touch") return;
      startHoldDrag(t, el, ev, 900);
    });

  }

  function attachSpacerReorder(el, t){
    if (!el || !t) return;
    if (cfg.trackReorderMouseEnabled) el.setAttribute("draggable", "true");
    else el.setAttribute("draggable","false");
    el.addEventListener("dragstart", (ev)=>{
      if (isTrackDragBlocked()){
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      // Don't start drag-reorder when the gesture begins on interactive controls.
      if (ev.target && ev.target.closest && ev.target.closest("input, button, .btn, .thumb, .faderHit, .faderBox, .panBox, .panSlider, .fxSlots, .fxSlot, .fxSlotActions, .slotbtn")){
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      if (!t.targetGuid) return;
      draggingSpacerGuid = t.targetGuid;
      el.classList.add("dragging");
      document.body.classList.add("draggingTrack");
      ev.dataTransfer.effectAllowed = "move";
      try{ ev.dataTransfer.setData("text/plain", t.targetGuid); }catch(_){}
    });
    el.addEventListener("dragenter", (ev)=>{
      if (draggingSpacerGuid && draggingSpacerGuid !== t.targetGuid) el.classList.add("dropTarget");
      if (draggingTrackGuid && draggingTrackGuid !== t.targetGuid) el.classList.add("dropTarget");
    });
    el.addEventListener("dragleave", ()=>{
      el.classList.remove("dropTarget");
      el.classList.remove("dropAfter", "dropBefore");
      if (dragDropEl === el) clearDropHighlight();
    });
    el.addEventListener("dragover", (ev)=>{
      if (!draggingSpacerGuid && !draggingTrackGuid) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
      const rect = el.getBoundingClientRect();
      const after = (ev.clientX - rect.left) > rect.width / 2;
      setDropHighlight(el, after);
    });
    el.addEventListener("drop", (ev)=>{
      ev.preventDefault();
      const dropState = dragDropState ? {guid: dragDropState.guid, after: dragDropState.after} : null;
      el.classList.remove("dropTarget");
      el.classList.remove("dropAfter", "dropBefore");
      clearDropHighlight();
      const dropGuid = (dropState && dropState.guid) ? dropState.guid : t.targetGuid;
      if (draggingSpacerGuid && dropGuid && draggingSpacerGuid !== dropGuid){
        const beforeGuid = (dropState && dropState.after)
          ? (getNextTrackGuidAfter(dropGuid, draggingSpacerGuid) || dropGuid)
          : dropGuid;
        wsSend({type:"setSpacer", guid: draggingSpacerGuid, enabled:false});
        wsSend({type:"setSpacer", guid: beforeGuid, enabled:true});
        moveSpacerWidth(draggingSpacerGuid, beforeGuid);
        renderOrUpdate(true);
        draggingSpacerGuid = null;
        setTimeout(()=>wsSend({type:"reqState"}), 10);
        return;
      }
      if (draggingTrackGuid && dropGuid){
        const info = getDropTargetInfo(el);
        if (info && info.folderGuid && info.guid === info.folderGuid && info.guid === dropGuid){
          wsSend({type:"moveTrackToFolder", guid: draggingTrackGuid, folderGuid: info.folderGuid});
        } else {
          const after = !!(dropState && dropState.after);
          const targetIndex = getDropTrackTargetIndex(dropGuid, draggingTrackGuid, after);
          if (targetIndex != null){
            const beforeGuid = after ? (getNextProjectTrackGuid(dropGuid, draggingTrackGuid) || '') : dropGuid;
          if (beforeGuid){
            wsSend({type:"moveTrack", guid: draggingTrackGuid, beforeGuid});
            applyOptimisticMove(draggingTrackGuid, beforeGuid);
          } else {
            const beforeGuid = after ? (getNextProjectTrackGuid(dropGuid, draggingTrackGuid) || '') : dropGuid;
          if (beforeGuid){
            wsSend({type:"moveTrack", guid: draggingTrackGuid, beforeGuid});
            applyOptimisticMove(draggingTrackGuid, beforeGuid);
          } else {
            wsSend({type:"moveTrack", guid: draggingTrackGuid, toIndex: targetIndex});
            applyOptimisticMoveToIndex(draggingTrackGuid, targetIndex);
          }
          }
            renderOrUpdate(true);
          }
        }
        draggingTrackGuid = null;
        setTimeout(()=>wsSend({type:"reqState"}), 10);
      }
    });
    el.addEventListener("dragend", ()=>{
      draggingSpacerGuid = null;
      el.classList.remove("dragging");
      el.classList.remove("dropTarget");
      el.classList.remove("dropAfter", "dropBefore");
      clearDropHighlight();
      document.body.classList.remove("draggingTrack");
    });

    el.addEventListener("pointerdown", (ev)=>{
      if (!cfg.trackReorderTouchEnabled) return;
      if (ev.pointerType !== "touch") return;
      startHoldDrag(t, el, ev, 900);
    });
  }

  function createSpacerStrip(t){
    const el = document.createElement("div");
    el.className = "strip spacer";
    el.setAttribute("data-guid", t.guid);
    el.dataset.targetGuid = t.targetGuid || "";
    const label = document.createElement("div");
    label.className = "spacerLabel";
    el.appendChild(label);
    el._spacerLabel = label;

    el.addEventListener("contextmenu", (ev)=>{
      ev.preventDefault();
      ev.stopPropagation();
      openSpacerContextMenu(t, ev.clientX, ev.clientY);
    });
    attachTouchHoldMenu(el, (x, y)=> openSpacerContextMenu(t, x, y));

    attachSpacerReorder(el, t);
    updateSpacerStrip(el, t);
    return el;
  }

  
  function getSceneMasterStripName(){
    try{
      const cur = getCurrentScene ? getCurrentScene() : null;
      if (!cur) return "MASTER";
      if (cur.name === "main") return "MASTER";
      const mg = (typeof cur.masterGuid === "string") ? cur.masterGuid : "";
      if (!mg) return "MASTER";
      const tracks = (lastState && lastState.tracks) ? lastState.tracks : [];
      const t = tracks.find(tt=>tt && tt.guid === mg);
      if (t && t.name) return String(t.name) + " (master)";
      return String(mg) + " (master)";
    }catch{ return "MASTER"; }
  }

function createStrip(t){
    if (t.kind === "spacer"){
      return createSpacerStrip(t);
    }
    const el = document.createElement("div");
    el.className = "strip" + (t.kind==="master" ? " master" : "");
    el.setAttribute("data-guid", t.guid);

    const accent = document.createElement("div");
    accent.className = "accent";
    const col = hexOrEmpty(t.color);
    if (col) accent.style.background = col;
    el.appendChild(accent);

    const header = document.createElement("div");
    header.className = "header";
    el.appendChild(header);

    const hrow = document.createElement("div");
    hrow.className = "hrow";
    header.appendChild(hrow);

    const id = document.createElement("div");
    id.className = "trackId";
    id.textContent = (t.kind==="master") ? "" : String(t.idx||"");
    hrow.appendChild(id);

    const title = document.createElement("div");
    title.className = "title";
    title.innerHTML = `<span class="name"></span>`;
    title.querySelector(".name").textContent = (t.kind==="master") ? getSceneMasterStripName() : (t.name || "");
    hrow.appendChild(title);

    // slot bars (FX / SENDS) like DAW, optional
    const slotbar = document.createElement("div");
    slotbar.className = "slotbar";
    header.appendChild(slotbar);

    const fxBtn = document.createElement("div");
    fxBtn.className = "slotbtn";
    fxBtn.textContent = "FX";
    // Always show header FX button (it navigates to the FX tab in track params)
    fxBtn.style.display = "flex";
    slotbar.appendChild(fxBtn);

    const sendsBtn = document.createElement("div");
    sendsBtn.className = "slotbtn";
    sendsBtn.textContent = "Sends";
    // Always show header Returns/Sends button
    sendsBtn.style.display = "flex";
    slotbar.appendChild(sendsBtn);

const folderBtn = document.createElement("div");
folderBtn.className = "slotbtn folderbtn";
folderBtn.textContent = "▾";
folderBtn.style.display = "none";
slotbar.appendChild(folderBtn);

    const body = document.createElement("div");
    body.className = "body";
    el.appendChild(body);

    const fxSlots = document.createElement("div");
    fxSlots.className = "fxSlots";
    fxSlots.style.display = cfg.showFxSlots ? "flex" : "none";
    body.appendChild(fxSlots);

    // If strips are recreated (e.g. layout refresh), restore the last known
    // scroll position immediately on mount. This prevents the "spring back"
    // effect where the user scrolls, then a UI refresh resets to 0.
    try{
      const saved = fxSlotsScroll.get(t.guid);
      if (typeof saved === "number" && saved > 0){
        requestAnimationFrame(()=>{
          const max = Math.max(0, (fxSlots.scrollHeight - fxSlots.clientHeight));
          fxSlots.scrollTop = Math.max(0, Math.min(max, saved));
        });
      }
    }catch(_){ }

    
    
    // Keep FX slots scroll position stable across UI refreshes and Chromium "inertia snap" quirks.
    // Optional: controlled by Settings → Interface → Hold FX slots scroll.
    if (cfg.fxSlotsScrollHoldEnabled && (cfg.fxSlotsScrollHoldSec||0) > 0){
    try{
      const nowTs = ()=> ((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now());
      const clamp = (v, a, b)=> Math.max(a, Math.min(b, v));

      const holdMs = Math.max(500, Math.min(120000, (parseInt(cfg.fxSlotsScrollHoldSec||40,10)||40) * 1000));

      const markUserInput = ()=>{
        fxSlots._userInputTs = nowTs();
      };
      // Wheel/trackpad + touch: mark that subsequent scroll events are user-driven.
      fxSlots.addEventListener("wheel", markUserInput, {passive:true});
      fxSlots.addEventListener("touchstart", markUserInput, {passive:true});
      fxSlots.addEventListener("pointerdown", (ev)=>{
        // pointerdown is more reliable than touchstart on some browsers
        if (!ev) return;
        if (ev.pointerType === "touch" || ev.pointerType === "mouse" || ev.pointerType === "pen"){
          markUserInput();
        }
      }, {passive:true});

      const scheduleGuard = ()=>{
        if (fxSlots._guardRaf) return;
        const token = (fxSlots._guardToken || 0) + 1;
        fxSlots._guardToken = token;

        const tick = ()=>{
          if (fxSlots._guardToken !== token) return;
          const ts = nowTs();
          const until = fxSlots._guardUntil || 0;
          if (ts > until){
            fxSlots._guardRaf = 0;
            return;
          }

          const desired = (typeof fxSlots._scrollDesired === "number") ? fxSlots._scrollDesired
            : ((typeof fxSlots._lastGoodScrollTop === "number") ? fxSlots._lastGoodScrollTop : 0);
          const max = Math.max(0, (fxSlots.scrollHeight - fxSlots.clientHeight));
          const want = clamp(desired, 0, max);
          const cur = fxSlots.scrollTop || 0;

          // Restore when the browser snaps away from our desired value (usually towards the top).
          // Use a small cooldown to avoid oscillation.
          const lastRestore = fxSlots._lastRestoreTs || 0;
          const snapped = (want > 2 && max > 10) && ((cur <= 2 && want > 2) || (cur + 8 < want));
          if (snapped && (ts - lastRestore) > 90){
            fxSlots._ignoreNextScroll = true;
            fxSlots.scrollTop = want;
            fxSlots._lastRestoreTs = ts;
          }

          fxSlots._guardRaf = requestAnimationFrame(tick);
        };
        fxSlots._guardRaf = requestAnimationFrame(tick);
      };

      fxSlots.addEventListener("scroll", ()=>{
        const ts = nowTs();
        const st = fxSlots.scrollTop || 0;
        const max = Math.max(0, (fxSlots.scrollHeight - fxSlots.clientHeight));

        // Ignore scroll events triggered by our own restore.
        if (fxSlots._ignoreNextScroll){
          fxSlots._ignoreNextScroll = false;
          fxSlots._prevScrollTop = st;
          fxSlots._prevScrollTs = ts;
          return;
        }

        const prev = (typeof fxSlots._prevScrollTop === "number") ? fxSlots._prevScrollTop : st;
        const prevTs = fxSlots._prevScrollTs || 0;
        const gap = ts - prevTs;
        // Momentum scroll generates continuous scroll events; treat those as user-driven.
        if (gap >= 0 && gap < 80){ fxSlots._userInputTs = ts; }
        const jump = prev - st;

        // Update last-good scroll whenever we're not near the very top.
        if (st > 2 && max > 10){
          fxSlots._lastGoodScrollTop = st;
          fxSlots._lastGoodTs = ts;
          try{ fxSlotsLastGood.set(t.guid, st); }catch(_){ }
        }

        const lastGood = (typeof fxSlots._lastGoodScrollTop === "number") ? fxSlots._lastGoodScrollTop : 0;
        const lastGoodTs = fxSlots._lastGoodTs || 0;

        // If the scroll event happens without recent wheel/touch/pointer input and it jumps
        // sharply upward (towards 0), treat it as a synthetic snap and do NOT persist it.
        const inputRecent = (ts - (fxSlots._userInputTs || 0)) < 200;
        const looksLikeSnap = (!inputRecent && jump > 18 && lastGood > 2 && (ts - lastGoodTs) < holdMs && max > 10 && (st + 8) < lastGood);

        if (!looksLikeSnap){
          fxSlots._userScrollTs = ts;
          fxSlots._userScrollTop = st;
          fxSlots._scrollDesired = st;
        } else {
          // Keep desired at the last good position; do not persist the snap.
          fxSlots._scrollDesired = lastGood;
        }

        try{
          const wantSave = (typeof fxSlots._scrollDesired === "number") ? fxSlots._scrollDesired : st;
          fxSlotsScroll.set(t.guid, wantSave);
        }catch(_){ }

        fxSlots._prevScrollTop = st;
        fxSlots._prevScrollTs = ts;

        // Keep the guard alive for a short window after the last scroll event
        // to catch late snaps after momentum ends.
        fxSlots._guardUntil = ts + holdMs;
        scheduleGuard();
      }, {passive:true});
    }catch(_){ }
    }

const topLine = document.createElement("div");
    topLine.className = "vline";
    topLine.innerHTML = `<div class="label">VOL</div><div class="value volDb">0.0 dB</div>`;
    body.appendChild(topLine);

    const faderBox = document.createElement("div");
    faderBox.className = "faderBox";
    body.appendChild(faderBox);

    const bottomControls = document.createElement("div");
    bottomControls.className = "bottomControls";
    body.appendChild(bottomControls);

    const inner = document.createElement("div");
    inner.className = "faderInner";
    faderBox.appendChild(inner);

    const well = document.createElement("div");
    well.className = "trackWell";
    faderBox.appendChild(well);
    const zeroMark = document.createElement("div");
    zeroMark.className = "zeroMark";
    well.appendChild(zeroMark);

    const ticks = document.createElement("div");
    ticks.className = "ticks";
    const tickPositions = [0.06,0.18,0.30,0.42,0.54,0.66,0.78,0.90];
    tickPositions.forEach(p=>{
      const ln = document.createElement("div");
      ln.className = "tick";
      ln.style.top = (p*100)+"%";
      ticks.appendChild(ln);
    });
    faderBox.appendChild(ticks);

    const vuL = document.createElement("div");
    vuL.className = "vu vuL";
    const vuFillL = document.createElement("div");
    vuFillL.className = "vuFill";
    const vuPeakL = document.createElement("div");
    vuPeakL.className = "vuPeak";
    vuL.appendChild(vuFillL);
    vuL.appendChild(vuPeakL);
    well.appendChild(vuL);

    const vuR = document.createElement("div");
    vuR.className = "vu vuR";
    const vuFillR = document.createElement("div");
    vuFillR.className = "vuFill";
    const vuPeakR = document.createElement("div");
    vuPeakR.className = "vuPeak";
    vuR.appendChild(vuFillR);
    vuR.appendChild(vuPeakR);
    well.appendChild(vuR);

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    faderBox.appendChild(thumb);

    const hit = document.createElement("div");
    hit.className = "faderHit";
    faderBox.appendChild(hit);

    // Buttons
    const btnRow = document.createElement("div");
    btnRow.className = "btnRow";
    bottomControls.appendChild(btnRow);

    const muteBtn = document.createElement("div");
    muteBtn.className = "btn";
    muteBtn.textContent = "M";
    btnRow.appendChild(muteBtn);

    const soloBtn = document.createElement("div");
    soloBtn.className = "btn";
    soloBtn.textContent = "S";
    btnRow.appendChild(soloBtn);

    const recBtn = document.createElement("div");
    recBtn.className = "btn";
    recBtn.textContent = "R";
    btnRow.appendChild(recBtn);

    const fxBtn2 = document.createElement("div");
    fxBtn2.className = "btn";
    fxBtn2.textContent = "FX";
    btnRow.appendChild(fxBtn2);

    // Pan box
    const panBox = document.createElement("div");
    panBox.className = "panBox";
    panBox.style.display = (t.kind==="master" || !cfg.showPanFader) ? "none" : "flex";
    panBox.innerHTML = `
      <div class="panTop"><div class="label">PAN</div><div class="value panVal">C</div></div>
      <div class="panCtrl">
        <div class="panTrack"><div class="panThumb"></div></div>
        <div class="panHit"></div>
      </div>
    `;
bottomControls.appendChild(panBox);

    const folderTag = document.createElement("div");
    folderTag.className = "folderTag";
    el.appendChild(folderTag);

    const indentGuide = document.createElement("div");
    indentGuide.className = "indentGuide";
    indentGuide.style.display = "none";
    el.appendChild(indentGuide);

    const footerBar = document.createElement("div");
    footerBar.className = "footerBar";
    const footerNum = document.createElement("div");
    footerNum.className = "footerNum";
    footerNum.textContent = (t.kind==="master") ? "MASTER" : String(t.idx||"");
    const footerFolderBtn = document.createElement("div");
    footerFolderBtn.className = "footerFolderBtn";
    footerFolderBtn.textContent = "▾";
    footerBar.appendChild(footerNum);
    footerBar.appendChild(footerFolderBtn);
    el.appendChild(footerBar);

    // Store refs
    el._refs = {accent, header, title, slotbar, fxBtn, sendsBtn, folderBtn, volDb: topLine.querySelector(".volDb"), faderBox, thumb,
      vuFillL, vuFillR, vuPeakL, vuPeakR, zeroMark, muteBtn, soloBtn, recBtn, fxBtn2,
      panBox, panVal: panBox.querySelector(".panVal"), panTrack: panBox.querySelector(".panTrack"), panThumb: panBox.querySelector(".panThumb"), panHit: panBox.querySelector(".panHit"),
      folderTag, indentGuide, footerBar, footerNum, footerFolderBtn, fxSlots};

    const applyFaderUi = (vol, yOverride)=>{
      const refs = el._refs;
      if (refs && refs.volDb) refs.volDb.textContent = `${dbFromVol(vol)} dB`;
      const y = (typeof yOverride === "number") ? yOverride : yFromVol(vol);
      sliderTargets.set(t.guid, y);
      sliderCurrent.set(t.guid, y);
      if (refs && refs.thumb && refs.faderBox){
        const h = refs.faderBox.clientHeight || 420;
        refs.thumb.style.transform = `translate(-50%, ${Math.max(8, Math.min(h-28, y*h))}px)`;
      }
    };

    const wireFxHold = (btn)=>{
      if (!btn) return;
      let holdT = null;
      btn._holdTriggered = false;
      const clearHold = ()=>{
        if (holdT) clearTimeout(holdT);
        holdT = null;
      };
      btn.addEventListener("pointerdown", (ev)=>{
        if (ev.button !== 0) return;
        btn._holdTriggered = false;
        clearHold();
        holdT = setTimeout(()=>{
          btn._holdTriggered = true;
          const guid = t.guid;
          const tr = trackByGuid.get(guid);
          const cached = fxCache.get(guid);
          const list = cached && Array.isArray(cached.fx) ? cached.fx : [];
          if (tr && tr.fxAllOff){
            const restore = fxHoldRestore.get(guid) || [];
            if (restore.length){
              restore.forEach((idx)=>{
                wsSend({type:"setFxEnabled", guid, index: idx, enabled:true});
                const local = list.find(fx=>fx.index===idx);
                if (local) local.enabled = true;
              });
            }
          } else {
            const enabledList = list.filter(fx=>fx && fx.enabled).map(fx=>fx.index);
            if (enabledList.length) fxHoldRestore.set(guid, enabledList);
            wsSend({type:"setFxAllEnabled", guid, enabled:false});
            list.forEach(fx=>{ fx.enabled = false; });
          }
        }, 650);
      });
      btn.addEventListener("pointerup", clearHold);
      btn.addEventListener("pointercancel", clearHold);
      btn.addEventListener("pointerleave", clearHold);
    };

    // Events
    title.addEventListener("click", (ev)=>{ ev.stopPropagation(); openTrackMenu(t.guid, "general"); });
    el.addEventListener("contextmenu", (ev)=>{
      ev.preventDefault();
      ev.stopPropagation();
      openTrackContextMenu(t.guid, ev.clientX, ev.clientY);
    });
    attachTouchHoldMenu(el, (x, y)=> openTrackContextMenu(t.guid, x, y));
    attachTrackReorder(el, t);
    fxBtn.addEventListener("click",(ev)=>{
      ev.stopPropagation();
      if (fxBtn._holdTriggered){ fxBtn._holdTriggered = false; return; }
      openTrackMenu(t.guid,"fx");
    });
    sendsBtn.addEventListener("click",(ev)=>{ ev.stopPropagation(); openTrackMenu(t.guid,"sends"); });
    folderBtn.addEventListener("click",(ev)=>{ ev.stopPropagation(); if (t.kind!=="master" && t.folderDepth>0) cycleFolderMode(t.guid); });

    muteBtn.addEventListener("click",(ev)=>{ ev.stopPropagation(); wsSend({type:"setMute", guid:t.guid, mute: !(!!trackByGuid.get(t.guid)?.mute)}); });
    soloBtn.addEventListener("click",(ev)=>{ ev.stopPropagation(); wsSend({type:"setSolo", guid:t.guid, solo: !(!!trackByGuid.get(t.guid)?.solo)}); });
    recBtn.addEventListener("click",(ev)=>{ ev.stopPropagation(); if(t.kind==="master") return; wsSend({type:"setRec", guid:t.guid, rec: !(!!trackByGuid.get(t.guid)?.rec)}); });
    fxBtn2.addEventListener("click",(ev)=>{
      ev.stopPropagation();
      if (fxBtn2._holdTriggered){ fxBtn2._holdTriggered = false; return; }
      const guid = t.guid;
      const was = fxExpanded.has(guid);
      if (was) fxExpanded.delete(guid);
      else fxExpanded.add(guid);
      // ensure we have the FX list ready when expanding
      const cur = Object.assign({}, trackByGuid.get(guid) || t, {
        _compact: !!t._compact,
        _gapL: !!t._gapL,
        _gapR: !!t._gapR,
        _folderGroupId: t._folderGroupId || null,
        _folderGroupColor: t._folderGroupColor || "",
      });
      const fxCount = cur.fxCount || 0;
      if (!was && fxCount>0){
        // request list even if cfg.showFxSlots is off
        ensureFxList(guid, fxCount);
      }
      // apply class + rerender slots
      updateStrip(el, cur, true);
    });
    wireFxHold(fxBtn);
    wireFxHold(fxBtn2);

    if (el._refs.footerFolderBtn) el._refs.footerFolderBtn.addEventListener("click",(ev)=>{ ev.stopPropagation(); if (t.kind!=="master" && t.folderDepth>0) cycleFolderMode(t.guid); });

    const resetFader = (ev)=>{
      if (ev) ev.preventDefault();
      const vol = 1.0;
      wsSend({type:"setVol", guid:t.guid, vol}); // 0dB = 1.0
      applyFaderUi(vol);
      const localTrack = trackByGuid.get(t.guid) || t;
      localTrack.vol = vol;
    };
    // Double click reset (0dB) on fader area
    hit.addEventListener("dblclick", resetFader);
    thumb.addEventListener("dblclick", resetFader);
    faderBox.addEventListener("dblclick", resetFader);

    // Drag fader (thumb or hit area). We must prevent HTML5 drag-reorder from
    // kicking in while the user is dragging a control.
    const startVolDrag = (ev)=>{
      if (ev.button != null && ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();

      let active = true;
      draggingGuid = t.guid;

      // Temporarily disable strip drag-reorder while dragging the fader (prevents jerky behavior).
      const prevDraggable = el.getAttribute("draggable");
      try{ el.setAttribute("draggable", "false"); }catch(_){ }

      const pointerId = ev.pointerId;
      try{ (ev.currentTarget || thumb).setPointerCapture(pointerId); }catch(_){ }

      let latestY = ev.clientY;
      let rafId = 0;

      const apply = ()=>{
        rafId = 0;
        if (!active) return;
        const rect = faderBox.getBoundingClientRect();
        const y = (latestY - rect.top) / rect.height;
        const yy = Math.max(0, Math.min(1, y));
        const vv = volFromY(yy);
        wsSend({type:"setVol", guid:t.guid, vol: vv});
        applyFaderUi(vv, yy);
        const localTrack = trackByGuid.get(t.guid) || t;
        localTrack.vol = vv;
      };

      const move = (e)=>{
        if (!active) return;
        latestY = e.clientY;
        if (!rafId) rafId = requestAnimationFrame(apply);
      };

      const cleanup = ()=>{
        if (!active) return;
        active = false;
        draggingGuid = null;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        try{ (ev.currentTarget || thumb).releasePointerCapture(pointerId); }catch(_){ }
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", cleanup, true);
        window.removeEventListener("pointercancel", cleanup, true);
        window.removeEventListener("blur", cleanup, true);
        try{ el.setAttribute("draggable", prevDraggable == null ? "true" : String(prevDraggable)); }catch(_){ }
      };

      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", cleanup, true);
      window.addEventListener("pointercancel", cleanup, true);
      window.addEventListener("blur", cleanup, true);

      // Apply once immediately.
      if (!rafId) rafId = requestAnimationFrame(apply);
    };

    // thumb is the primary target; hit is a convenience for mouse.
    thumb.addEventListener("pointerdown", startVolDrag);
    hit.addEventListener("pointerdown", (ev)=>{
      // avoid accidental drags while swiping through the mixer on touch
      if (ev.pointerType === "touch") return;
      startVolDrag(ev);
    });

    // Pan

    // Prevent track drag-reorder while interacting with the pan control.
    // Requirements:
    //  - Never break native <input type="range"> dragging (so no preventDefault on pointerdown)
    //  - Ensure track drag (HTML5 draggable + touch-hold) never starts from pan
    //  - Avoid jitter: don't overwrite slider.value from websocket while user is dragging
    
    // --- Custom PAN control (replaces native <input type="range">) ---
    // We implement a custom horizontal drag similar to the VOL fader logic so that
    // Chrome/Android doesn't jitter and doesn't accidentally start track drag/reorder.
    const setPanThumbPos = (pan)=>{
      const r2 = el._refs;
      if (!r2 || !r2.panThumb) return;
      const p = Math.max(-1, Math.min(1, pan));
      r2.panThumb.style.left = `${(p + 1) * 50}%`; // -1..1 -> 0..100%
    };

    const setPanLocal = (pan)=>{
      const p = Math.max(-1, Math.min(1, pan));
      el._panLocal = p;
      el._panDragTs = nowMs();
      el._panDragging = true;
      setPanThumbPos(p);
      if (el._refs && el._refs.panVal) el._refs.panVal.textContent = panLabel(p);
      return p;
    };

    const startPanDrag = (ev)=>{
      if (!ev) return;
      if (ev.button != null && ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();

      // Prevent strip drag/reorder while interacting with PAN.
      blockTrackDrag(2000);

      const prevDraggable = el.getAttribute("draggable");
      if (el._prevDraggablePan == null) el._prevDraggablePan = prevDraggable;
      try{ el.setAttribute("draggable","false"); }catch(_){}

      el._panDragging = true;
      el._panDragTs = nowMs();

      const pointerId = ev.pointerId;
      try{ (ev.currentTarget || el).setPointerCapture(pointerId); }catch(_){}

      let latestX = ev.clientX;
      let rafId = 0;
      let lastSent = (typeof el._panLocal === "number") ? el._panLocal : 0;

      const apply = ()=>{
        rafId = 0;
        const r2 = el._refs;
        if (!r2 || !r2.panTrack) return;
        const rect = r2.panTrack.getBoundingClientRect();
        const w = Math.max(1, rect.width);
        const x = Math.max(0, Math.min(w, latestX - rect.left));
        const pan = (x / w) * 2 - 1; // 0..w -> -1..1
        const p = setPanLocal(pan);

        // Send only when value changes enough to matter (prevents spam + improves smoothness).
        if (Math.abs(p - lastSent) > 0.002){
          lastSent = p;
          wsSend({type:"setPan", guid:t.guid, pan:p});
        }
      };

      const move = (e)=>{
        latestX = e.clientX;
        if (!rafId) rafId = requestAnimationFrame(apply);
      };

      const end = ()=>{
        // one last apply for accuracy
        if (!rafId) rafId = requestAnimationFrame(apply);

        el._panDragging = false;
        // keep a short 'recently dragging' window to avoid websocket echo fighting the UI
        el._panDragTs = nowMs();

        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", end, true);
        window.removeEventListener("pointercancel", end, true);
        window.removeEventListener("blur", end, true);
        try{ (ev.currentTarget || el).releasePointerCapture(pointerId); }catch(_){}

        try{ el.setAttribute("draggable", (el._prevDraggablePan == null) ? "true" : String(el._prevDraggablePan)); }catch(_){}
        el._prevDraggablePan = null;
      };

      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", end, true);
      window.addEventListener("pointercancel", end, true);
      window.addEventListener("blur", end, true);

      // Apply once immediately so click/tap sets the value.
      if (!rafId) rafId = requestAnimationFrame(apply);
    };

    // Bind to panHit/panTrack (not the whole strip).
    if (el._refs && el._refs.panHit){
      el._refs.panHit.addEventListener("pointerdown", startPanDrag);
      el._refs.panHit.addEventListener("dblclick",(ev)=>{
        ev.preventDefault();
        ev.stopPropagation();
        setPanLocal(0);
        wsSend({type:"setPan", guid:t.guid, pan: 0});
      });
    }
    if (el._refs && el._refs.panTrack){
      el._refs.panTrack.addEventListener("pointerdown", startPanDrag);
    }


    updateStrip(el, t, true);
    return el;
  }

  function updateStrip(el, t, first=false){
    if (!el) return;
    if (t.kind === "spacer"){
      updateSpacerStrip(el, t);
      return;
    }
    if (!el._refs) return;
    const r = el._refs;

    // class master/child + soloed
    el.classList.toggle("master", t.kind==="master");
    el.classList.toggle("masterPinned", t.kind==="master" && !!cfg.masterPinned);
    el.classList.toggle("pinLeft", t.kind==="master" && !!cfg.masterPinned && cfg.masterSide === "left");
    el.classList.toggle("pinRight", t.kind==="master" && !!cfg.masterPinned && cfg.masterSide === "right");
    el.classList.toggle("child", !!t._compact || (t.indent>0));
    const anySolo = (lastState.tracks||[]).some(x=>x.solo);
    el.classList.toggle("soloed", (!anySolo) || !!t.solo);

// visual gaps around folder groups (for readability)
el.classList.toggle("gapL", !!t._gapL);
el.classList.toggle("gapR", !!t._gapR);


    // track color (used for outline/frame)
    const col = hexOrEmpty(t.color);
    if (el.style){
      el.style.setProperty("--trackColor", col || "transparent");
      if (t._folderGroupId){
        el.style.setProperty("--folderGroupColor", t._folderGroupColor || col || "transparent");
        el.dataset.folderGroup = t._folderGroupId;
      } else {
        el.style.removeProperty("--folderGroupColor");
        delete el.dataset.folderGroup;
      }
    }
    const indentValue = Number(t.indent || 0);
    el.dataset.indent = String(indentValue);
    el.dataset.folderDepth = String(t.folderDepth || 0);
    if (el.style) el.style.setProperty("--indent", String(indentValue));

    // header text
    const nameEl = r.title.querySelector(".name");
    const displayName = (t.kind === "master") ? "MASTER" : (t.name || "");
    if (nameEl && nameEl.textContent !== displayName) nameEl.textContent = displayName;


    // folder tag + indent guide
    if (t.kind!=="master"){
      const isChild = (t.indent>0);
      el.classList.toggle("compactChild", !!t._compact);
      el.classList.toggle("deepHierarchy", (Number(t.indent||0) >= 4));
      const isFolderStart = (t.folderDepth>0);
      el.classList.toggle("folderStart", isFolderStart);
      el.classList.toggle("nestedFolderStart", isFolderStart && (t.indent>0));
      el.classList.toggle("folderChild", isChild);
      r.indentGuide.style.display = isChild ? "block" : "none";
      const fm = (t.folderDepth>0) ? getFolderMode(t.guid) : "expanded";

      // footer number
      if (r.footerNum) r.footerNum.textContent = (t.kind==="master") ? "M" : String(t.idx||"");

      // folder button in footer (3 states)
      if (r.footerFolderBtn){
        r.footerFolderBtn.style.display = (t.folderDepth>0) ? "flex" : "none";
        const icon = (fm==="hidden") ? "⤓" : (fm==="compact") ? "▸" : "▾";
        r.footerFolderBtn.textContent = icon;
      }

      // footer color (dim)
      if (r.footerBar){
        const c = hexOrEmpty(t.color);
        if (cfg.showColorFooter && c){
          const rgb = hexToRgb(c);
          r.footerBar.style.background = rgb ? `rgba(${rgb.r},${rgb.g},${rgb.b},${cfg.footerIntensity||0.35})` : "#1c1f23";
        } else {
          r.footerBar.style.background = "#1c1f23";
        }
      }

      // visual compact for children
      if (t._compact){
        el.style.width = "72px";
        r.title.style.display = "none";
        // Keep header slotbar buttons (FX / Sends / Folder) visible even in compact mode
        // so navigation doesn't disappear on small screens.
        r.slotbar.style.display = "flex";
      } else {
        const baseWidth = (t.kind==="master") ? 140 : 124;
        const inset = Math.min(30, Math.max(0, t.indent || 0) * 6);
        const width = Math.max(92, baseWidth - inset);
        el.style.width = `${width}px`;
        r.title.style.display = "";
        r.slotbar.style.display = "";
      }
    }

    if (t.kind === "master"){
      const compact = !!cfg.masterCompact;
      if (r.footerNum) r.footerNum.textContent = "MASTER";
      if (compact){
        el.style.width = "92px";
        r.title.style.display = "none";
      } else {
        el.style.width = "140px";
        r.title.style.display = "";
      }
    }

    // FX badge count
    const fxCount = t.fxCount||0;
    const isFxExpanded = fxExpanded.has(t.guid);
    el.classList.toggle("fxExpanded", isFxExpanded);
    if (r.fxBtn2){
      r.fxBtn2.classList.toggle('onFx', fxCount>0);
      r.fxBtn2.classList.toggle('onFxExpanded', isFxExpanded);
    }
    ensureFxList(t.guid, fxCount);
    updateFxSlotsUI(el, t.guid);
    // slotbar toggles + state highlighting
    if (t.kind === "master"){
      r.fxBtn.style.display = "none";
      r.sendsBtn.style.display = "none";
    } else {
      // Keep header navigation buttons always visible
      r.fxBtn.style.display = "flex";
      r.sendsBtn.style.display = "flex";
    }

// Folder collapse button (only for folder-start tracks)
if (r.folderBtn){
  if (t.kind!=="master" && t.folderDepth>0){
    r.folderBtn.style.display = "flex";
    const fm = getFolderMode(t.guid);
    r.folderBtn.textContent = (fm==="hidden") ? "⤓" : (fm==="compact" ? "▸" : "▾");
  } else {
    r.folderBtn.style.display = "none";
  }
}

// FX button: blue if has FX; red if all-off
const fxHas = (t.fxCount||0) > 0;
const fxAllOff = !!t.fxAllOff;
r.fxBtn.classList.toggle("fxHas", fxHas && !fxAllOff);
r.fxBtn.classList.toggle("fxAllOff", fxHas && fxAllOff);

// Sends button: green if has sends; red if all sends muted
const sends = (t.sendDetails && t.sendDetails.length) ? t.sendDetails : [];
const sendCount = sends.length || ((t.sendSlots && t.sendSlots.length) ? t.sendSlots.length : 0);
const allMuted = (sendCount>0 && sends.length>0) ? sends.every(s=>!!s.mute) : false;
r.sendsBtn.classList.toggle("sendsHas", sendCount>0 && !allMuted);
r.sendsBtn.classList.toggle("sendsAllMute", sendCount>0 && allMuted);

    // VOL label
    const db = dbFromVol(t.vol||1.0);
    const clipState = meterAnim.get(t.guid);
    const now = performance.now();
    if (clipState && clipState.clipUntil && clipState.clipUntil > now && Number.isFinite(clipState.clipDb)){
      r.volDb.textContent = `CLIP +${clipState.clipDb.toFixed(1)} dB`;
      r.volDb.classList.add("clip");
    } else {
      r.volDb.textContent = db + " dB";
      r.volDb.classList.remove("clip");
    }

    // narrow strip detection (hide VOL label on very thin strips)
    const w = (el.getBoundingClientRect ? el.getBoundingClientRect().width : el.offsetWidth);
    const isN = (w && w < 96);
    if (el._isNarrow !== isN){ el._isNarrow = isN; el.classList.toggle("narrow", isN); }


    // Button states
    r.muteBtn.classList.toggle("onMute", !!t.mute);
    // FX all-off highlight (if plugins exist)
    const fxWarn = ((t.fxCount||0) > 0) && !!t.fxAllOff;
    try{ r.fxBtn2 && r.fxBtn2.classList.toggle("fxWarn", fxWarn); }catch(_){ }
    try{ r.fxBtn && r.fxBtn.classList.toggle("fxWarn", fxWarn); }catch(_){ }

    r.soloBtn.classList.toggle("onSolo", !!t.solo);
    if (t.kind==="master"){
      r.recBtn.style.display = "none";
    } else {
      r.recBtn.style.display = "flex";
      r.recBtn.classList.toggle("onRec", !!t.rec);
    }

    // PAN
    if (r.panBox){
      r.panBox.style.display = (t.kind==="master" || !cfg.showPanFader) ? "none" : "flex";
    }
    if (t.kind!=="master" && (r.panThumb || r.panTrack)){
      const panFromState = (t.pan ?? 0);
      const panLocal = (typeof el._panLocal === "number") ? el._panLocal : panFromState;
      const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      const recentlyDragging = !!el._panDragging || ((now - (el._panDragTs || 0)) < 1200);
      const showPan = (recentlyDragging || draggingGuid === t.guid) ? panLocal : panFromState;

      // Avoid fighting the user's drag with websocket echoes (looks like jitter).
      if (r.panThumb){ r.panThumb.style.left = `${(Math.max(-1, Math.min(1, showPan)) + 1) * 50}%`; }
      r.panVal.textContent = panLabel(showPan);
    }

    // Fader smoothing target
    const targetY = yFromVol(t.vol||1.0);
    sliderTargets.set(t.guid, targetY);
    if (!sliderCurrent.has(t.guid)) sliderCurrent.set(t.guid, targetY);

    // If master -> only mute + FX
    if (t.kind==="master"){
      r.soloBtn.style.display = "none";
      r.fxBtn2.style.display = "flex";
    } else {
      r.soloBtn.style.display = "flex";
      r.fxBtn2.style.display = "flex";
    }
  }

  // Smooth thumb position animation
  function rafLoop(){
    try{
      for (const [guid, el] of stripEls){
        const t = trackByGuid.get(guid);
        if (!t || !el || !el._refs) continue;
        if (draggingGuid === guid) continue;
        const cur = sliderCurrent.get(guid) ?? 0.5;
        const target = sliderTargets.get(guid) ?? cur;
        const next = cur + (target - cur) * 0.22; // smoothing
        sliderCurrent.set(guid, next);

        // thumb translate within faderBox
        const fb = el._refs.faderBox;
        const thumb = el._refs.thumb;
        if (fb && thumb){
          const rectH = fb.clientHeight || 420;
          const y = next * rectH;
          thumb.style.transform = `translate(-50%, ${Math.max(10, Math.min(rectH-30, y))}px)`;
        }
      }
      if (transportLive.data){
        const now = performance.now();
        const t = transportLive.data;
        const elapsed = Math.max(0, (now - transportLive.ts) / 1000);
        let position = Number.isFinite(t.position) ? t.position : parseFloat(t.position);
        if (!Number.isFinite(position)) position = 0;
        if (t.playing || t.recording) position += elapsed;

        let bar = t.bar;
        let beat = t.beat;
        let beatFrac = t.beatFrac;
        if ((t.playing || t.recording) && Number.isFinite(t.bpm) && Number.isFinite(bar) && Number.isFinite(beat) && Number.isFinite(beatFrac)){
          const beatsPerBar = 4;
          const base = (Math.max(1, bar) - 1) * beatsPerBar + (Math.max(1, beat) - 1) + Math.max(0, beatFrac);
          const total = base + (elapsed * t.bpm / 60);
          bar = Math.floor(total / beatsPerBar) + 1;
          const beatInBar = total % beatsPerBar;
          beat = Math.floor(beatInBar) + 1;
          beatFrac = beatInBar - Math.floor(beatInBar);
        }
        const derived = Object.assign({}, t, {position, bar, beat, beatFrac});
        applyTransportRefs(derived, {
          time: transportTime,
          bars: transportBars,
          bpm: transportBpm,
          play: transportPlay,
          pause: transportPause,
          rec: transportRec,
          stop: transportStop,
        });
        if (openModal && openModal.kind === "transport" && openModal.transportRefs){
          applyTransportRefs(derived, openModal.transportRefs);
        }
      }
    } catch {}
    requestAnimationFrame(rafLoop);
  }


  function ensureFxList(guid, wantCount){
    if (!cfg.showFxSlots && !fxExpanded.has(guid)) return;
    if (!wantCount || wantCount<=0) return;
    const cached = fxCache.get(guid);
    if (cached && (Date.now()-cached.ts) < 2500 && (cached.fx||[]).length === wantCount) return;
    if (fxReqInFlight.has(guid)) return;
    fxReqInFlight.add(guid);
    wsSend({type:"reqFxList", guid});
  }

  
  let _fxAddMenuEl = null;
  function closeFxAddMenu(){
    if (_fxAddMenuEl){
      try{ _fxAddMenuEl.remove(); }catch(_){}
      _fxAddMenuEl = null;
    }
  }
  document.addEventListener("click", (e)=>{
    // close add menu on outside click
    if (_fxAddMenuEl && !(_fxAddMenuEl.contains(e.target))) closeFxAddMenu();
  }, true);

  function openFxAddMenu(guid, anchorEl){
    closeFxAddMenu();
    const rect = anchorEl.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.className = "fxAddMenu";
    menu.innerHTML = `<div class="small" style="padding:6px 8px;">Add FX</div>`;
    FX_ADD_CATALOG.forEach(x=>{
      const mi = document.createElement("div");
      mi.className = "mi";
      mi.textContent = x.name;
      mi.addEventListener("click", (ev)=>{
        ev.stopPropagation();
        wsSend({type:"addFx", guid, name:x.add});
        fxPendingOpen.set(guid, {name: x.name || x.add || "", ts: Date.now()});
        closeFxAddMenu();
        // refresh list shortly
        setTimeout(()=>wsSend({type:"reqFxList", guid}), 60);
      });
      menu.appendChild(mi);
    });
    document.body.appendChild(menu);
    // position (clamp to viewport)
    const pad = 8;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = rect.left;
    let top = rect.bottom + 6;
    // measure after insert
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    if (left + mw > vw - pad) left = Math.max(pad, vw - pad - mw);
    if (top + mh > vh - pad) top = Math.max(pad, rect.top - mh - 6);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
    _fxAddMenuEl = menu;
  }

  let _trackMenuEl = null;
  function closeTrackMenu(){
    if (_trackMenuEl){
      try{ _trackMenuEl.remove(); }catch(_){}
      _trackMenuEl = null;
    }
  }
  document.addEventListener("click", (e)=>{
    if (_trackMenuEl && !(_trackMenuEl.contains(e.target))) closeTrackMenu();
  }, true);

  let _mixerMenuEl = null;
  function closeMixerMenu(){
    if (_mixerMenuEl){
      try{ _mixerMenuEl.remove(); }catch(_){}
      _mixerMenuEl = null;
    }
  }
  document.addEventListener("click", (e)=>{
    if (_mixerMenuEl && !(_mixerMenuEl.contains(e.target))) closeMixerMenu();
  }, true);

  function appendMixerMenuItems(addItem){
    addItem("Add track", ()=>{
      wsSend({type:"addTrack"});
      setTimeout(()=>wsSend({type:"reqState"}), 120);
    });
    if (!cfg.masterEnabled){
      addItem("Show master", ()=>{
        cfg.masterEnabled = true;
        saveCfg();
        renderOrUpdate(true);
      });
    }
    addItem("Add visual spacer", ()=>{
      wsSend({type:"addSpacer"});
      setTimeout(()=>wsSend({type:"reqState"}), 120);
    });
    addItem("Mixer settings", ()=> openSettingsTab("ui"));
    addItem("Track manager", ()=> openSettingsTab("tracks"));
    addItem("Scene manager", openSceneManager);
  }

  function openTrackContextMenu(guid, x, y){
    closeTrackMenu();
    const t = trackByGuid.get(guid);
    if (!t) return;
    const menu = document.createElement("div");
    menu.className = "trackMenu";

    const mkItem = (label, onClick, disabled=false)=>{
      const mi = document.createElement("div");
      mi.className = "mi" + (disabled ? " disabled" : "");
      mi.textContent = label;
      if (!disabled){
        mi.addEventListener("click", (ev)=>{ ev.stopPropagation(); onClick(); closeTrackMenu(); });
      }
      menu.appendChild(mi);
    };

    const mkSubmenu = (label, contentEl)=>{
      const wrap = document.createElement("div");
      wrap.className = "mi hasSubmenu";
      wrap.innerHTML = `<span>${escapeHtml(label)}</span><span class="submenuCaret">›</span>`;
      const sub = document.createElement("div");
      sub.className = "submenu";
      sub.appendChild(contentEl);
      wrap.appendChild(sub);
      wrap.addEventListener("click", (ev)=>{
        ev.stopPropagation();
        wrap.classList.toggle("open");
      });
      wrap.addEventListener("pointerdown", (ev)=>{
        if (ev.pointerType === "touch") ev.stopPropagation();
      });
      menu.appendChild(wrap);
    };

    const mkPalette = (colors)=>{
      const palette = document.createElement("div");
      palette.className = "trackColorPalette";
      colors.forEach((hex)=> {
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.className = "swatch";
        swatch.style.background = hex;
        swatch.title = hex;
        swatch.addEventListener("click", (ev)=>{
          ev.stopPropagation();
          wsSend({type:"setTrackColor", guid: t.guid, color: hex});
          setTimeout(()=>wsSend({type:"reqState"}), 80);
          closeTrackMenu();
        });
        palette.appendChild(swatch);
      });
      return palette;
    };

    if (t.kind === "master"){
      mkItem(cfg.masterEnabled ? "Hide master" : "Show master", ()=>{
        cfg.masterEnabled = !cfg.masterEnabled;
        saveCfg();
        renderOrUpdate(true);
      });
      mkItem(cfg.masterSide === "left" ? "Move master to right" : "Move master to left", ()=>{
        cfg.masterSide = (cfg.masterSide === "left") ? "right" : "left";
        saveCfg();
        renderOrUpdate(true);
      });
      mkItem(cfg.masterCompact ? "Disable compact master" : "Compact master view", ()=>{
        cfg.masterCompact = !cfg.masterCompact;
        saveCfg();
        renderOrUpdate(true);
      });
      mkItem(cfg.masterPinned ? "Unpin master" : "Pin master", ()=>{
        cfg.masterPinned = !cfg.masterPinned;
        saveCfg();
        renderOrUpdate(true);
      });
      const otherMenu = document.createElement("div");
      appendMixerMenuItems((label, onClick)=>{
        const mi = document.createElement("div");
        mi.className = "mi";
        mi.textContent = label;
        mi.addEventListener("click", (ev)=>{ ev.stopPropagation(); onClick(); closeTrackMenu(); });
        otherMenu.appendChild(mi);
      });
      mkSubmenu("Other", otherMenu);
    } else {
      if (!cfg.masterEnabled){
        mkItem("Show master", ()=>{
          cfg.masterEnabled = true;
          saveCfg();
          renderOrUpdate(true);
        });
      }

      mkItem("Rename", ()=>{
        const current = t.name || "";
        const next = prompt("Rename track", current);
        if (next === null) return;
        const name = String(next).trim();
        if (!name) return;
        wsSend({type:"renameTrack", guid: t.guid, name});
        setTimeout(()=>wsSend({type:"reqState"}), 80);
      });
      mkSubmenu("Track color", mkPalette([
        "#ff0080",
        "#008000",
        "#00ff80",
        "#ff80c0",
        "#80ffff",
        "#004080",
        "#80ff80",
        "#ff80ff",
        "#800080",
        "#ffc6ff",
      ]));
      const compactOn = !!cfg.compactTracks[t.guid];
      mkItem(compactOn ? "Disable compact view" : "Enable compact view", ()=>{
        if (compactOn) delete cfg.compactTracks[t.guid];
        else cfg.compactTracks[t.guid] = true;
        saveCfg();
        renderOrUpdate(true);
      });
      mkItem("Create folder with this track", ()=>{
        wsSend({type:"createFolderWithTrack", guid: t.guid});
        setTimeout(()=>wsSend({type:"reqState"}), 120);
      });
      const folders = (lastState && lastState.tracks) ? lastState.tracks.filter(tr=>tr.folderDepth>0 && tr.guid !== t.guid) : [];
      mkItem("Move to folder...", ()=>{
        if (!folders.length) return;
        const options = folders.map((f, i)=>`${i+1}: ${f.name || ("Track " + f.idx)}`).join("\n");
        const pick = prompt(`Select folder:\n${options}`, "1");
        if (!pick) return;
        const idx = parseInt(pick, 10);
        if (!Number.isFinite(idx) || idx < 1 || idx > folders.length) return;
        wsSend({type:"moveTrackToFolder", guid: t.guid, folderGuid: folders[idx-1].guid});
        setTimeout(()=>wsSend({type:"reqState"}), 120);
      }, !folders.length);
      mkItem("Move track...", ()=>{
        const total = (lastState && lastState.tracks) ? lastState.tracks.length : 0;
        const pick = prompt(`Move to track number (1-${total})`, "");
        if (!pick) return;
        const idx = parseInt(pick, 10);
        if (!Number.isFinite(idx) || idx < 1 || idx > total) return;
        wsSend({type:"moveTrack", guid: t.guid, toIndex: idx-1});
        setTimeout(()=>wsSend({type:"reqState"}), 120);
      });
      mkItem("Delete track", ()=>{
        if (!confirm(`Delete track "${t.name || ("Track " + t.idx)}"?`)) return;
        wsSend({type:"deleteTrack", guid: t.guid});
        setTimeout(()=>wsSend({type:"reqState"}), 160);
      });
      const otherMenu = document.createElement("div");
      appendMixerMenuItems((label, onClick)=>{
        const mi = document.createElement("div");
        mi.className = "mi";
        mi.textContent = label;
        mi.addEventListener("click", (ev)=>{ ev.stopPropagation(); onClick(); closeTrackMenu(); });
        otherMenu.appendChild(mi);
      });
      mkSubmenu("Other", otherMenu);
    }

    document.body.appendChild(menu);
    const pad = 8;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = x;
    let top = y;
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    if (left + mw > vw - pad) left = Math.max(pad, vw - pad - mw);
    if (top + mh > vh - pad) top = Math.max(pad, vh - pad - mh);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
    _trackMenuEl = menu;
  }

  function openSpacerContextMenu(t, x, y){
    closeTrackMenu();
    const menu = document.createElement("div");
    menu.className = "trackMenu";

    const mkItem = (label, onClick, disabled=false)=>{
      const mi = document.createElement("div");
      mi.className = "mi" + (disabled ? " disabled" : "");
      mi.textContent = label;
      if (!disabled){
        mi.addEventListener("click", (ev)=>{ ev.stopPropagation(); onClick(); closeTrackMenu(); });
      }
      menu.appendChild(mi);
    };

    const widthGroup = (label, value)=>{
      const active = t._compact ? value === "narrow" : value === (t.width || "standard");
      mkItem(active ? `✓ ${label}` : label, ()=>{
        if (!t.targetGuid) return;
        if (!cfg.spacerWidths) cfg.spacerWidths = {};
        cfg.spacerWidths[t.targetGuid] = value;
        saveCfg();
        renderOrUpdate(true);
      }, t._compact && value !== "narrow");
    };

    mkItem("Delete spacer", ()=>{
      if (!t.targetGuid) return;
      wsSend({type:"setSpacer", guid: t.targetGuid, enabled:false});
      setTimeout(()=>wsSend({type:"reqState"}), 120);
    });
    widthGroup("Standard width", "standard");
    widthGroup("Narrow width", "narrow");
    widthGroup("Wide width", "wide");

    document.body.appendChild(menu);
    const pad = 8;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = x;
    let top = y;
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    if (left + mw > vw - pad) left = Math.max(pad, vw - pad - mw);
    if (top + mh > vh - pad) top = Math.max(pad, vh - pad - mh);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
    _trackMenuEl = menu;
  }

  function openMixerContextMenu(x, y){
    closeMixerMenu();
    const menu = document.createElement("div");
    menu.className = "trackMenu";

    const mkItem = (label, onClick)=>{
      const mi = document.createElement("div");
      mi.className = "mi";
      mi.textContent = label;
      mi.addEventListener("click", (ev)=>{ ev.stopPropagation(); onClick(); closeMixerMenu(); });
      menu.appendChild(mi);
    };

    appendMixerMenuItems(mkItem);

    document.body.appendChild(menu);
    const pad = 8;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = x;
    let top = y;
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    if (left + mw > vw - pad) left = Math.max(pad, vw - pad - mw);
    if (top + mh > vh - pad) top = Math.max(pad, vh - pad - mh);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
    _mixerMenuEl = menu;
  }

  function showSlotActions(row, guid, fx){
    // remove existing
    const old = row.querySelector(".fxSlotActions");
    if (old) old.remove();

    const a = document.createElement("div");
    a.className = "fxSlotActions";

    const bUp = document.createElement("button"); bUp.textContent="↑";
    const bDn = document.createElement("button"); bDn.textContent="↓";
    const bDel = document.createElement("button"); bDel.textContent="✕"; bDel.className="danger";
    const bTg = document.createElement("button"); bTg.textContent = fx.enabled ? "OFF":"ON";

    a.appendChild(bUp); a.appendChild(bDn); a.appendChild(bDel); a.appendChild(bTg);
    row.appendChild(a);

    row._holdOpen = true;

    const refresh = ()=> setTimeout(()=>wsSend({type:"reqFxList", guid}), 60);

    bUp.addEventListener("click", (ev)=>{
      ev.stopPropagation();
      wsSend({type:"moveFx", guid, from: fx.index, to: Math.max(0, fx.index-1)});
      refresh();
      a.remove();
    });
    bDn.addEventListener("click", (ev)=>{
      ev.stopPropagation();
      wsSend({type:"moveFx", guid, from: fx.index, to: fx.index+1});
      refresh();
      a.remove();
    });
    bTg.addEventListener("click", (ev)=>{
      ev.stopPropagation();
      const enabled = !fx.enabled;
      wsSend({type:"setFxEnabled", guid, index: fx.index, enabled});
      fx.enabled = enabled;
      row.classList.toggle("off", !fx.enabled);
      const sw = row.querySelector(".sw"); if (sw) sw.textContent = fx.enabled ? "ON":"OFF";
      bTg.textContent = fx.enabled ? "OFF":"ON";
      // no immediate refresh needed
    });
    bDel.addEventListener("click", (ev)=>{
      ev.stopPropagation();
      const nm = prettyFxName(String(fx.name||("FX "+(fx.index+1))));
      if (!confirm(`Delete FX "${nm}"?`)) return;
      wsSend({type:"deleteFx", guid, index: fx.index});
      refresh();
      a.remove();
    });
    // keep visible for 5s after hold; hide earlier on outside click/scroll
    const clear = ()=>{
      try{ a.remove(); }catch(_){ }
      row._holdOpen = false;
      if (row._slotActionTimer){ clearTimeout(row._slotActionTimer); row._slotActionTimer = null; }
      document.removeEventListener("pointerdown", onDoc, true);
      document.removeEventListener("scroll", onDoc, true);
    };
    const arm = ()=>{
      if (row._slotActionTimer) clearTimeout(row._slotActionTimer);
      row._slotActionTimer = setTimeout(clear, 5000);
    };
    const onDoc = (ev)=>{
      if (!row.contains(ev.target)) clear();
    };
    arm();
    a.addEventListener("pointerdown", (ev)=>{ ev.stopPropagation(); arm(); }, true);
    document.addEventListener("pointerdown", onDoc, true);
    document.addEventListener("scroll", onDoc, true);
  }

  function openFxParamsFromSlot(guid, fxIndex){
    // New: open a plugin window.
    // - Desktop: floating window (multiple allowed)
    // - Phone: fullscreen window
    openPluginWin(guid, fxIndex);
  }

  function primaryFxIndex(guid){
    // Try cache first (may not be 0 if user moved FX around)
    try{
      const cached = fxCache.get(guid);
      const list = (cached && cached.fx) ? cached.fx : [];
      if (list.length){
        return list.reduce((m,f)=>Math.min(m, (typeof f.index==="number"?f.index:0)), 9999);
      }
    }catch(_){ }
    return 0;
  }

  function openFxUIOrMenu(guid){
    const tr = trackByGuid.get(guid);
    const fxCount = tr ? (tr.fxCount||0) : 0;
    if (fxCount > 0){
      openPluginWin(guid, primaryFxIndex(guid));
    } else {
      // No FX yet → open the FX tab (add/manage)
      openTrackMenu(guid, "fx");
    }
  }

  function clearFxSlotDrag(){
    if (!fxSlotDrag) return;
    try{ fxSlotDrag.rowEl && fxSlotDrag.rowEl.classList.remove("dragging"); }catch(_){ }
    try{
      if (fxSlotDrag.targetEl){
        fxSlotDrag.targetEl.classList.remove("dropTarget");
        fxSlotDrag.targetEl.classList.remove("dropAfter");
      }
    }catch(_){ }
    fxSlotDrag = null;
  }

  function setFxSlotDropTarget(el, after){
    if (fxSlotDrag && fxSlotDrag.targetEl && fxSlotDrag.targetEl !== el){
      fxSlotDrag.targetEl.classList.remove("dropTarget");
      fxSlotDrag.targetEl.classList.remove("dropAfter");
    }
    if (fxSlotDrag) fxSlotDrag.targetEl = el;
    if (el){
      el.classList.add("dropTarget");
      el.classList.toggle("dropAfter", !!after);
    }
    if (fxSlotDrag) fxSlotDrag.targetAfter = !!after;
  }

  function onFxSlotDragMove(ev){
    if (!fxSlotDrag || ev.pointerId !== fxSlotDrag.pointerId) return;
    const dx = ev.clientX - fxSlotDrag.startX;
    const dy = ev.clientY - fxSlotDrag.startY;
    if (!fxSlotDrag.started){
      if (fxSlotDrag.holdTriggered) return;
      if (Math.hypot(dx, dy) < 6) return;
      if (fxSlotDrag.holdClear) fxSlotDrag.holdClear();
      fxSlotDrag.started = true;
      fxSlotDrag.rowEl.classList.add("dragging");
      fxSlotDrag.rowEl._skipClick = true;
    }

    const hit = document.elementFromPoint(ev.clientX, ev.clientY);
    const row = hit ? hit.closest(".fxSlot") : null;
    if (!row || !fxSlotDrag.slotsEl || !fxSlotDrag.slotsEl.contains(row)){
      setFxSlotDropTarget(null, false);
      return;
    }
    if (row === fxSlotDrag.rowEl){
      setFxSlotDropTarget(null, false);
      return;
    }
    const rect = row.getBoundingClientRect();
    const after = ev.clientY > (rect.top + rect.height * 0.5);
    setFxSlotDropTarget(row, after);
  }

  function onFxSlotDragEnd(ev){
    if (!fxSlotDrag || ev.pointerId !== fxSlotDrag.pointerId) return;
    const drag = fxSlotDrag;
    const target = drag.targetEl;
    const started = drag.started;
    try{ if (drag.rowEl) drag.rowEl.releasePointerCapture(ev.pointerId); }catch(_){ }
    if (drag.rowEl) setTimeout(()=>{ drag.rowEl._skipClick = false; }, 0);
    clearFxSlotDrag();
    window.removeEventListener("pointermove", onFxSlotDragMove, true);
    window.removeEventListener("pointerup", onFxSlotDragEnd, true);
    window.removeEventListener("pointercancel", onFxSlotDragEnd, true);

    if (!started || !target) return;
    const targetFxIndex = target.dataset.fxIndex ? parseInt(target.dataset.fxIndex, 10) : null;
    const slotIndex = target.dataset.slotIndex ? parseInt(target.dataset.slotIndex, 10) : null;
    let toIndex = null;
    if (Number.isFinite(targetFxIndex)){
      toIndex = targetFxIndex + (drag.targetAfter ? 1 : 0);
    }else if (Number.isFinite(slotIndex)){
      toIndex = slotIndex;
    }
    if (toIndex == null || !Number.isFinite(toIndex)) return;
    if (Number.isFinite(drag.maxIndex)) toIndex = Math.min(drag.maxIndex, toIndex);
    if (toIndex === drag.fxIndex) return;
    wsSend({type:"moveFx", guid: drag.guid, from: drag.fxIndex, to: Math.max(0, toIndex)});
    setTimeout(()=>wsSend({type:"reqFxList", guid: drag.guid}), 80);
  }

  
  function updateFxSlotsUI(el, guid){
    const r = el._refs;
    if (!r || !r.fxSlots) return;

    // Preserve scroll position across frequent FX list refreshes.
    // Some browsers can reset scrollTop when flex/layout styles change.
    // We keep a "live" scrollTop (from the element itself) and prefer the
    // most recent user-driven value when restoring.
    const preScrollTop = r.fxSlots.scrollTop || 0;
    const preUserTs = r.fxSlots._userScrollTs || 0;
    const nowTs = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();

    const expanded = el.classList.contains("fxExpanded") || fxExpanded.has(guid);

    // Phone landscape / compact strips: hide list unless explicitly expanded.
    if (document.body.classList.contains("phoneLandscape") && !expanded){
      r.fxSlots.style.display = "none";
      return;
    }
    if (el.classList.contains("compactChild") && !expanded){
      r.fxSlots.style.display = "none";
      return;
    }
    if (!cfg.showFxSlots && !expanded){
      r.fxSlots.style.display = "none";
      return;
    }

    const cached = fxCache.get(guid);
    const list = (cached && cached.fx) ? cached.fx : [];

    const shown = expanded
      ? Math.max(6, Math.min(24, (list.length||0) + 1))
      : Math.max(4, Math.min(10, parseInt(cfg.fxSlotsShown||4, 10) || 4));

    // Fast path: if FX list + visibility state hasn't changed, avoid touching the DOM.
    // Frequent refreshes during touch/momentum scrolling can cause some browsers to
    // snap scrollTop back to 0 ("spring back"). Keeping this no-op is the most robust fix.
    const visibleWanted = !(document.body.classList.contains("phoneLandscape") && !expanded)
      && !(el.classList.contains("compactChild") && !expanded)
      && (cfg.showFxSlots || expanded);

    const listSig = (()=>{
      try{
        return (list||[]).map(f=>{
          if (!f) return "";
          const nm = String(f.name||"");
          return (f.index + ":" + (f.enabled?1:0) + ":" + nm);
        }).join("|");
      }catch(_){ return ""; }
    })();

    const sig = (visibleWanted? "1":"0") + "|" + (expanded? "1":"0") + "|" + String(shown) + "|" + listSig;

    if (r.fxSlots._contentSig === sig){
      // Fast-path: no structural changes -> avoid DOM churn (keeps scrolling stable).
      if (!visibleWanted){
        if (r.fxSlots.style.display !== "none") r.fxSlots.style.display = "none";
      } else {
        if (r.fxSlots.style.display !== "flex") r.fxSlots.style.display = "flex";
      }
      return;
    }
    r.fxSlots._contentSig = sig;



    const isPtrLike = (s)=> /0x[0-9a-f]+/i.test(String(s||"")) || /^\(.*\*\)/.test(String(s||""));
    const prettyFxName = (s)=> String(s||"").replace(/^\s*(JS|AU|VST3?|VST):\s*/i, "").trim();
    const fxDisplayName = (fx, i)=>{
      let nm = fx ? (fx.name || "") : "";
      if (!nm || isPtrLike(nm)) nm = fx ? ("FX " + (i+1)) : "(empty)";
      nm = prettyFxName(nm);
      if (nm.length > 64) nm = nm.slice(0, 64);
      return nm || "(empty)";
    };

    // Layout
    r.fxSlots.style.display = "flex";
    const savedScrollTop = fxSlotsScroll.get(guid);
    const desiredScrollTop = Number.isFinite(r.fxSlots._userScrollTop)
      ? r.fxSlots._userScrollTop
      : (Number.isFinite(savedScrollTop) ? savedScrollTop : preScrollTop);

    // If the user is actively scrolling (trackpad inertia / touch momentum),
    // avoid forcing scrollTop during this refresh. We'll only restore if the
    // browser/layout actually resets it.
    const userRecentlyScrolled = (preUserTs && (nowTs - preUserTs) < 260);

    r.fxSlots._suppressScrollSave = false;

    let needsScroll = false;
    // Only touch layout styles when the "layout signature" changes.
    // This avoids unwanted scrollTop resets on some browsers.
    const prevSig = r.fxSlots._layoutSig || "";
    let layoutSig = "";
    let layoutChanged = false;
    if (expanded){
      layoutSig = "exp";
      if (layoutSig !== prevSig){
        layoutChanged = true;
        r.fxSlots.classList.add("scroll");
        r.fxSlots.style.maxHeight = "none";
        r.fxSlots.style.height = "100%";
        r.fxSlots.style.flex = "1 1 auto";
        r.fxSlots.style.position = "relative";
        r.fxSlots.style.paddingBottom = "0px";
      }
    } else {
      needsScroll = (list.length >= shown);
      const slotH = 24, gap = 6;
      const maxH = shown*slotH + (shown-1)*gap;
      layoutSig = "cmp:" + shown + ":" + (needsScroll ? "s" : "n") + ":" + maxH;
      if (layoutSig !== prevSig){
        layoutChanged = true;
        r.fxSlots.classList.toggle("scroll", needsScroll);
        r.fxSlots.style.maxHeight = maxH + "px";
        r.fxSlots.style.height = maxH + "px";
        r.fxSlots.style.flex = "0 0 auto";
        r.fxSlots.style.position = "relative";
        r.fxSlots.style.paddingBottom = "0px";
      }
    }
    r.fxSlots._layoutSig = layoutSig;

    // Desired number of rows.
    const totalSlots = expanded
      ? (list.length + 1)
      : (needsScroll ? (list.length + 1) : Math.max(shown, list.length));

    // Create rows once and update in-place. This avoids scrollTop resets from rebuilds.
    const ensureRow = (i)=>{
      const row = document.createElement("div");
      row.className = "fxSlot empty";
      row.dataset.slotIndex = String(i);
      row.dataset.guid = String(guid||"");
      row.innerHTML = `<span class="nm">(empty)</span>`;

      const getFx = ()=>{
        const c = fxCache.get(guid);
        const arr = (c && c.fx) ? c.fx : [];
        const si = Number(row.dataset.slotIndex || 0);
        return arr[si] || null;
      };

      row.addEventListener("click", (ev)=>{
        ev.stopPropagation();
        if (row._holdOpen) return;
        if (row._skipClick){ row._skipClick = false; return; }
        const fx = getFx();
        if (fx){
          openFxParamsFromSlot(guid, fx.index);
        } else {
          openFxAddMenu(guid, row);
        }
      });

      // Touch reliability: on some mobile browsers a fast tap can be lost when
      // the list is reflowing (no click fired). Treat a short touch as a tap.
      let tap = null;
      row.addEventListener("pointerdown", (ev)=>{
        if (ev.pointerType !== "touch") return;
        tap = {id: ev.pointerId, x: ev.clientX, y: ev.clientY, t: Date.now()};
      }, {passive:true});
      row.addEventListener("pointerup", (ev)=>{
        if (!tap || ev.pointerId !== tap.id) return;
        const dt = Date.now() - tap.t;
        const dist = Math.hypot(ev.clientX - tap.x, ev.clientY - tap.y);
        tap = null;
        if (dt > 420 || dist > 12) return; // likely scroll/hold
        if (row._holdOpen) return;
        row._skipClick = true;
        const fx = getFx();
        if (fx) openFxParamsFromSlot(guid, fx.index);
        else openFxAddMenu(guid, row);
      });

      // long-press actions
      let holdT = null;
      const clearHold = ()=>{ if (holdT){ clearTimeout(holdT); holdT=null; } };
      const startHold = (ev)=>{
        ev.stopPropagation();
        clearHold();
        holdT = setTimeout(()=>{
          const fx = getFx();
          if (!fx) return;
          row._holdOpen = true;
          showSlotActions(row, guid, fx);
        }, 420);
      };
      const cancelHold = ()=>{ clearHold(); };
      row.addEventListener("pointerdown", startHold);
      row.addEventListener("pointerup", cancelHold);
      row.addEventListener("pointerleave", cancelHold);
      row.addEventListener("pointercancel", cancelHold);

      // drag reorder (desktop mouse)
      row.addEventListener("pointerdown", (ev)=>{
        if (!FX_SLOT_REORDER_ENABLED) return;
        if (ev.pointerType !== "mouse" || ev.button !== 0) return;
        if (row._holdOpen) return;
        const fx = getFx();
        if (!fx) return;
        fxSlotDrag = {
          guid,
          fxIndex: fx.index,
          rowEl: row,
          slotsEl: r.fxSlots,
          pointerId: ev.pointerId,
          startX: ev.clientX,
          startY: ev.clientY,
          started: false,
          holdTriggered: false,
          holdClear: clearHold,
          targetEl: null,
          targetAfter: false,
          maxIndex: (fxCache.get(guid) && fxCache.get(guid).fx) ? fxCache.get(guid).fx.length : list.length
        };
        try{ row.setPointerCapture(ev.pointerId); }catch(_){ }
        window.addEventListener("pointermove", onFxSlotDragMove, true);
        window.addEventListener("pointerup", onFxSlotDragEnd, true);
        window.addEventListener("pointercancel", onFxSlotDragEnd, true);
      });

      return row;
    };

    // Expand/shrink DOM to match totalSlots without clearing.
    const curRows = Array.from(r.fxSlots.querySelectorAll('.fxSlot'));
    const prevRowCount = curRows.length;
    for (let i=curRows.length; i<totalSlots; i++){
      r.fxSlots.appendChild(ensureRow(i));
    }
    // Remove extra rows from the end (keep badge if present).
    let rows = Array.from(r.fxSlots.querySelectorAll('.fxSlot'));
    while (rows.length > totalSlots){
      const last = rows.pop();
      if (last && last.parentNode) last.parentNode.removeChild(last);
    }
    rows = Array.from(r.fxSlots.querySelectorAll('.fxSlot'));

    // Update row content.
    for (let i=0; i<rows.length; i++){
      const row = rows[i];
      row.dataset.slotIndex = String(i);
      row.dataset.guid = String(guid||"");
      const fx = list[i];
      row.className = "fxSlot" + (fx ? (fx.enabled ? "" : " off") : " empty");
      if (fx) row.dataset.fxIndex = String(fx.index);
      else delete row.dataset.fxIndex;
      const nm = fxDisplayName(fx, i);
      const nmEl = row.querySelector('.nm');
      if (nmEl && nmEl.textContent !== nm) nmEl.textContent = nm;
    }

    // "+N" badge (only when scrollable and not expanded)
    const existingBadge = r.fxSlots.querySelector('.fxMoreBadge');
    if (existingBadge && (expanded || !needsScroll)){
      existingBadge.remove();
    }
    if (!expanded && needsScroll){
      const more = Math.max(0, (list.length||0) - shown);
      let badge = r.fxSlots.querySelector('.fxMoreBadge');
      if (!badge){
        badge = document.createElement('div');
        badge.className = 'fxMoreBadge';
        r.fxSlots.appendChild(badge);
      }
      badge.textContent = '+' + more;
      const onScroll = ()=>{ badge.classList.toggle('hide', r.fxSlots.scrollTop > 0); };
      if (r.fxSlots._badgeScrollHandler){
        r.fxSlots.removeEventListener('scroll', r.fxSlots._badgeScrollHandler);
      }
      r.fxSlots._badgeScrollHandler = onScroll;
      r.fxSlots.addEventListener('scroll', onScroll, {passive:true});
      onScroll();
    }

    
    // After DOM/layout churn, avoid forcing scrollTop while the user is still scrolling (including inertia).
    // If the browser reset this nested scroller to the top after momentum ends, restore to the last desired position.
    try{
      const tsNow = nowTs;
      const recent = (r.fxSlots._userScrollTs && (tsNow - r.fxSlots._userScrollTs) < 1200);
      const desired = (typeof r.fxSlots._scrollDesired === "number") ? r.fxSlots._scrollDesired
        : ((typeof r.fxSlots._lastGoodScrollTop === "number") ? r.fxSlots._lastGoodScrollTop
          : (Number.isFinite(savedScrollTop) ? savedScrollTop : 0));
      const max = Math.max(0, (r.fxSlots.scrollHeight - r.fxSlots.clientHeight));
      const want = Math.max(0, Math.min(max, desired));
      const cur = r.fxSlots.scrollTop || 0;
      if (!recent && want > 2 && cur <= 2 && max > 10){
        r.fxSlots._ignoreNextScroll = true;
        r.fxSlots.scrollTop = want;
      }
      // Never overwrite the stored scroll with a synthetic snap-to-top.
      if (want > 2){
        try{ fxSlotsScroll.set(guid, want); }catch(_){ }
      }
    }catch(_){ }

  }



function applyMeters(msg){
    try{
      for (const fr of (msg.frames||[])){
        const guid = fr.guid;
        const el = stripEls.get(guid);
        if (!el || !el._refs) continue;

        const pkL = Math.max(0, Math.min(1, meterFromPeak(fr.pkL||0)));
        const pkR = Math.max(0, Math.min(1, meterFromPeak(fr.pkR||0)));

        const clipDb = (typeof fr.clipDb === "number") ? fr.clipDb : null;
        let st = meterAnim.get(guid);
        if (!st){
          st = {tL: pkL, tR: pkR, curL: pkL, curR: pkR, pL: pkL, pR: pkR, clipDb: null, clipUntil: 0};
          meterAnim.set(guid, st);
        } else {
          st.tL = pkL;
          st.tR = pkR;
        }
        if (clipDb && clipDb > 0){
          st.clipDb = Math.max(st.clipDb || 0, clipDb);
          st.clipUntil = performance.now() + 1500;
        }
      }
      ensureMeterAnim();
    } catch (e){
      // meters shouldn't kill UI
    }
  }

  // ---------- Modal: Track menu + FX control ----------
  const overlay = document.getElementById("overlay");
  const modal = document.getElementById("modal");
  const modalTitle = document.getElementById("modalTitle");
  const tabsEl = document.getElementById("tabs");
  const modalBody = document.getElementById("modalBody");
  const closeBtn = document.getElementById("closeBtn");
  const renameBtn = document.getElementById("renameBtn");

  let openModal = null; // {guid, tab, fxList, fxParams, fxIndex}

  const TABSET = [
    {id:"general", label:"General"},
    {id:"sends", label:"Sends"},
    {id:"returns", label:"Returns"},
    {id:"fx", label:"FX"},
  ];

  function openTrackMenu(guid, tab){
    window._trackMenuState = window._trackMenuState || {};
    window._trackMenuState.guid = guid;
    window._trackMenuState.tab = tab;

    openModal = {guid, tab: tab||"general", fxList: null, fxParams: null, fxIndex: -1};
    overlay.style.display = "block";
    modal.style.display = "block";
    renderModal();
    if (openModal.tab === "fx"){
      wsSend({type:"reqFxList", guid});
    }
  }

  function closeModal(){
    overlay.style.display = "none";
    modal.style.display = "none";
    openModal = null;
  }
  overlay.addEventListener("click", closeModal);
  closeBtn.addEventListener("click", closeModal);
  if (renameBtn){
    renameBtn.addEventListener("click", ()=>{
      if (!openModal || !openModal.guid) return;
      const t = trackByGuid.get(openModal.guid);
      if (!t) return;
      const current = t.name || "";
      const next = prompt("Rename track", current);
      if (next === null) return;
      const name = String(next).trim();
      if (!name) return;
      wsSend({type:"renameTrack", guid: t.guid, name});
      closeModal();
    });
  }

  function setTab(tab){
    if (!openModal) return;
    openModal.tab = tab;
    if (tab === "fx"){
      wsSend({type:"reqFxList", guid: openModal.guid});
    }
    renderModal();
  }

  
const FX_ADD_CATALOG = [
  {name:"RM-NS", add:"JS: RM_NS||JS:RM_NS||RM_NS"},

  // Use plain JSFX desc names first (these are what REAPER actually matches),
  // then keep older/alternate spellings as fallbacks.
  {name:"RM Gate", add:"JS: RM_Gate||JS:RM_Gate||RM_Gate||JS: RM_Gate [Telemetry]||JS:RM_Gate [Telemetry]||RM_Gate [Telemetry]"},
  {name:"RM PreAmp", add:"JS: RM_PreAmp||JS:RM_PreAmp||RM_PreAmp||JS: RM_Preamp||JS:RM_Preamp||RM_Preamp||RM PreAmp||JS: RM_PreAmp [Telemetry]||JS:RM_PreAmp [Telemetry]||RM_PreAmp [Telemetry]||JS: RM_Preamp [Telemetry]||JS:RM_Preamp [Telemetry]||RM_Preamp [Telemetry]"},
  {name:"RM_EQ", add:"JS: RM_EQ4||JS:RM_EQ4||RM_EQ4||JS: RM_EQ4 (ProQ) + Spectrum v3 [Telemetry]||JS:RM_EQ4 (ProQ) + Spectrum v3 [Telemetry]||RM_EQ4 (ProQ) + Spectrum v3 [Telemetry]"},
  {name:"RM_EQ2", add:"JS: RM_EQ2||JS:RM_EQ2||RM_EQ2||JS: RM_EQ2 (ProQ) + Spectrum v3 [Telemetry]||JS:RM_EQ2 (ProQ) + Spectrum v3 [Telemetry]||RM_EQ2 (ProQ) + Spectrum v3 [Telemetry]"},
  {name:"RM_1175", add:"JS: RM_1175||JS:RM_1175||RM_1175||JS: RM_1175 (1175 core) Hybrid v3||JS:RM_1175 (1175 core) Hybrid v3"},
  {name:"RM_LA1A", add:"JS: RM_LA1A||JS:RM_LA1A||RM_LA1A||JS: RM_LA1A [Telemetry]||JS:RM_LA1A [Telemetry]||RM_LA1A [Telemetry]"},
  {name:"RM_Deesser", add:"JS: RM_Deesser||JS:RM_Deesser||RM_Deesser||JS: RM_Deesser [Telemetry]||JS:RM_Deesser [Telemetry]||RM_Deesser [Telemetry]"},
  {name:"RM_Vox", add:"JS: RM_Rvox||JS:RM_Rvox||RM_Rvox||JS: RM_RVox||JS:RM_RVox||RM_RVox||JS: rm_rvox (RVox-ish) - Gate / Comp / Gain||JS:rm_rvox (RVox-ish) - Gate / Comp / Gain||rm_rvox"},
  {name:"RM_Compressor2", add:"JS: RM_Compressor2||JS:RM_Compressor2||RM_Compressor2||JS: RM_Compressor2 [Telemetry]||JS:RM_Compressor2 [Telemetry]||RM_Compressor2 [Telemetry]"},
  {name:"RM_Limiter2", add:"JS: RM_Limiter2||JS:RM_Limiter2||RM_Limiter2||JS: RM_Limiter2 [Telemetry]||JS:RM_Limiter2 [Telemetry]||RM_Limiter2 [Telemetry]"},
  {name:"RM_Kicker", add:"JS: RM_Kicker||JS:RM_Kicker||RM_Kicker||JS: RM_Kicker50hz [Telemetry]||JS:RM_Kicker50hz [Telemetry]||RM_Kicker50hz [Telemetry]||JS: RM_Kicker50hz||JS:RM_Kicker50hz||RM_Kicker50hz"},
  {name:"RM_DelayMachine", add:"JS: RM_DelayMachine||JS:RM_DelayMachine||RM_DelayMachine"},
  {name:"RM_Saturator", add:"JS: RM_Saturator||JS:RM_Saturator||RM_Saturator||JS: rm_saturator (2x OS + Auto Level v3)||JS:rm_saturator (2x OS + Auto Level v3)||rm_saturator"},
  {name:"RM_EQT1A", add:"JS: RM_EQT1A||JS:RM_EQT1A||RM_EQT1A"},
  {name:"RM_Lexikan2", add:"JS: RM_Lexikan2||JS:RM_Lexikan2||RM_Lexikan2"},
  {name:"RM_Air", add:"JS: RM_Air||JS:RM_Air||RM_Air"}
];

  function attachTapTempoButton(btn, onTap){
    if (!btn) return;
    let lastTouchTap = 0;
    const handleTap = ()=>{
      if (typeof onTap === "function") onTap();
    };
    btn.addEventListener("pointerdown", (ev)=>{
      if (ev.pointerType !== "touch") return;
      ev.preventDefault();
      lastTouchTap = Date.now();
      handleTap();
    });
    btn.addEventListener("click", ()=>{
      if (lastTouchTap && (Date.now() - lastTouchTap) < 500) return;
      handleTap();
    });
  }

  function renderTransportModal(){
    modalTitle.textContent = "Transport";
    tabsEl.innerHTML = "";
    modalBody.innerHTML = "";

    const wrap = document.createElement("div");
    wrap.className = "transportModal";
    const isPhone = isPhoneLike();
    if (isPhone) wrap.classList.add("phoneTransport");

    if (isPhone){
      const title = document.createElement("div");
      title.className = "transportProject";
      title.textContent = getProjectLabel();
      wrap.appendChild(title);
    }

    const controls = document.createElement("div");
    controls.className = "transportControls";
    const mkCtrl = (label, title, action, extraClass)=>{
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.title = title;
      if (extraClass) btn.classList.add(extraClass);
      btn.addEventListener("click", ()=>wsSend({type:"transport", action}));
      return btn;
    };
    const stopBtn = mkCtrl("■", "Stop", "stop", "stop");
    const playBtn = mkCtrl("▶", "Play", "play");
    const pauseBtn = mkCtrl("❚❚", "Pause", "pause");
    const recBtn = mkCtrl("●", "Record", "record", "rec");
    controls.append(stopBtn, playBtn, pauseBtn, recBtn);

    const info = document.createElement("div");
    info.className = "transportInfo";
    const timeBtn = document.createElement("button");
    timeBtn.className = "transportValue";
    timeBtn.title = "Project time";
    const barsBtn = document.createElement("button");
    barsBtn.className = "transportValue";
    barsBtn.title = "Bars/Beats";
    const bpmBtn = document.createElement("button");
    bpmBtn.className = "transportValue";
    bpmBtn.title = "BPM";
    bpmBtn.addEventListener("click", openBpmModal);
    info.append(timeBtn, barsBtn);
    if (!isPhone) info.appendChild(bpmBtn);

    wrap.appendChild(controls);
    wrap.appendChild(info);

    let bpmInput = null;
    if (isPhone){
      const bpmRow = document.createElement("div");
      bpmRow.className = "row transportBpmRow";
      const label = document.createElement("label");
      label.textContent = "BPM";
      const input = document.createElement("input");
      bpmInput = input;
      input.type = "number";
      input.min = "20";
      input.max = "300";
      input.step = "1";
      const tapBtn = document.createElement("button");
      tapBtn.className = "miniBtn";
      tapBtn.textContent = "Tap";
      const applyBtn = document.createElement("button");
      applyBtn.className = "miniBtn on";
      applyBtn.textContent = "Apply";
      bpmRow.append(label, input, tapBtn, applyBtn);
      wrap.appendChild(bpmRow);

      const clampBpm = (v)=>{
        const n = Number.isFinite(v) ? v : 120;
        return Math.max(20, Math.min(300, Math.round(n)));
      };
      const current = (lastState && lastState.transport && Number.isFinite(lastState.transport.bpm)) ? Math.round(lastState.transport.bpm) : 120;
      openModal.draftBpm = current;
      input.value = String(current);

      const setDraft = (v)=>{
        const n = clampBpm(v);
        openModal.draftBpm = n;
        input.value = String(n);
      };
      input.addEventListener("input", ()=> setDraft(parseFloat(input.value)));

      let taps = [];
      const handleTap = ()=>{
        const now = performance.now();
        taps.push(now);
        if (taps.length > 6) taps = taps.slice(-6);
        if (taps.length >= 2){
          const intervals = [];
          for (let i=1;i<taps.length;i++) intervals.push(taps[i]-taps[i-1]);
          const avg = intervals.reduce((a,b)=>a+b,0) / intervals.length;
          if (avg > 0){
            const bpm = 60000 / avg;
            setDraft(bpm);
          }
        }
      };
      attachTapTempoButton(tapBtn, handleTap);
      applyBtn.addEventListener("click", ()=> wsSend({type:"setBpm", bpm: openModal.draftBpm}));

      const mkPhoneToggle = (label, key, onChange) => {
        const row = document.createElement("div");
        row.className = "row";
        row.innerHTML = `<label>${label}</label><button class="miniBtn ${cfg[key]?'on':''}">${cfg[key]?'ON':'OFF'}</button>`;
        const btn = row.querySelector("button");
        btn.addEventListener("click", ()=>{
          cfg[key] = !cfg[key];
          saveCfg();
          btn.classList.toggle("on", cfg[key]);
          btn.textContent = cfg[key] ? "ON":"OFF";
          if (onChange) onChange();
        });
        return row;
      };
      wrap.appendChild(mkPhoneToggle("Show track/folder frames", "showTrackFrames", applyTrackFrames));
    }

    modalBody.appendChild(wrap);

    openModal.transportRefs = {
      time: timeBtn,
      bars: barsBtn,
      bpm: bpmBtn,
      bpmInput,
      play: playBtn,
      pause: pauseBtn,
      rec: recBtn,
      stop: stopBtn,
    };
    if (lastState && lastState.transport) updateTransportUI(lastState.transport);
  }


  function renderBpmModal(){
    modalTitle.textContent = "BPM";
    tabsEl.innerHTML = "";
    modalBody.innerHTML = "";

    const wrap = document.createElement("div");
    const current = Number.isFinite(openModal.draftBpm) ? openModal.draftBpm : 120;
    openModal.draftBpm = current;
    const clampBpm = (v)=>{
      const n = Number.isFinite(v) ? v : 120;
      return Math.max(20, Math.min(300, Math.round(n)));
    };

    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<label>Tempo</label>
      <div style="display:flex; align-items:center; gap:10px; flex:1;">
        <input class="rng" type="range" min="20" max="300" step="1" value="${current}">
        <input class="inp" type="number" min="20" max="300" step="1" value="${current}" style="width:90px;">
      </div>`;
    wrap.appendChild(row);

    const tapRow = document.createElement("div");
    tapRow.className = "row";
    tapRow.innerHTML = `<label>Tap tempo</label><button class="miniBtn">Tap</button><div class="small" style="margin-left:auto">tap 4x+</div>`;
    wrap.appendChild(tapRow);

    const btnRow = document.createElement("div");
    btnRow.className = "row";
    btnRow.style.justifyContent = "flex-end";
    btnRow.innerHTML = `<button class="miniBtn">Cancel</button><button class="miniBtn on">Apply</button>`;
    wrap.appendChild(btnRow);

    const slider = row.querySelector("input.rng");
    const input = row.querySelector("input.inp");
    const tapBtn = tapRow.querySelector("button");
    const [cancelBtn, applyBtn] = btnRow.querySelectorAll("button");

    const setDraft = (v)=>{
      const n = clampBpm(v);
      openModal.draftBpm = n;
      slider.value = String(n);
      input.value = String(n);
    };

    slider.addEventListener("input", ()=> setDraft(parseFloat(slider.value)));
    input.addEventListener("input", ()=> setDraft(parseFloat(input.value)));

    let taps = [];
    const handleTap = ()=>{
      const now = performance.now();
      taps.push(now);
      if (taps.length > 6) taps = taps.slice(-6);
      if (taps.length >= 2){
        const intervals = [];
        for (let i=1;i<taps.length;i++) intervals.push(taps[i]-taps[i-1]);
        const avg = intervals.reduce((a,b)=>a+b,0) / intervals.length;
        if (avg > 0){
          const bpm = 60000 / avg;
          setDraft(bpm);
        }
      }
    };
    attachTapTempoButton(tapBtn, handleTap);

    cancelBtn.addEventListener("click", closeModal);
    applyBtn.addEventListener("click", ()=>{
      wsSend({type:"setBpm", bpm: openModal.draftBpm});
      closeModal();
    });

    modalBody.appendChild(wrap);
  }

  function renderModal(){
    if (!openModal) return;
    if (renameBtn){
      const showRename = !openModal.kind && !!openModal.guid;
      renameBtn.style.display = showRename ? "inline-flex" : "none";
    }
    if (openModal.kind === "settings"){
      renderSettingsModal();
      return;
    }
    if (openModal.kind === "scenes"){
      renderScenesModal();
      return;
    }
    if (openModal.kind === "transport"){
      renderTransportModal();
      return;
    }
    if (openModal.kind === "bpm"){
      renderBpmModal();
      return;
    }
    const t = trackByGuid.get(openModal.guid);
    modalTitle.textContent = (t ? (t.kind==="master" ? "MASTER" : t.name) : "Track");
    tabsEl.innerHTML = "";
    for (const tb of TABSET){
      const b = document.createElement("div");
      b.className = "tab" + (openModal.tab===tb.id ? " on" : "");
      b.textContent = tb.label;
      b.addEventListener("click", ()=>setTab(tb.id));
      tabsEl.appendChild(b);
    }

    modalBody.innerHTML = "";
    if (!t){
      modalBody.innerHTML = "<div class='small'>No track data.</div>";
      return;
    }

    if (openModal.tab === "general"){
      renderGeneral(t);
      return;
    }
    if (openModal.tab === "sends"){
      if (typeof renderSendsTab === "function") renderSendsTab(t);
      else modalBody.innerHTML = `<div class="small">Sends UI error. Reload page.</div>`;
      return;
    }
    if (openModal.tab === "returns"){
      if (typeof renderReturnsTab === "function") renderReturnsTab(t);
      else modalBody.innerHTML = `<div class="small">Returns UI error. Reload page.</div>`;
      return;
    }
    if (openModal.tab === "fx"){
      renderFxTab(t);
      return;
    }
    if (openModal.tab === "fxparams"){
      renderFxParamsTab(t);
      return;
    }
  }

  function renderGeneral(t){
    const wrap = document.createElement("div");

    // FX all-off warning
    if ((t.fxAllOff || false) && (t.fxCount||0)>0){
      const warn=document.createElement('div');
      warn.className='fxAllOffBanner';
      warn.textContent=`⚠ All FX are OFF on this track (FX: ${t.fxCount||0}).`;
      wrap.appendChild(warn);
    }

    // VOL
    const volRow = document.createElement("div");
    volRow.className = "row";
    volRow.innerHTML = `<label>Volume</label><input type="range" min="0" max="1" step="0.001" value="${1 - yFromVol(t.vol||1)}" style="flex:1"><div class="small" style="width:70px; text-align:right">${dbFromVol(t.vol||1)} dB</div>`;
    const volSl = volRow.querySelector("input");
    const volVal = volRow.querySelector("div");
    const applyVolUI = (vol)=>{
      if (volVal) volVal.textContent = `${dbFromVol(vol)} dB`;
      // slider uses 0..1 reversed mapping from vol->y
      try{ volSl.value = (1 - yFromVol(vol)); }catch(_){}
    };
    volSl.addEventListener("input", ()=>{
      const vol = volFromDb(dbFromNorm(parseFloat(volSl.value)));
      wsSend({type:"setVol", guid:t.guid, vol});
      // optimistic UI
      t.vol = vol;
      applyVolUI(vol);
    });
    volSl.addEventListener("dblclick",(e)=>{
      e.preventDefault();
      const vol = 1.0; // 0 dB
      wsSend({type:"setVol", guid:t.guid, vol});
      t.vol = vol;
      applyVolUI(vol);
    });
    wrap.appendChild(volRow);

    // PAN
    if (t.kind !== "master"){
      const panRow = document.createElement("div");
      panRow.className = "row";
      panRow.innerHTML = `<label>Pan</label><input type="range" min="-1" max="1" step="0.01" value="${t.pan||0}" style="flex:1"><div class="small" style="width:70px; text-align:right">${panLabel(t.pan||0)}</div>`;
      const panSl = panRow.querySelector("input");
      const panVal = panRow.querySelector("div");
      const applyPanUI = (pan)=>{
        if (panVal) panVal.textContent = panLabel(pan);
        try{ panSl.value = pan; }catch(_){}
      };
      panSl.addEventListener("input", ()=>{
        const pan = parseFloat(panSl.value);
        wsSend({type:"setPan", guid:t.guid, pan});
        t.pan = pan;
        applyPanUI(pan);
      });
      panSl.addEventListener("dblclick",(e)=>{
        e.preventDefault();
        const pan = 0; // center
        wsSend({type:"setPan", guid:t.guid, pan});
        t.pan = pan;
        applyPanUI(pan);
      });
      wrap.appendChild(panRow);
    }

    // M/S/R buttons
    const bRow = document.createElement("div");
    bRow.className = "row";
    bRow.innerHTML = `<label>Buttons</label>
      <button class="miniBtn ${t.mute?'on':''}">Mute</button>
      <button class="miniBtn ${t.solo?'on':''}" ${t.kind==="master"?'disabled':''}>Solo</button>
      <button class="miniBtn ${t.rec?'on':''}" ${t.kind==="master"?'disabled':''}>Rec</button>
    `;
    const [bM,bS,bR] = bRow.querySelectorAll("button");
    bM.addEventListener("click", ()=>{
      const v=!t.mute; t.mute=v; bM.classList.toggle('on',v);
      wsSend({type:"setMute", guid:t.guid, mute:v});
      renderOrUpdate();
    });
    bS.addEventListener("click", ()=>{
      const v=!t.solo; t.solo=v; bS.classList.toggle('on',v);
      wsSend({type:"setSolo", guid:t.guid, solo:v});
      renderOrUpdate();
    });
    bR.addEventListener("click", ()=>{
      const v=!t.rec; t.rec=v; bR.classList.toggle('on',v);
      wsSend({type:"setRec", guid:t.guid, rec:v});
      renderOrUpdate();
    });
    wrap.appendChild(bRow);

    // Rec input selection when rec armed (and not master)
    if (t.kind !== "master"){
      const ri = document.createElement("div");
      ri.className = "row";
      const cur = (typeof t.recInput === "number") ? (t.recInput + 1) : 1;
      let opts = "";
      for (let i=1;i<=16;i++) opts += `<option value="${i}" ${i===cur?'selected':''}>Input ${i}</option>`;
      ri.innerHTML = `<label>Rec input</label><select style="flex:1;height:34px;border-radius:10px;border:1px solid rgba(0,0,0,.75);background:#22252a;color:#ddd;padding:0 10px;">${opts}</select>
                      <div class="small" style="width:70px;text-align:right">${t.rec? "armed":"off"}</div>`;
      const sel = ri.querySelector("select");
      sel.addEventListener("change", ()=>wsSend({type:"setRecInput", guid:t.guid, input: parseInt(sel.value,10)}));
      wrap.appendChild(ri);

      const hint = document.createElement("div");
      hint.className = "small";
      hint.style.opacity = 0.75;
      hint.textContent = "Rec input currently assumes mono hardware inputs (Input 1 => 0, Input 2 => 1 ...).";
      wrap.appendChild(hint);
    }

    
        // Assignments moved to Settings → Track Manager.

modalBody.appendChild(wrap);
  }

  function _chanLabel(s){
    if (!s) return "";
    // Accept '3-4' or '3/4'
    return String(s).replace("/", "-");
  }
  function _chanPairLabel(v){
    const start = Number(v);
    if (!Number.isFinite(start)) return "1-2";
    return `${start + 1}-${start + 2}`;
  }
  function _chanPairOptions(maxPairs=8){
    const opts = [];
    for (let i=0;i<maxPairs;i++){
      const v = i * 2;
      opts.push({value: v, label: _chanPairLabel(v)});
    }
    return opts;
  }
  function _chanPairValue(label){
    if (!label) return 0;
    const txt = String(label).trim();
    const parts = txt.split(/[-/]/);
    const start = parseInt(parts[0], 10);
    if (!Number.isFinite(start)) return 0;
    const zero = Math.max(0, start - 1);
    return zero - (zero % 2);
  }

  function renderSendsTab(t){
    const sends = (t.sendDetails || []);
    const names = (t.sendSlots || []);
    const wrap = document.createElement("div");

    const addRow = document.createElement("div");
    addRow.className = "row";
    const tracks = (lastState && lastState.tracks) ? lastState.tracks : [];
    const otherTracks = tracks.filter(tr => tr.guid && tr.guid !== t.guid);
    const chanOptions = _chanPairOptions(8);
    const opts = otherTracks.map(tr => `<option value="${tr.guid}">${escapeHtml(tr.name || ("Track " + tr.idx))}</option>`).join("");
    const chanOpts = chanOptions.map(o => `<option value="${o.value}">${o.label}</option>`).join("");
    addRow.innerHTML = `<label>Add send</label>
      <select style="flex:1;height:34px;border-radius:10px;border:1px solid rgba(0,0,0,.75);background:#22252a;color:#ddd;padding:0 10px;">
        ${opts || `<option value="">No tracks</option>`}
      </select>
      <select style="width:82px;height:34px;border-radius:10px;border:1px solid rgba(0,0,0,.75);background:#22252a;color:#ddd;padding:0 8px;">
        ${chanOpts}
      </select>
      <select style="width:82px;height:34px;border-radius:10px;border:1px solid rgba(0,0,0,.75);background:#22252a;color:#ddd;padding:0 8px;">
        ${chanOpts}
      </select>
      <button class="miniBtn" ${opts ? "" : "disabled"}>Add</button>`;
    const [sel, srcSel, dstSel] = addRow.querySelectorAll("select");
    const addBtn = addRow.querySelector("button");
    addBtn.addEventListener("click", ()=>{
      const destGuid = sel.value;
      if (!destGuid) return;
      const srcChan = parseInt(srcSel.value, 10);
      const dstChan = parseInt(dstSel.value, 10);
      wsSend({type:"addSend", guid:t.guid, destGuid, srcChan, dstChan});
      const destTrack = otherTracks.find(tr => tr.guid === destGuid);
      if (destTrack){
        const next = (t.sendDetails || []).slice();
        next.push({
          index: next.length,
          destName: destTrack.name || ("Track " + destTrack.idx),
          vol: 1,
          mute: false,
          mode: 0,
          srcCh: _chanPairLabel(srcChan),
          dstCh: _chanPairLabel(dstChan)
        });
        t.sendDetails = next;
        if (openModal && openModal.guid === t.guid && openModal.tab === "sends") renderModal();
      }
      setTimeout(()=>wsSend({type:"reqState"}), 120);
      setTimeout(()=>wsSend({type:"reqState"}), 500);
    });
    wrap.appendChild(addRow);

    const list = document.createElement("div");
    list.className = "sendList";

    const rows = sends.length ? sends : names.map((nm,i)=>({index:i, destName:nm, vol:1, mute:false, mode:0, srcCh:"1-2", dstCh:"3-4"}));

    rows.forEach(sd=>{
      const card = document.createElement("div");
      card.className = "sendCard";
      const modePre = (sd.mode && sd.mode!==0);
      const srcVal = _chanPairValue(sd.srcCh);
      const dstVal = _chanPairValue(sd.dstCh);
      card.innerHTML = `
        <div class="sendTop">
          <div class="sendName">${escapeHtml(sd.destName||("Send "+(sd.index+1)))}</div>
          <div class="sendMeta">${_chanLabel(sd.srcCh)} → ${_chanLabel(sd.dstCh)}</div>
          <button class="miniBtn ${sd.mute?'on':''}">Mute</button>
          <div class="seg">
            <button class="${!modePre?'on':''}">Post</button>
            <button class="${modePre?'on':''}">Pre</button>
          </div>
        </div>
        <div class="row" style="margin:6px 0 2px 0;">
          <label class="small" style="width:40px;">Ch</label>
          <select class="sendChan src" style="width:82px;height:30px;border-radius:10px;border:1px solid rgba(0,0,0,.75);background:#22252a;color:#ddd;padding:0 8px;">
            ${chanOpts}
          </select>
          <div class="small">→</div>
          <select class="sendChan dst" style="width:82px;height:30px;border-radius:10px;border:1px solid rgba(0,0,0,.75);background:#22252a;color:#ddd;padding:0 8px;">
            ${chanOpts}
          </select>
        </div>
        <div class="sendFader">
          <label class="small" style="width:40px">Lvl</label>
          <input type="range" min="0" max="1" step="0.001" value="${normFromDb((sd.vol&&sd.vol>0)?(20*Math.log10(sd.vol)):-60)}">
          <div class="small" style="width:70px; text-align:right">${dbFromVol(sd.vol||1)} dB</div>
        </div>
      `;
      const [bMute, bPost, bPre] = card.querySelectorAll(".sendTop button");
      const segBtns = card.querySelectorAll(".seg button");
      const srcSelRow = card.querySelector("select.sendChan.src");
      const dstSelRow = card.querySelector("select.sendChan.dst");
      const sl = card.querySelector("input[type=range]");
      const valEl = card.querySelectorAll(".sendFader .small")[1];
      if (srcSelRow) srcSelRow.value = String(srcVal);
      if (dstSelRow) dstSelRow.value = String(dstVal);

      bMute.addEventListener("click", ()=>{
        const v=!sd.mute; sd.mute=v; bMute.classList.toggle("on", v);
        wsSend({type:"setSendMute", guid:t.guid, index: sd.index, mute:v});
      });
      segBtns[0].addEventListener("click", ()=>{
        sd.mode=0;
        segBtns[0].classList.add("on"); segBtns[1].classList.remove("on");
        wsSend({type:"setSendMode", guid:t.guid, index: sd.index, mode:0});
      });
      segBtns[1].addEventListener("click", ()=>{
        sd.mode=1;
        segBtns[1].classList.add("on"); segBtns[0].classList.remove("on");
        wsSend({type:"setSendMode", guid:t.guid, index: sd.index, mode:1});
      });
      sl.addEventListener("input", ()=>{
        const n=parseFloat(sl.value);
        const db=dbFromNorm(n);
        const vol=volFromDb(db);
        sd.vol=vol;
        if (valEl) valEl.textContent = `${dbFromVol(vol)} dB`;
        wsSend({type:"setSendVol", guid:t.guid, index: sd.index, vol});
      });
      sl.addEventListener("dblclick", (ev)=>{
        ev.preventDefault();
        sd.vol = 1;
        if (valEl) valEl.textContent = `${dbFromVol(1)} dB`;
        sl.value = String(normFromDb(0));
        wsSend({type:"setSendVol", guid:t.guid, index: sd.index, vol: 1});
      });
      srcSelRow?.addEventListener("change", ()=>{
        const val = parseInt(srcSelRow.value, 10);
        sd.srcCh = _chanPairLabel(val);
        const meta = card.querySelector(".sendMeta");
        if (meta) meta.textContent = `${_chanLabel(sd.srcCh)} → ${_chanLabel(sd.dstCh)}`;
        wsSend({type:"setSendSrcChan", guid:t.guid, index: sd.index, chan: val});
      });
      dstSelRow?.addEventListener("change", ()=>{
        const val = parseInt(dstSelRow.value, 10);
        sd.dstCh = _chanPairLabel(val);
        const meta = card.querySelector(".sendMeta");
        if (meta) meta.textContent = `${_chanLabel(sd.srcCh)} → ${_chanLabel(sd.dstCh)}`;
        wsSend({type:"setSendDstChan", guid:t.guid, index: sd.index, chan: val});
      });
      list.appendChild(card);
    });
    if (!rows.length){
      const empty = document.createElement("div");
      empty.className = "small";
      empty.textContent = "No sends.";
      wrap.appendChild(empty);
    } else {
      wrap.appendChild(list);
    }
    modalBody.appendChild(wrap);
  }

  function renderReturnsTab(t){
    const recvs = (t.recvDetails || []);
    const names = (t.recvSlots || []);
    const wrap = document.createElement("div");

    const addRow = document.createElement("div");
    addRow.className = "row";
    const tracks = (lastState && lastState.tracks) ? lastState.tracks : [];
    const otherTracks = tracks.filter(tr => tr.guid && tr.guid !== t.guid);
    const chanOptions = _chanPairOptions(8);
    const opts = otherTracks.map(tr => `<option value="${tr.guid}">${escapeHtml(tr.name || ("Track " + tr.idx))}</option>`).join("");
    const chanOpts = chanOptions.map(o => `<option value="${o.value}">${o.label}</option>`).join("");
    addRow.innerHTML = `<label>Add return</label>
      <select style="flex:1;height:34px;border-radius:10px;border:1px solid rgba(0,0,0,.75);background:#22252a;color:#ddd;padding:0 10px;">
        ${opts || `<option value="">No tracks</option>`}
      </select>
      <select style="width:82px;height:34px;border-radius:10px;border:1px solid rgba(0,0,0,.75);background:#22252a;color:#ddd;padding:0 8px;">
        ${chanOpts}
      </select>
      <select style="width:82px;height:34px;border-radius:10px;border:1px solid rgba(0,0,0,.75);background:#22252a;color:#ddd;padding:0 8px;">
        ${chanOpts}
      </select>
      <button class="miniBtn" ${opts ? "" : "disabled"}>Add</button>`;
    const [sel, srcSel, dstSel] = addRow.querySelectorAll("select");
    const addBtn = addRow.querySelector("button");
    addBtn.addEventListener("click", ()=>{
      const sourceGuid = sel.value;
      if (!sourceGuid) return;
      const srcChan = parseInt(srcSel.value, 10);
      const dstChan = parseInt(dstSel.value, 10);
      wsSend({type:"addReturn", guid:t.guid, sourceGuid, srcChan, dstChan});
      const sourceTrack = otherTracks.find(tr => tr.guid === sourceGuid);
      if (sourceTrack){
        const next = (t.recvDetails || []).slice();
        next.push({
          index: next.length,
          srcName: sourceTrack.name || ("Track " + sourceTrack.idx),
          vol: 1,
          mute: false,
          srcCh: _chanPairLabel(srcChan),
          dstCh: _chanPairLabel(dstChan)
        });
        t.recvDetails = next;
        if (openModal && openModal.guid === t.guid && openModal.tab === "returns") renderModal();
      }
      setTimeout(()=>wsSend({type:"reqState"}), 120);
      setTimeout(()=>wsSend({type:"reqState"}), 500);
    });
    wrap.appendChild(addRow);

    const list = document.createElement("div");
    list.className = "sendList";
    const rows = recvs.length ? recvs : names.map((nm,i)=>({index:i, srcName:nm, vol:1, mute:false, srcCh:"1-2", dstCh:"3-4"}));
    rows.forEach(rd=>{
      const card = document.createElement("div");
      card.className = "sendCard";
      const srcVal = _chanPairValue(rd.srcCh);
      const dstVal = _chanPairValue(rd.dstCh);
      card.innerHTML = `
        <div class="sendTop">
          <div class="sendName">${escapeHtml(rd.srcName||("Return "+(rd.index+1)))}</div>
          <div class="sendMeta">${_chanLabel(rd.srcCh)} → ${_chanLabel(rd.dstCh)}</div>
          <button class="miniBtn ${rd.mute?'on':''}">Mute</button>
        </div>
        <div class="row" style="margin:6px 0 2px 0;">
          <label class="small" style="width:40px;">Ch</label>
          <select class="sendChan src" style="width:82px;height:30px;border-radius:10px;border:1px solid rgba(0,0,0,.75);background:#22252a;color:#ddd;padding:0 8px;">
            ${chanOpts}
          </select>
          <div class="small">→</div>
          <select class="sendChan dst" style="width:82px;height:30px;border-radius:10px;border:1px solid rgba(0,0,0,.75);background:#22252a;color:#ddd;padding:0 8px;">
            ${chanOpts}
          </select>
        </div>
        <div class="sendFader">
          <label class="small" style="width:40px">Lvl</label>
          <input type="range" min="0" max="1" step="0.001" value="${normFromDb((rd.vol&&rd.vol>0)?(20*Math.log10(rd.vol)):-60)}">
          <div class="small" style="width:70px; text-align:right">${dbFromVol(rd.vol||1)} dB</div>
        </div>
      `;
      const bMute = card.querySelector(".sendTop button");
      const srcSelRow = card.querySelector("select.sendChan.src");
      const dstSelRow = card.querySelector("select.sendChan.dst");
      const sl = card.querySelector("input[type=range]");
      const valEl = card.querySelectorAll(".sendFader .small")[1];
      if (srcSelRow) srcSelRow.value = String(srcVal);
      if (dstSelRow) dstSelRow.value = String(dstVal);
      bMute.addEventListener("click", ()=>{
        const v=!rd.mute; rd.mute=v; bMute.classList.toggle("on", v);
        wsSend({type:"setRecvMute", guid:t.guid, index: rd.index, mute:v});
      });
      sl.addEventListener("input", ()=>{
        const n=parseFloat(sl.value);
        const db=dbFromNorm(n);
        const vol=volFromDb(db);
        rd.vol=vol;
        if (valEl) valEl.textContent = `${dbFromVol(vol)} dB`;
        wsSend({type:"setRecvVol", guid:t.guid, index: rd.index, vol});
      });
      sl.addEventListener("dblclick", (ev)=>{
        ev.preventDefault();
        rd.vol = 1;
        if (valEl) valEl.textContent = `${dbFromVol(1)} dB`;
        sl.value = String(normFromDb(0));
        wsSend({type:"setRecvVol", guid:t.guid, index: rd.index, vol: 1});
      });
      srcSelRow?.addEventListener("change", ()=>{
        const val = parseInt(srcSelRow.value, 10);
        rd.srcCh = _chanPairLabel(val);
        const meta = card.querySelector(".sendMeta");
        if (meta) meta.textContent = `${_chanLabel(rd.srcCh)} → ${_chanLabel(rd.dstCh)}`;
        wsSend({type:"setRecvSrcChan", guid:t.guid, index: rd.index, chan: val});
      });
      dstSelRow?.addEventListener("change", ()=>{
        const val = parseInt(dstSelRow.value, 10);
        rd.dstCh = _chanPairLabel(val);
        const meta = card.querySelector(".sendMeta");
        if (meta) meta.textContent = `${_chanLabel(rd.srcCh)} → ${_chanLabel(rd.dstCh)}`;
        wsSend({type:"setRecvDstChan", guid:t.guid, index: rd.index, chan: val});
      });
      list.appendChild(card);
    });
    if (!rows.length){
      const empty = document.createElement("div");
      empty.className = "small";
      empty.textContent = "No returns.";
      wrap.appendChild(empty);
    } else {
      wrap.appendChild(list);
    }
    modalBody.appendChild(wrap);
  }


  function renderFxTab(t){
    // FX list + add catalog + enable all off/on
    const wrap = document.createElement("div");

    const top = document.createElement("div");
    top.className = "row";
    top.innerHTML = `<label>FX</label>
      <button class="miniBtn">Refresh</button>
      <button class="miniBtn">Add FX</button>
      <button class="miniBtn">All ON</button>
      <button class="miniBtn">All OFF</button>
    `;
    const [bR,bAdd,bOn,bOff] = top.querySelectorAll("button");
    bR.addEventListener("click", ()=>wsSend({type:"reqFxList", guid:t.guid}));
    bAdd.addEventListener("click", (ev)=> openFxAddMenu(t.guid, ev.currentTarget));
    bOn.addEventListener("click", ()=>wsSend({type:"setFxAllEnabled", guid:t.guid, enabled:true}));
    bOff.addEventListener("click", ()=>wsSend({type:"setFxAllEnabled", guid:t.guid, enabled:false}));
    wrap.appendChild(top);

    const list = document.createElement("div");
    list.className = "fxList";
    const fx = openModal.fxList || [];
    if (!fx.length){
      list.innerHTML = `<div class="small">No FX on this track.</div>`;
    } else {
      fx.forEach((f, idx)=>{
        const item = document.createElement("div");
        item.className = "fxItem";
        item.innerHTML = `
          <div class="nm">${escapeHtml(prettyFxName(f.name))}</div>
          <div class="fxCtl">
            <button class="miniBtn ${f.enabled?'on':''}">${f.enabled?'ON':'OFF'}</button>
            <button class="miniBtn">Params</button>
            <button class="miniBtn">Delete</button>
            <button class="miniBtn">↑</button>
            <button class="miniBtn">↓</button>
          </div>
        `;
        const [bEn,bP,bDel,bUp,bDn] = item.querySelectorAll("button");
        // Tap the row to open the plugin UI (one click flow)
        item.addEventListener("click", ()=>openPluginWin(t.guid, f.index));

        bEn.addEventListener("click", (ev)=>{ ev.stopPropagation(); wsSend({type:"setFxEnabled", guid:t.guid, index:f.index, enabled: !f.enabled}); });
        bP.addEventListener("click", (ev)=>{
          ev.stopPropagation();
          // Prefer the plugin window UI.
          openPluginWin(t.guid, f.index);
        });
        bDel.addEventListener("click", (ev)=>{
          ev.stopPropagation();
          wsSend({type:"deleteFx", guid:t.guid, index:f.index});
          setTimeout(()=>wsSend({type:"reqFxList", guid:t.guid}), 60);
        });
        bUp.addEventListener("click", (ev)=>{ ev.stopPropagation(); if (f.index>0) wsSend({type:"moveFx", guid:t.guid, from:f.index, to:f.index-1}); });
        bDn.addEventListener("click", (ev)=>{ ev.stopPropagation(); wsSend({type:"moveFx", guid:t.guid, from:f.index, to:f.index+1}); });
        list.appendChild(item);
      });
    }
    wrap.appendChild(list);

    modalBody.appendChild(wrap);
  }

  function renderFxParamsTab(t){
    const wrap = document.createElement("div");
    const fxIndex = openModal.fxIndex;
    const title = document.createElement("div");
    title.className = "row";
    const fxName = (()=>{
      try{
        const cached = fxCache.get(t.guid);
        const list = (openModal.fxList && openModal.fxList.length) ? openModal.fxList : ((cached && cached.fx) ? cached.fx : []);
        const f = list.find(x=>x.index===fxIndex);
        return f ? (f.name||"") : "";
      }catch(_){ return ""; }
    })();
    title.innerHTML = `<label>FX params</label>
      <button class="miniBtn">Back</button>
      <button class="miniBtn">Refresh</button>
      <div class="small" style="margin-left:auto">${fxName ? escapeHtml(prettyFxName(fxName)) + " • " : ""}#${fxIndex}</div>`;
    const [bBack,bRef] = title.querySelectorAll("button");
    bBack.addEventListener("click", ()=>{ openModal.tab="fx"; renderModal(); wsSend({type:"reqFxList", guid:t.guid}); });
    bRef.addEventListener("click", ()=>wsSend({type:"reqFxParams", guid:t.guid, fxIndex}));
    wrap.appendChild(title);

    const params = openModal.fxParams || [];
    if (!params.length){
      wrap.innerHTML += `<div class="small">No params or not loaded yet.</div>`;
      modalBody.appendChild(wrap);
      return;
    }
    const grid = document.createElement("div");
    grid.className = "paramGrid";
    params.forEach(p=>{
      const card = document.createElement("div");
      card.className = "paramCard";
      card.innerHTML = `
        <div class="paramName">${p.name}</div>
        <input type="range" min="0" max="1" step="0.001" value="${p.value}">
        <div class="small">#${p.index} val=${(Math.round(p.value*1000)/1000).toFixed(3)}</div>
      `;
      const sl = card.querySelector("input");
      sl.addEventListener("input", ()=> wsSend({type:"setFxParam", guid:t.guid, fxIndex, param:p.index, value: parseFloat(sl.value)}));
      grid.appendChild(card);
    });
    wrap.appendChild(grid);

    modalBody.appendChild(wrap);
  }

  const folderListOpen = new Map(); // guid -> boolean

  function buildTrackHierarchy(tracks){
    const root = {children: []};
    const stack = [root];
    for (const t of tracks){
      const node = {track: t, children: [], depth: Math.max(0, stack.length - 1)};
      stack[stack.length - 1].children.push(node);
      if (t.folderDepth > 0) stack.push(node);
      if (t.folderDepth < 0){
        let left = Math.abs(t.folderDepth);
        while (left > 0 && stack.length > 1){
          stack.pop();
          left -= 1;
        }
      }
    }
    return root.children;
  }

  function filterTrackHierarchy(nodes, query){
    if (!query) return nodes;
    const q = query.toLowerCase();
    const matchesNode = (n)=>{
      const name = String(n.track.name||"").toLowerCase();
      const idx = String(n.track.idx||"");
      return name.includes(q) || idx.includes(q);
    };
    const filterNode = (node)=>{
      const kids = [];
      node.children.forEach((child)=>{
        const filtered = filterNode(child);
        if (filtered) kids.push(filtered);
      });
      if (matchesNode(node) || kids.length){
        return {track: node.track, children: kids, depth: node.depth};
      }
      return null;
    };
    const out = [];
    nodes.forEach((node)=>{
      const filtered = filterNode(node);
      if (filtered) out.push(filtered);
    });
    return out;
  }

  function collectDescendants(node, out){
    node.children.forEach((child)=>{
      out.push(child.track.guid);
      collectDescendants(child, out);
    });
  }

  function renderTrackHierarchyList(list, tracks, opts){
    const scene = opts.scene;
    const sceneLocked = opts.sceneLocked;
    const onToggle = opts.onToggle || opts.onUpdate;
    const onRefresh = opts.onRefresh || opts.onUpdate;
    const query = opts.query || "";
    const tree = filterTrackHierarchy(buildTrackHierarchy(tracks), query);
    list.innerHTML = "";

    const renderNode = (node)=>{
      const t = node.track;
      const isFolder = t.folderDepth > 0;
      const shown = sceneLocked ? true : (scene.guids || []).includes(t.guid);
      const open = folderListOpen.has(t.guid) ? folderListOpen.get(t.guid) : true;
      const dot = hexOrEmpty(t.color)
        ? `<span style="display:inline-block; width:10px; height:10px; border-radius:999px; background:${hexOrEmpty(t.color)}; margin-right:6px;"></span>`
        : `<span style="display:inline-block; width:10px; height:10px; border-radius:999px; background:#444; margin-right:6px;"></span>`;

      const row = document.createElement("div");
      row.className = "fxItem trackTreeRow";
      row.style.paddingLeft = `${6 + node.depth * 14}px`;

      const nameWrap = document.createElement("div");
      nameWrap.className = "nm";
      if (isFolder){
        const toggle = document.createElement("button");
        toggle.className = "trackTreeToggle";
        toggle.textContent = open ? "▾" : "▸";
        toggle.addEventListener("click", (ev)=>{
          ev.stopPropagation();
          folderListOpen.set(t.guid, !open);
          onRefresh();
        });
        nameWrap.appendChild(toggle);
      } else {
        const spacer = document.createElement("span");
        spacer.className = "trackTreeSpacer";
        nameWrap.appendChild(spacer);
      }
      const name = document.createElement("div");
      name.innerHTML = `${dot}${t.idx} — ${escapeHtml(t.name||"")}`;
      nameWrap.appendChild(name);

      const fxWarn = (t.fxAllOff && (t.fxCount||0)>0)
        ? `<span class="pill" style="border-color:rgba(255,80,80,.6); background:rgba(120,30,30,.25);">FX OFF</span>`
        : ((t.fxCount||0)>0 ? `<span class="pill">FX ${t.fxCount||0}</span>` : ``);
      const ctl = document.createElement("div");
      ctl.className = "fxCtl";
      const isMaster = !!(scene && !(scene.all||false) && scene.name !== "main" && scene.masterGuid === t.guid);
      ctl.innerHTML = `${fxWarn}`
        + `<button class="miniBtn tmToggle ${sceneLocked?'disabled':''}">${shown?'Shown':'Hidden'}</button>`
        + `<button class="miniBtn tmMaster ${isMaster?'on':''} ${sceneLocked?'disabled':''}" title="Toggle scene master for this track">M</button>`;

      const btn = ctl.querySelector(".tmToggle");
      const mbtn = ctl.querySelector(".tmMaster");
      btn.addEventListener("click", (e)=>{
        e.stopPropagation();
        if (sceneLocked) return;
        const next = new Set(scene.guids || []);
        const desc = [];
        if (isFolder) collectDescendants(node, desc);
        if (next.has(t.guid)){
          next.delete(t.guid);
          desc.forEach(g=>next.delete(g));
        } else {
          next.add(t.guid);
          desc.forEach(g=>next.add(g));
        }
        scene.guids = Array.from(next);
        onToggle();
      });

      // Scene master toggle (per-track button)
      mbtn.addEventListener("click", (e)=>{
        e.stopPropagation();
        if (sceneLocked) return;
        if (!scene) return;
        if (scene.name === "main") return; // main scene master is always built-in MASTER
        const guid = t.guid;
        scene.masterGuid = (scene.masterGuid === guid) ? "" : guid;
        onToggle();
      });

      row.appendChild(nameWrap);
      row.appendChild(ctl);
      list.appendChild(row);

      const showChildren = query ? true : open;
      if (node.children.length && showChildren){
        node.children.forEach(renderNode);
      }
    };

    tree.forEach(renderNode);
  }

  function renderScenesModal(){
    modalTitle.textContent = "Scenes";
    tabsEl.innerHTML = "";
    modalBody.innerHTML = "";

    const wrap = document.createElement("div");
    const headerRow = document.createElement("div");
    headerRow.className = "row";
    const sceneOptions = sceneState.scenes.map(sc=>`<option value="${escapeHtml(sc.name)}">${escapeHtml(sc.name)}</option>`).join("");
    headerRow.innerHTML = `<label>Scene</label>
      <select style="flex:1;height:34px;border-radius:10px;border:1px solid rgba(0,0,0,.75);background:#22252a;color:#ddd;padding:0 10px;">
        ${sceneOptions}
      </select>
      <button class="miniBtn">Add</button>
      <button class="miniBtn">Delete</button>`;
    const sel = headerRow.querySelector("select");
    const [addBtn, delBtn] = headerRow.querySelectorAll("button");
    sel.value = sceneState.current;
    sel.addEventListener("change", ()=> setCurrentScene(sel.value));
    addBtn.addEventListener("click", ()=>{
      const name = prompt("New scene name", "");
      if (!name) return;
      const clean = String(name).trim();
      if (!clean) return;
      if (sceneState.scenes.find(sc=>sc.name.toLowerCase() === clean.toLowerCase())){
        alert("Scene already exists.");
        return;
      }
      sceneState.scenes.push({name: clean, all:false, guids: [], masterGuid: ""});
      setCurrentScene(clean);
    });
    delBtn.addEventListener("click", ()=>{
      const cur = getCurrentScene();
      if (cur.name === "main"){
        alert("Main scene cannot be deleted.");
        return;
      }
      if (!confirm(`Delete scene "${cur.name}"?`)) return;
      sceneState.scenes = sceneState.scenes.filter(sc=>sc.name !== cur.name);
      setCurrentScene("main");
    });
    wrap.appendChild(headerRow);

    const cur = getCurrentScene();
    const info = document.createElement("div");
    info.className = "small";
    info.style.margin = "6px 0 10px";
    info.textContent = cur.all || cur.name === "main"
      ? "Main scene shows all tracks."
      : "Select tracks visible in this scene.";
    wrap.appendChild(info);


    // Master track per scene (synced with ReaImGui via ProjExtState)
    {
      const tracks = (lastState && lastState.tracks) ? lastState.tracks : [];
      const sc = getCurrentScene();
      if (sc){
        const box = document.createElement("div");
        box.style.margin = "10px 0 12px";

        const label = document.createElement("label");
        label.style.display = "block";
        label.style.marginBottom = "8px";
        label.textContent = "Master";
        box.appendChild(label);

        if (sc.name === "main"){
          const info = document.createElement("div");
          info.className = "small";
          info.textContent = "Main scene master is always: MASTER";
          box.appendChild(info);
        } else {
          const sel = document.createElement("select");
          sel.style.flex = "1";
          sel.style.height = "34px";
          sel.style.borderRadius = "10px";
          sel.style.border = "1px solid rgba(255,255,255,.08)";
          sel.style.background = "#22252a";
          sel.style.color = "#ddd";
          sel.style.padding = "0 10px";

          const optNone = document.createElement("option");
          optNone.value = "";
          optNone.textContent = "(no master)";
          sel.appendChild(optNone);

          for (const t of tracks){
            if (!t || t.guid === "MASTER") continue;
            const opt = document.createElement("option");
            opt.value = t.guid;
            opt.textContent = `${t.idx} — ${t.name || t.guid}`;
            sel.appendChild(opt);
          }
          sel.value = (typeof sc.masterGuid === "string") ? sc.masterGuid : "";

          sel.addEventListener("change", ()=>{
            sc.masterGuid = sel.value || "";
            saveScenes();
            renderOrUpdate(true);
            if (openModal && openModal.kind === "scenes") renderModal();
          });

          box.appendChild(sel);

          const hint = document.createElement("div");
          hint.className = "small";
          hint.style.marginTop = "6px";
          hint.textContent = "If выбранный мастер — папка, её дочерние треки тоже будут отображаться.";
          box.appendChild(hint);
        }

        wrap.appendChild(box);
      }
    }



    if (!(cur.all || cur.name === "main")){
      const list = document.createElement("div");
      list.className = "fxList";
      const tracks = (lastState && lastState.tracks) ? lastState.tracks : [];
      const refreshList = ()=> renderTrackHierarchyList(list, tracks, {
        scene: cur,
        sceneLocked: false,
        onToggle: ()=>{
          saveScenes();
          renderOrUpdate(true);
          refreshList();
        },
        onRefresh: refreshList,
      });
      refreshList();
      wrap.appendChild(list);
    }

    modalBody.appendChild(wrap);
  }

  // ---------- Settings ----------
  const fsBtn = document.getElementById("fsBtn");
  const settingsBtn = document.getElementById("settingsBtn");
  const playerBtn = document.getElementById("playerBtn");
  const transportStop = document.getElementById("transportStop");
  const transportPlay = document.getElementById("transportPlay");
  const transportPause = document.getElementById("transportPause");
  const transportRec = document.getElementById("transportRec");
  const transportTime = document.getElementById("transportTime");
  const transportBars = document.getElementById("transportBars");
  const transportBpm = document.getElementById("transportBpm");
  transportRec?.classList.add("rec");

  function toggleFullscreen(){
    if (!document.fullscreenElement){
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  fsBtn.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", ()=>{
    fsBtn.textContent = document.fullscreenElement ? "⤢" : "⛶";
  });

  const SETTINGS_TABS = [
    {id:"main", label:"General"},
    {id:"ui", label:"Interface"},
    {id:"tracks", label:"Track Manager"}
  ];

  function renderTrackManagerSection(){
    const tm = document.createElement("div");
    tm.className = "row";
    tm.style.display = "block";
    tm.style.marginTop = "12px";
    tm.innerHTML = `<label style="display:block; margin-bottom:8px;">Track Manager</label>`;
    const tmWrap = document.createElement("div");
    tmWrap.style.display = "flex";
    tmWrap.style.gap = "8px";
    tmWrap.style.margin = "8px 0";
    tmWrap.innerHTML = `
      <input id="tmSearch" class="tmSearch" placeholder="Search tracks...">
      <button class="miniBtn" id="tmShowAll">Show all</button>
      <button class="miniBtn" id="tmHideAll">Hide all</button>
    `;
    tm.appendChild(tmWrap);

    const list = document.createElement("div");
    list.className = "fxList";
    list.style.gap = "8px";
    tm.appendChild(list);

    const tracks = (lastState && lastState.tracks) ? lastState.tracks : [];
    const scene = getCurrentScene();
    const sceneLocked = scene.all || scene.name === "main";

    const renderList = ()=>{
      const q = (tm.querySelector("#tmSearch").value||"").toLowerCase().trim();
      renderTrackHierarchyList(list, tracks, {
        scene,
        sceneLocked,
        query: q,
        onToggle: ()=>{
          saveScenes();
          renderOrUpdate(true);
          renderList();
        },
        onRefresh: renderList,
      });
    };

    tm.querySelector("#tmSearch").addEventListener("input", renderList);
    tm.querySelector("#tmShowAll").addEventListener("click", ()=>{
      if (sceneLocked) return;
      scene.guids = tracks.map(t=>t.guid);
      saveScenes();
      renderOrUpdate(true);
      renderList();
    });
    tm.querySelector("#tmHideAll").addEventListener("click", ()=>{
      if (sceneLocked) return;
      scene.guids = [];
      saveScenes();
      renderOrUpdate(true);
      renderList();
    });
    renderList();
    return tm;
  }

  function renderSettingsModal(){
    modalTitle.textContent = "Настройки";
    tabsEl.innerHTML = "";
    SETTINGS_TABS.forEach(tb=>{
      const b = document.createElement("div");
      b.className = "tab" + (openModal.tab===tb.id ? " on" : "");
      b.textContent = tb.label;
      b.addEventListener("click", ()=>{ openModal.tab = tb.id; renderModal(); });
      tabsEl.appendChild(b);
    });

    modalBody.innerHTML = "";
    const wrap = document.createElement("div");

    const mkToggle = (label, key, onChange) => {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<label>${label}</label><button class="miniBtn ${cfg[key]?'on':''}">${cfg[key]?'ON':'OFF'}</button>`;
      const b = row.querySelector("button");
      b.addEventListener("click", ()=>{
        cfg[key] = !cfg[key];
        saveCfg();
        b.classList.toggle("on", cfg[key]);
        b.textContent = cfg[key] ? "ON":"OFF";
        if (onChange) onChange();
      });
      return row;
    };

    if (openModal.tab === "main"){
      wrap.appendChild(mkToggle("Master enabled", "masterEnabled", ()=>renderOrUpdate(true)));
      wrap.appendChild(mkToggle("Pin master track", "masterPinned", ()=>renderOrUpdate(true)));

      const side = document.createElement("div");
      side.className = "row";
      side.innerHTML = `<label>Master side</label>
        <button class="miniBtn ${cfg.masterSide==='left'?'on':''}">Left</button>
        <button class="miniBtn ${cfg.masterSide==='right'?'on':''}">Right</button>`;
      const [bL,bR] = side.querySelectorAll("button");
      bL.addEventListener("click", ()=>{ cfg.masterSide="left"; saveCfg(); bL.classList.add("on"); bR.classList.remove("on"); renderOrUpdate(true); });
      bR.addEventListener("click", ()=>{ cfg.masterSide="right"; saveCfg(); bR.classList.add("on"); bL.classList.remove("on"); renderOrUpdate(true); });
      wrap.appendChild(side);

      const fs = document.createElement("div");
      fs.className = "row";
      fs.innerHTML = `<label>Fullscreen</label><button class="miniBtn">Toggle</button>`;
      fs.querySelector("button").addEventListener("click", toggleFullscreen);
      wrap.appendChild(fs);
    }

    if (openModal.tab === "ui"){
      const themeRow = document.createElement("div");
      themeRow.className = "row";
      themeRow.innerHTML = `<label>Theme</label>
        <button class="miniBtn ${cfg.theme==='dark'?'on':''}">Dark</button>
        <button class="miniBtn ${cfg.theme==='light'?'on':''}">Light</button>`;
      const [bDark,bLight] = themeRow.querySelectorAll("button");
      bDark.addEventListener("click", ()=>{ cfg.theme="dark"; saveCfg(); applyTheme(); bDark.classList.add("on"); bLight.classList.remove("on"); });
      bLight.addEventListener("click", ()=>{ cfg.theme="light"; saveCfg(); applyTheme(); bLight.classList.add("on"); bDark.classList.remove("on"); });
      wrap.appendChild(themeRow);

      wrap.appendChild(mkToggle("Large touch mode", "largeTouch", applyTouchMode));
      wrap.appendChild(mkToggle("Color footer bar", "showColorFooter", ()=>{ renderOrUpdate(true); wsSend({type:"setUi", ui:{showColorFooter: cfg.showColorFooter}}); }));
      const intRow = document.createElement("div");
      intRow.className = "row";
      const selVal = (cfg.footerIntensity==0.25||cfg.footerIntensity==0.35||cfg.footerIntensity==0.45) ? cfg.footerIntensity : 0.35;
      intRow.innerHTML = `<label>Footer intensity</label>
        <select class="sel" ${cfg.showColorFooter?'':'disabled'}>
          <option value="0.25" ${selVal===0.25?'selected':''}>Low (25%)</option>
          <option value="0.35" ${selVal===0.35?'selected':''}>Med (35%)</option>
          <option value="0.45" ${selVal===0.45?'selected':''}>High (45%)</option>
        </select>`;
      const sel = intRow.querySelector("select");
      sel.addEventListener("change", ()=>{
        const v = parseFloat(sel.value);
        cfg.footerIntensity = (v===0.25||v===0.35||v===0.45) ? v : 0.35;
        saveCfg();
        renderOrUpdate(true);
        wsSend({type:"setUi", ui:{showColorFooter: cfg.showColorFooter, footerIntensity: cfg.footerIntensity}});
      });
      wrap.appendChild(intRow);

      wrap.appendChild(mkToggle("Show FX slot bar", "showFxBar", ()=>renderOrUpdate(true)));
      wrap.appendChild(mkToggle("Show Sends slot bar", "showSendsBar", ()=>renderOrUpdate(true)));
      wrap.appendChild(mkToggle("Show PAN fader", "showPanFader", ()=>renderOrUpdate(true)));
      wrap.appendChild(mkToggle("Show FX slots list", "showFxSlots", ()=>renderOrUpdate(true)));
      wrap.appendChild(mkToggle("Show track/folder frames", "showTrackFrames", applyTrackFrames));

      if (cfg.fxSlotsShown === undefined) cfg.fxSlotsShown = 4;
      const slotsRow = document.createElement("div");
      slotsRow.className = "row";
      const shown = Math.max(4, Math.min(10, parseInt(cfg.fxSlotsShown||4,10)||4));
      cfg.fxSlotsShown = shown;
      slotsRow.innerHTML = `<label>FX slots visible</label>
        <div style="display:flex;align-items:center;gap:10px;min-width:180px;">
          <input class="rng" type="range" min="4" max="10" value="${shown}">
          <div class="small" id="fxSlotsShownVal">${shown}</div>
        </div>`;
      const rng = slotsRow.querySelector("input");
      const val = slotsRow.querySelector("#fxSlotsShownVal");
      rng.addEventListener("input", ()=>{ val.textContent = rng.value; });
      rng.addEventListener("change", ()=>{
        cfg.fxSlotsShown = Math.max(4, Math.min(10, parseInt(rng.value,10)||4));
        saveCfg();
        renderOrUpdate(true);
      });
      wrap.appendChild(slotsRow);

      // FX slots scroll hold (optional)
      const holdRow = document.createElement('div');
      holdRow.className = 'row';
      holdRow.innerHTML = `<label>Hold FX slots scroll</label><button class=\"miniBtn ${cfg.fxSlotsScrollHoldEnabled?'on':''}\">${cfg.fxSlotsScrollHoldEnabled?'ON':'OFF'}</button>`;
      const holdBtn = holdRow.querySelector('button');
      holdBtn.addEventListener('click', ()=>{
        cfg.fxSlotsScrollHoldEnabled = !cfg.fxSlotsScrollHoldEnabled;
        saveCfg();
        holdBtn.classList.toggle('on', cfg.fxSlotsScrollHoldEnabled);
        holdBtn.textContent = cfg.fxSlotsScrollHoldEnabled ? 'ON' : 'OFF';
        renderOrUpdate(true);
      });
      wrap.appendChild(holdRow);

      const holdSecRow = document.createElement('div');
      holdSecRow.className = 'row';
      const curSec = Math.max(1, Math.min(120, parseInt(cfg.fxSlotsScrollHoldSec||40,10)||40));
      cfg.fxSlotsScrollHoldSec = curSec;
      holdSecRow.innerHTML = `<label>FX slots hold time</label>
        <div style=\"display:flex;align-items:center;gap:10px;min-width:180px;\">
          <input class=\"rng\" type=\"range\" min=\"1\" max=\"120\" value=\"${curSec}\" ${cfg.fxSlotsScrollHoldEnabled?'':'disabled'}>
          <div class=\"small\" id=\"fxHoldVal\">${curSec}s</div>
        </div>`;
      const hrng = holdSecRow.querySelector('input');
      const hval = holdSecRow.querySelector('#fxHoldVal');
      hrng.addEventListener('input', ()=>{ hval.textContent = hrng.value + 's'; });
      hrng.addEventListener('change', ()=>{
        cfg.fxSlotsScrollHoldSec = Math.max(1, Math.min(120, parseInt(hrng.value,10)||40));
        saveCfg();
        renderOrUpdate(true);
      });
      // keep enabled state in sync
      const syncHoldEnable = ()=>{ try{ hrng.disabled = !cfg.fxSlotsScrollHoldEnabled; }catch(_){} };
      syncHoldEnable();
      holdBtn.addEventListener('click', syncHoldEnable);
      wrap.appendChild(holdSecRow);

      const dragRow = document.createElement('div');
      dragRow.className = 'row';
      dragRow.innerHTML = `<label>Track reorder (desktop)</label><button class=\"miniBtn ${cfg.trackReorderMouseEnabled?'on':''}\">${cfg.trackReorderMouseEnabled?'ON':'OFF'}</button>`;
      const dragBtn = dragRow.querySelector('button');
      dragBtn.addEventListener('click', ()=>{
        cfg.trackReorderMouseEnabled = !cfg.trackReorderMouseEnabled;
        saveCfg();
        dragBtn.classList.toggle('on', cfg.trackReorderMouseEnabled);
        dragBtn.textContent = cfg.trackReorderMouseEnabled ? 'ON' : 'OFF';
        renderOrUpdate(true);
      });
      wrap.appendChild(dragRow);

      const dragTouchRow = document.createElement('div');
      dragTouchRow.className = 'row';
      dragTouchRow.innerHTML = `<label>Track reorder (touch hold)</label><button class=\"miniBtn ${cfg.trackReorderTouchEnabled?'on':''}\">${cfg.trackReorderTouchEnabled?'ON':'OFF'}</button>`;
      const dragTouchBtn = dragTouchRow.querySelector('button');
      const setTouchBtn = ()=>{ dragTouchBtn.classList.toggle('on', cfg.trackReorderTouchEnabled); dragTouchBtn.textContent = cfg.trackReorderTouchEnabled ? 'ON' : 'OFF'; }
      setTouchBtn();
      dragTouchBtn.addEventListener('click', ()=>{
        cfg.trackReorderTouchEnabled = !cfg.trackReorderTouchEnabled;
        saveCfg();
        setTouchBtn();
        renderOrUpdate(true);
      });
      wrap.appendChild(dragTouchRow);
    }

    if (openModal.tab === "tracks"){
      wrap.appendChild(renderTrackManagerSection());
    }

    modalBody.appendChild(wrap);
  }

  function openSettingsTab(tab="main"){
    overlay.style.display = "block";
    modal.style.display = "block";
    openModal = {kind:"settings", tab};
    renderModal();
  }

  function openSettings(){
    openSettingsTab("main");
  }

  function openTransportModal(){
    overlay.style.display = "block";
    modal.style.display = "block";
    openModal = {kind:"transport", transportRefs: null};
    renderModal();
  }


  function openBpmModal(){
    const current = (lastState && lastState.transport && Number.isFinite(lastState.transport.bpm)) ? Math.round(lastState.transport.bpm) : 120;
    if (isPhoneLike()){
      const input = prompt("Set BPM", String(current));
      if (input === null) return;
      const parsed = Math.round(parseFloat(input));
      if (!Number.isFinite(parsed)) return;
      const bpm = Math.max(20, Math.min(300, parsed));
      wsSend({type:"setBpm", bpm});
      return;
    }
    overlay.style.display = "block";
    modal.style.display = "block";
    openModal = {kind:"bpm", draftBpm: current};
    renderModal();
  }

  settingsBtn.addEventListener("click", openSettings);
  playerBtn?.addEventListener("click", openTransportModal);
  transportStop?.addEventListener("click", ()=>wsSend({type:"transport", action:"stop"}));
  transportPlay?.addEventListener("click", ()=>wsSend({type:"transport", action:"play"}));
  transportPause?.addEventListener("click", ()=>wsSend({type:"transport", action:"pause"}));
  transportRec?.addEventListener("click", ()=>wsSend({type:"transport", action:"record"}));
  transportBpm?.addEventListener("click", openBpmModal);

  // ---------- Init ----------
  connectWS();
  requestAnimationFrame(rafLoop);
})();