# 清译 ClearLingo

一款小而清晰的双语网页翻译扩展。它只识别正文式文本块，按段落在原文下方插入译文，并继续监听动态加载的新内容。

## 功能

- 正文优先的段落识别，避开导航、表单、代码块和可编辑区域
- 双语对照与仅译文两种显示方式
- 自动识别源语言，支持 12 种常用目标语言
- 动态页面增量翻译
- 页面一键还原，不刷新、不破坏原有事件监听器
- `Option/Alt + T` 快捷切换
- Chrome 138+ 优先使用浏览器内置 Translator API；其他环境自动回退在线翻译
- Manifest V3，无构建工具、无运行时依赖、无遥测

## Chrome / Edge / Chromium 安装

1. 打开扩展管理页（Chrome 为 `chrome://extensions`）。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”，选中本目录。
4. 打开普通网页，点击工具栏中的清译图标。

浏览器内部页面、扩展商店页面等受保护页面无法注入内容脚本，这是浏览器的安全限制。

## Safari 安装与开发

需要较新的 macOS 与 Xcode。在项目上一级目录执行：

```sh
xcrun safari-web-extension-converter ./translate-tool \
  --project-location ./ClearLingo-Safari \
  --app-name ClearLingo \
  --bundle-identifier com.example.clearlingo
```

随后在 Xcode 中选择签名团队并运行生成的 macOS/iOS 容器 App，再到 Safari 设置中启用扩展。发布前请把示例 bundle identifier 换成你自己的反向域名标识。

## 架构

- `src/content.js`：正文发现、DOM 呈现、动态内容监听与还原
- `src/background.js`：并发控制、内存缓存和跨域翻译请求
- `src/translator.js`：文本分块与翻译服务适配
- `popup/`：扩展面板和同步设置

Chrome 138+ 桌面版在语言对可用时优先使用浏览器内置 Translator API。Safari 或本地语言包不可用时，扩展回退到 MyMemory 的公开 REST API，无需密钥，但受公共服务的配额与 500 字节单请求限制；项目会自动按 UTF-8 字节安全分段。商用或高并发场景建议后续替换 `src/translator.js` 为带 SLA 的正式服务适配器。

## 开发检查

需要 Node.js 20 或更高版本：

```sh
npm test
npm run check
```

## 隐私

扩展不收集遥测。Chrome 本地翻译可用时，正文不会发送给第三方；回退到在线模式时，选中的正文会直接发送给 MyMemory。设置保存在浏览器同步存储中。详见 [PRIVACY.md](./PRIVACY.md)。

## 设计说明与来源边界

产品思路参考了沉浸式翻译旧开源项目的“正文优先、逐段双语”体验。当前沉浸式翻译仓库明确说明其不包含源代码，因此本项目未复制当前闭源实现，也未复制归档项目源码；全部代码为独立、精简实现。

## License

MIT
