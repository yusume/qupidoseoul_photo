// ===============================
// PHOTO FRAME - SVG IMAGE EDITOR
// ===============================

const FRAME_DIR = "./frames"; //
const FRAME_MANIFEST_URL = `${FRAME_DIR}/manifest.json`; //
const DEFAULT_FRAME = "layout1.svg"; //

const canvas = new fabric.Canvas("c", { //
  selection: false, //
  enableRetinaScaling: true, //
});

const fileInput = document.getElementById("fileInput"); //
const svgOverlay = document.getElementById("svgOverlay"); //
const canvasWrap = document.getElementById("canvasWrap"); //
const layoutSelect = document.getElementById("layoutSelect"); //
const exportBtn = document.getElementById("exportBtn"); //
const logoColorInput = document.getElementById("logoColor"); //

// layout4_id 전용 DOM 요소
const idLayoutCtrls = document.getElementById("idLayoutCtrls");
const flipLeftBtn = document.getElementById("flipLeftBtn");
const flipVLeftBtn = document.getElementById("flipVLeftBtn");
const flipRightBtn = document.getElementById("flipRightBtn");
const flipVRightBtn = document.getElementById("flipVRightBtn");

const EXPORT_DPI = 300; //
const EXPORT_MM_W = 100; //
const EXPORT_MM_H = 150; //
const MM_PER_INCH = 25.4; //
const PREVIEW_SCALE = 2; //

const slots = []; //
let activeSlotIndex = null; //
let dragState = null; //
let currentLayoutName = "";

// 안쪽 여백 설정 (3px)
const INNER_MARGIN = 3;

// 슬롯별 필터 상태: { filter: 'none'|'grayscale'|'sepia'|'vintage'|'sharpen', brightness: 0, contrast: 0 }
const slotFilters = {};
let activeFilterSlotId = null;

function getSlotFilter(slotId) {
  return slotFilters[slotId] || { filter: "none", brightness: 0, contrast: 0 };
}

// SVG filter 정의 등록
const SVG_FILTER_DEFS = {
  grayscale: `
    <feColorMatrix type="saturate" values="0"/>`,
  sepia: `
    <feColorMatrix type="matrix" values="
      0.393 0.769 0.189 0 0
      0.349 0.686 0.168 0 0
      0.272 0.534 0.131 0 0
      0     0     0     1 0"/>`,
  vintage: `
    <feColorMatrix type="matrix" values="
      0.9  0.1  0.1  0  0.04
      0.05 0.85 0.05 0  0.02
      0.05 0.05 0.75 0  0
      0    0    0    1  0"/>
    <feComponentTransfer>
      <feFuncR type="gamma" amplitude="1" exponent="1.1" offset="0.03"/>
      <feFuncG type="gamma" amplitude="1" exponent="1.05" offset="0"/>
      <feFuncB type="gamma" amplitude="0.9" exponent="1.2" offset="0"/>
    </feComponentTransfer>`,
  sharpen: `
    <feConvolveMatrix order="3" kernelMatrix="
       0 -1  0
      -1  5 -1
       0 -1  0" preserveAlpha="true"/>`,
};

function buildFilterId(slotId, filterState) {
  const { filter, brightness, contrast } = filterState;
  const hasBc = brightness !== 0 || contrast !== 0;
  if (filter === "none" && !hasBc) return null;
  return `svgf-${slotId}-${filter}-b${brightness}-c${contrast}`.replace(/[^a-zA-Z0-9-]/g, "_");
}

function ensureSlotFilter(overlaySvg, slotId) {
  const state = getSlotFilter(slotId);
  const defs = ensureDefs(overlaySvg);

  // 이 슬롯의 기존 필터 제거
  defs.querySelectorAll(`[id^="svgf-${slotId}-"]`).forEach((el) => el.remove());

  const filterId = buildFilterId(slotId, state);
  if (!filterId) return null;

  const { filter, brightness, contrast } = state;
  const hasBc = brightness !== 0 || contrast !== 0;

  let primitives = "";
  if (filter !== "none" && SVG_FILTER_DEFS[filter]) {
    primitives += SVG_FILTER_DEFS[filter];
  }
  if (hasBc) {
    // brightness: -100~100 → slope 0.2~2.0
    const bSlope = brightness >= 0
      ? 1 + (brightness / 100) * 1.0
      : 1 + (brightness / 100) * 0.8;
    const bOffset = 0;
    // contrast: -100~100 → slope 0.1~3.0
    const cSlope = contrast >= 0
      ? 1 + (contrast / 100) * 2.0
      : 1 + (contrast / 100) * 0.9;
    const cOffset = contrast >= 0 ? 0 : (contrast / 100) * 0.1;
    primitives += `
    <feComponentTransfer result="bc">
      <feFuncR type="linear" slope="${bSlope * cSlope}" intercept="${bOffset + cOffset}"/>
      <feFuncG type="linear" slope="${bSlope * cSlope}" intercept="${bOffset + cOffset}"/>
      <feFuncB type="linear" slope="${bSlope * cSlope}" intercept="${bOffset + cOffset}"/>
    </feComponentTransfer>`;
  }

  const filterEl = document.createElementNS("http://www.w3.org/2000/svg", "filter");
  filterEl.setAttribute("id", filterId);
  filterEl.setAttribute("color-interpolation-filters", "sRGB");
  filterEl.setAttribute("x", "0%");
  filterEl.setAttribute("y", "0%");
  filterEl.setAttribute("width", "100%");
  filterEl.setAttribute("height", "100%");
  filterEl.innerHTML = primitives;
  defs.appendChild(filterEl);
  return filterId;
}

