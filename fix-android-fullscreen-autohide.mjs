/**
 * HGhub:修复安卓 App 沉浸全屏时播放条(进度条 + 底部控制栏 + 退出全屏按钮)不会自动隐藏。
 *
 * 用法(在仓库根目录执行):
 *   node fix-android-fullscreen-autohide.mjs
 *
 * 脚本逐条做「锚点替换」,每一步都要求锚点在文件里恰好出现一次;
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

/* —— 1. 闲置计时器:安卓在沉浸全屏里也接管 —— */
{
  const lines = src.split("\n");
  const i = lines.findIndex((l) => l.includes("const [idle, setIdle] = useState(false);"));
  if (i < 1) throw new Error("[1] 找不到 idle 状态声明,已中止");
  let end = -1;
  for (let k = i + 1; k < lines.length; k += 1) {
    if (lines[k].trim() === "}, [paused]);") { end = k; break; }
  }
  if (end < 0) throw new Error("[1] 找不到 idle 计时 effect 的结尾,已中止");
  const block = [
    "  /* 播放器 UI 闲置自动隐藏:桌面跟随鼠标;安卓在沉浸全屏里隐藏播放条(点一下画面唤回) */",
    "  const [idle, setIdle] = useState(false);",
    "  const idleTimer = useRef<number | undefined>(undefined);",
    "  const idleAtDown = useRef(false);",
    "  const wake = useCallback(() => {",
    "    setIdle(false);",
    "    window.clearTimeout(idleTimer.current);",
    "    idleTimer.current = window.setTimeout(() => setIdle(true), 2800);",
    "  }, []);",
    "  useEffect(() => {",
    "    /* 安卓普通竖屏模式不接管:底部信息栏要常驻;只有沉浸全屏(fs)才自动隐藏播放条 */",
    "    if (!isDesktop && !fs) { setIdle(false); window.clearTimeout(idleTimer.current); return undefined; }",
    "    wake();",
    "    return () => window.clearTimeout(idleTimer.current);",
    "  }, [isDesktop, fs, wake]);",
    "  useEffect(() => {",
    "    if (paused) { setIdle(false); window.clearTimeout(idleTimer.current); }",
    "    else if (!isDesktop && fs) wake();",
    "  }, [paused, isDesktop, fs, wake]);",
  ];
  lines.splice(i - 1, end - (i - 1) + 1, ...block);
  src = lines.join("\n");
}

/* —— 2. 播放器根节点:is-idle 不再只给桌面;并在触摸按下时唤回 —— */
replaceOnce(
  "2a is-idle",
  '${isDesktop && idle ? "is-idle" : ""}',
  '${idle ? "is-idle" : ""}',
);
replaceOnce(
  "2b onPointerDown",
  "onPointerMove={() => { if (isDesktop) wake(); }}>",
  "onPointerMove={() => { if (isDesktop) wake(); }}\n      onPointerDown={() => { if (!isDesktop) wake(); }}>",
);

/* —— 3. 手势按下:记录「按下前播放条是否已隐藏」并计时复位 —— */
replaceOnce(
  "3 onDown",
  "    if (isDesktop) return;\n    const el = e.currentTarget;",
  "    if (isDesktop) return;\n    /* 记下按下前播放条是否已隐藏:隐藏时第一下只负责唤回,不顺手暂停 */\n    idleAtDown.current = idle;\n    wake();\n    const el = e.currentTarget;",
);

/* —— 4. 单击:播放条隐藏时,第一下只唤回,不改播放状态 —— */
replaceOnce(
  "4 onUp",
  "    if (Date.now() - g.t < 260) videoRef.current?.toggle();",
  "    if (Date.now() - g.t < 260) {\n      /* 沉浸全屏里播放条正隐藏着:这一下只把它唤回来,不改播放状态 */\n      if (!isDesktop && fs && idleAtDown.current) { wake(); return; }\n      videoRef.current?.toggle();\n    }",
);

/* —— 5. 拖进度条时持续保活,免得拖到一半自己淡掉 —— */
replaceOnce(
  "5a onBarDown",
  "  const onBarDown = (e: React.PointerEvent<HTMLDivElement>) => {\n    e.stopPropagation();",
  "  const onBarDown = (e: React.PointerEvent<HTMLDivElement>) => {\n    e.stopPropagation();\n    wake();",
);
replaceOnce(
  "5b onBarMove",
  "    if (!barScrub.current) return;\n    e.stopPropagation();",
  "    if (!barScrub.current) return;\n    wake();\n    e.stopPropagation();",
);

/* —— 6. 全屏进度条随闲置淡出 —— */
replaceOnce(
  "6 fs seekbar",
  '<div className="absolute inset-x-0 z-30 px-4" style={{ bottom: "calc(var(--sab, 0px) + 52px)", height: 22 }}>',
  '<div className={`absolute inset-x-0 z-30 px-4 transition-opacity duration-300 ${idle ? "opacity-0 pointer-events-none" : "opacity-100"}`}\n          style={{ bottom: "calc(var(--sab, 0px) + 52px)", height: 22 }}>',
);

/* —— 7. 退出全屏按钮随闲置淡出 —— */
replaceOnce(
  "7 exit button",
  'className="hg-chip-strong absolute right-3 z-40 w-9 h-9 rounded-full backdrop-blur-md flex items-center justify-center pressable elev-1"',
  'className={`hg-chip-strong absolute right-3 z-40 w-9 h-9 rounded-full backdrop-blur-md flex items-center justify-center pressable elev-1 transition-opacity duration-300 ${idle ? "opacity-0 pointer-events-none" : "opacity-100"}`}',
);

/* —— 8. 底部播放条(播放/暂停、时间、倍速)随闲置淡出 —— */
replaceOnce(
  "8 bottom bar",
  '<div className="absolute inset-x-0 z-40 flex items-center gap-3 px-4"',
  '<div className={`absolute inset-x-0 z-40 flex items-center gap-3 px-4 transition-opacity duration-300 ${idle ? "opacity-0 pointer-events-none" : "opacity-100"}`}',
);

if (src === before) throw new Error("没有产生任何改动,已中止");
writeFileSync(FILE, crlf ? src.replace(/\n/g, "\r\n") : src, "utf8");

const changed = src.split("\n").length - before.split("\n").length;
console.log(`已修改 ${FILE}(净增 ${changed} 行),共 8 处。`);
console.log("跑一次 `git diff src/components/Feed.tsx` 看改动,再 pnpm android:dev 验证。");
