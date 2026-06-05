// ===============================
// PHOTO FRAME - SVG IMAGE EDITOR
// ===============================

const FRAME_DIR = "./frames";
const FRAME_MANIFEST_URL = `${FRAME_DIR}/manifest.json`;
const DEFAULT_FRAME = "layout1.svg";

const canvas = new fabric.Canvas("c", {
  selection: false,
  enableRetinaScaling: true,
});

const fileInput = document.getElementById("fileInput");
const svgOverlay = document.getElementById("svgOverlay");
const canvasWrap = document.getElementById("canvasWrap");
const layoutSelect = document.getElementById("layoutSelect");
const exportBtn = document.getElementById("exportBtn");
const logoColorInput = document.getElementById("logoColor");

// layout4_id 및 layout4_id_v2 전용 DOM 요소
const idLayoutCtrls = document.getElementById("idLayoutCtrls");
const flipLeftBtn = document.getElementById("flipLeftBtn");
const flipVLeftBtn = document.getElementById("flipVLeftBtn");
const flipRightBtn = document.getElementById("flipRightBtn");
const flipVRightBtn = document.getElementById("flipVRightBtn");

const EXPORT_DPI = 300;
const EXPORT_MM_W = 100;
const EXPORT_MM_H = 150;
const MM_PER_INCH = 25.4;
const PREVIEW_SCALE = 2;

const slots = [];
let activeSlotIndex = null;
let currentBackground = "#111";
let dragState = null;
let currentLayoutName = "";

// ID 레이아웃 상태 관리 (35x45: box1~9 증명, 30x40: box10~11 여권)
const idLayoutState = {
  "35x45": { dataUrl: null, flipX: false, flipY: false }, 
  "30x40": { dataUrl: null, flipX: false, flipY: false }  
};

// layout4_id 계열 레이아웃을 감지하는 헬퍼 함수
function isIdLayoutMode(layoutName) {
  return layoutName.includes("layout4_id") || layoutName.includes("layout4_id_v2");
}

function parseViewBox(svgEl) {
  const viewBox = svgEl.getAttribute("viewBox");
  if (!viewBox) {
    const w = parseFloat(svgEl.getAttribute("width")) || 0;
    const h = parseFloat(svgEl.getAttribute("height")) || 0;
    return { minX: 0, minY: 0, w, h };
  }

  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) {
    return { minX: 0, minY: 0, w: 0, h: 0 };
  }

  const [minX, minY, w, h] = parts;
  return { minX, minY, w, h };
}

function isInsideDefsOrClip(el) {
  let node = el.parentElement;
  while (node) {
    const tag = node.tagName ? node.tagName.toLowerCase() : "";
    if (tag === "defs" || tag === "clippath") return true;
    node = node.parentElement;
  }
  return false;
}

function getHref(el) {
  return (
    el.getAttribute("href") ||
    el.getAttribute("xlink:href") ||
    el.getAttributeNS("http://www.w3.org/1999/xlink", "href") ||
    ""
  );
}

// 사각형 영역 해석 및 태그 구조별 고유 ID 수집 알고리즘 보완
function resolveUseRect(useEl, svgRoot) {
  const href = getHref(useEl);
  if (!href || !href.startsWith("#")) return null;
  const target = svgRoot.querySelector(href);
  if (!target || target.tagName.toLowerCase() !== "rect") return null;
  
  // 1순위: use 태그 자체 ID, 2순위: 참조 대상 rect ID, 3순위: 상위 부모 레이어 ID
  let resolvedId = useEl.getAttribute("id") || target.getAttribute("id") || "";
  if (!resolvedId && useEl.parentElement) {
    resolvedId = useEl.parentElement.getAttribute("id") || "";
  }

  return {
    x: parseFloat(target.getAttribute("x")) || 0,
    y: parseFloat(target.getAttribute("y")) || 0,
    w: parseFloat(target.getAttribute("width")) || 0,
    h: parseFloat(target.getAttribute("height")) || 0,
    svgId: resolvedId
  };
}