function applySlotFilter(overlaySvg, slotId) {
  const filterId = ensureSlotFilter(overlaySvg, slotId);
  const wrapperGroup = overlaySvg.querySelector(`g[data-wrapper="${slotId}"]`);
  if (!wrapperGroup) return;
  if (filterId) {
    wrapperGroup.setAttribute("filter", `url(#${filterId})`);
  } else {
    wrapperGroup.removeAttribute("filter");
  }
}

// layout4_id 상태 관리
const idLayoutState = {
  "35x45": { dataUrl: null, flipX: false, flipY: false },
  "30x40": { dataUrl: null, flipX: false, flipY: false }
};

function parseViewBox(svgEl) { //
  const viewBox = svgEl.getAttribute("viewBox"); //
  if (!viewBox) { //
    const w = parseFloat(svgEl.getAttribute("width")) || 0; //
    const h = parseFloat(svgEl.getAttribute("height")) || 0; //
    return { minX: 0, minY: 0, w, h }; //
  }

  const parts = viewBox.trim().split(/[\s,]+/).map(Number); //
  if (parts.length !== 4 || parts.some(Number.isNaN)) { //
    return { minX: 0, minY: 0, w: 0, h: 0 }; //
  }

  const [minX, minY, w, h] = parts; //
  return { minX, minY, w, h }; //
}

function isInsideDefsOrClip(el) { //
  let node = el.parentElement; //
  while (node) { //
    const tag = node.tagName ? node.tagName.toLowerCase() : ""; //
    if (tag === "defs" || tag === "clippath") return true; //
    node = node.parentElement; //
  }
  return false; //
}

function getHref(el) { //
  return ( //
    el.getAttribute("href") || //
    el.getAttribute("xlink:href") || //
    el.getAttributeNS("http://www.w3.org/1999/xlink", "href") || //
    "" //
  ); //
}

function resolveUseRect(useEl, svgRoot) { //
  const href = getHref(useEl); //
  if (!href || !href.startsWith("#")) return null; //
  const target = svgRoot.querySelector(href); //
  if (!target || target.tagName.toLowerCase() !== "rect") return null; //
  return {
    x: parseFloat(target.getAttribute("x")) || 0, //
    y: parseFloat(target.getAttribute("y")) || 0, //
    w: parseFloat(target.getAttribute("width")) || 0, //
    h: parseFloat(target.getAttribute("height")) || 0, //
  };
}

function setCanvasSize(w, h) { //
  const cssW = Math.round(w * PREVIEW_SCALE); //
  const cssH = Math.round(h * PREVIEW_SCALE); //

  canvas.setWidth(w); //
  canvas.setHeight(h); //
  canvas.setDimensions({ width: cssW, height: cssH }, { cssOnly: true }); //

  if (canvas.lowerCanvasEl) canvas.lowerCanvasEl.style.width = `${cssW}px`; //
  if (canvas.upperCanvasEl) canvas.upperCanvasEl.style.width = `${cssW}px`; //
  if (canvas.wrapperEl) canvas.wrapperEl.style.width = `${cssW}px`; //
  if (canvasWrap) { //
    canvasWrap.style.width = `${cssW}px`; //
    canvasWrap.style.height = `${cssH}px`; //
    canvasWrap.style.aspectRatio = `${w} / ${h}`; //
  }
}

function getSvgPoint(svgEl, clientX, clientY) { //
  const pt = svgEl.createSVGPoint(); //
  pt.x = clientX; //
  pt.y = clientY; //
  const ctm = svgEl.getScreenCTM(); //
  if (!ctm) return { x: 0, y: 0 }; //
  const inv = ctm.inverse(); //
  const sp = pt.matrixTransform(inv); //
  return { x: sp.x, y: sp.y }; //
}

