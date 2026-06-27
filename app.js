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
  let allowFullCanvas = false; // layout3처럼 슬롯이 캔버스 전체인 경우

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
      // id 필터 우선, 없으면 전체 — 단 rect+use 중복이면 rect만 유지
      let selected = idFiltered.length ? idFiltered : rawElements;
      if (!idFiltered.length) {
        const rects = selected.filter((e) => e.tagName.toLowerCase() === "rect");
        const uses  = selected.filter((e) => e.tagName.toLowerCase() === "use");
        if (rects.length && uses.length) selected = rects; // rect+use 중복 제거
      }
      elements.push(...selected);
      // 후보가 1개이고 id 없는 경우 → 전체캔버스 단일슬롯(layout3) 가능성
      if (selected.length === 1 && !idFiltered.length) allowFullCanvas = true;
    });
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
    // 전체캔버스 단일슬롯은 50% 필터 예외 처리
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
      let selected = idFiltered.length ? idFiltered : rawElements;
      if (!idFiltered.length) {
        const rects = selected.filter((e) => e.tagName.toLowerCase() === "rect");
        const uses  = selected.filter((e) => e.tagName.toLowerCase() === "use");
        if (rects.length && uses.length) selected = rects;
      }
      elements.push(...selected);
      if (selected.length === 1 && !idFiltered.length) allowFullCanvas = true;
    });

    // 50% 필터 (전체캔버스 단일슬롯 예외)
    elements = elements.filter((el) => {
      const r = getSlotRectFromElement(el, overlayRoot);
      if (!r) return false;
      if (r.w * r.h > viewBox.w * viewBox.h * 0.5 && !allowFullCanvas) return false;
      return true;
    });

    // extractSlots와 동일 정렬 → slot 번호가 같은 DOM 요소에 붙도록
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
      const nw = img.naturalWidth;  // 실제 픽셀 해상도 (CSS픽셀 img.width와 다름)
      const nh = img.naturalHeight;
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = nh;   // 90도 회전 후 가로 = 원본 세로
      tempCanvas.height = nw;  // 90도 회전 후 세로 = 원본 가로
      const ctx = tempCanvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.translate(nh / 2, nw / 2);
      ctx.rotate((90 * Math.PI) / 180);
      ctx.drawImage(img, -nw / 2, -nh / 2, nw, nh);
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
      const rawEls = Array.from(group.querySelectorAll("rect, use")).filter( //
        (el) => !isInsideDefsOrClip(el) //
      ); //
      const idFiltered = rawEls.filter((el) => //
        /^image_box_/i.test(el.getAttribute("id") || "") //
      ); //
      let targets = idFiltered.length ? idFiltered : rawEls;
      // rect+use 중복이면 rect만 투명 처리
      if (!idFiltered.length) {
        const rects = targets.filter((e) => e.tagName.toLowerCase() === "rect");
        if (rects.length) targets = rects;
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
  exportBtn.addEventListener("click", async () => {
    const exportW = Math.round((EXPORT_MM_W / MM_PER_INCH) * EXPORT_DPI); //
    const exportH = Math.round((EXPORT_MM_H / MM_PER_INCH) * EXPORT_DPI); //
    const liveSvg = svgOverlay.querySelector("svg"); //
    if (!liveSvg) return; //

    const viewBox = parseViewBox(liveSvg);
    const scaleX = exportW / viewBox.w;
    const scaleY = exportH / viewBox.h;

    // Step 1: 슬롯 이미지 정보 수집 (href=원본 dataUrl, 위치/크기/clipPath)
    const slotImages = Array.from(liveSvg.querySelectorAll("image[data-slot]")).map((el) => {
      const slotId = el.getAttribute("data-slot");
      const clipPathAttr = el.getAttribute("clip-path") || el.closest("[clip-path]")?.getAttribute("clip-path") || "";
      const clipId = clipPathAttr.match(/url\(#([^)]+)\)/)?.[1] || `clip-${slotId}`;
      const cp = liveSvg.querySelector(`#${clipId} rect`);
      return {
        href: el.getAttribute("href") || el.getAttributeNS("http://www.w3.org/1999/xlink", "href"),
        x: parseFloat(el.getAttribute("x")) || 0,
        y: parseFloat(el.getAttribute("y")) || 0,
        w: parseFloat(el.getAttribute("width")) || 0,
        h: parseFloat(el.getAttribute("height")) || 0,
        clip: cp ? {
          x: parseFloat(cp.getAttribute("x")) || 0,
          y: parseFloat(cp.getAttribute("y")) || 0,
          w: parseFloat(cp.getAttribute("width")) || 0,
          h: parseFloat(cp.getAttribute("height")) || 0,
        } : null,
        slotId,
      };
    });

    // Step 2: 슬롯 이미지 제거한 프레임 전용 clone
    const frameClone = liveSvg.cloneNode(true);
    if (!frameClone.getAttribute("xmlns")) frameClone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    if (!frameClone.getAttribute("xmlns:xlink")) frameClone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    frameClone.setAttribute("width", exportW);
    frameClone.setAttribute("height", exportH);
    // 이미지 wrapper g 제거
    frameClone.querySelectorAll("g[data-wrapper]").forEach((g) => g.remove());
    // 슬롯 rect 투명화
    frameClone.querySelectorAll("[data-slot]").forEach((el) => {
      el.style.fill = "none";
      el.style.fillOpacity = "0";
    });

    // Step 3: export canvas
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = exportW;
    tempCanvas.height = exportH;
    const ctx = tempCanvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Step 4: 슬롯 이미지를 canvas에 직접 원본 해상도로 그리기
    await Promise.all(slotImages.map((si) => new Promise((resolve) => {
      if (!si.href) { resolve(); return; }
      const img = new Image();
      img.onload = () => {
        ctx.save();
        if (si.clip) {
          ctx.beginPath();
          ctx.rect(si.clip.x * scaleX, si.clip.y * scaleY, si.clip.w * scaleX, si.clip.h * scaleY);
          ctx.clip();
        }
        ctx.drawImage(img, si.x * scaleX, si.y * scaleY, si.w * scaleX, si.h * scaleY);
        ctx.restore();
        resolve();
      };
      img.onerror = resolve;
      img.src = si.href;
    })));

    // Step 5: 프레임 SVG를 이미지 위에 오버레이 (로고/테두리/텍스트)
    const frameText = new XMLSerializer().serializeToString(frameClone);
    const frameBlob = new Blob([frameText], { type: "image/svg+xml;charset=utf-8" });
    const frameUrl = URL.createObjectURL(frameBlob);
    await new Promise((resolve) => {
      const frameImg = new Image();
      frameImg.onload = () => {
        ctx.drawImage(frameImg, 0, 0, exportW, exportH);
        URL.revokeObjectURL(frameUrl);
        resolve();
      };
      frameImg.onerror = resolve;
      frameImg.src = frameUrl;
    });

    // Step 6: PNG 다운로드
    const link = document.createElement("a"); //
    link.download = "photo_frame.png"; //
    link.href = tempCanvas.toDataURL("image/png"); //
    link.click(); //
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