function setCanvasSize(w, h) {
  const cssW = Math.round(w * PREVIEW_SCALE);
  const cssH = Math.round(h * PREVIEW_SCALE);

  canvas.setWidth(w);
  canvas.setHeight(h);
  canvas.setDimensions({ width: cssW, height: cssH }, { cssOnly: true });

  if (canvas.lowerCanvasEl) {
    canvas.lowerCanvasEl.style.width = `${cssW}px`;
    canvas.lowerCanvasEl.style.height = `${cssH}px`;
  }
  if (canvas.upperCanvasEl) {
    canvas.upperCanvasEl.style.width = `${cssW}px`;
    canvas.upperCanvasEl.style.height = `${cssH}px`;
  }
  if (canvas.wrapperEl) {
    canvas.wrapperEl.style.width = `${cssW}px`;
    canvas.wrapperEl.style.height = `${cssH}px`;
  }
  if (canvasWrap) {
    canvasWrap.style.width = `${cssW}px`;
    canvasWrap.style.height = `${cssH}px`;
    canvasWrap.style.aspectRatio = `${w} / ${h}`;
  }
}

function getSvgPoint(svgEl, clientX, clientY) {
  const pt = svgEl.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svgEl.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const inv = ctm.inverse();
  const sp = pt.matrixTransform(inv);
  return { x: sp.x, y: sp.y };
}

function extractSlots(svgRoot, viewBox) {
  let elements = [];
  
  if (isIdLayoutMode(currentLayoutName)) {
    elements = Array.from(svgRoot.querySelectorAll("rect, use")).filter(
      (el) => !isInsideDefsOrClip(el)
    );
  } else {
    const groups = svgRoot.querySelectorAll("g.image_box, g#image_box");
    groups.forEach((group) => {
      const rawElements = Array.from(group.querySelectorAll("rect, use")).filter(
        (el) => !isInsideDefsOrClip(el)
      );
      const idFiltered = rawElements.filter((el) =>
        /^image_box_/i.test(el.getAttribute("id") || "")
      );
      elements.push(...(idFiltered.length ? idFiltered : rawElements));
    });
  }

  const out = [];
  let slotIndex = 1;

  elements.forEach((el) => {
    const tag = el.tagName.toLowerCase();
    let rect = null;
    
    //use 태그나 부모 <g> 태그에 ID가 누락되는 현상을 방지하는 정밀 추적 필터
    let svgId = el.getAttribute("id") || "";
    if (!svgId && el.parentElement) {
      svgId = el.parentElement.getAttribute("id") || "";
    }

    if (tag === "rect") {
      rect = {
        x: parseFloat(el.getAttribute("x")) || 0,
        y: parseFloat(el.getAttribute("y")) || 0,
        w: parseFloat(el.getAttribute("width")) || 0,
        h: parseFloat(el.getAttribute("height")) || 0,
        svgId: svgId
      };
    } else if (tag === "use") {
      const x = el.getAttribute("x");
      const y = el.getAttribute("y");
      const w = el.getAttribute("width");
      const h = el.getAttribute("height");

      if (x !== null || y !== null || w !== null || h !== null) {
        rect = {
          x: parseFloat(x) || 0,
          y: parseFloat(y) || 0,
          w: parseFloat(w) || 0,
          h: parseFloat(h) || 0,
          svgId: svgId
        };
      } else {
        rect = resolveUseRect(el, svgRoot);
      }
    }

    if (!rect || rect.w < 10 || rect.h < 10) return;
    if (rect.w >= viewBox.w && rect.h >= viewBox.h) return; 

    out.push({
      id: `slot${slotIndex++}`,
      x: rect.x - viewBox.minX,
      y: rect.y - viewBox.minY,
      w: rect.w,
      h: rect.h,
      svgId: rect.svgId || svgId 
    });
  });

  return out;
}

