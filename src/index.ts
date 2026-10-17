import {
    fetchPost,
    getActiveEditor,
    IProtyle,
    Plugin,
} from "siyuan";
import "./index.scss";

const OUTLINE_API = "/api/outline/getDocOutline";
const HEADING_NODES = '[data-type="NodeHeading"][data-node-id]';

type OutlineEntry = {
    id: string;
    depth: number;
    element: HTMLElement;
    text: string;
};

type OutlineBlock = {
    id: string;
    type?: string;
    children?: OutlineBlock[];
};

type OutlinePath = {
    id?: string;
    nodeType?: string;
    blocks?: OutlineBlock[];
    children?: OutlinePath[];
};

type ScrollDragOrigin = {
    pointerY: number;
    scrollTop: number;
    pointerId: number;
};

function readHeadingText(element: HTMLElement): string {
    // 从克隆节点提取标题文本，避免读取块操作按钮等界面内容。
    const copy = element.cloneNode(true) as HTMLElement;
    copy
        .querySelectorAll(".protyle-attr, .protyle-action, .protyle-icons")
        .forEach((node) => node.remove());
    return (copy.textContent || "")
        .replace(/\u200b|\u200c|\u200d|\ufeff/g, "")
        .trim();
}

function indexHeadings(editor: IProtyle | null | undefined): Map<string, HTMLElement> {
    const surface = editor?.wysiwyg?.element;
    if (!surface) {
        return new Map();
    }
    return new Map(
        Array.from(surface.querySelectorAll<HTMLElement>(HEADING_NODES), (element) => [
            element.dataset.nodeId,
            element,
        ]),
    );
}

function flattenOutline(
    paths: OutlinePath[] | undefined,
    elements: Map<string, HTMLElement>,
): OutlineEntry[] {
    const entries: Omit<OutlineEntry, "text">[] = [];
    // 接口返回嵌套大纲树；统一展开为文档顺序，供导航和层级缩进使用。
    const appendBlock = (block: OutlineBlock, depth: number) => {
        if (!block) {
            return;
        }
        if (block.type === "NodeHeading" && elements.has(block.id)) {
            entries.push({id: block.id, depth, element: elements.get(block.id)});
        }
        (block.children || []).forEach((child) => appendBlock(child, depth + 1));
    };
    const appendPath = (path: OutlinePath, depth: number) => {
        if (!path) {
            return;
        }
        if (path.nodeType === "NodeHeading" && elements.has(path.id)) {
            entries.push({id: path.id, depth, element: elements.get(path.id)});
        }
        (path.blocks || []).forEach((block) => appendBlock(block, depth + 1));
        (path.children || []).forEach((child) => appendPath(child, depth + 1));
    };
    (paths || []).forEach((path) => appendPath(path, 0));
    return entries.map((entry) => ({
        ...entry,
        text: readHeadingText(entry.element),
    }));
}

class OutlineCanvas {
    private onSelect: (id: string) => void;
    private emptyLabel: string;
    private currentID: string;
    private controls: Map<string, HTMLButtonElement>;
    private element: HTMLElement;
    private viewport: HTMLDivElement;
    private list: HTMLDivElement;
    private scrollTrack: HTMLDivElement;
    private scrollThumb: HTMLDivElement;
    private layoutFrame: number;
    private dragOrigin: ScrollDragOrigin | null;
    private onViewportScroll: () => void;
    private onScrollbarPointerEnd: () => void;

