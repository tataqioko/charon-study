# Charon-Study

一款基于 AI 的智能学习辅助桌面应用，帮助你高效掌握任何知识领域。

## ✨ 核心特性

- 🎯 **AI 驱动的学习计划**：输入主题，自动生成个性化学习路径
- 📚 **智能讲义生成**：流式生成深度讲义，支持 Markdown、LaTeX 公式、Mermaid 图表
- 💬 **互动式追问**：不懂就问，AI 实时解答你的疑惑
- 📝 **多题型测验**：单选、多选、判断、填空、简答、编程题全覆盖
- 🔄 **FSRS 复习系统**：科学间隔复习，长期记忆更牢固
- 📊 **可视化统计**：复习热力图、学习曲线、保留率分析
- ❌ **智能错题本**：自动记录错题，针对性复习
- 📂 **材料上传**：支持 TXT、Markdown 文本文件，从已有材料生成课程
- 🎨 **精美界面**：深色模式、自定义主题，学习体验更舒适

## 🚀 快速开始

### 下载安装

前往 [Releases](https://github.com/tataqioko/charon-study/releases) 页面下载最新版本：

- **Windows**: `charon-study_x.x.x_x64-setup.exe`
- **macOS**: `charon-study_x.x.x_x64.dmg`（开发中）
- **Linux**: `charon-study_x.x.x_amd64.deb`（开发中）

### 首次使用

1. 启动应用后，按引导填入你的 API Key（需要兼容 OpenAI 格式的 API）
2. 选择默认模型（推荐 GPT-4 或 Claude 3.5）
3. 创建第一个课程，开始学习之旅！

## 💻 技术栈

- **前端框架**: Vue 3 + TypeScript
- **桌面框架**: Tauri 2
- **样式方案**: Tailwind CSS v4
- **UI 组件**: shadcn-vue
- **数据存储**: SQLite
- **AI 集成**: 兼容 OpenAI API 格式

## 🛠️ 开发指南

### 环境要求

- Node.js 18+
- pnpm 8+
- Rust 1.70+（需要 rustup 和 MSVC）
- WebView2（Windows）

### 本地开发

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm tauri dev

# 构建生产版本
pnpm tauri build
```

## 📖 使用说明

### 1. 创建课程

点击「新建课程」按钮，输入：
- 学习主题（如「React 进阶」）
- 学习节奏（冲刺/常规/休闲）
- 总天数和每天学习时长

AI 会自动生成完整的学习计划。

### 2. 学习讲义

- 点击课程卡片进入学习页面
- 流式生成的讲义支持数学公式、代码高亮、流程图
- 可调节字号、开启专注模式
- 支持划词高亮和笔记

### 3. 追问互动

在讲义底部或右侧栏：
- 快捷追问：没听懂、举例说明、讲深一点
- 自定义提问：输入你的问题，AI 实时解答

### 4. 完成测验

每天学习后，点击「开始测验」：
- 6 种题型全覆盖
- 即时批改和详细解析
- 错题自动进入错题本

### 5. 间隔复习

完成的内容会自动加入复习队列：
- FSRS-4.5 算法智能排期
- 4 级评分（困难/一般/容易/完美）
- 可视化复习数据

## 🔐 隐私与安全

- **本地存储**：所有数据存储在本地 SQLite 数据库
- **API Key 安全**：使用系统 Keyring 加密存储
- **无数据上传**：除了调用 AI API，不会上传任何个人数据

## 📝 更新日志

查看 [CHANGELOG.md](./CHANGELOG.md) 了解版本更新记录。

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

## 📄 开源协议

AGPL-3.0 with Commons Clause - 详见 [LICENSE](./LICENSE) 文件

**注意**：本软件禁止任何形式的商业使用。你可以自由使用、学习和修改代码，但不得用于商业目的。

## 🙏 致谢

- [Tauri](https://tauri.app/) - 跨平台桌面应用框架
- [Vue.js](https://vuejs.org/) - 渐进式 JavaScript 框架
- [shadcn-vue](https://www.shadcn-vue.com/) - 优雅的 Vue 组件库
- [FSRS](https://github.com/open-spaced-repetition/fsrs.js) - 科学的间隔重复算法

---

Made with ❤️ by [tataqioko](https://github.com/tataqioko)

