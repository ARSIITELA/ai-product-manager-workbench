---
description: "Simin 工作台导航、文档阅读、现有对话槽位、详情面板与主题呈现。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-layout

[English](README.md) | 中文

## 概述

本包在真实项目文件和现有对话上提供 Simin 个人工作台。AppFrame 负责视口测量、全局浮层与 Agent 详情浮动面板；SiminShell 负责导航和阅读。主题呈现器投影配色、正文字号与 document 元数据。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

首页使用单侧导航与任务工作区。原有工作台标志搭配暖色中性欢迎区、圆角面板与灰绿色操作按钮。六类任务覆盖立项报告、PRD、竞品分析、AI 效果评估、提示词方案和版本规划。项目卡片与最近文档展示真实本机文件及其更新时间，并提供网格和列表视图。

任务窗口可以选择已有项目或创建命名项目、补充材料，并查看成果纲要。创建新项目前必须提供材料。开始任务会把对应草稿放入现有项目对话，由用户发送后请求生成。立项草稿优先使用已安装的 ai-initiation-report 技能及工作区指令，缺失信息标为待补。项目创建失败时保留已输入材料。项目对话旁也提供任务快捷入口。

宽窗口中阅读和对话使用独立圆角面板，较窄窗口在两者间切换。用户可以复制或下载当前 Markdown 文档。保存提案展示正文或逐行差异，等待确认。文件操作携带已读内容版本；冲突时保留现有文档。导航和显示偏好使用 localStorage，正文保留在磁盘中。

工作台导航使用精选的 [Heroicons v2.2.0 实心图标](https://github.com/tailwindlabs/heroicons/tree/v2.2.0/optimized/24/solid)，MIT 许可保留在 [SiminIcons](src/client/SiminIcons.tsx) 中。任务卡片组合共用图标、成果名称和简短说明。全局与项目标题栏保留面包屑、搜索及任务创建，侧栏文档入口可返回阅读。

工作台设置以平面分组、细分割线和黑白开关呈现，开关复用共用组件。本地偏好修改后立即保存；复制目录和现有模型设置弹窗使用紧凑的行内操作入口。

根框架保留 `main`、`rightbar`、`shell.bottom` 和 `shell.overlay` 槽位。隐藏挂载的旧侧栏保留设置 portal。全局面板选中态和现有对话继续使用 `ctx.layout`，可见导航由工作台提供。

<a id="window-chrome-seat"></a>
### 窗口 chrome 座

macOS 侧栏以 48px 顶部内边距将标志放在红绿灯下方。品牌与标题栏保留拖动区域，控件保持可点。根浮层避让变量保留平台标题栏和原生全屏行为。`shell.leading` 仍为兼容保留注册，但此框架不渲染它。

### 主题呈现

呈现器消费解析后的主题快照，并投影到 document：`html { color-scheme }` 驱动原生 UA 控件，依据当前配色方案设置 `body[data-ds-dark-theme]`，把主题的别名 token 与 `--dsh-content-font-size` 设为 body 上的内联变量，并持有一个 `<meta name="theme-color">`，其内容随计算后的 body 背景色更新。对呈现器执行 dispose（资源释放）时，它会连同其他全局写入一起移除自己的元数据节点。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`selectPanel(id)` 校验实时 `main` 注册表。`beginNavigation()` 中止被替代的导航，不取消底层会话创建。根存储区分面板选中态和视口、详情面板测量。AppFrame 用 ResizeObserver 和可取消的动画帧测量自身盒子，卸载时释放两者。

项目打开、草稿插入、对话搜索和模型设置通过 DOM 事件交给现有 owner。ui-layout 不值导入 ui-workspace。工作台每两秒轮询本机项目数据，请求可中止，读取失败时保留内容。现有 Agent 详情面板通过浮动 rightbar 槽位渲染，低于 640px 时不可用。独立标题组件投影当前会话标题；主题更新仍为事件驱动的纯 DOM 写入。

项目阅读与对话在独立圆角面板中使用主题基础底色。对话保留现有 Session 标题栏，并在上方提供项目任务快捷入口。

<a id="further-exploration"></a>
## 进一步探索

当布局面不够用时阅读以下页面。它们从框架进入它所渲染的栏与它所呈现的主题。

- [ui-sidebar](../ui-sidebar/README.zh.md)——占据 `sidebar` 栏及其座位。
- [ui-conversation](../ui-conversation/README.zh.md)——占据 `main` 中的 `conversation` key。
- [ui-sidebar-right](../ui-sidebar-right/README.zh.md)——以每会话一个停靠面占据 `rightbar` 栏。
- [ui-theme](../ui-theme/README.zh.md)——呈现器消费其解析快照的主题 seam。
- [Web 客户端架构](../../../docs/subsystems/web-client.zh.md)——浏览器插件行如何加载并注册槽位。

-----

<a id="model-experience"></a>
## 模型体验

无，因为布局不暴露模型工具，也不直接请求模型。

#### KV Cache 影响

任务窗口把本地化任务指令与用户材料准备为输入框草稿。用户发送后，现有对话才提交该文本，并增加该对话的输入 token；仅打开或准备任务不请求模型。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 项目导航用于本机个人工作；文件根目录由此工作区的 Host 配置持有。
- 文件变化通过轮询刷新；外部编辑可能需要一个轮询周期后出现。
- 下载导出 Markdown；Word、PDF 和表格导出需要独立生成流程。
- 工作台不接 Figma、GitHub 或飞书，也不预设项目阶段。
- Windows 布局与公开分发不在本机 Mac 构建的验收范围内。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