    constructor(onSelect: (id: string) => void, emptyLabel: string, outlineLabel: string) {
        this.onSelect = onSelect;
        this.emptyLabel = emptyLabel;
        this.currentID = "";
        this.controls = new Map();
        this.element = document.createElement("nav");
        this.element.className = "fo2";
        this.element.setAttribute("aria-label", outlineLabel);
        this.element.hidden = true;
        this.viewport = document.createElement("div");
        this.viewport.className = "fo2__viewport";
        this.list = document.createElement("div");
        this.list.className = "fo2__list";
        this.viewport.append(this.list);
        this.scrollTrack = document.createElement("div");
        this.scrollTrack.className = "fo2__scrolltrack";
        this.scrollTrack.setAttribute("aria-hidden", "true");
        this.scrollThumb = document.createElement("div");
        this.scrollThumb.className = "fo2__scrollthumb";
        this.scrollTrack.append(this.scrollThumb);
        this.element.append(this.viewport, this.scrollTrack);
        this.layoutFrame = 0;
        this.dragOrigin = null;
        this.onViewportScroll = () => this.scheduleScrollbarUpdate();
        this.onScrollbarPointerEnd = () => {
            this.dragOrigin = null;
        };
        // 鼠标悬停和键盘焦点使用同一展开状态，避免两套样式分支。
        this.element.addEventListener("pointerenter", () => this.expand(true));
        this.element.addEventListener("pointerleave", () => {
            if (!this.element.contains(document.activeElement)) {
                this.expand(false);
            }
        });
        this.element.addEventListener("focusin", () => this.expand(true));
        this.element.addEventListener("focusout", (event) => {
            if (!(event.relatedTarget instanceof Node) || !this.element.contains(event.relatedTarget)) {
                this.expand(false);
            }
        });
        this.viewport.addEventListener("scroll", this.onViewportScroll, {
            passive: true,
        });
        this.scrollTrack.addEventListener("pointerdown", (event) => this.beginScrollbarDrag(event));
        this.scrollThumb.addEventListener("pointermove", (event) => this.moveScrollbarThumb(event));
        this.scrollThumb.addEventListener("pointerup", this.onScrollbarPointerEnd);
        this.scrollThumb.addEventListener(
            "pointercancel",
            this.onScrollbarPointerEnd,
        );
        this.list.addEventListener("click", (event) => {
            const target = event.target instanceof Element ? event.target : null;
            const button = target?.closest("[data-outline-id]");
            if (button instanceof HTMLButtonElement && this.element.contains(button)) {
                this.onSelect(button.dataset.outlineId);
            }
        });
        document.body.append(this.element);
    }

    scheduleScrollbarUpdate() {
        if (this.layoutFrame) {
            return;
        }
        this.layoutFrame = window.requestAnimationFrame(() => {
            this.layoutFrame = 0;
            this.updateScrollbar();
        });
    }

    expand(open: boolean) {
        this.element.classList.toggle("fo2--open", open);
        this.scheduleScrollbarUpdate();
    }

    setEntries(entries: OutlineEntry[]) {
        const live = new Set();
        // 按块 ID 复用按钮，只在顺序变化时移动节点，减少刷新造成的布局扰动。
        entries.forEach((entry, index) => {
            live.add(entry.id);
            let button = this.controls.get(entry.id);
            if (!button) {
                button = document.createElement("button");
                button.type = "button";
                button.className = "fo2__row";
                button.dataset.outlineId = entry.id;
                const label = document.createElement("span");
                label.className = "fo2__label";
                const marker = document.createElement("span");
                marker.className = "fo2__marker";
                marker.setAttribute("aria-hidden", "true");
                button.append(label, marker);
                this.controls.set(entry.id, button);
            }
            const text = entry.text || this.emptyLabel;
            const label = button.firstElementChild;
            label.textContent = text;
            button.title = text;
            button.setAttribute("aria-label", text);
            button.style.setProperty("--fo2-depth", String(entry.depth));
            const current = this.list.children[index];
            if (current !== button) {
                this.list.insertBefore(button, current || null);
            }
        });
        this.controls.forEach((button, id) => {
            if (!live.has(id)) {
                button.remove();
                this.controls.delete(id);
            }
        });
        if (!live.has(this.currentID)) {
            this.currentID = "";
        }
        this.element.hidden = entries.length === 0;
        if (!entries.length) {
            this.expand(false);
        } else {
            this.scheduleScrollbarUpdate();
        }
    }

    setCurrent(id: string) {
        if (this.currentID === id) {
            return;
        }
        // 只切换前后两个按钮的状态，滚动期间避免遍历整份大纲。
        const previous = this.controls.get(this.currentID);
        previous?.classList.remove("fo2__row--current");
        previous?.setAttribute("aria-current", "false");
        this.currentID = id;
        const current = this.controls.get(id);
        current?.classList.add("fo2__row--current");
        current?.setAttribute("aria-current", "location");
    }

    place(editor: IProtyle | null) {
        if (!editor?.contentElement) {
            return;
        }
        const content = editor.contentElement.getBoundingClientRect();
        const scroll = editor.scroll?.element?.getBoundingClientRect();
        const editorVisible = content.width > 0 &&
            content.height > 0 &&
            !editor.element.classList.contains("fn__none");
        this.element.hidden = !editorVisible || this.controls.size === 0;
        if (this.element.hidden) {
            return;
        }
        // 优先贴近编辑器滚动条内侧，避免浮层覆盖编辑器滚动控件。
        const anchor = scroll?.width > 0 ? scroll.left : content.right - 20;
        const right = Math.max(8, window.innerWidth - anchor + 7);
        const height = Math.min(
            this.viewport.scrollHeight,
            window.innerHeight * 0.86,
            620,
        );
        const top = Math.max(
            8,
            Math.min(
                window.innerHeight - height - 8,
                content.top + (content.height - height) / 2,
            ),
        );
        this.element.style.right = `${Math.round(right)}px`;
        this.element.style.top = `${Math.round(top)}px`;
        this.updateScrollbar();
    }