function extractSlots(svgRoot, viewBox) { //
  let elements = [];
  // layout3처럼 image_box 그룹 안에 full-canvas rect만 있는 경우 단일 슬롯으로 처리할지 여부
  let allowFullCanvas = false;

  if (currentLayoutName.includes("layout4_id")) {
    elements = Array.from(svgRoot.querySelectorAll("rect, use")).filter(
      (el) => !isInsideDefsOrClip(el)
    );
  } else {
    const groups = svgRoot.querySelectorAll("g.image_box, g#image_box"); //
    groups.forEach((group) => { //
      const rawElements = Array.from(group.querySelectorAll("rect, use")).filter( //
        (el) => !isInsideDefsOrClip(el) //
      ); //
      const idFiltered = rawElements.filter((el) => //
        /^image_box_/i.test(el.getAttribute("id") || "") //
      ); //
      const selected = idFiltered.length ? idFiltered : rawElements;
      elements.push(...selected);
      // 후보가 1개뿐이고 id 필터도 없으면 full-canvas 슬롯일 가능성 있음
      if (selected.length === 1 && !idFiltered.length) allowFullCanvas = true;
    });
  }

  // layout2처럼 use가 같은 rect를 중복 참조하는 경우 rect만 남기고 use는 제거
  // (image_box_* id가 없는 레이아웃에서 rect+use 중복 제거)
  const hasIdRects = elements.some((el) => /^image_box_/i.test(el.getAttribute("id") || ""));
  if (!hasIdRects) {
    const rects = elements.filter((el) => el.tagName.toLowerCase() === "rect");
    const uses = elements.filter((el) => el.tagName.toLowerCase() === "use");
    // rect와 use가 같은 위치를 중복으로 가리키고 있으면 rect만 유지
    if (rects.length > 0 && uses.length > 0) {
      elements = rects;
    }
  }

  const rawOut = [];

  elements.forEach((el) => {
    const tag = el.tagName.toLowerCase();
    let rect = null;

    if (tag === "rect") {
      rect = {
        x: parseFloat(el.getAttribute("x")) || 0,
        y: parseFloat(el.getAttribute("y")) || 0,
        w: parseFloat(el.getAttribute("width")) || 0,
        h: parseFloat(el.getAttribute("height")) || 0,
      };
    } else if (tag === "use") {
      rect = resolveUseRect(el, svgRoot);
    }

    if (!rect || rect.w < 15 || rect.h < 15) return;

    const slotArea = rect.w * rect.h;
    const viewArea = viewBox.w * viewBox.h;
    // full-canvas 단일 슬롯(layout3 등)은 50% 필터 예외 처리
    if (slotArea > viewArea * 0.5 && !allowFullCanvas) return;

    rawOut.push({
      x: rect.x - viewBox.minX,
      y: rect.y - viewBox.minY,
      w: rect.w,
      h: rect.h,
    });
  });

  // 기하학 좌표계 기반 정렬 수행
  rawOut.sort((a, b) => {
    if (Math.abs(a.x - b.x) < 8) return a.y - b.y;
    return a.x - b.x;
  });

  return rawOut.map((slot, index) => ({
    ...slot,
    id: `slot${index + 1}`
  }));
}

function assignSlotMarkers(overlayRoot, slotsList) { //
  let elements = [];
  const viewBox = parseViewBox(overlayRoot);

  if (currentLayoutName.includes("layout4_id")) {
    elements = Array.from(overlayRoot.querySelectorAll("rect, use")).filter((el) => {
      if (isInsideDefsOrClip(el)) return false;
      const r = getSlotRectFromElement(el, overlayRoot);
      if (!r || r.w < 15 || r.h < 15) return false;
      if ((r.w * r.h) > (viewBox.w * viewBox.h * 0.5)) return false; // 거대 배경 패스 제거 동기화
      return true;
    });
    
    elements.sort((a, b) => {
      const rA = getSlotRectFromElement(a, overlayRoot);
      const rB = getSlotRectFromElement(b, overlayRoot);
      if (!rA || !rB) return 0;
      if (Math.abs(rA.x - rB.x) < 8) return rA.y - rB.y;
      return rA.x - rB.x;
    });
  } else {
    let allowFullCanvas = false;
    const groups = overlayRoot.querySelectorAll("g.image_box, g#image_box"); //
    groups.forEach((group) => { //
      const rawElements = Array.from(group.querySelectorAll("rect, use")).filter( //
        (el) => !isInsideDefsOrClip(el) //
      ); //
      const idFiltered = rawElements.filter((el) => //
        /^image_box_/i.test(el.getAttribute("id") || "") //
      ); //
      const selected = idFiltered.length ? idFiltered : rawElements;
      elements.push(...selected);
      if (selected.length === 1 && !idFiltered.length) allowFullCanvas = true;
    });

    // layout2처럼 rect+use 중복 참조 제거
    const hasIdRects = elements.some((el) => /^image_box_/i.test(el.getAttribute("id") || ""));
    if (!hasIdRects) {
      const rects = elements.filter((el) => el.tagName.toLowerCase() === "rect");
      const uses = elements.filter((el) => el.tagName.toLowerCase() === "use");
      if (rects.length > 0 && uses.length > 0) elements = rects;
    }

    // full-canvas가 아닌 경우 거대 배경 rect 제거
    if (!allowFullCanvas) {
      elements = elements.filter((el) => {
        const r = getSlotRectFromElement(el, overlayRoot);
        if (!r) return false;
        return (r.w * r.h) <= (viewBox.w * viewBox.h * 0.5);
      });
    }

    // extractSlots와 동일한 정렬 적용 → slot 번호가 같은 DOM 요소에 붙도록
    elements.sort((a, b) => {
      const rA = getSlotRectFromElement(a, overlayRoot);
      const rB = getSlotRectFromElement(b, overlayRoot);
      if (!rA || !rB) return 0;
      if (Math.abs(rA.x - rB.x) < 8) return rA.y - rB.y;
      return rA.x - rB.x;
    });
  }

  slotsList.forEach((slot, index) => { //
    const el = elements[index]; //
    if (el) el.setAttribute("data-slot", slot.id); //
  }); //
}

