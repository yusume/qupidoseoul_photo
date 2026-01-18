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

const EXPORT_DPI = 300;
const EXPORT_MM_W = 100;
const EXPORT_MM_H = 150;
const MM_PER_INCH = 25.4;
const PREVIEW_SCALE = 2;

const slots = [];
let activeSlotIndex = null;
let currentBackground = "#111";
let dragState = null;

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

function resolveUseRect(useEl, svgRoot) {
  const href = getHref(useEl);
  if (!href || !href.startsWith("#")) return null;
  const target = svgRoot.querySelector(href);
  if (!target || target.tagName.toLowerCase() !== "rect") return null;
  return {
    x: parseFloat(target.getAttribute("x")) || 0,
    y: parseFloat(target.getAttribute("y")) || 0,
    w: parseFloat(target.getAttribute("width")) || 0,
    h: parseFloat(target.getAttribute("height")) || 0,
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
  const groups = svgRoot.querySelectorAll("g.image_box, g#image_box");
  const out = [];
  let slotIndex = 1;

  groups.forEach((group) => {
    const rawElements = Array.from(group.querySelectorAll("rect, use")).filter(
      (el) => !isInsideDefsOrClip(el)
    );
    const idFiltered = rawElements.filter((el) =>
      /^image_box_/i.test(el.getAttribute("id") || "")
    );
    const elements = idFiltered.length ? idFiltered : rawElements;

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
          };
        } else {
          rect = resolveUseRect(el, svgRoot);
        }
      }

      if (!rect) return;

      out.push({
        id: `slot${slotIndex++}`,
        x: rect.x - viewBox.minX,
        y: rect.y - viewBox.minY,
        w: rect.w,
        h: rect.h,
      });
    });
  });

  return out;
}

function assignSlotMarkers(overlayRoot, slotsList) {
  const groups = overlayRoot.querySelectorAll("g.image_box, g#image_box");
  const elements = [];

  groups.forEach((group) => {
    const rawElements = Array.from(group.querySelectorAll("rect, use")).filter(
      (el) => !isInsideDefsOrClip(el)
    );
    const idFiltered = rawElements.filter((el) =>
      /^image_box_/i.test(el.getAttribute("id") || "")
    );
    const list = idFiltered.length ? idFiltered : rawElements;
    list.forEach((el) => elements.push(el));
  });

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

function clampImageToSlot(slot, rect) {
  const minX = slot.x + slot.w - rect.w;
  const minY = slot.y + slot.h - rect.h;
  const maxX = slot.x;
  const maxY = slot.y;
  return {
    x: Math.min(maxX, Math.max(minX, rect.x)),
    y: Math.min(maxY, Math.max(minY, rect.y)),
  };
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
    const nextRect = {
      x: rect.x + (p.x - start.x),
      y: rect.y + (p.y - start.y),
      w: rect.w,
      h: rect.h,
    };
    const clamped = clampImageToSlot(slot, nextRect);
    target.setAttribute("x", clamped.x);
    target.setAttribute("y", clamped.y);
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
    const minScale = Math.max(slot.w / naturalW, slot.h / naturalH);
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

    target.setAttribute("x", clamped.x);
    target.setAttribute("y", clamped.y);
    target.setAttribute("width", nextW);
    target.setAttribute("height", nextH);
  });
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
  const url = `${FRAME_DIR}/${encodeURIComponent(fileName)}`;
  const { viewBox, slots: parsedSlots } = await loadSVGOverlay(url);
  setCanvasSize(viewBox.w, viewBox.h);

  slots.length = 0;
  parsedSlots.forEach((s) => slots.push({ ...s }));

  activeSlotIndex = null;
  canvas.clear();
  canvas.setBackgroundColor("transparent", canvas.renderAll.bind(canvas));
  canvas.renderAll();
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file || activeSlotIndex === null) return;

  const s = slots[activeSlotIndex];
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    const overlaySvg = svgOverlay.querySelector("svg");
    if (!overlaySvg) return;

    const slotEl = overlaySvg.querySelector(`[data-slot="${s.id}"]`);
    if (!slotEl) return;

    const rect = getSlotRectFromElement(slotEl, overlaySvg);
    if (!rect) return;

    const img = new Image();
    img.onload = () => {
      const naturalW = img.naturalWidth || rect.w;
      const naturalH = img.naturalHeight || rect.h;
      const scale = Math.max(rect.w / naturalW, rect.h / naturalH);
      const w = naturalW * scale;
      const h = naturalH * scale;
      const x = rect.x + (rect.w - w) / 2;
      const y = rect.y + (rect.h - h) / 2;

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
      clipRect.setAttribute("x", rect.x);
      clipRect.setAttribute("y", rect.y);
      clipRect.setAttribute("width", rect.w);
      clipRect.setAttribute("height", rect.h);
      clipPath.appendChild(clipRect);

      const existing = overlaySvg.querySelector(`image[data-slot="${s.id}"]`);
      if (existing) existing.remove();

      const imgEl = document.createElementNS("http://www.w3.org/2000/svg", "image");
      imgEl.setAttribute("data-slot", s.id);
      imgEl.setAttribute("data-natural-w", String(naturalW));
      imgEl.setAttribute("data-natural-h", String(naturalH));
      imgEl.setAttribute("x", x);
      imgEl.setAttribute("y", y);
      imgEl.setAttribute("width", w);
      imgEl.setAttribute("height", h);
      imgEl.setAttribute("preserveAspectRatio", "xMidYMid slice");
      imgEl.setAttribute("clip-path", `url(#${clipId})`);
      imgEl.setAttribute("style", "cursor: move;");
      imgEl.setAttribute("href", dataUrl);
      imgEl.setAttributeNS("http://www.w3.org/1999/xlink", "href", dataUrl);

      const group = slotEl.closest("g.image_box, g#image_box") || overlaySvg;
      group.appendChild(imgEl);
      bringLogoToFront(overlaySvg);
      if (logoColorInput) {
        updateLogoColor(logoColorInput.value, overlaySvg);
      }
    };
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
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
      setFrame(e.target.value);
    });
  }

  await setFrame(frames[0]);
})();