    updateScrollbar() {
        if (!this.viewport || !this.scrollTrack || !this.scrollThumb) {
            return;
        }
        // 原生滚动条隐藏后，用独立滑块反映视口比例和当前位置。
        const viewportHeight = this.viewport.clientHeight;
        const contentHeight = this.viewport.scrollHeight;
        const hasOverflow = viewportHeight > 0 && contentHeight > viewportHeight + 1;
        this.scrollTrack.hidden = !hasOverflow;
        this.element.classList.toggle("fo2--overflow", hasOverflow);
        if (!hasOverflow) {
            return;
        }
        const trackHeight = this.scrollTrack.clientHeight;
        const thumbHeight = Math.max(
            20,
            (trackHeight * viewportHeight) / contentHeight,
        );
        const thumbRange = Math.max(0, trackHeight - thumbHeight);
        const scrollRange = contentHeight - viewportHeight;
        this.scrollThumb.style.height = `${thumbHeight}px`;
        this.scrollThumb.style.transform = `translateY(${
            scrollRange ? (this.viewport.scrollTop / scrollRange) * thumbRange : 0
        }px)`;
    }

    beginScrollbarDrag(event: PointerEvent) {
        if (!(event.target instanceof Node) || !this.scrollTrack.contains(event.target) || this.scrollTrack.hidden) {
            return;
        }
        event.preventDefault();
        // 点击轨道按比例定位，拖动滑块则记录初始指针和滚动位置。
        const trackRect = this.scrollTrack.getBoundingClientRect();
        const thumbHeight = this.scrollThumb.offsetHeight;
        const trackRange = Math.max(1, trackRect.height - thumbHeight);
        const scrollRange = this.viewport.scrollHeight - this.viewport.clientHeight;
        if (event.target === this.scrollThumb) {
            this.dragOrigin = {
                pointerY: event.clientY,
                scrollTop: this.viewport.scrollTop,
                pointerId: event.pointerId,
            };
            this.scrollThumb.setPointerCapture(event.pointerId);
            return;
        }
        const thumbTop = Math.max(
            0,
            Math.min(trackRange, event.clientY - trackRect.top - thumbHeight / 2),
        );
        this.viewport.scrollTop = (thumbTop / trackRange) * scrollRange;
    }

    moveScrollbarThumb(event: PointerEvent) {
        if (!this.dragOrigin || this.dragOrigin.pointerId !== event.pointerId) {
            return;
        }
        const trackRange = Math.max(
            1,
            this.scrollTrack.clientHeight - this.scrollThumb.offsetHeight,
        );
        const scrollRange = this.viewport.scrollHeight - this.viewport.clientHeight;
        const pointerDelta = event.clientY - this.dragOrigin.pointerY;
        this.viewport.scrollTop = this.dragOrigin.scrollTop + (pointerDelta / trackRange) * scrollRange;
    }

    destroy() {
        if (this.layoutFrame) {
            window.cancelAnimationFrame(this.layoutFrame);
            this.layoutFrame = 0;
        }
        this.dragOrigin = null;
        this.element.remove();
        this.controls.clear();
    }
}

class EditorOutlineSession {
    editor: IProtyle | null;
    private version: number;
    private mutationTimer: number;
    private scrollFrame: number;
    private navigationTimer: number;
    private navigationTargetID: string;
    private lastHeadingIDs: string;
    private entries: OutlineEntry[];
    private resize: ResizeObserver | null;
    private mutations: MutationObserver | null;
    private canvas: OutlineCanvas;
    private onScroll: () => void;
    private onResize: () => void;
    private onMutation: () => void;

