/*
 * 内容时效条 (Shixiao Bar)
 * 数据层：正文里的一行纯文本  > [!时效] (时效起:: 2026-09-01) (时效止:: 2026-09-30) (时效状态:: 现行)
 * 显示层：渲染成干净的徽标（图标 + 日期范围 + 状态胶囊，按状态配色），不显示任何字段语法
 * 交互：点击徽标 → 弹窗（两个日历选择器 + 状态下拉），保存即写回原文该行
 * 命令：「插入时效条」→ 同样的弹窗，在光标处插入一条
 */
const { Plugin, Modal, Setting, Notice } = require("obsidian");
const { ViewPlugin, Decoration, WidgetType } = require("@codemirror/view");
const { RangeSetBuilder, EditorSelection } = require("@codemirror/state");

const LINE_RE = /^>\s*\[!时效\]\s*\(时效起::\s*(\d{4}-\d{2}-\d{2})\s*\)\s*\(时效止::\s*(\d{4}-\d{2}-\d{2})\s*\)\s*\(时效状态::\s*([^()]*)\s*\)\s*$/;
const TEXT_RE = /^\(时效起::\s*(\d{4}-\d{2}-\d{2})\s*\)\s*\(时效止::\s*(\d{4}-\d{2}-\d{2})\s*\)\s*\(时效状态::\s*([^()]*)\s*\)\s*$/;

const STATUS_CLASS = {
  // 英文状态（推荐）
  "NONE": "shixiao-none",
  "IN PROGRESS": "shixiao-in-progress",
  "DONE": "shixiao-done",
  "DROPPED": "shixiao-dropped",
  "EXPIRED": "shixiao-expired",
  // 中文状态（旧数据兼容）
  "现行": "shixiao-in-progress",
  "过期": "shixiao-expired",
  "失效": "shixiao-dropped",
};

function todayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function buildLine(v) {
  return `> [!时效] (时效起:: ${v.start}) (时效止:: ${v.end}) (时效状态:: ${v.status})`;
}

/* ---------- 弹窗：日历 + 状态下拉 ---------- */
class ShixiaoModal extends Modal {
  constructor(app, init, onSubmit) {
    super(app);
    this.value = { ...init };
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("shixiao-modal");
    contentEl.createEl("h3", { text: "时效条" });

    const submit = () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(this.value.start) || !/^\d{4}-\d{2}-\d{2}$/.test(this.value.end)) {
        new Notice("请在日历里选择起止日期");
        return;
      }
      this.close();
      this.onSubmit(this.value);
    };

    // 起止日期并排两列
    const datesRow = contentEl.createDiv({ cls: "shixiao-dates-row" });
    const startField = datesRow.createDiv({ cls: "shixiao-date-field" });
    startField.createEl("label", { text: "生效开始" });
    const startInput = startField.createEl("input", { type: "date", value: this.value.start });
    startInput.addEventListener("change", (e) => (this.value.start = e.target.value));

    const endField = datesRow.createDiv({ cls: "shixiao-date-field" });
    endField.createEl("label", { text: "生效结束" });
    const endInput = endField.createEl("input", { type: "date", value: this.value.end });
    endInput.addEventListener("change", (e) => (this.value.end = e.target.value));

    // 状态下拉
    let statusSelect;
    new Setting(contentEl).setName("状态").addDropdown((d) => {
      ["NONE", "IN PROGRESS", "DONE", "DROPPED", "EXPIRED"].forEach((s) => d.addOption(s, s));
      d.setValue(this.value.status);
      d.onChange((v) => (this.value.status = v));
      statusSelect = d.selectEl;
    });

    // 按钮
    const saveBtn = new Setting(contentEl)
      .addButton((b) => b.setButtonText("保存").setCta().onClick(submit))
      .addButton((b) => b.setButtonText("取消").onClick(() => this.close()));

    // 键盘导航：输入完开始 → 回车到结束；结束 → 回车到状态；状态 → 回车保存
    // 注意：不用 ArrowRight，因为日期输入框内部需要用方向键切换 年/月/日。
    const moveOnEnter = (input, next) => {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          next.focus();
        }
      });
    };
    moveOnEnter(startInput, endInput);
    moveOnEnter(endInput, statusSelect);
    statusSelect.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });

    // 弹窗打开自动聚焦到开始日期
    setTimeout(() => startInput.focus(), 10);
  }
  onClose() {
    this.contentEl.empty();
  }
}

/* ---------- 徽标 DOM ---------- */
function buildBadge(v, onClick) {
  const status = v.status || "未指定";
  const badge = document.createElement("span");
  badge.addClass("shixiao-badge", STATUS_CLASS[v.status] || "shixiao-current");
  badge.setAttr("role", "button");
  badge.createSpan({ cls: "shixiao-icon", text: "🕓" });
  badge.createSpan({ cls: "shixiao-range", text: `${v.start} ~ ${v.end}` });
  badge.createSpan({ cls: "shixiao-status", text: status });
  badge.createSpan({ cls: "shixiao-hint", text: "点击修改" });
  badge.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return badge;
}