function getSlotRectFromElement(el, overlayRoot) { //
  const tag = el.tagName.toLowerCase(); //
  if (tag === "rect") { //
    return {
      x: parseFloat(el.getAttribute("x")) || 0, //
      y: parseFloat(el.getAttribute("y")) || 0, //
      w: parseFloat(el.getAttribute("width")) || 0, //
      h: parseFloat(el.getAttribute("height")) || 0, //
    };
  }
  if (tag === "use") { //
    return resolveUseRect(el, overlayRoot); //
  }
  return null; //
}

function ensureDefs(svgRoot) { //
  let defs = svgRoot.querySelector("defs"); //
  if (!defs) { //
    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs"); //
    svgRoot.insertBefore(defs, svgRoot.firstChild); //
  }
  return defs; //
}

function rotateImage90Deg(srcDataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = img.height;
      tempCanvas.height = img.width;
      const ctx = tempCanvas.getContext("2d");
      ctx.translate(tempCanvas.width / 2, tempCanvas.height / 2);
      ctx.rotate((90 * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      resolve(tempCanvas.toDataURL("image/png"));
    };
    img.src = srcDataUrl;
  });
}

function bringLogoToFront(svgRoot) { //
  const logo = svgRoot.querySelector("#logo"); //
  if (!logo) return; //
  logo.parentNode.appendChild(logo); //
}

function updateLogoColor(color, svgRoot) { //
  const root = svgRoot || svgOverlay.querySelector("svg"); //
  if (!root) return; //
  const logo = root.querySelector("#logo"); //
  if (!logo) return; //

  logo.setAttribute("fill", color); //
  const nodes = logo.querySelectorAll("*"); //
  nodes.forEach((node) => { //
    if (node.hasAttribute("fill") && node.getAttribute("fill") !== "none") { //
      node.setAttribute("fill", color); //
    }
  });
}

// [수정] 3px 마진이 정밀 적용된 위치 리미트 연산기
function clampImageToSlot(slot, rect) {
  const innerW = slot.w - (INNER_MARGIN * 2);
  const innerH = slot.h - (INNER_MARGIN * 2);
  const minX = (slot.x + INNER_MARGIN) + innerW - rect.w;
  const minY = (slot.y + INNER_MARGIN) + innerH - rect.h;
  const maxX = (slot.x + INNER_MARGIN);
  const maxY = (slot.y + INNER_MARGIN);
  return {
    x: Math.min(maxX, Math.max(minX, rect.x)),
    y: Math.min(maxY, Math.max(minY, rect.y)),
  };
}

// 최대 X축 클러스터링 알고리즘 기반 그룹 분류기
function getIdLayoutGroup(slot, viewBox) {
  if (!slots.length) return "35x45";
  const xPositions = slots.map(s => s.x);
  const maxX = Math.max(...xPositions);
  
  // 기하학적 정렬 상태에서 우측의 독립 열(마지막 세로 기둥)만 정밀하게 30x40 매핑 유도
  if (Math.abs(slot.x - maxX) < 15) {
    return "30x40";
  }
  return "35x45";
}

function applyImageTransform(imgEl, groupKey, slot) {
  const state = idLayoutState[groupKey];
  if (!state) return;

  const wrapperGroup = imgEl.parentElement;
  if (!wrapperGroup || wrapperGroup.tagName.toLowerCase() !== "g") return;

  const cx = slot.x + slot.w / 2;
  const cy = slot.y + slot.h / 2;

  let transformString = "";
  if (state.flipX) transformString += `translate(${cx}, ${cy}) scale(-1, 1) translate(${-cx}, ${-cy}) `;
  if (state.flipY) transformString += `translate(${cx}, ${cy}) scale(1, -1) translate(${-cx}, ${-cy}) `;

  if (transformString.trim()) {
    wrapperGroup.setAttribute("transform", transformString.trim());
  } else {
    wrapperGroup.removeAttribute("transform");
  }
}