    constructor(label: string, outlineLabel: string) {
        this.editor = null;
        this.version = 0;
        this.mutationTimer = 0;
        this.scrollFrame = 0;
        this.navigationTimer = 0;
        this.navigationTargetID = "";
        this.lastHeadingIDs = "";
        this.entries = [];
        this.resize = null;
        this.mutations = null;
        this.canvas = new OutlineCanvas(
            (id) => this.navigate(id),
            label,
            outlineLabel,
        );
        this.onScroll = () => {
            if (this.navigationTargetID) {
                // 点击跳转期间保留用户选中的标题，避免中间章节覆盖高亮。
                this.scheduleNavigationEnd();
                return;
            }
            this.queueCurrentHeading();
        };
        this.onResize = () => this.canvas.place(this.editor);
        this.onMutation = () => this.queueMutationRead();
    }

    useEditor(editor: IProtyle | null | undefined) {
        if (this.editor === editor) {
            this.reloadOutline();
            return;
        }
        this.releaseEditor();
        if (!editor?.element || !editor.contentElement) {
            return;
        }
        this.editor = editor;
        // 每个编辑器会话独立绑定滚动与尺寸监听，切换时统一释放。
        editor.contentElement.addEventListener("scroll", this.onScroll, {
            passive: true,
        });
        window.addEventListener("resize", this.onResize, {passive: true});
        this.resize = new ResizeObserver(this.onResize);
        this.resize.observe(editor.element);
        this.resize.observe(editor.contentElement);
        if (editor.scroll?.element) {
            this.resize.observe(editor.scroll.element);
        }
        if (editor.wysiwyg?.element) {
            this.mutations = new MutationObserver(this.onMutation);
            this.mutations.observe(editor.wysiwyg.element, {
                attributes: true,
                attributeFilter: ["data-node-id", "data-type", "data-subtype"],
                characterData: true,
                childList: true,
                subtree: true,
            });
        }
        this.reloadOutline();
    }

    releaseEditor() {
        // 先使未完成的请求和帧回调失效，再释放编辑器相关资源。
        window.clearTimeout(this.mutationTimer);
        window.clearTimeout(this.navigationTimer);
        this.mutationTimer = 0;
        this.navigationTimer = 0;
        this.navigationTargetID = "";
        this.version++;
        if (this.scrollFrame) {
            window.cancelAnimationFrame(this.scrollFrame);
            this.scrollFrame = 0;
        }
        this.editor?.contentElement?.removeEventListener("scroll", this.onScroll);
        window.removeEventListener("resize", this.onResize);
        this.resize?.disconnect();
        this.mutations?.disconnect();
        this.resize = null;
        this.mutations = null;
        this.editor = null;
        this.entries = [];
        this.lastHeadingIDs = "";
        this.canvas.setEntries([]);
    }

    queueMutationRead() {
        // 编辑器会连续发出多次 DOM 变更，合并后再读取标题和文本。
        window.clearTimeout(this.mutationTimer);
        this.mutationTimer = window.setTimeout(() => this.readEditorChanges(), 180);
    }

    readEditorChanges() {
        if (!this.editor) {
            return;
        }
        const liveElements = indexHeadings(this.editor);
        const ids = Array.from(liveElements.keys());
        const signature = ids.join("|");
        if (signature !== this.lastHeadingIDs) {
            // 标题集合变化时重新请求层级；只有文本变化时复用已有层级。
            this.reloadOutline();
            return;
        }
        this.entries = this.entries
            .filter((entry) => liveElements.has(entry.id))
            .map((entry) => ({
                ...entry,
                element: liveElements.get(entry.id),
                text: readHeadingText(liveElements.get(entry.id)),
            }));
        this.canvas.setEntries(this.entries);
        this.canvas.setCurrent(this.getCurrentHeadingID());
        this.canvas.place(this.editor);
    }

    reloadOutline() {
        const editor = this.editor;
        if (!editor) {
            return;
        }
        const elements = indexHeadings(editor);
        this.lastHeadingIDs = Array.from(elements.keys()).join("|");
        if (!elements.size) {
            this.entries = [];
            this.canvas.setEntries([]);
            return;
        }
        // 先用编辑器现有标题立即更新界面，再用接口层级补齐正式大纲。
        this.entries = this.entries
            .filter((entry) => elements.has(entry.id))
            .map((entry) => ({
                ...entry,
                element: elements.get(entry.id),
                text: readHeadingText(elements.get(entry.id)),
            }));
        this.canvas.setEntries(this.entries);
        this.canvas.setCurrent(this.getCurrentHeadingID());
        this.canvas.place(editor);
        const generation = ++this.version;
        const block = editor.block || {};
        fetchPost(
            OUTLINE_API,
            {
                id: block.rootID || block.id || editor.id,
                notebook: editor.notebookId || "",
            },
            (response) => {
                // 版本号和编辑器身份共同阻止旧请求覆盖当前文档的大纲。
                if (
                    generation !== this.version ||
                    editor !== this.editor ||
                    response?.code !== 0
                ) {
                    return;
                }
                const currentElements = indexHeadings(editor);
                this.lastHeadingIDs = Array.from(currentElements.keys()).join("|");
                this.entries = flattenOutline(response.data, currentElements);
                this.canvas.setEntries(this.entries);
                this.canvas.setCurrent(this.getCurrentHeadingID());
                this.canvas.place(editor);
            },
        );
    }

