/**
 * HGhub:给安卓端加两个播放手势 ——
 *   1) 双击画面快进 10 秒(想改成 5 秒就把下面的 SEEK_STEP 改成 5);
 *   2) 双指放大画面(1x ~ 3.5x),换集/换片自动复位。
 *
 * 用法(在仓库根目录执行):
 *   node feat-android-gestures.mjs
 *
 * 逐条做「锚点替换」,每一步都要求锚点在文件里恰好出现一次;
 * 任何一步对不上就整体中止、不写文件,并在终端指明是哪一步。
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILE = process.env.HGHUB_FILE || "src/components/Feed.tsx";
let src = readFileSync(FILE, "utf8");
const crlf = src.includes("\r\n");
if (crlf) src = src.replace(/\r\n/g, "\n");
const before = src;

function replaceOnce(name, from, to) {
  const parts = src.split(from);
  if (parts.length !== 2) {
    throw new Error(`[${name}] 锚点应出现 1 次,实际 ${parts.length - 1} 次,已中止(未写入任何改动)`);
  }
  src = parts.join(to);
}

/* —— 1. 快进步长常量 —— */
replaceOnce(
  "1 SEEK_STEP",
  "const RATES = [1, 1.25, 1.5, 2];",
  "const RATES = [1, 1.25, 1.5, 2];\n/** 双击快进的秒数:想用 5 秒就把这里改成 5 */\nconst SEEK_STEP = 10;",
);

/* —— 2. 双击 / 捏合需要的状态与 refs,以及两个小工具 —— */
replaceOnce(
  "2 refs",
  "  const holdRef = useRef(false);\n  const lockArmedRef = useRef(false);\n",
  "  const holdRef = useRef(false);\n  const lockArmedRef = useRef(false);\n" +
    "  /* —— 双击快进 / 双指放大 —— */\n" +
    "  const [seekHint, setSeekHint] = useState<{ dir: number; n: number; key: number } | null>(null);\n" +
    "  const hintTimer = useRef<number | undefined>(undefined);\n" +
    "  const [zoom, setZoom] = useState(1);\n" +
    "  const doubleTap = useRef<{ t: number; x: number; y: number; timer: number | null }>({ t: 0, x: 0, y: 0, timer: null });\n" +
    "  const pointers = useRef(new Map<number, { x: number; y: number }>());\n" +
    "  const pinch = useRef<{ dist: number; zoom: number } | null>(null);\n" +
    "  /** 撤掉还没兑现的那次单击(双击、横拖、上滑时用) */\n" +
    "  const cancelPendingTap = () => {\n" +
    "    const d = doubleTap.current;\n" +
    "    if (d.timer) { window.clearTimeout(d.timer); doubleTap.current = { t: 0, x: 0, y: 0, timer: null }; }\n" +
    "  };\n" +
    "  /** 双击快进/快退:夹在 0 与片尾前 0.2 秒之间,并弹一下提示 */\n" +
    "  const seekBy = (delta: number) => {\n" +
    "    const d = duration || 0;\n" +
    "    const t = Math.max(0, d > 0 ? Math.min(d - 0.2, time + delta) : time + delta);\n" +
    "    videoRef.current?.seek(t);\n" +
    "    setTime(t);\n" +
    "    setSeekHint({ dir: delta >= 0 ? 1 : -1, n: Math.abs(delta), key: Date.now() });\n" +
    "    window.clearTimeout(hintTimer.current);\n" +
    "    hintTimer.current = window.setTimeout(() => setSeekHint(null), 700);\n" +
    "  };\n",
);

/* —— 3. 第二根手指落下:放弃长按/横拖,进入捏合 —— */
replaceOnce(
  "3 onDown",
  "    idleAtDown.current = idle;\n    wake();\n    const el = e.currentTarget;\n",
  "    idleAtDown.current = idle;\n    wake();\n" +
    "    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });\n" +
    "    if (pointers.current.size === 2) {\n" +
    "      /* 双指:放弃长按/横拖,改走「双指放大」 */\n" +
    "      if (gesture.current?.timer) window.clearTimeout(gesture.current.timer);\n" +
    "      gesture.current = null;\n" +
    "      holdRef.current = false;\n" +
    "      setHoldSpeed(false);\n" +
    "      setLockArmed(false);\n" +
    "      lockArmedRef.current = false;\n" +
    "      cancelPendingTap();\n" +
    "      const pts = [...pointers.current.values()];\n" +
    "      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;\n" +
    "      pinch.current = { dist, zoom };\n" +
    "      return;\n" +
    "    }\n" +
    "    const el = e.currentTarget;\n",
);

/* —— 4. 双指移动:按两指间距缩放画面 —— */
replaceOnce(
  "4 onMove",
  "  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {\n    const g = gesture.current;\n    if (!g || isDesktop) return;\n",
  "  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {\n" +
    "    if (isDesktop) return;\n" +
    "    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });\n" +
    "    const pin = pinch.current;\n" +
    "    if (pin && pointers.current.size >= 2) {\n" +
    "      /* 双指放大:1x ~ 3.5x,以画面中心为基准 */\n" +
    "      const pts = [...pointers.current.values()];\n" +
    "      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;\n" +
    "      setZoom(Math.max(1, Math.min(3.5, (pin.zoom * dist) / pin.dist)));\n" +
    "      return;\n" +
    "    }\n" +
    "    const g = gesture.current;\n" +
    "    if (!g) return;\n",
);

