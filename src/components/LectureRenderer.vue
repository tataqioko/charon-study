<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from "vue";
import MarkdownIt from "markdown-it";
import katex from "katex";
import "katex/dist/katex.min.css";
import mermaid from "mermaid";

const props = defineProps<{
  content: string;
  scale?: number;
  streaming?: boolean;
  highlights?: { id: number; anchor_text: string | null; color: string; hl_start: number | null; hl_end: number | null }[];
}>();
const emit = defineEmits<{
  select: [payload: { text: string; start: number; end: number; x: number; y: number }];
  removeHighlight: [id: number];
}>();
const html = ref("");
const container = ref<HTMLElement | null>(null);

mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose" });

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

// 有些模型会把整篇讲义包进 ```markdown ... ``` 代码围栏,去掉最外层。
// 也处理流式未收尾(只有开头 ``` 还没结尾)的情况。
function stripOuterFence(text: string): string {
  let t = text.trim();
  const closed = t.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  if (closed) return closed[1];
  // 流式中:以 ``` 开头但还没结尾,先剥开头那行
  if (/^```(?:markdown|md)?\s*\n/i.test(t)) {
    t = t.replace(/^```(?:markdown|md)?\s*\n/i, "");
    // 若结尾已出现收尾 ```,也去掉
    t = t.replace(/\n```\s*$/i, "");
  }
  return t;
}

// 渲染 KaTeX:$$...$$ 块级 与 $...$ 行内
function renderMath(text: string): string {
  // 块级 $$...$$
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_m, expr) => {
    try {
      return katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false });
    } catch {
      return _m;
    }
  });
  // 行内 $...$(避免匹配到货币)
  text = text.replace(/(?<!\$)\$(?!\$)([^\n$]+?)\$(?!\$)/g, (_m, expr) => {
    try {
      return katex.renderToString(expr.trim(), { displayMode: false, throwOnError: false });
    } catch {
      return _m;
    }
  });
  return text;
}

// 提取 mermaid 代码块,渲染后回填
async function renderMermaid() {
  await nextTick();
  if (!container.value) return;
  const blocks = container.value.querySelectorAll("code.language-mermaid");
  let i = 0;
  for (const block of Array.from(blocks)) {
    const code = block.textContent ?? "";
    try {
      const { svg } = await mermaid.render(`mmd-${Date.now()}-${i++}`, code);
      const wrap = document.createElement("div");
      wrap.className = "my-4 flex justify-center";
      wrap.innerHTML = svg;
      block.closest("pre")?.replaceWith(wrap);
    } catch {
      /* 保留原始代码块 */
    }
  }
}

function render() {
  const cleaned = stripOuterFence(props.content ?? "");
  const withMath = renderMath(cleaned);
  html.value = md.render(withMath);
  // 流式过程中跳过 Mermaid 异步渲染(否则每次重建都重跑,导致页面上下抽动)
  if (!props.streaming) {
    renderMermaid();
    applyHighlights();
  }
}

// 高亮配色(半透明荧光 + 深色字,明暗两种模式都清晰)
const HL_COLORS: Record<string, string> = {
  amber: "background:rgba(251,191,36,.55)",
  green: "background:rgba(134,239,172,.6)",
  blue: "background:rgba(147,197,253,.6)",
  pink: "background:rgba(249,168,212,.6)",
};
function markStyle(color: string): string {
  return `${HL_COLORS[color] ?? HL_COLORS.amber};color:#1a1a1a;border-radius:2px;padding:0 1px;cursor:pointer`;
}

// 只统计"正文可读文字",跳过公式(katex)、图表(svg)、代码块,保证偏移量稳定
function makeTextWalker(root: HTMLElement): TreeWalker {
  return document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const el = (node as Text).parentElement;
      if (el?.closest(".katex, svg, pre")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
}

// 计算 DOM 里某个位置(node,offset)相对于正文纯文本的绝对字符偏移;失败返回 -1
function absOffset(root: HTMLElement, node: Node, offset: number): number {
  if (node.nodeType !== Node.TEXT_NODE) return -1; // 只处理落在文字节点内的选区端点
  const walker = makeTextWalker(root);
  let acc = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n === node) return acc + offset;
    acc += (n.textContent ?? "").length;
  }
  return -1;
}

// 先清掉所有 <mark>,把 DOM 还原成无高亮的干净状态(不重建 innerHTML,故无闪烁)
function clearMarks() {
  if (!container.value) return;
  const marks = Array.from(container.value.querySelectorAll("mark[data-hl]"));
  for (const m of marks) {
    const parent = m.parentNode;
    if (!parent) continue;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize(); // 合并相邻文字节点,恢复偏移连续
  }
}

