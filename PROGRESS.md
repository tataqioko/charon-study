# Charon-Study 开发进度

## 已完成(可运行)

### 环境
- Node / pnpm / Rust(rustup)/ MSVC / WebView2 全部就绪
- Tauri 2 + Vue 3 + TypeScript 脚手架

### 技术栈
- Tailwind v4 + shadcn-vue(11 套组件:button/card/input/label/select/dialog/tabs/switch/badge/separator/sonner)
- motion-v(动效)、Inspira UI(aurora-background / text-generate-effect)
- Solar 图标(@iconify/vue,符合项目规范,禁 emoji/Lucide)
- Pinia + Vue Query + Vue Router
- 品牌色:Charon 紫(明暗双主题)

### Rust 后端(src-tauri/src/lib.rs)
- base_url 锁死 `https://api.nktp.top/v1`
- keyring 存 key(save/has/delete)
- `list_models`(已存 key)/ `list_models_with_key`(实时校验)
- `chat_stream`(SSE 流式对话,Channel 推事件)
- `chat_once`(非流式,结构化 JSON 生成用)
- `get_api_base_url`
- SQLite(tauri-plugin-sql):courses / steps / lectures / tests 四表

### 前端
- 自定义标题栏(无边框、可拖拽、最小化/最大化/关闭、深色切换)
- 关闭 = 最小化到系统托盘(托盘菜单:显示/退出;左键点图标唤出)
- 深色模式(useTheme composable)
- 首启引导流程(OnboardingView):欢迎 → 填 key 实时校验 → 选模型 → 进主页
- 路由守卫:无 key 强制引导,有 key 直接进主页
- MainLayout(侧边栏)+ CoursesView(课程列表,占位数据)

### 课程核心闭环(已打通,待实测)
- 新建课程弹窗:主题 + 节奏(冲刺/常规/休闲)+ 天数 → AI 生成
- 编排 courseGen.ts:主题 → 学习计划 JSON → 落库 steps → 首日讲义 eager
- 反推 prompt prompts.ts:排期 / 讲义
- 数据层 db.ts:课程/步骤/讲义 CRUD
- 学习页 StudyView:分天侧栏 + 讲义渲染 + 按需生成其余天
- 讲义渲染 LectureRenderer:markdown-it + KaTeX + Mermaid
- 讲义流式生成(streamLectureForStep,逐字显示 + 节流 + 防串台)
- 阅读体验:字号调节(60-240%)、专注模式、完成标记、进度条、书签(migration v2)
- 追问/重讲:讲义底部快捷追问(没听懂/举例/讲深)+ 自定义提问,流式追加落库
- 高亮+笔记:划词四色高亮 + 写笔记,笔记侧栏管理,存 notes 表
- 流式渲染防抖:生成中跳过 Mermaid,结束后统一渲染(消除页面上下抽动)

## 待办(下一步,按块拆)
1. [x] 首启流程 + key 实时校验(已实测通过)
2. [x] 设置页(改 key / 换模型 / 刷新 / 搜索 / 收藏)
3. [x] 流式对话调试台(已实测通过)
4. [x] SQLite 接入(tauri-plugin-sql)+ 数据表
5. [x] 新建课程流程(主题 → 计划 → 首日讲义)【待用户实测】
6. [x] 讲义生成(首日 eager + 后台批量补全)+ 渲染已做
   - [x] 首日讲义 eager 生成(课程创建时)
   - [x] 后台批量生成剩余讲义(非阻塞,静默失败)
   - [x] 流式渲染(Markdown + KaTeX + Mermaid)
7. [~] 材料上传功能(已实现 TXT/MD 基础版)
   - [x] 基础 UI:Tabs(输入主题 vs 上传材料)+ 拖拽上传区 + 文件列表
   - [x] TXT/MD 文本文件支持(单文件 ≤5MB,前端 File.text() 读取)
   - [x] 多文件合并 → knowledge_base 存库 + AI 生成课程
   - [ ] PDF 支持(pdfjs-dist 前端解析,约 20 分钟)
   - [ ] Word 支持(.doc/.docx,需 mammoth.js 或类似库)
   - [ ] PPT 支持(.ppt/.pptx,需专门解析库或后端)
   - [ ] 图片 OCR(调用视觉模型 API,如 GPT-4V)
   - [ ] 大文件分块上传(≥8MB 分块)
   - [ ] 文件大小上限调整
8. [ ] 测验系统(6 题型 + 交卷统一看)
9. [~] 追问功能改造:右侧栏聊天窗口式显示
   - [x] 创建 qa 表存储问答历史(step_id/question/answer/created_at)
   - [x] 右侧栏加问答历史列表(可滚动,显示问题+答案)
   - [x] 追问不再追加到讲义,独立存储和显示
   - [x] 切换讲义时加载对应问答历史
   - [x] Markdown 渲染问答内容(prose样式)
   - [x] 聊天式布局:顶部输入 + 中间历史(滚动) + 底部固定按钮
   - [ ] 左右侧栏可拖拽调整宽度
10. [ ] 动效补充(折叠/切换/hover 微动效)
   - [ ] 侧栏折叠/展开滑动动画(motion-v)
   - [ ] 步骤切换淡入淡出
   - [ ] 按钮 hover 微动效
   - [ ] 讲义加载骨架屏动画
11. [x] FSRS 复习系统 + 可视化
   - [x] FSRS-4.5 算法实现(fsrs.ts)
   - [x] 数据库设计(cards/reviews 表,迁移 v5)
   - [x] 复习页面 ReviewView(卡片展示 + 4 级评分)
   - [x] 课程列表加「开始复习」入口
   - [x] 统计卡片(新卡片/学习中/复习中/已复习)
   - [x] 自动为已完成 step 创建卡片
   - [x] 复习可视化(热力图/学习曲线/保留率图表)
     - [x] 卡片状态分布(饼图百分比)
     - [x] 复习热力图(近 90 天,类似 GitHub 贡献图)
     - [x] 复习趋势图(近 30 天柱状图)
12. [ ] 导出(PDF/MD/HTML)
13. [ ] 打包 + 自建更新(你的站点,非 GitHub)
14. [~] 诊断问卷系统
   - [x] 数据库设计(diagnostics/profiles 表,迁移 v6)
   - [x] Prompt 设计(生成诊断题 + 解析画像)
   - [x] 默认画像集成(当前直接使用,跳过诊断)
   - [x] DiagnosticView UI(问题展示 + 进度条 + 量表/选择题)
   - [x] 画像影响排期(传给 schedulePrompt)
   - [ ] 完整流程集成(NewCourseDialog 加诊断环节)
15. [x] 错题集功能
   - [x] 数据库设计(test_attempts 表,迁移 v7)
   - [x] QuizView 交卷时保存答题记录
   - [x] WrongAnswersView 错题本页面
   - [x] 课程列表加「错题本」入口
   - [x] 错题展示(题目/你的答案/正确答案/解析)
   - [x] 回顾讲义链接
16. [x] 课程调整功能
   - [x] reschedule() 重新排期函数
   - [x] StudyView 加「调整计划」按钮
   - [x] 调整天数对话框(带警告提示)
   - [x] 删除旧 steps 并重新生成
17. [ ] 材料上传增强(PDF/Word/PPT/OCR)

## 关键决策记录
- 站点锁死 api.nktp.top,用户只填 key(靠中转变现)
- 全局单模型;首启实时校验;强制先配置
- 更新走自建服务(GitHub 国内进不去)
- 图标统一 Solar Bold Duotone,禁 emoji