function bindSvgEvents(overlaySvg) { //
  overlaySvg.style.touchAction = "none"; //

  overlaySvg.addEventListener("dblclick", (e) => { //
    const p = getSvgPoint(overlaySvg, e.clientX, e.clientY); //
    const idx = slots.findIndex( //
      (s) => //
        p.x >= s.x && //
        p.x <= s.x + s.w && //
        p.y >= s.y && //
        p.y <= s.y + s.h //
    ); //
    if (idx === -1) return; //
    activeSlotIndex = idx; //
    fileInput.value = ""; //
    fileInput.click(); //
  });

  overlaySvg.addEventListener("pointerdown", (e) => { //
    const target = e.target; //
    if (!target || target.tagName.toLowerCase() !== "image") return; //
    const slotId = target.getAttribute("data-slot"); //
    if (!slotId) return; //
    const slot = slots.find((s) => s.id === slotId); //
    if (!slot) return; //

    // 이미지 클릭 → 필터 패널 열기
    showFilterPanel(slotId);

    const rect = {
      x: parseFloat(target.getAttribute("x")) || 0, //
      y: parseFloat(target.getAttribute("y")) || 0, //
      w: parseFloat(target.getAttribute("width")) || 0, //
      h: parseFloat(target.getAttribute("height")) || 0, //
    };
    const start = getSvgPoint(overlaySvg, e.clientX, e.clientY); //
    dragState = { target, slot, start, rect, pointerId: e.pointerId }; //
    target.setPointerCapture(e.pointerId); //
  });

  overlaySvg.addEventListener("pointermove", (e) => { //
    if (!dragState || dragState.pointerId !== e.pointerId) return; //
    const { target, slot, start, rect } = dragState; //
    const p = getSvgPoint(overlaySvg, e.clientX, e.clientY); //
    
    const deltaX = p.x - start.x; //
    const deltaY = p.y - start.y; //
    
    if (currentLayoutName.includes("layout4_id")) {
      const viewBox = parseViewBox(overlaySvg);
      const targetGroup = getIdLayoutGroup(slot, viewBox);
      const state = idLayoutState[targetGroup];

      let correctedDx = deltaX;
      let correctedDy = deltaY;
      
      if (state.flipX) correctedDx = -correctedDx;
      if (state.flipY) correctedDy = -correctedDy;

      const nextRect = {
        x: rect.x + correctedDx,
        y: rect.y + correctedDy,
        w: rect.w,
        h: rect.h,
      };
      const clamped = clampImageToSlot(slot, nextRect);
      
      slots.forEach((s) => {
        if (getIdLayoutGroup(s, viewBox) === targetGroup) {
          const imgEl = overlaySvg.querySelector(`image[data-slot="${s.id}"]`);
          if (imgEl) {
            const offsetX = clamped.x - (slot.x + INNER_MARGIN);
            const offsetY = clamped.y - (slot.y + INNER_MARGIN);
            
            imgEl.setAttribute("x", (s.x + INNER_MARGIN) + offsetX);
            imgEl.setAttribute("y", (s.y + INNER_MARGIN) + offsetY);
          }
        }
      });
    } else {
      const nextRect = {
        x: rect.x + deltaX, //
        y: rect.y + deltaY, //
        w: rect.w, //
        h: rect.h, //
      };
      const clamped = clampImageToSlot(slot, nextRect); //
      target.setAttribute("x", clamped.x); //
      target.setAttribute("y", clamped.y); //
    }
  });

  overlaySvg.addEventListener("pointerup", () => { //
    dragState = null; //
  });

  overlaySvg.addEventListener("wheel", (e) => { //
    const target = e.target; //
    if (!target || target.tagName.toLowerCase() !== "image") return; //
    const slotId = target.getAttribute("data-slot"); //
    if (!slotId) return; //
    const slot = slots.find((s) => s.id === slotId); //
    if (!slot) return; //

    e.preventDefault(); //
    const rect = {
      x: parseFloat(target.getAttribute("x")) || 0, //
      y: parseFloat(target.getAttribute("y")) || 0, //
      w: parseFloat(target.getAttribute("width")) || 0, //
      h: parseFloat(target.getAttribute("height")) || 0, //
    };
    const naturalW = parseFloat(target.getAttribute("data-natural-w")) || rect.w; //
    const naturalH = parseFloat(target.getAttribute("data-natural-h")) || rect.h; //
    const scaleFactor = e.deltaY < 0 ? 1.05 : 0.95; //

    let nextW = rect.w * scaleFactor; //
    let nextH = rect.h * scaleFactor; //
    
    const innerW = slot.w - (INNER_MARGIN * 2);
    const innerH = slot.h - (INNER_MARGIN * 2);
    const minScale = Math.max(innerW / naturalW, innerH / naturalH); //
    const minW = naturalW * minScale; //
    const minH = naturalH * minScale; //

    if (nextW < minW || nextH < minH) { //
      nextW = minW; //
      nextH = minH; //
    }

    const cx = rect.x + rect.w / 2; //
    const cy = rect.y + rect.h / 2; //
    const nextRect = {
      x: cx - nextW / 2, //
      y: cy - nextH / 2, //
      w: nextW, //
      h: nextH, //
    };
    const clamped = clampImageToSlot(slot, nextRect);

    if (currentLayoutName.includes("layout4_id")) {
      const viewBox = parseViewBox(overlaySvg);
      const targetGroup = getIdLayoutGroup(slot, viewBox);
      
      slots.forEach((s) => {
        if (getIdLayoutGroup(s, viewBox) === targetGroup) {
          const imgEl = overlaySvg.querySelector(`image[data-slot="${s.id}"]`);
          if (imgEl) {
            const offsetX = clamped.x - (slot.x + INNER_MARGIN);
            const offsetY = clamped.y - (slot.y + INNER_MARGIN);
            
            imgEl.setAttribute("x", (s.x + INNER_MARGIN) + offsetX);
            imgEl.setAttribute("y", (s.y + INNER_MARGIN) + offsetY);
            imgEl.setAttribute("width", nextW);
            imgEl.setAttribute("height", nextH);
          }
        }
      });
    } else {
      target.setAttribute("x", clamped.x); //
      target.setAttribute("y", clamped.y); //
      target.setAttribute("width", nextW); //
      target.setAttribute("height", nextH); //
    }
  });
}