function assignSlotMarkers(overlayRoot, slotsList) {
  let elements = [];
  if (isIdLayoutMode(currentLayoutName)) {
    elements = Array.from(overlayRoot.querySelectorAll("rect, use")).filter(
      (el) => !isInsideDefsOrClip(el) && (parseFloat(el.getAttribute("width")) >= 10 || el.tagName.toLowerCase() === 'use')
    );
  } else {
    const groups = overlayRoot.querySelectorAll("g.image_box, g#image_box");
    groups.forEach((group) => {
      const rawElements = Array.from(group.querySelectorAll("rect, use")).filter(
        (el) => !isInsideDefsOrClip(el)
      );
      const idFiltered = rawElements.filter((el) =>
        /^image_box_/i.test(el.getAttribute("id") || "")
      );
      elements.push(...(idFiltered.length ? idFiltered : rawElements));
    });
  }

  slotsList.forEach((slot, index) => {
    const el = elements[index];
    if (el) el.setAttribute("data-slot", slot.id);
  });
}

function getSlotRectFromElement(el, overlayRoot) {
  const tag = el.tagName.toLowerCase();
  if (tag === "rect") {
    return {
      x: parseFloat(el.getAttribute("x")) || 0,
      y: parseFloat(el.getAttribute("y")) || 0,
      w: parseFloat(el.getAttribute("width")) || 0,
      h: parseFloat(el.getAttribute("height")) || 0,
    };
  }
  if (tag === "use") {
    const x = el.getAttribute("x");
    const y = el.getAttribute("y");
    const w = el.getAttribute("width");
    const h = el.getAttribute("height");
    if (x !== null || y !== null || w !== null || h !== null) {
      return {
        x: parseFloat(x) || 0,
        y: parseFloat(y) || 0,
        w: parseFloat(w) || 0,
        h: parseFloat(h) || 0,
      };
    }
    return resolveUseRect(el, overlayRoot);
  }
  return null;
}

function ensureDefs(svgRoot) {
  let defs = svgRoot.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svgRoot.insertBefore(defs, svgRoot.firstChild);
  }
  return defs;
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

function bringLogoToFront(svgRoot) {
  const logo = svgRoot.querySelector("#logo");
  if (!logo) return;
  logo.parentNode.appendChild(logo);
}

function updateLogoColor(color, svgRoot) {
  const root = svgRoot || svgOverlay.querySelector("svg");
  if (!root) return;
  const logo = root.querySelector("#logo");
  if (!logo) return;

  logo.setAttribute("fill", color);
  const nodes = logo.querySelectorAll("*");
  nodes.forEach((node) => {
    if (node.hasAttribute("fill") && node.getAttribute("fill") !== "none") {
      node.setAttribute("fill", color);
    }
  });
}

// 사방 여백 3px 마진 제한 수식
function clampImageToSlot(slot, rect) {
  const isIdLayout = isIdLayoutMode(currentLayoutName);
  const margin = isIdLayout ? 3 : 0; 

  const innerW = slot.w - (margin * 2);
  const innerH = slot.h - (margin * 2);
  const minX = (slot.x + margin) + innerW - rect.w;
  const minY = (slot.y + margin) + innerH - rect.h;
  const maxX = (slot.x + margin);
  const maxY = (slot.y + margin);
  return {
    x: Math.min(maxX, Math.max(minX, rect.x)),
    y: Math.min(maxY, Math.max(minY, rect.y)),
  };
}

// 추출된 svgId 속성의 box 문자열 숫자를 정밀 판독하여 그룹 매핑
function getIdLayoutGroup(slot, viewBox) {
  const idStr = String(slot.svgId || "").toLowerCase();
  
  const match = idStr.match(/box(\d+)/);
  if (match) {
    const num = parseInt(match[1], 10);
    if (num >= 1 && num <= 9) return "35x45";   // 증명사진 섹션 (90도 사전 회전 대상)
    if (num === 10 || num === 11) return "30x40"; // 여권사진 섹션 (정방향 대상)
  }

  // 예외 상황 대비 방어 코드 (중심축 분할 연산 보완 구조 백업)
  const middleX = viewBox.w / 2;
  return (slot.x + slot.w / 2) < middleX ? "35x45" : "30x40";
}