    queueCurrentHeading() {
        if (this.navigationTargetID || this.scrollFrame) {
            return;
        }
        this.scrollFrame = window.requestAnimationFrame(() => {
            this.scrollFrame = 0;
            if (!this.navigationTargetID) {
                this.canvas.setCurrent(this.getCurrentHeadingID());
            }
        });
    }

    scheduleNavigationEnd() {
        // 滚动事件停止一段时间后恢复按阅读位置自动更新高亮。
        window.clearTimeout(this.navigationTimer);
        this.navigationTimer = window.setTimeout(() => {
            this.navigationTimer = 0;
            this.navigationTargetID = "";
            this.queueCurrentHeading();
        }, 220);
    }

    findCurrentID(): string {
        if (!this.editor?.contentElement || !this.entries.length) {
            return "";
        }
        // 以编辑区域顶部下方 46px 作为阅读线，选择阅读线之前最近的标题。
        const activationLine = this.editor.contentElement.getBoundingClientRect().top + 46;
        let current = this.entries[0].id;
        for (const entry of this.entries) {
            if (entry.element.getBoundingClientRect().top > activationLine) {
                break;
            }
            current = entry.id;
        }
        return current;
    }

    getCurrentHeadingID(): string {
        return this.navigationTargetID || this.findCurrentID();
    }

    navigate(id: string) {
        const target = this.entries.find((entry) => entry.id === id)?.element;
        if (!target || !this.editor?.contentElement) {
            return;
        }
        const content = this.editor.contentElement;
        // 用目标标题相对滚动容器的位置计算偏移，保留少量顶部呼吸空间。
        const top = target.getBoundingClientRect().top -
            content.getBoundingClientRect().top +
            content.scrollTop;
        const maxScrollTop = Math.max(0, content.scrollHeight - content.clientHeight);
        const targetTop = Math.min(
            maxScrollTop,
            Math.max(0, top - 8),
        );
        this.navigationTargetID = id;
        window.clearTimeout(this.navigationTimer);
        this.navigationTimer = 0;
        if (this.scrollFrame) {
            window.cancelAnimationFrame(this.scrollFrame);
            this.scrollFrame = 0;
        }
        this.canvas.setCurrent(id);
        if (Math.abs(content.scrollTop - targetTop) < 1) {
            this.navigationTargetID = "";
            return;
        }
        content.scrollTo({top: targetTop, behavior: "smooth"});
        this.scheduleNavigationEnd();
    }

    destroy() {
        this.releaseEditor();
        this.canvas.destroy();
    }
}

class FloatingOutlinePlugin extends Plugin {
    private session: EditorOutlineSession | null = null;

    onload() {
        const emptyLabel = typeof this.i18n.untitledFallback === "string" ? this.i18n.untitledFallback : "";
        const outlineLabel = typeof this.i18n.outlineLabel === "string" ? this.i18n.outlineLabel : "";
        this.session = new EditorOutlineSession(
            emptyLabel,
            outlineLabel,
        );
        // 同时覆盖编辑器切换、静态加载和动态加载完成后的大纲刷新。
        this.eventBus.on("switch-protyle", (event) => this.session.useEditor(event.detail?.protyle));
        this.eventBus.on("loaded-protyle-dynamic", (event) => this.refreshLoadedEditor(event));
        this.eventBus.on("loaded-protyle-static", (event) => this.refreshLoadedEditor(event));
        this.eventBus.on("destroy-protyle", (event) => {
            if (event.detail?.protyle === this.session.editor) {
                this.session.useEditor(null);
            }
        });
    }

    onLayoutReady() {
        this.session.useEditor(getActiveEditor()?.protyle);
    }

    refreshLoadedEditor(event: CustomEvent<{protyle: IProtyle;}>) {
        if (event.detail?.protyle === this.session.editor) {
            this.session.reloadOutline();
        }
    }

    onunload() {
        this.session?.destroy();
    }
}

export default FloatingOutlinePlugin;