function renderImageToSlot(overlaySvg, s, dataUrl, groupKey) { //
  const slotEl = overlaySvg.querySelector(`[data-slot="${s.id}"]`); //
  if (!slotEl) return; //

  const rect = getSlotRectFromElement(slotEl, overlaySvg); //
  if (!rect) return; //

  const img = new Image(); //
  img.onload = () => { //
    const isIdLayout = currentLayoutName.includes("layout4_id");
    const margin = isIdLayout ? INNER_MARGIN : 0; // 3px 안쪽 마진 여백 구현
    
    const targetX = rect.x + margin;
    const targetY = rect.y + margin;
    const targetW = rect.w - (margin * 2);
    const targetH = rect.h - (margin * 2);

    const naturalW = img.naturalWidth || targetW; //
    const naturalH = img.naturalHeight || targetH; //
    const scale = Math.max(targetW / naturalW, targetH / naturalH); //
    const w = naturalW * scale; //
    const h = naturalH * scale; //
    const x = targetX + (targetW - w) / 2; //
    const y = targetY + (targetH - h) / 2; //

    const defs = ensureDefs(overlaySvg); //
    const clipId = `clip-${s.id}`; //
    let clipPath = overlaySvg.querySelector(`#${clipId}`); //
    if (!clipPath) { //
      clipPath = document.createElementNS("http://www.w3.org/2000/svg", "clipPath"); //
      clipPath.setAttribute("id", clipId); //
      defs.appendChild(clipPath); //
    } else { //
      clipPath.innerHTML = ""; //
    } //

    const clipRect = document.createElementNS("http://www.w3.org/2000/svg", "rect"); //
    clipRect.setAttribute("x", targetX); //
    clipRect.setAttribute("y", targetY); //
    clipRect.setAttribute("width", targetW); //
    clipRect.setAttribute("height", targetH); //
    clipPath.appendChild(clipRect); //

    const existing = overlaySvg.querySelector(`image[data-slot="${s.id}"]`); //
    if (existing) { //
      const parentNode = existing.parentElement;
      if (parentNode && parentNode.tagName.toLowerCase() === "g" && parentNode.getAttribute("data-wrapper") === s.id) {
        parentNode.remove();
      } else {
        existing.remove(); //
      }
    }

    const wrapperGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    wrapperGroup.setAttribute("data-wrapper", s.id);
    wrapperGroup.setAttribute("clip-path", `url(#${clipId})`);

    const imgEl = document.createElementNS("http://www.w3.org/2000/svg", "image"); //
    imgEl.setAttribute("data-slot", s.id); //
    imgEl.setAttribute("data-natural-w", String(naturalW)); //
    imgEl.setAttribute("data-natural-h", String(naturalH)); //
    imgEl.setAttribute("x", x); //
    imgEl.setAttribute("y", y); //
    imgEl.setAttribute("width", w); //
    imgEl.setAttribute("height", h); //
    imgEl.setAttribute("preserveAspectRatio", "xMidYMid slice"); //
    imgEl.setAttribute("style", "cursor: move;"); //
    imgEl.setAttribute("href", dataUrl); //
    imgEl.setAttributeNS("http://www.w3.org/1999/xlink", "href", dataUrl); //

    wrapperGroup.appendChild(imgEl);

    const group = slotEl.closest("g.image_box, g#image_box") || overlaySvg; //
    group.appendChild(wrapperGroup);

    if (isIdLayout && groupKey) {
      applyImageTransform(imgEl, groupKey, s);
    }

    // 슬롯에 저장된 필터 재적용
    applySlotFilter(overlaySvg, s.id);

    // 필터 패널이 이 슬롯을 보고 있으면 UI 동기화
    if (activeFilterSlotId === s.id) syncFilterPanelUI(s.id);

    bringLogoToFront(overlaySvg); //
    if (logoColorInput) { //
      updateLogoColor(logoColorInput.value, overlaySvg); //
    }
  };
  img.src = dataUrl; //
}

async function loadSVGOverlay(url) { //
  const res = await fetch(url); //
  if (!res.ok) throw new Error(`SVG fetch failed: ${res.status} ${res.statusText}`); //
  const svgText = await res.text(); //
  svgOverlay.innerHTML = svgText; //

  const overlayRoot = svgOverlay.querySelector("svg"); //
  if (overlayRoot) { //
    if (!overlayRoot.getAttribute("xmlns")) { //
      overlayRoot.setAttribute("xmlns", "http://www.w3.org/2000/svg"); //
    }
    if (!overlayRoot.getAttribute("xmlns:xlink")) { //
      overlayRoot.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink"); //
    }
    const slotGroups = overlayRoot.querySelectorAll("g.image_box, g#image_box"); //
    slotGroups.forEach((group) => { //
      const rawElements = Array.from(group.querySelectorAll("rect, use")).filter( //
        (el) => !isInsideDefsOrClip(el) //
      ); //
      const idFiltered = rawElements.filter((el) => //
        /^image_box_/i.test(el.getAttribute("id") || "") //
      ); //
      let targets = idFiltered.length ? idFiltered : rawElements;
      // rect+use 중복 제거: rect가 있으면 use는 fill 숨김 불필요
      if (!idFiltered.length) {
        const rects = targets.filter((el) => el.tagName.toLowerCase() === "rect");
        if (rects.length > 0) targets = rects;
      }
      targets.forEach((el) => { //
        el.style.fill = "none"; //
        el.style.fillOpacity = "0"; //
      }); //
    }); //
  }

  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml"); //
  const svgEl = doc.querySelector("svg"); //
  if (!svgEl) throw new Error("SVG root not found."); //

  const viewBox = parseViewBox(svgEl); //
  const parsedSlots = extractSlots(svgEl, viewBox);

  const overlaySvg = svgOverlay.querySelector("svg"); //
  if (overlaySvg) { //
    assignSlotMarkers(overlaySvg, parsedSlots);
    bindSvgEvents(overlaySvg);
    bringLogoToFront(overlaySvg); //
    if (logoColorInput) { //
      updateLogoColor(logoColorInput.value, overlaySvg); //
    }
  }

  return { viewBox, slots: parsedSlots }; //
}