// 래퍼 그룹 변형 처리
function applyImageTransform(imgEl, groupKey, slot) {
  const state = idLayoutState[groupKey];
  if (!state) return;

  const wrapperGroup = imgEl.parentElement;
  if (!wrapperGroup || wrapperGroup.tagName.toLowerCase() !== "g") return;

  const cx = slot.x + slot.w / 2;
  const cy = slot.y + slot.h / 2;

  let transformString = "";
  
  if (state.flipX) {
    transformString += `translate(${cx}, ${cy}) scale(-1, 1) translate(${-cx}, ${-cy}) `;
  }

  if (state.flipY) {
    transformString += `translate(${cx}, ${cy}) scale(1, -1) translate(${-cx}, ${-cy}) `;
  }

  if (transformString.trim()) {
    wrapperGroup.setAttribute("transform", transformString.trim());
  } else {
    wrapperGroup.removeAttribute("transform");
  }
}

function bindSvgEvents(overlaySvg) {
  overlaySvg.style.touchAction = "none";

  overlaySvg.addEventListener("dblclick", (e) => {
    const p = getSvgPoint(overlaySvg, e.clientX, e.clientY);
    const idx = slots.findIndex(
      (s) =>
        p.x >= s.x &&
        p.x <= s.x + s.w &&
        p.y >= s.y &&
        p.y <= s.y + s.h
    );
    if (idx === -1) return;
    activeSlotIndex = idx;
    fileInput.value = "";
    fileInput.click();
  });

  overlaySvg.addEventListener("pointerdown", (e) => {
    const target = e.target;
    if (!target || target.tagName.toLowerCase() !== "image") return;
    const slotId = target.getAttribute("data-slot");
    if (!slotId) return;
    const slot = slots.find((s) => s.id === slotId);
    if (!slot) return;

    const rect = {
      x: parseFloat(target.getAttribute("x")) || 0,
      y: parseFloat(target.getAttribute("y")) || 0,
      w: parseFloat(target.getAttribute("width")) || 0,
      h: parseFloat(target.getAttribute("height")) || 0,
    };
    const start = getSvgPoint(overlaySvg, e.clientX, e.clientY);
    dragState = { target, slot, start, rect, pointerId: e.pointerId };
    target.setPointerCapture(e.pointerId);
  });

  overlaySvg.addEventListener("pointermove", (e) => {
    if (!dragState || dragState.pointerId !== e.pointerId) return;
    const { target, slot, start, rect } = dragState;
    const p = getSvgPoint(overlaySvg, e.clientX, e.clientY);
    
    const deltaX = p.x - start.x;
    const deltaY = p.y - start.y;
    
    if (isIdLayoutMode(currentLayoutName)) {
      const viewBox = parseViewBox(overlaySvg);
      const targetGroup = getIdLayoutGroup(slot, viewBox);
      const state = idLayoutState[targetGroup];

      let correctedDx = deltaX;
      let correctedDy = deltaY;
      
      if (state.flipX) {
        correctedDx = -correctedDx;
      }
      if (state.flipY) {
        correctedDy = -correctedDy;
      }

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
            const offsetX = clamped.x - (slot.x + 3);
            const offsetY = clamped.y - (slot.y + 3);
            
            imgEl.setAttribute("x", (s.x + 3) + offsetX);
            imgEl.setAttribute("y", (s.y + 3) + offsetY);
          }
        }
      });
    } else {
      const nextRect = {
        x: rect.x + deltaX,
        y: rect.y + deltaY,
        w: rect.w,
        h: rect.h,
      };
      const clamped = clampImageToSlot(slot, nextRect);
      target.setAttribute("x", clamped.x);
      target.setAttribute("y", clamped.y);
    }
  });

  overlaySvg.addEventListener("pointerup", () => {
    dragState = null;
  });

  overlaySvg.addEventListener("wheel", (e) => {
    const target = e.target;
    if (!target || target.tagName.toLowerCase() !== "image") return;
    const slotId = target.getAttribute("data-slot");
    if (!slotId) return;
    const slot = slots.find((s) => s.id === slotId);
    if (!slot) return;

    e.preventDefault();
    const rect = {
      x: parseFloat(target.getAttribute("x")) || 0,
      y: parseFloat(target.getAttribute("y")) || 0,
      w: parseFloat(target.getAttribute("width")) || 0,
      h: parseFloat(target.getAttribute("height")) || 0,
    };
    const naturalW = parseFloat(target.getAttribute("data-natural-w")) || rect.w;
    const naturalH = parseFloat(target.getAttribute("data-natural-h")) || rect.h;
    const scaleFactor = e.deltaY < 0 ? 1.05 : 0.95;

    let nextW = rect.w * scaleFactor;
    let nextH = rect.h * scaleFactor;
    
    const margin = isIdLayoutMode(currentLayoutName) ? 3 : 0;
    const innerW = slot.w - (margin * 2);
    const innerH = slot.h - (margin * 2);
    const minScale = Math.max(innerW / naturalW, innerH / naturalH);
    const minW = naturalW * minScale;
    const minH = naturalH * minScale;

    if (nextW < minW || nextH < minH) {
      nextW = minW;
      nextH = minH;
    }

    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const nextRect = {
      x: cx - nextW / 2,
      y: cy - nextH / 2,
      w: nextW,
      h: nextH,
    };
    const clamped = clampImageToSlot(slot, nextRect);

    if (isIdLayoutMode(currentLayoutName)) {
      const viewBox = parseViewBox(overlaySvg);
      const targetGroup = getIdLayoutGroup(slot, viewBox);
      
      slots.forEach((s) => {
        if (getIdLayoutGroup(s, viewBox) === targetGroup) {
          const imgEl = overlaySvg.querySelector(`image[data-slot="${s.id}"]`);
          if (imgEl) {
            const offsetX = clamped.x - (slot.x + 3);
            const offsetY = clamped.y - (slot.y + 3);
            
            imgEl.setAttribute("x", (s.x + 3) + offsetX);
            imgEl.setAttribute("y", (s.y + 3) + offsetY);
            imgEl.setAttribute("width", nextW);
            imgEl.setAttribute("height", nextH);
          }
        }
      });
    } else {
      target.setAttribute("x", clamped.x);
      target.setAttribute("y", clamped.y);
      target.setAttribute("width", nextW);
      target.setAttribute("height", nextH);
    }
  });
}