/* —— 5. 横拖开始时,别让上一次单击的暂停迟到 —— */
replaceOnce(
  "5 scrub-cancel",
  "      if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy)) {\n        if (g.timer) window.clearTimeout(g.timer);\n        g.mode = \"scrub\";\n",
  "      if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy)) {\n        if (g.timer) window.clearTimeout(g.timer);\n        cancelPendingTap();\n        g.mode = \"scrub\";\n",
);

/* —— 6. 上滑翻页时同理 —— */
replaceOnce(
  "6 swipe-cancel",
  "      } else if (Math.abs(dy) > 14) {\n        if (g.timer) window.clearTimeout(g.timer);\n      }\n",
  "      } else if (Math.abs(dy) > 14) {\n        if (g.timer) window.clearTimeout(g.timer);\n        cancelPendingTap();\n      }\n",
);

/* —— 7. 抬手:先收掉捏合,再处理单击/双击 —— */
replaceOnce(
  "7 onUp-head",
  "  const onUp = () => {\n    const g = gesture.current;\n    gesture.current = null;\n    if (!g) return;\n    if (g.timer) window.clearTimeout(g.timer);\n",
  "  const onUp = (e?: React.PointerEvent<HTMLDivElement>) => {\n" +
    "    if (e) pointers.current.delete(e.pointerId);\n" +
    "    if (pinch.current) {\n" +
    "      /* 双指缩放结束:不改播放状态,也不算单击 */\n" +
    "      if (pointers.current.size < 2) pinch.current = null;\n" +
    "      return;\n" +
    "    }\n" +
    "    const g = gesture.current;\n" +
    "    gesture.current = null;\n" +
    "    if (!g) return;\n" +
    "    if (g.timer) window.clearTimeout(g.timer);\n",
);

/* —— 8. 单击延时 300ms 兑现:期间来的第二下就是「双击快进」 —— */
replaceOnce(
  "8 double-tap",
  "      if (!isDesktop && fs && idleAtDown.current) { wake(); return; }\n      videoRef.current?.toggle();\n",
  "      if (!isDesktop && fs && idleAtDown.current) { wake(); return; }\n" +
    "      /* 双击快进:320ms 内、落点相近的第二下 → 快进 SEEK_STEP 秒,并吃掉这一下单击 */\n" +
    "      const now = Date.now();\n" +
    "      const prev = doubleTap.current;\n" +
    "      const near = Math.abs(g.x - prev.x) < 96 && Math.abs(g.y - prev.y) < 96;\n" +
    "      if (prev.timer && now - prev.t < 320 && near) {\n" +
    "        cancelPendingTap();\n" +
    "        seekBy(SEEK_STEP);\n" +
    "        return;\n" +
    "      }\n" +
    "      doubleTap.current = {\n" +
    "        t: now, x: g.x, y: g.y,\n" +
    "        timer: window.setTimeout(() => {\n" +
    "          doubleTap.current = { t: 0, x: 0, y: 0, timer: null };\n" +
    "          videoRef.current?.toggle();\n" +
    "        }, 300) as unknown as number,\n" +
    "      };\n",
);

/* —— 9. 捏合期间不要让列表把触摸吃去滚动 —— */
replaceOnce(
  "9 touchmove",
  "    const fn = (e: TouchEvent) => { if (holdRef.current) e.preventDefault(); };",
  "    const fn = (e: TouchEvent) => { if (holdRef.current || pinch.current) e.preventDefault(); };",
);

/* —— 10. 画面套上缩放变换 —— */
replaceOnce(
  "10 zoom-transform",
  '                <div className="absolute inset-0" style={{ touchAction: "pan-y" }}\n                  onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>\n',
  '                <div className="absolute inset-0"\n' +
    '                  style={{ touchAction: "pan-y", transform: zoom > 1 ? `scale(${zoom})` : undefined }}\n' +
    "                  onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>\n",
);

/* —— 11. 换集/换片时把放大复位 —— */
replaceOnce(
  "11 reset-zoom",
  "    setVsize({ w: 0, h: 0 });\n  }, [playKey]);",
  "    setVsize({ w: 0, h: 0 });\n" +
    "    /* 换集/换片:把双指放大复位 */\n" +
    "    setZoom(1); pinch.current = null; pointers.current.clear();\n" +
    "  }, [playKey]);",
);

/* —— 12. 双击快进的浮层提示 —— */
replaceOnce(
  "12 seek-hint-ui",
  "              {/* 横拖定位浮层 */}\n",
  "              {/* 双击快进提示 */}\n" +
    "              {!isDesktop && seekHint && (\n" +
    '                <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">\n' +
    "                  <span key={seekHint.key}\n" +
    '                    className="px-4 h-10 rounded-full flex items-center gap-1 backdrop-blur-md hg-chip-strong text-[13.5px] font-bold hg-ink-2 tabular-nums">\n' +
    '                    {seekHint.dir > 0 ? "快进" : "快退"} {seekHint.n} 秒\n' +
    "                  </span>\n" +
    "                </div>\n" +
    "              )}\n" +
    "\n" +
    "              {/* 横拖定位浮层 */}\n",
);

if (src === before) throw new Error("没有产生任何改动,已中止");
writeFileSync(FILE, crlf ? src.replace(/\n/g, "\r\n") : src, "utf8");

const added = src.split("\n").length - before.split("\n").length;
console.log(`已修改 ${FILE}(净增 ${added} 行),共 12 处。`);
console.log("跑一次 `git diff src/components/Feed.tsx` 看改动。");
