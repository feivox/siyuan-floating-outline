[English](README.md)

# 悬浮大纲

为思源桌面端编辑器提供紧凑的悬停展开式大纲，自动跟随当前文档，并标记当前阅读位置对应的标题。

## 功能

* 在编辑器旁以短横显示标题层级，鼠标悬停后展开为可阅读的大纲卡片
* 根据阅读位置跟踪并高亮当前标题
* 点击标题跳转到对应位置，滚动过程中保持所选标题高亮
* 文档或活动编辑器变化时自动更新；编辑器不可用或文档没有标题时隐藏

## 环境要求

* 思源 3.8.5 或更高版本
* Windows、Linux 或 macOS 桌面端

## 安装

1. 下载插件包并解压到 `<工作空间>/data/plugins/siyuan-floating-outline`
2. 在思源插件管理界面启用「悬浮大纲」

## 本地预览与开发

如需实时预览，请将项目目录放在 `<工作空间>/data/plugins/siyuan-floating-outline`，然后在该目录运行：

```sh
pnpm install
pnpm run dev
```

开发构建会监视 `src/index.ts` 和 `src/index.scss`，并在 `plugin.json` 同级生成 `index.js`、`index.css` 和 `i18n/`。在思源中启用或重载插件即可预览修改。如果仓库保留在工作空间之外，请将这些生成文件及 `plugin.json` 复制到插件目录。

## 打包

运行正式构建生成 `package.zip`：

```sh
pnpm run build
```

插件包包含入口文件、语言文件、插件清单和本 README。