/* ---------- 阅读模式 callout 解析 ---------- */
function parseCalloutValue(callout) {
  // 尝试 1：Dataview 渲染后的 inline-field DOM
  const keys = Array.from(callout.querySelectorAll(".inline-field-key")).map((k) => k.textContent.trim());
  const vals = Array.from(callout.querySelectorAll(".inline-field-value")).map((v) => v.textContent.trim());
  if (keys.length === vals.length && keys.length >= 3) {
    const map = {};
    keys.forEach((k, i) => (map[k] = vals[i]));
    if (/^\d{4}-\d{2}-\d{2}$/.test(map["时效起"]) && /^\d{4}-\d{2}-\d{2}$/.test(map["时效止"])) {
      return { start: map["时效起"], end: map["时效止"], status: map["时效状态"] || "" };
    }
  }

  // 尝试 2：原始文本（Dataview 关闭时）
  const text = callout.textContent && callout.textContent.trim();
  const m = text && text.match(TEXT_RE);
  if (m) return { start: m[1], end: m[2], status: m[3] || "" };

  return null;
}

/* ---------- 实时预览（Live Preview）的 CodeMirror 部件 ---------- */
class ShixiaoWidget extends WidgetType {
  constructor(value, from, to, plugin) {
    super();
    this.value = value;
    this.from = from;
    this.to = to;
    this.plugin = plugin;
  }
  eq(other) {
    return other.from === this.from && JSON.stringify(other.value) === JSON.stringify(this.value);
  }
  toDOM() {
    try {
      return buildBadge(this.value, () => {
        new ShixiaoModal(this.plugin.app, this.value, (nv) => {
          const view = this.plugin.getActiveEditorView();
          if (!view) return;
          view.dispatch({ changes: { from: this.from, to: this.to, insert: buildLine(nv) } });
        }).open();
      });
    } catch (e) {
      // 徽标渲染失败时显示纯文本，绝不留空行
      console.error("[shixiao] 徽标渲染失败，已回退为纯文本", e);
      const s = document.createElement("span");
      s.textContent = `时效 ${this.value.start} ~ ${this.value.end} ｜ ${this.value.status}`;
      return s;
    }
  }
  ignoreEvent() {
    return true;
  }
}

function buildLivePreviewPlugin(plugin) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = this.build(view);
      }
      update(u) {
        if (u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = this.build(u.view);
      }
      build(view) {
        const builder = new RangeSetBuilder();
        let matched = 0, skipped = 0;
        try {
          const sel = view.state.selection.main;
          for (const vr of view.visibleRanges) {
            for (let pos = vr.from; pos <= vr.to; ) {
              const line = view.state.doc.lineAt(pos);
              pos = line.to + 1;
              const m = line.text.match(LINE_RE);
              if (!m) continue;
              if (sel.from <= line.to && sel.to >= line.from) {
                skipped++;
                continue; // 光标在这一行时显示原文，方便手改
              }
              matched++;
              builder.add(
                line.from,
                line.to,
                Decoration.replace({
                  widget: new ShixiaoWidget({ start: m[1], end: m[2], status: m[3] }, line.from, line.to, plugin),
                })
              );
            }
          }
        } catch (e) {
          console.error("[shixiao] 实时预览装饰失败，已回退为原文", e);
        }
        console.log("[shixiao] live preview matched=", matched, "skipped(cursor)=", skipped);
        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations }
  );
}

/* ---------- 主插件 ---------- */
module.exports = class ShixiaoBarPlugin extends Plugin {
  onload() {
    this.registerEditorExtension(buildLivePreviewPlugin(this));

    // 阅读模式：把原始语法行替换成徽标
    // Dataview 会把 inline field 渲染成自己的 DOM，导致 TEXT_RE 匹配 textContent 失败；
    // 同时 ctx.getSectionInfo(callout) 在某些 Obsidian 版本/主题下会返回 null。
    // 因此这里直接解析 callout 的 DOM：先尝试 Dataview 的 .inline-field 结构，再回退到原始文本。
    this.registerMarkdownPostProcessor((el, ctx) => {
      const callouts = Array.from(el.querySelectorAll(".callout"));
      if (el.matches && el.matches(".callout")) callouts.unshift(el);

      for (const callout of callouts) {
        try {
          if (callout.getAttr("data-callout") !== "时效") continue;
          const value = parseCalloutValue(callout);
          if (!value) continue;

          const content = callout.querySelector(".callout-content") || callout;
          content.empty();
          content.appendChild(
            buildBadge(value, () => this.editFromReading(ctx, value))
          );
        } catch (e) {
          console.error("[shixiao] 阅读模式渲染失败，已回退为原文", e);
        }
      }
    });

    // 命令：插入时效条（弹日历）
    this.addCommand({
      id: "insert-shixiao-bar",
      name: "插入时效条",
      editorCallback: (editor) => {
        new ShixiaoModal(
          this.app,
          { start: todayStr(), end: todayStr(30), status: "IN PROGRESS" },
          (v) => {
            const cursor = editor.getCursor();
            editor.replaceRange(buildLine(v) + "\n", cursor);
            editor.setCursor(cursor.line + 1, 0);
          }
        ).open();
      },
    });
  }

  getActiveEditorView() {
    const md = this.app.workspace.activeEditor;
    return md && md.editor && md.editor.cm ? md.editor.cm : null;
  }

  // 阅读模式下点击徽标：定位原文行并改写
  async editFromReading(ctx, oldValue) {
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!file) return;
    new ShixiaoModal(this.app, oldValue, async (nv) => {
      const text = await this.app.vault.read(file);
      const lines = text.split("\n");
      const idx = lines.findIndex((l) => {
        const m = l.match(LINE_RE);
        return m && m[1] === oldValue.start && m[2] === oldValue.end && m[3] === oldValue.status;
      });
      if (idx === -1) {
        new Notice("没找到对应的时效条，请回到编辑模式手动修改");
        return;
      }
      lines[idx] = buildLine(nv);
      await this.app.vault.modify(file, lines.join("\n"));
    }).open();
  }
};
