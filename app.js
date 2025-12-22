// ===============================
// PHOTO FRAME - FINAL APP.JS
// ===============================

const EXPORT_W = 1200;
const EXPORT_H = 1800;
const SVG_URL = "./frames/layout 1_memorycard.svg";

// ===== Canvas =====
const canvas = new fabric.Canvas("c", {
  selection: true,
});
canvas.setWidth(EXPORT_W);
canvas.setHeight(EXPORT_H);
canvas.setBackgroundColor("#111", canvas.renderAll.bind(canvas));

// ===== Elements =====
const fileInput = document.getElementById("fileInput");
const svgOverlay = document.getElementById("svgOverlay");

// ===============================
// 1️⃣ SVG OVERLAY (FRAME)
// ===============================
async function loadSVGOverlay(url = SVG_URL) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SVG fetch failed: ${res.status} ${res.statusText}`);
  const svgText = await res.text();
  svgOverlay.innerHTML = svgText;
}

// ===============================
// 2️⃣ SLOT DEFINITIONS (⬅️ 여기만 네 값으로 교체)
// ===============================
const slots = [
  { x: 10, y: 10, w: 279, h: 385 }, // SLOT 1
  { x: 310, y: 10, w: 279, h: 385 }, // SLOT 2
  { x: 10, y: 413, w: 279, h: 385 }, // SLOT 3
  { x: 310, y: 413, w: 279, h: 385 }, // SLOT 4
];

// layout2 / layoutTest에서 공유하는 키링 슬롯 좌표
const keyringSlots = [
  { x: 12, y: 12, w: 144, h: 438 },
  { x: 156, y: 12, w: 144, h: 438 },
  { x: 300, y: 12, w: 144, h: 438 },
  { x: 444, y: 12, w: 144, h: 438 },
  { x: 12, y: 450, w: 144, h: 438 },
  { x: 156, y: 450, w: 144, h: 438 },
  { x: 300, y: 450, w: 144, h: 438 },
  { x: 444, y: 450, w: 144, h: 438 },
];


const layouts = {
  layout1: {
    svg: "./frames/layout 1_memorycard.svg",
    slots: [
    { x: 10, y: 10, w: 279, h: 385 }, // SLOT 1
    { x: 310, y: 10, w: 279, h: 385 }, // SLOT 2
    { x: 10, y: 413, w: 279, h: 385 }, // SLOT 3
    { x: 310, y: 413, w: 279, h: 385 }, // SLOT 4
    ]
  },
  layout2: {
    svg: "./frames/layout 2_Keyring.svg",
    slots: [
  { x: 12, y: 12, w: 144, h: 438 },
  { x: 156, y: 12, w: 144, h: 438 },
  { x: 300, y: 12, w: 144, h: 438 },
  { x: 444, y: 12, w: 144, h: 438 },
  { x: 12, y: 450, w: 144, h: 438 },
  { x: 156, y: 450, w: 144, h: 438 },
  { x: 300, y: 450, w: 144, h: 438 },
  { x: 444, y: 450, w: 144, h: 438 },
    ],
  },
  layout3: {
    svg: "./frames/layout 3_ 4*6 full size.svg",
    slots: [
      { x: 0, y: 0, w: 574, h: 886 },
    ]
  },
  layout4: {
    svg: "./frames/layout 4_4 cut.svg",
    slots: [
      { x: 98, y: 160, w: 186, h: 278 },
      { x: 328, y: 160, w: 186, h: 278 },
      { x: 98, y: 475, w: 186, h: 278 },
      { x: 328, y: 475, w: 186, h: 278 },
    ]
  },
};

let activeSlotIndex = null;
let slotImages = {};



// ===============================
// SLOT HIT TEST
// ===============================
function hitTestSlot(pt) {
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (
      pt.x >= s.x &&
      pt.x <= s.x + s.w &&
      pt.y >= s.y &&
      pt.y <= s.y + s.h
    ) {
      return i;
    }
  }
  return null;
}

// ===============================
// DOUBLE CLICK → IMAGE LOAD
// ===============================
canvas.on("mouse:dblclick", (opt) => {
  const p = canvas.getPointer(opt.e);
  const idx = hitTestSlot(p);
  if (idx === null) return;

  activeSlotIndex = idx;
  fileInput.value = "";
  fileInput.click();
});

// ===============================
// IMAGE INSERT
// ===============================
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file || activeSlotIndex === null) return;

  const s = slots[activeSlotIndex];
  const url = URL.createObjectURL(file);

  fabric.Image.fromURL(url, (img) => {
    URL.revokeObjectURL(url);

    img.__slotIndex = activeSlotIndex;
    img.lockRotation = true;

    // cover scale
    const scale = Math.max(
      s.w / img.width,
      s.h / img.height
    );
    img.scale(scale);

    img.set({
      left: s.x + s.w / 2,
      top:  s.y + s.h / 2,
      originX: "center",
      originY: "center",
      hasControls: true,
    });

    // clipPath (RECT 기반)
    img.clipPath = new fabric.Rect({
      left: s.x + s.w / 2,
      top:  s.y + s.h / 2,
      width: s.w,
      height: s.h,
      originX: "center",
      originY: "center",
      absolutePositioned: true,
    });

    // 기존 이미지 교체
    if (slotImages[activeSlotIndex]) {
      canvas.remove(slotImages[activeSlotIndex]);
    }

    slotImages[activeSlotIndex] = img;
    canvas.add(img);
    img.sendToBack();
    canvas.setActiveObject(img);
    canvas.renderAll();
  });
});

// ===============================
// SLOT 영역 밖 이동 제한
// ===============================
canvas.on("object:moving", clampToSlot);
canvas.on("object:scaling", clampToSlot);

function clampToSlot(e) {
  const img = e.target;
  if (!img || img.__slotIndex === undefined) return;

  const s = slots[img.__slotIndex];
  img.setCoords();
  const ibox = img.getBoundingRect(true);

  if (ibox.left > s.x) img.left -= (ibox.left - s.x);
  if (ibox.top > s.y) img.top -= (ibox.top - s.y);

  if (ibox.left + ibox.width < s.x + s.w)
    img.left += (s.x + s.w) - (ibox.left + ibox.width);

  if (ibox.top + ibox.height < s.y + s.h)
    img.top += (s.y + s.h) - (ibox.top + ibox.height);

  canvas.renderAll();
}



function updateSvgLogoColor(color) {
  // SVG 안의 style 태그 찾기
  const styleTag = svgOverlay.querySelector("style");
  if (!styleTag) return;

  let css = styleTag.innerHTML;

  // cls-1, cls-5 fill 규칙 강제 교체
//   css = css.replace(/\.cls-1\s*\{[^}]*\}/g, `.cls-1 { fill: ${color} !important ; }`);
//   css = css.replace(/\.cls-5\s*\{[^}]*\}/g, `.logo_line { stroke: ${color} !important; stroke-width: .28px !important;  }`);

  styleTag.innerHTML = css;


}


// ===== SVG COLOR CONTROL =====
const orPicker = document.getElementById("orPicker");

if (orPicker) {
  orPicker.addEventListener("input", (e) => {
    updateSvgLogoColor(e.target.value);
  });
}






// ===== EXPORT PNG =====
document.getElementById("exportBtn").addEventListener("click", async () => {
  // SVG를 이미지로 변환
  const svg = svgOverlay.innerHTML;
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  const svgImg = new Image();
  svgImg.onload = () => {
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = EXPORT_W;
    tempCanvas.height = EXPORT_H;
    const ctx = tempCanvas.getContext("2d");

    // 1️⃣ fabric 캔버스
    ctx.drawImage(canvas.lowerCanvasEl, 0, 0);

    // 2️⃣ SVG 프레임
    ctx.drawImage(svgImg, 0, 0, EXPORT_W, EXPORT_H);

    // 다운로드
    const link = document.createElement("a");
    link.download = "photo_frame.png";
    link.href = tempCanvas.toDataURL("image/png");
    link.click();

    URL.revokeObjectURL(svgUrl);
  };
  svgImg.src = svgUrl;
});



const layoutSelect = document.getElementById("layoutSelect");

if (layoutSelect) {
  layoutSelect.addEventListener("change", (e) => {
    applyLayout(e.target.value);
  });
}

async function applyLayout(layoutKey) {
  const layout = layouts[layoutKey];
  if (!layout) return;

  // 1️⃣ SVG 교체
  await loadSVGOverlay(layout.svg);

  // 2️⃣ canvas 완전 초기화
  canvas.clear();
  canvas.setBackgroundColor("#111", canvas.renderAll.bind(canvas));

  // 3️⃣ 슬롯 상태 초기화
  slots.length = 0;
  layout.slots.forEach(s => slots.push({ ...s }));

  // 4️⃣ 이미지 상태 초기화
  slotImages = {};
  activeSlotIndex = null;

  if (orPicker) {
    updateSvgLogoColor(orPicker.value);
  }

  canvas.renderAll();
}




// ===============================
// INIT
// ===============================
(async function init() {
  const initialLayout =
    (layoutSelect && layoutSelect.value) || "layout1";
  await applyLayout(initialLayout);
})();