function renderImageToSlot(overlaySvg, s, dataUrl, groupKey) {
  const slotEl = overlaySvg.querySelector(`[data-slot="${s.id}"]`);
  if (!slotEl) return;

  const rect = getSlotRectFromElement(slotEl, overlaySvg);
  if (!rect) return;

  const img = new Image();
  img.onload = () => {
    const isIdLayout = isIdLayoutMode(currentLayoutName);
    const margin = isIdLayout ? 3 : 0; 
    
    const targetX = rect.x + margin;
    const targetY = rect.y + margin;
    const targetW = rect.w - (margin * 2);
    const targetH = rect.h - (margin * 2);

    const naturalW = img.naturalWidth || targetW;
    const naturalH = img.naturalHeight || targetH;
    const scale = Math.max(targetW / naturalW, targetH / naturalH);
    const w = naturalW * scale;
    const h = naturalH * scale;
    const x = targetX + (targetW - w) / 2;
    const y = targetY + (targetH - h) / 2;

    const defs = ensureDefs(overlaySvg);
    const clipId = `clip-${s.id}`;
    let clipPath = overlaySvg.querySelector(`#${clipId}`);
    if (!clipPath) {
      clipPath = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
      clipPath.setAttribute("id", clipId);
      defs.appendChild(clipPath);
    } else {
      clipPath.innerHTML = "";
    }

    const clipRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    clipRect.setAttribute("x", targetX);
    clipRect.setAttribute("y", targetY);
    clipRect.setAttribute("width", targetW);
    clipRect.setAttribute("height", targetH);
    clipPath.appendChild(clipRect);

    const existing = overlaySvg.querySelector(`image[data-slot="${s.id}"]`);
    if (existing) {
      const parentNode = existing.parentElement;
      if (parentNode && parentNode.tagName.toLowerCase() === "g" && parentNode.getAttribute("data-wrapper") === s.id) {
        parentNode.remove();
      } else {
        existing.remove();
      }
    }

    const wrapperGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    wrapperGroup.setAttribute("data-wrapper", s.id);
    wrapperGroup.setAttribute("clip-path", `url(#${clipId})`);

    const imgEl = document.createElementNS("http://www.w3.org/2000/svg", "image");
    imgEl.setAttribute("data-slot", s.id);
    imgEl.setAttribute("data-natural-w", String(naturalW));
    imgEl.setAttribute("data-natural-h", String(naturalH));
    imgEl.setAttribute("x", x);
    imgEl.setAttribute("y", y);
    imgEl.setAttribute("width", w);
    imgEl.setAttribute("height", h);
    imgEl.setAttribute("preserveAspectRatio", "xMidYMid slice");
    imgEl.setAttribute("style", "cursor: move;");
    imgEl.setAttribute("href", dataUrl);
    imgEl.setAttributeNS("http://www.w3.org/1999/xlink", "href", dataUrl);

    wrapperGroup.appendChild(imgEl);

    const group = slotEl.closest("g.image_box, g#image_box") || overlaySvg;
    group.appendChild(wrapperGroup);

    if (isIdLayout && groupKey) {
      applyImageTransform(imgEl, groupKey, s);
    }

    bringLogoToFront(overlaySvg);
    if (logoColorInput) {
      updateLogoColor(logoColorInput.value, overlaySvg);
    }
  };
  img.src = dataUrl;
}