function safeDecodeURIComponent(value) { //
  try { //
    return decodeURIComponent(value); //
  } catch (err) { //
    return value; //
  } //
}

async function listFrameFiles() { //
  try { //
    const res = await fetch(FRAME_MANIFEST_URL); //
    if (res.ok) { //
      const list = await res.json(); //
      if (Array.isArray(list)) { //
        return list.map((name) => safeDecodeURIComponent(name)); //
      } //
    } //
  } catch (err) {} //

  try { //
    const res = await fetch(`${FRAME_DIR}/`); //
    if (!res.ok) return []; //
    const text = await res.text(); //
    const matches = Array.from(text.matchAll(/href="([^"]+\.svg)"/gi)).map((m) => m[1]); //
    const files = matches //
      .map((href) => safeDecodeURIComponent(href.split("/").pop())) //
      .filter(Boolean); //
    return Array.from(new Set(files)); //
  } catch (err) { //
    return []; //
  } //
}

async function setFrame(fileName) { //
  currentLayoutName = fileName;
  const url = `${FRAME_DIR}/${encodeURIComponent(fileName)}`; //
  const { viewBox, slots: parsedSlots } = await loadSVGOverlay(url); //
  setCanvasSize(viewBox.w, viewBox.h); //

  slots.length = 0; //
  parsedSlots.forEach((s) => slots.push({ ...s })); //

  activeSlotIndex = null; //
  hideFilterPanel();
  canvas.clear(); //
  canvas.setBackgroundColor("transparent", canvas.renderAll.bind(canvas)); //
  canvas.renderAll(); //

  if (fileName.includes("layout4_id")) {
    idLayoutCtrls.style.display = "flex";
    const overlaySvg = svgOverlay.querySelector("svg");
    if (overlaySvg) {
      slots.forEach((s) => {
        const groupKey = getIdLayoutGroup(s, viewBox);
        if (idLayoutState[groupKey].dataUrl) {
          renderImageToSlot(overlaySvg, s, idLayoutState[groupKey].dataUrl, groupKey);
        }
      });
    }
  } else {
    idLayoutCtrls.style.display = "none";
  }
}

fileInput.addEventListener("change", () => { //
  const file = fileInput.files[0]; //
  if (!file || activeSlotIndex === null) return; //

  const reader = new FileReader(); //
  reader.onload = async () => { //
    let dataUrl = reader.result; //
    const overlaySvg = svgOverlay.querySelector("svg"); //
    if (!overlaySvg) return; //

    if (currentLayoutName.includes("layout4_id")) {
      const viewBox = parseViewBox(overlaySvg);
      const selectedSlot = slots[activeSlotIndex];
      const targetGroup = getIdLayoutGroup(selectedSlot, viewBox);
      
      if (targetGroup === "35x45") {
        dataUrl = await rotateImage90Deg(dataUrl);
      }
      
      idLayoutState[targetGroup].dataUrl = dataUrl;

      slots.forEach((s) => {
        if (getIdLayoutGroup(s, viewBox) === targetGroup) {
          renderImageToSlot(overlaySvg, s, dataUrl, targetGroup);
        }
      });
    } else {
      const s = slots[activeSlotIndex]; //
      renderImageToSlot(overlaySvg, s, dataUrl, null);
    }
  };
  reader.readAsDataURL(file); //
});

function updateGroupTransforms(groupKey) {
  const overlaySvg = svgOverlay.querySelector("svg");
  if (!overlaySvg) return;
  const viewBox = parseViewBox(overlaySvg);

  slots.forEach((s) => {
    if (getIdLayoutGroup(s, viewBox) === groupKey) {
      const imgEl = overlaySvg.querySelector(`image[data-slot="${s.id}"]`);
      if (imgEl) {
        applyImageTransform(imgEl, groupKey, s);
      }
    }
  });
}

// 35x45 컨트롤 핸들러
flipLeftBtn.addEventListener("click", () => {
  idLayoutState["35x45"].flipX = !idLayoutState["35x45"].flipX;
  updateGroupTransforms("35x45");
});

flipVLeftBtn.addEventListener("click", () => {
  idLayoutState["35x45"].flipY = !idLayoutState["35x45"].flipY;
  updateGroupTransforms("35x45");
});

// 30x40 컨트롤 핸들러
flipRightBtn.addEventListener("click", () => {
  idLayoutState["30x40"].flipX = !idLayoutState["30x40"].flipX;
  updateGroupTransforms("30x40");
});

flipVRightBtn.addEventListener("click", () => {
  idLayoutState["30x40"].flipY = !idLayoutState["30x40"].flipY;
  updateGroupTransforms("30x40");
});