// 按字符偏移把高亮套回正文;兼容旧数据(无偏移则回退到文字匹配)
async function applyHighlights() {
  await nextTick();
  if (!container.value || !props.highlights?.length) return;
  const withOffset = props.highlights.filter((h) => h.hl_start != null && h.hl_end != null);
  const legacy = props.highlights.filter((h) => h.hl_start == null || h.hl_end == null);

  // 快照文字节点及其绝对起点(后续包裹会拆分节点,先记录再处理)
  const snap: { node: Text; start: number }[] = [];
  const walker = makeTextWalker(container.value);
  let acc = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n as Text;
    snap.push({ node: t, start: acc });
    acc += (t.textContent ?? "").length;
  }

  // 对每个原始文字节点,算出落在其中的高亮片段并包裹(从右往左,避免偏移错位)
  for (const { node, start } of snap) {
    const len = (node.textContent ?? "").length;
    const end = start + len;
    const segs: { s: number; e: number; color: string; id: number }[] = [];
    for (const h of withOffset) {
      const s = Math.max(h.hl_start!, start);
      const e = Math.min(h.hl_end!, end);
      if (s < e) {
        // 只有该片段在此节点内的文字非空白才包裹(避免旧数据的换行符高亮产生空行)
        const segText = (node.textContent ?? "").slice(s - start, e - start);
        if (segText.trim()) {
          segs.push({ s: s - start, e: e - start, color: h.color, id: h.id });
        }
      }
    }
    if (!segs.length) continue;
    segs.sort((a, b) => b.s - a.s);
    for (const seg of segs) {
      try {
        const range = document.createRange();
        range.setStart(node, seg.s);
        range.setEnd(node, seg.e);
        const mark = document.createElement("mark");
        mark.setAttribute("data-hl", String(seg.id));
        mark.setAttribute("style", markStyle(seg.color));
        range.surroundContents(mark);
      } catch { /* 该片段跨界,忽略 */ }
    }
  }

  // 旧数据(无偏移):仍按文字匹配,并打上 data-hl 使其也可点击擦除
  for (const h of legacy) {
    const text = (h.anchor_text ?? "").trim();
    if (text) highlightTextInNode(container.value, text, h.color, h.id);
  }
}

// 旧数据兜底:纯文本匹配包裹(带 data-hl,可点击擦除)
function highlightTextInNode(root: HTMLElement, text: string, color: string, id: number) {
  const walker = makeTextWalker(root);
  const targets: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const tn = n as Text;
    if (tn.parentElement?.closest("mark")) continue;
    if (tn.textContent && tn.textContent.includes(text)) targets.push(tn);
  }
  for (const tn of targets) {
    const idx = tn.textContent!.indexOf(text);
    if (idx < 0) continue;
    try {
      const range = document.createRange();
      range.setStart(tn, idx);
      range.setEnd(tn, idx + text.length);
      const mark = document.createElement("mark");
      mark.setAttribute("data-hl", String(id));
      mark.setAttribute("style", markStyle(color));
      range.surroundContents(mark);
    } catch { /* 跨节点忽略 */ }
  }
}

// 划词选择:算出字符偏移,冒泡给父组件弹菜单(支持单字、支持在高亮上选区)
function onMouseUp() {
  const sel = window.getSelection();
  const text = sel?.toString() ?? "";
  if (!text.trim() || !sel || sel.rangeCount === 0 || !container.value) return;
  const range = sel.getRangeAt(0);
  const start = absOffset(container.value, range.startContainer, range.startOffset);
  const end = absOffset(container.value, range.endContainer, range.endOffset);
  const rect = range.getBoundingClientRect();
  emit("select", {
    text, start: Math.min(start, end), end: Math.max(start, end),
    x: rect.left + rect.width / 2, y: rect.top,
  });
}

watch(() => props.content, render);
// 高亮增删:只清 mark + 重新套用(不重建 HTML、不重跑 Mermaid),实时无闪烁
watch(() => props.highlights, () => {
  if (props.streaming) return;
  clearMarks();
  applyHighlights();
}, { deep: true });
// 流式结束时补一次完整渲染(含图表)
watch(() => props.streaming, (now) => {
  if (!now) render();
});
onMounted(render);
</script>

<template>
  <article
    ref="container"
    class="lecture-body max-w-none"
    :style="{ fontSize: (15 * (scale ?? 100) / 100) + 'px' }"
    v-html="html"
    @mouseup="onMouseUp"
  />
</template>

<style>
/* 讲义排版:清爽、可读,呼应极简风。字号由 article 行内 font-size 控制,子元素用 em 等比缩放 */
.lecture-body { line-height: 1.85; color: var(--foreground); }
.lecture-body h1 { font-size: 1.7em; font-weight: 700; margin: 0 0 1em; letter-spacing: -0.02em; }
.lecture-body h2 { font-size: 1.25em; font-weight: 600; margin: 1.8em 0 0.8em; padding-bottom: 0.3em; border-bottom: 1px solid var(--border); }
.lecture-body h3 { font-size: 1.05em; font-weight: 600; margin: 1.2em 0 0.5em; }
.lecture-body p { margin: 0.7em 0; }
.lecture-body strong { color: var(--primary); font-weight: 600; }
.lecture-body ul, .lecture-body ol { margin: 0.7em 0; padding-left: 1.4em; }
.lecture-body li { margin: 0.35em 0; }
.lecture-body blockquote { border-left: 3px solid var(--primary); background: var(--muted); padding: 0.6em 1em; margin: 1em 0; border-radius: 0 0.5em 0.5em 0; }
.lecture-body code { background: var(--muted); padding: 0.1em 0.35em; border-radius: 0.3em; font-size: 0.9em; }
.lecture-body pre { background: var(--muted); padding: 1em; border-radius: 0.6em; overflow-x: auto; margin: 1em 0; }
.lecture-body pre code { background: none; padding: 0; }
.lecture-body table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 0.92em; }
.lecture-body th, .lecture-body td { border: 1px solid var(--border); padding: 0.5em 0.8em; text-align: left; }
.lecture-body th { background: var(--muted); font-weight: 600; }
.lecture-body hr { border: none; border-top: 1px solid var(--border); margin: 1.5em 0; }
</style>