async function loadSVGOverlay(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SVG fetch failed: ${res.status} ${res.statusText}`);
  const svgText = await res.text();
  svgOverlay.innerHTML = svgText;

  const overlayRoot = svgOverlay.querySelector("svg");
  if (overlayRoot) {
    if (!overlayRoot.getAttribute("xmlns")) {
      overlayRoot.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }
    if (!overlayRoot.getAttribute("xmlns:xlink")) {
      overlayRoot.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    }
    const slotGroups = overlayRoot.querySelectorAll("g.image_box, g#image_box");
    slotGroups.forEach((group) => {
      const elements = Array.from(group.querySelectorAll("rect, use")).filter(
        (el) => !isInsideDefsOrClip(el)
      );
      const idFiltered = elements.filter((el) =>
        /^image_box_/i.test(el.getAttribute("id") || "")
      );
      const targets = idFiltered.length ? idFiltered : elements;
      targets.forEach((el) => {
        el.style.fill = "none";
        el.style.fillOpacity = "0";
      });
    });
  }

  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svgEl = doc.querySelector("svg");
  if (!svgEl) throw new Error("SVG root not found.");

  const viewBox = parseViewBox(svgEl);
  const parsedSlots = extractSlots(svgEl, viewBox);

  const overlaySvg = svgOverlay.querySelector("svg");
  if (overlaySvg) {
    assignSlotMarkers(overlaySvg, parsedSlots);
    bindSvgEvents(overlaySvg);
    bringLogoToFront(overlaySvg);
    if (logoColorInput) {
      updateLogoColor(logoColorInput.value, overlaySvg);
    }
  }

  return { viewBox, slots: parsedSlots };
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch (err) {
    return value;
  }
}

async function listFrameFiles() {
  try {
    const res = await fetch(FRAME_MANIFEST_URL);
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list)) {
        return list.map((name) => safeDecodeURIComponent(name));
      }
    }
  } catch (err) {
    // manifest optional
  }

  try {
    const res = await fetch(`${FRAME_DIR}/`);
    if (!res.ok) return [];
    const text = await res.text();
    const matches = Array.from(text.matchAll(/href="([^"]+\.svg)"/gi)).map(
      (m) => m[1]
    );
    const files = matches
      .map((href) => safeDecodeURIComponent(href.split("/").pop()))
      .filter(Boolean);
    return Array.from(new Set(files));
  } catch (err) {
    return [];
  }
}

async function setFrame(fileName) {
  currentLayoutName = fileName;
  const url = `${FRAME_DIR}/${encodeURIComponent(fileName)}`;
  const { viewBox, slots: parsedSlots } = await loadSVGOverlay(url);
  setCanvasSize(viewBox.w, viewBox.h);

  slots.length = 0;
  parsedSlots.forEach((s) => slots.push({ ...s }));

  activeSlotIndex = null;
  canvas.clear();
  canvas.setBackgroundColor("transparent", canvas.renderAll.bind(canvas));
  canvas.renderAll();

  if (isIdLayoutMode(fileName)) {
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

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file || activeSlotIndex === null) return;

  const reader = new FileReader();
  reader.onload = async () => {
    let dataUrl = reader.result;
    const overlaySvg = svgOverlay.querySelector("svg");
    if (!overlaySvg) return;

    if (isIdLayoutMode(currentLayoutName)) {
      const viewBox = parseViewBox(overlaySvg);
      const selectedSlot = slots[activeSlotIndex];
      const targetGroup = getIdLayoutGroup(selectedSlot, viewBox);
      
      // 고유 ID가 box1 ~ box9 범위일 때만 90도 사전 회전하여 올려줌
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
      const s = slots[activeSlotIndex];
      renderImageToSlot(overlaySvg, s, dataUrl, null);
    }
  };
  reader.readAsDataURL(file);
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

// box1 ~ box9 컨트롤 핸들러
flipLeftBtn.addEventListener("click", () => {
  idLayoutState["35x45"].flipX = !idLayoutState["35x45"].flipX;
  updateGroupTransforms("35x45");
});

flipVLeftBtn.addEventListener("click", () => {
  idLayoutState["35x45"].flipY = !idLayoutState["35x45"].flipY;
  updateGroupTransforms("35x45");
});

// box10, box11 컨트롤 핸들러
flipRightBtn.addEventListener("click", () => {
  idLayoutState["30x40"].flipX = !idLayoutState["30x40"].flipX;
  updateGroupTransforms("30x40");
});

flipVRightBtn.addEventListener("click", () => {
  idLayoutState["30x40"].flipY = !idLayoutState["30x40"].flipY;
  updateGroupTransforms("30x40");
});


if (exportBtn) {
  exportBtn.addEventListener("click", () => {
    const exportW = Math.round((EXPORT_MM_W / MM_PER_INCH) * EXPORT_DPI);
    const exportH = Math.round((EXPORT_MM_H / MM_PER_INCH) * EXPORT_DPI);
    const liveSvg = svgOverlay.querySelector("svg");
    if (!liveSvg) return;
    const clone = liveSvg.cloneNode(true);
    if (!clone.getAttribute("xmlns")) {
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }
    if (!clone.getAttribute("xmlns:xlink")) {
      clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    }
    clone.setAttribute("width", exportW);
    clone.setAttribute("height", exportH);

    const svgText = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);

    const svgImg = new Image();
    svgImg.onload = () => {
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = exportW;
      tempCanvas.height = exportH;
      const ctx = tempCanvas.getContext("2d");
      ctx.drawImage(svgImg, 0, 0, exportW, exportH);

      const link = document.createElement("a");
      link.download = "photo_frame.png";
      link.href = tempCanvas.toDataURL("image/png");
      link.click();

      URL.revokeObjectURL(svgUrl);
    };
    svgImg.src = svgUrl;
  });
}

if (logoColorInput) {
  logoColorInput.addEventListener("input", (e) => {
    updateLogoColor(e.target.value);
  });
}

(async function init() {
  const files = await listFrameFiles();
  const frames = files.length ? files : [DEFAULT_FRAME];

  if (layoutSelect) {
    layoutSelect.innerHTML = "";
    frames.forEach((file) => {
      const option = document.createElement("option");
      option.value = file;
      option.textContent = file.replace(/\.svg$/i, "");
      layoutSelect.appendChild(option);
    });

    layoutSelect.addEventListener("change", (e) => {
        const fileName = e.target.value;
        setFrame(fileName);

        if (fileName.includes("layout3_TOP") || fileName.includes("layout3_bottom")) {
            logoColorInput.value = "#ffffff";
            updateLogoColor("#ffffff");
        }
    });
  }

  await setFrame(frames[0]);
})();