if (exportBtn) { //
  exportBtn.addEventListener("click", () => { //
    const exportW = Math.round((EXPORT_MM_W / MM_PER_INCH) * EXPORT_DPI); //
    const exportH = Math.round((EXPORT_MM_H / MM_PER_INCH) * EXPORT_DPI); //
    const liveSvg = svgOverlay.querySelector("svg"); //
    if (!liveSvg) return; //
    const clone = liveSvg.cloneNode(true); //
    if (!clone.getAttribute("xmlns")) { //
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg"); //
    }
    if (!clone.getAttribute("xmlns:xlink")) { //
      clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink"); //
    }
    clone.setAttribute("width", exportW); //
    clone.setAttribute("height", exportH); //

    const svgText = new XMLSerializer().serializeToString(clone); //
    const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }); //
    const svgUrl = URL.createObjectURL(svgBlob); //

    const svgImg = new Image(); //
    svgImg.onload = () => { //
      const tempCanvas = document.createElement("canvas"); //
      tempCanvas.width = exportW; //
      tempCanvas.height = exportH; //
      const ctx = tempCanvas.getContext("2d"); //
      ctx.drawImage(svgImg, 0, 0, exportW, exportH); //

      const link = document.createElement("a"); //
      link.download = "photo_frame.png"; //
      link.href = tempCanvas.toDataURL("image/png"); //
      link.click(); //

      URL.revokeObjectURL(svgUrl); //
    };
    svgImg.src = svgUrl; //
  });
}

if (logoColorInput) { //
  logoColorInput.addEventListener("input", (e) => { //
    updateLogoColor(e.target.value); //
  });
}

(async function init() { //
  const files = await listFrameFiles(); //
  const frames = files.length ? files : [DEFAULT_FRAME]; //

  if (layoutSelect) { //
    layoutSelect.innerHTML = ""; //
    frames.forEach((file) => { //
      const option = document.createElement("option"); //
      option.value = file; //
      option.textContent = file.replace(/\.svg$/i, ""); //
      layoutSelect.appendChild(option); //
    });

    layoutSelect.addEventListener("change", (e) => { //
        const fileName = e.target.value; //
        setFrame(fileName); //

        if (fileName.includes("layout3_TOP") || fileName.includes("layout3_bottom")) { //
            logoColorInput.value = "#ffffff"; //
            updateLogoColor("#ffffff"); //
        }
    });
  }

  await setFrame(frames[0]); //
})();
// ── 필터 패널 UI ─────────────────────────────────────────────────
const filterPanel = document.getElementById("filterPanel");
const filterBtns = document.querySelectorAll(".filter-btn");
const brightnessInput = document.getElementById("brightnessInput");
const contrastInput = document.getElementById("contrastInput");
const brightnessVal = document.getElementById("brightnessVal");
const contrastVal = document.getElementById("contrastVal");

function showFilterPanel(slotId) {
  activeFilterSlotId = slotId;
  filterPanel.style.display = "block";
  syncFilterPanelUI(slotId);
}

function hideFilterPanel() {
  filterPanel.style.display = "none";
  activeFilterSlotId = null;
  filterBtns.forEach((b) => b.classList.remove("active"));
  document.querySelector('.filter-btn[data-filter="none"]')?.classList.add("active");
}

function syncFilterPanelUI(slotId) {
  const state = getSlotFilter(slotId);
  filterBtns.forEach((b) => {
    b.classList.toggle("active", b.dataset.filter === state.filter);
  });
  brightnessInput.value = state.brightness;
  contrastInput.value = state.contrast;
  brightnessVal.textContent = state.brightness;
  contrastVal.textContent = state.contrast;
}

filterBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!activeFilterSlotId) return;
    const f = btn.dataset.filter;
    const state = getSlotFilter(activeFilterSlotId);
    slotFilters[activeFilterSlotId] = { ...state, filter: f };
    filterBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const overlaySvg = svgOverlay.querySelector("svg");
    if (overlaySvg) applySlotFilter(overlaySvg, activeFilterSlotId);
  });
});

brightnessInput.addEventListener("input", () => {
  if (!activeFilterSlotId) return;
  const v = parseInt(brightnessInput.value);
  brightnessVal.textContent = v;
  const state = getSlotFilter(activeFilterSlotId);
  slotFilters[activeFilterSlotId] = { ...state, brightness: v };
  const overlaySvg = svgOverlay.querySelector("svg");
  if (overlaySvg) applySlotFilter(overlaySvg, activeFilterSlotId);
});

contrastInput.addEventListener("input", () => {
  if (!activeFilterSlotId) return;
  const v = parseInt(contrastInput.value);
  contrastVal.textContent = v;
  const state = getSlotFilter(activeFilterSlotId);
  slotFilters[activeFilterSlotId] = { ...state, contrast: v };
  const overlaySvg = svgOverlay.querySelector("svg");
  if (overlaySvg) applySlotFilter(overlaySvg, activeFilterSlotId);
});

// 캔버스 바깥 클릭 시 필터 패널 닫기
document.addEventListener("click", (e) => {
  if (!filterPanel || filterPanel.style.display === "none") return;
  if (filterPanel.contains(e.target)) return;
  if (canvasWrap.contains(e.target)) return;
  hideFilterPanel();
});
