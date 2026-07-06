// 课程生成 prompt
// 每个环节要求 LLM 输出严格 JSON，前端解析后落库。

/** daily_plan 多 unit 层：一天内的单个学习单元（ daily_plan_payload.days[].units[]） */
export interface DayUnit {
  order_in_day: number; // 当天内顺序
  title: string; // 单元标题
  objective: string; // 单元学习目标
  need_lecture: boolean; // 是否需要讲义
  need_exercise: boolean; // 是否需要练习
  related_knowledge_units: string[]; // 关联知识单元（unit_id 或标题）
  source_refs: string[]; // 材料引用（material:xxx），无材料时为空数组
  prerequisites: string[]; // 前置单元
}

export interface ScheduleDay {
  day_index: number;
  day_title: string;
  learning_goal: string;
  topic_scope: string[];
  estimated_time: string;
  completion_standard: string;
  units?: DayUnit[]; // 多 unit 层；旧数据可能缺省（向后兼容）
}

export interface SchedulePayload {
  course_topic: string;
  total_days: number;
  daily_available_time: string;
  days: ScheduleDay[];
}

/** 排期环节:主题 + 天数/节奏 → N 天学习计划(JSON) */
export function schedulePrompt(
  topic: string,
  totalDays: number,
  dailyTime: string,
  mode: string,
  knowledgeBase?: string,
  profile?: UserProfile
): { system: string; user: string } {
  const modeDesc =
    mode === "sprint"
      ? "冲刺模式:节奏紧凑,聚焦高频考点与核心骨架,允许高强度"
      : mode === "leisure"
      ? "休闲模式:节奏轻松,循序渐进,不贪多"
      : "常规模式:稳扎稳打,均衡覆盖";

  const materialContext = knowledgeBase
    ? `\n\n用户上传了以下学习材料,请基于材料内容规划学习计划:\n\`\`\`\n${knowledgeBase.slice(0, 8000)}\n\`\`\``
    : "";

  const profileContext = profile
    ? `\n\n用户学习画像:
- 基础水平: ${profile.level === "beginner" ? "初学者" : profile.level === "intermediate" ? "中级" : "高级"}
- 学习风格: ${profile.learning_style === "visual" ? "视觉型" : profile.learning_style === "reading" ? "阅读型" : profile.learning_style === "hands-on" ? "实践型" : "听觉型"}
- 学习目标: ${profile.goal === "quick_start" ? "快速入门" : profile.goal === "systematic" ? "系统掌握" : profile.goal === "exam_prep" ? "应试考试" : "兴趣爱好"}
- 优势: ${profile.strengths.join("、") || "无特别优势"}
- 薄弱: ${profile.weaknesses.join("、") || "无特别薄弱"}
- 偏好: ${profile.preferences.join("、")}

请根据画像调整难度曲线、内容深度和讲解风格。`
    : "";

  return {
    system: `你是一位资深课程规划师,擅长把一个主题拆解成分天的学习计划。
你必须只输出一个 JSON 对象,不要有任何解释、前后缀或 markdown 代码块标记。
JSON 结构严格如下:
{
  "course_topic": "课程主题",
  "total_days": 天数(整数),
  "daily_available_time": "每日可用时间",
  "days": [
    {
      "day_index": 1,
      "day_title": "当天主题标题",
      "learning_goal": "当天学习目标(一句话)",
      "topic_scope": ["知识点1", "知识点2"],
      "estimated_time": "预计耗时",
      "completion_standard": "完成标准(学完能做到什么)",
      "units": [
        {
          "order_in_day": 1,
          "title": "学习单元标题(比当天主题更细的一个知识点)",
          "objective": "该单元学习目标(一句话)",
          "need_lecture": true,
          "need_exercise": true,
          "related_knowledge_units": ["关联知识点或单元"],
          "source_refs": [],
          "prerequisites": ["前置单元标题(可为空)"]
        }
      ]
    }
  ]
}
规则:
- days 数组长度必须等于 total_days。
- 每天拆成 1-3 个 units(学习单元),按 order_in_day 从 1 递增排序,由浅入深。
- 每个 unit 是一个可独立成讲义的最小知识点;need_lecture 通常为 true。
- need_exercise 表示该单元学完后是否需要配套练习(核心/易错单元设为 true)。
- source_refs 一律留空数组([]);材料引用由系统在排期后按知识库自动匹配填充,你无需填写。
- prerequisites 填写前置单元的标题;没有则用空数组 []。`,
    user: `请为主题《${topic}》制定一份 ${totalDays} 天的学习计划。
每日可用时间:${dailyTime}。
${modeDesc}。
从基础到进阶合理编排,每天聚焦 1-3 个知识点,并把每天拆成 1-3 个学习单元(units),循序渐进。${materialContext}${profileContext}`,
  };
}

/** 讲义生成结果 */
export interface LectureResult {
  content_md: string;
  suggested_questions: string[];
}

/** 从 AI 响应中提取讲义内容和建议问题 */
export function parseLectureResponse(response: string): LectureResult {
  // 提取建议复习问题部分
  const questionsMatch = response.match(/##\s*建议复习问题\s*\n([\s\S]*?)(?=\n##|\n---\s*讲义结束|$)/i);
  const suggested_questions: string[] = [];

  if (questionsMatch) {
    const questionsText = questionsMatch[1];
    // 提取列表项：兼容有序列表（1. / 10. / 1、）与无序列表（- / *）
    const questionItems = questionsText.match(/^\s*(?:\d+[.、]|[-*])\s+(.+)$/gm);
    if (questionItems) {
      suggested_questions.push(...questionItems.map(item =>
        item.replace(/^\s*(?:\d+[.、]|[-*])\s+/, '').trim()
      ));
    }
  }

  return {
    content_md: response,
    suggested_questions,
  };
}

/** 讲义环节:某个 step → Markdown 讲义 */
export function lecturePrompt(
  courseTopic: string,
  dayTitle: string,
  learningGoal: string,
  topicScope: string[],
  dailyTime: string,
  contextSection?: string,
  masteryContext?: string
): { system: string; user: string } {
  const materialSection = contextSection || '';
  const masterySection = masteryContext || '';

  return {
    system: `你是一位极其擅长"从零带初学者入门"的学科名师。你要为学生生成一节讲义,输出 Markdown 格式。

**核心教学法:三步法**
对每个概念采用:
1. **精确定义** - 严格的学术定义
2. **提出具体实例** - 可操作的例子或真实案例
3. **围绕实例剖析** - 深入讲解为什么这样设计

**必须包含的元素:**

1. **划重点环节** (## 开头)
   - 先安抚初学者:"如果你一点没学过,完全没关系,我们从零一步步走"
   - 列出 3-5 条必背结论,用 **加粗** 强调关键词
   - 每条结论要具体、可验证

2. **分讲正文** (### 第一讲、### 第二讲...)
   - 每讲开头用生活化问题引入
   - 核心概念用三步法展开
   - 适当用表格归纳对比
   - **每讲必须配1-2个 SVG 图表**

3. **SVG 图表要求** (关键!)
   - 用 \`\`\`svg 代码块嵌入
   - 图表类型:关系图、流程图、对比图、结构图
   - 配色柔和专业(避免纯色,用 #2c3e50, #3498db, #e74c3c 等)
   - 必须有标题、图例、说明文字
   - 图表后紧跟 **图解说明** 段落

4. **课堂总结** (## 开头)
   - 回顾式收尾
   - 鼓励学生

5. **建议复习问题** (## 开头)
   - 列出 3-5 个引导性问题
   - 帮助学生自我检查

**数学公式:** 用 KaTeX 格式 $...$ (行内) 或 $$...$$ (独立行)
**图表:** 优先用 SVG,复杂流程可用 \`\`\`mermaid
**语气:** 口语化、第二人称"你"、鼓励式

末尾输出: --- 讲义结束 ---`,
    user: `课程:《${courseTopic}》
本节主题:${dayTitle}
学习目标:${learningGoal}
覆盖知识点:${topicScope.join("、")}
建议时长:${dailyTime}${materialSection}${masterySection}

请生成这一节的完整讲义,确保包含 SVG 图表和三步法讲解。`,
  };
}

/** 追问/重讲:基于当前讲义上下文,回答学生的追问(输出 Markdown 片段) */
export function followUpPrompt(
  courseTopic: string,
  dayTitle: string,
  lectureExcerpt: string,
  question: string
): { system: string; user: string } {
  return {
    system: `你是学生正在学习的这节课的老师。学生刚读完你的讲义,现在有追问。
请用 Markdown 输出一段**补充讲解**(不要重复整节讲义,只针对追问),口语化、第二人称"你"、鼓励式。
可用 $...$ 数学公式、表格、\`\`\`mermaid 图表。开头用一个 "### " 小标题点出这次补充讲什么。`,
    user: `课程:《${courseTopic}》
本节:${dayTitle}
讲义节选(供你参考上下文,不要照抄):
"""
${lectureExcerpt.slice(0, 2000)}
"""
学生的追问:${question}

请针对这个追问补充讲解。`,
  };
}

/** 测验题型（ 6 大题型 + 每题可配 SVG 图示） */
export interface QuizQuestion {
  kind:
    | "single_choice"
    | "multi_choice"
    | "judgment"
    | "fill_blanks"
    | "ordering" // 排序题：把 items 拖成正确顺序
    | "error_spot" // 纠错题：从 choices 中选出有错误的一项
    | "free_response"; // 主观题：LLM 评分
  stem: string;
  choices?: { id: string; label: string }[]; // 选择题 / 纠错题
  items?: string[]; // 排序题：乱序展示的待排序项（answer 为正确顺序数组）
  answer: string | string[]; // 单选/纠错=选项id;多选=id数组;判断="true"/"false";排序=正确顺序数组;填空/主观=参考文本
  explanation: string;
  svg?: string; // 题目配图（SVG 源码，可选）
  rubric?: string; // 主观题评分标准（供 LLM 评分参考）
  reference_answer?: string; // 主观题参考答案
}

export interface QuizPayload {
  questions: QuizQuestion[];
}

/** 出题环节:某节知识点 → 一套测验(JSON) */
export function quizPrompt(
  courseTopic: string,
  dayTitle: string,
  learningGoal: string,
  topicScope: string[],
  retrievedContext?: string,
  masteryContext?: string
): { system: string; user: string } {
  const contextSection = retrievedContext
    ? `\n\n以下是从用户上传的学习材料中检索到的相关内容：\n${retrievedContext}\n\n请基于上述材料内容出题，确保题目和答案都来自材料。`
    : '';

  const masterySection = masteryContext || '';

  // 根据掌握度调整难度指引
  const difficultyGuide = masteryContext
    ? `\n\n**自适应难度调整**：根据学习者历史表现，对薄弱知识点出基础巩固题，对已掌握知识点出进阶应用题。`
    : '';

  return {
    system: `你是命题专家。为学生刚学完的这一节出一套测验,只输出一个 JSON 对象,不要任何解释或代码块标记。
结构严格如下:
{
  "questions": [
    {
      "kind": "single_choice",        // single_choice|multi_choice|judgment|fill_blanks|ordering|error_spot|free_response
      "stem": "题干",
      "choices": [{"id":"a","label":"选项内容"}],   // 选择题/纠错题必填;其它题型省略
      "items": ["步骤A","步骤B","步骤C"],            // 仅排序题(ordering)必填:乱序展示的待排序项
      "answer": "a",                   // 单选/纠错=选项id;多选=["a","c"];判断="true"/"false";排序=按正确顺序排列的 items 数组;填空/主观=参考答案文本
      "explanation": "答案解析",
      "svg": "<svg ...>...</svg>",     // 可选:该题配图(SVG 源码),有助理解时才加
      "rubric": "评分标准",            // 仅主观题(free_response):分点说明如何给分
      "reference_answer": "参考答案"    // 仅主观题(free_response):理想答案
    }
  ]
}
出 6 道题,按此顺序:
1. 单选(single_choice)
2. 判断(judgment)
3. 多选(multi_choice)
4. 排序(ordering,给出 3-5 个 items,answer 为正确顺序的完整数组)
5. 纠错(error_spot,给出 3-4 个 choices,其中恰有一个存在错误/不成立,answer 为该错误项的 id)
6. 主观题(free_response,必须给出 rubric 和 reference_answer)
题目紧扣本节知识点,难度适中,解析清晰。涉及流程/结构/关系的题目可在 svg 字段配图。${difficultyGuide}`,
    user: `课程:《${courseTopic}》
本节:${dayTitle}
学习目标:${learningGoal}
知识点:${topicScope.join("、")}${contextSection}${masterySection}

请出这一节的测验。`,
  };
}

/** 主观题 LLM 评分结果 */
export interface GradeResult {
  score: number; // 0-100
  feedback: string; // 评语/改进建议
}

/** 主观题评分:根据 rubric + 参考答案给学生作答打分 */
export function gradeFreeResponsePrompt(
  stem: string,
  userAnswer: string,
  rubric: string,
  referenceAnswer: string
): { system: string; user: string } {
  return {
    system: `你是严谨而鼓励式的阅卷老师。根据评分标准和参考答案，为学生的主观题作答打分。
只输出一个 JSON 对象，不要任何解释或代码块标记，结构如下:
{
  "score": 85,          // 0-100 的整数分
  "feedback": "评语：先肯定答对的点，再具体指出缺漏与改进方向"
}
评分要客观公正：答案正确完整给高分；部分正确给部分分；跑题或空白给低分。feedback 用第二人称"你"，简洁具体。`,
    user: `题目：${stem}

评分标准：${rubric || "（未提供，请按参考答案的要点酌情给分）"}

参考答案：${referenceAnswer || "（未提供）"}

学生作答：${userAnswer || "（未作答）"}

请打分。`,
  };
}

/** 从可能带代码块包裹的 LLM 输出中提取纯 JSON */
export function extractJson(raw: string): string {
  let s = raw.trim();
  // 去掉 ```json ... ``` 或 ``` ... ``` 包裹
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // 截取第一个 { 到最后一个 }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return s;
}

/** 诊断问卷生成 */
export interface DiagnosticQuestion {
  id: string;
  type: "single_choice" | "scale" | "text";
  question: string;
  options?: string[]; // 选择题选项
  scale_range?: { min: number; max: number; min_label: string; max_label: string }; // 量表题
  custom_enabled?: boolean; // 是否允许自定义补充（）
  custom_placeholder?: string; // 自定义补充的占位符
}

export interface DiagnosticPayload {
  ai_questions: DiagnosticQuestion[]; // 5个AI自适应题
  fixed_questions: DiagnosticQuestion[]; // 3个固定偏好题
}

export function diagnosticPrompt(topic: string): { system: string; user: string } {
  return {
    system: `你是一位资深教育专家,擅长通过诊断问卷了解学习者的基础水平、学习风格和需求。
你要为主题《${topic}》生成一份诊断问卷,包含 5 个 AI 自适应题 + 3 个固定偏好题。

输出严格 JSON,不要任何解释或代码块标记。结构如下:
{
  "ai_questions": [
    {
      "id": "q1",
      "type": "single_choice",
      "question": "问题文本",
      "options": ["选项A", "选项B", "选项C", "选项D"],
      "custom_enabled": true,
      "custom_placeholder": "可选：写下你针对这个问题最想补的重点"
    },
    {
      "id": "q2",
      "type": "scale",
      "question": "问题文本",
      "scale_range": {"min": 1, "max": 5, "min_label": "完全不了解", "max_label": "非常熟悉"},
      "custom_enabled": true,
      "custom_placeholder": "可选：写下你针对这个问题最想补的重点"
    }
  ],
  "fixed_questions": [
    {
      "id": "pref1",
      "type": "single_choice",
      "question": "你更喜欢的学习方式?",
      "options": ["看视频讲解", "读文字教程", "动手实践", "听音频课"]
    },
    {
      "id": "pref2",
      "type": "single_choice",
      "question": "你的学习目标是?",
      "options": ["快速入门", "系统掌握", "应试考试", "兴趣爱好"]
    },
    {
      "id": "pref3",
      "type": "scale",
      "question": "你每天愿意投入的学习时间?",
      "scale_range": {"min": 1, "max": 5, "min_label": "30分钟", "max_label": "3小时以上"}
    }
  ]
}

AI 题要能测出学习者的基础水平(从入门到进阶),题目类型混合使用(选择/量表)。
AI 题都要设置 custom_enabled: true，允许学习者补充自己的具体重点。`,
    user: `请为主题《${topic}》生成诊断问卷。`,
  };
}

/** 供诊断问卷参考的知识单元摘要（标题 + 概述）。 */
export interface DiagnosticUnitBrief {
  title: string;
  summary: string;
}

/**
 * 基于知识库的诊断问卷（：诊断题建立在知识单元之上，而非只对着主题名瞎猜）。
 * 输入主题 + 从上传材料抽取的知识单元清单（标题+概述），AI 题需紧扣这些真实知识点，
 * 以便测出学习者对「本材料实际覆盖内容」的掌握程度。固定偏好题与主题版保持一致。
 */
export function diagnosticFromUnitsPrompt(
  topic: string,
  units: DiagnosticUnitBrief[]
): { system: string; user: string } {
  const roster = units
    .map((u, i) => `${i + 1}. ${u.title}${u.summary ? `：${u.summary}` : ""}`)
    .join("\n");

  return {
    system: `你是一位资深教育专家,擅长通过诊断问卷了解学习者的基础水平、学习风格和需求。
你要为主题《${topic}》生成一份诊断问卷,包含 5 个 AI 自适应题 + 3 个固定偏好题。

**关键**：下面会给你一份「知识单元清单」，它是从学习者上传的真实材料里抽取出来的。
你的 5 个 AI 题【必须】紧扣这些真实知识点来测学习者的基础，而不是泛泛地问主题常识。
例如围绕清单里的具体术语、方法、概念设问，判断学习者对本材料覆盖内容的熟悉程度。

输出严格 JSON,不要任何解释或代码块标记。结构如下:
{
  "ai_questions": [
    {
      "id": "q1",
      "type": "single_choice",
      "question": "问题文本",
      "options": ["选项A", "选项B", "选项C", "选项D"],
      "custom_enabled": true,
      "custom_placeholder": "可选：写下你针对这个问题最想补的重点"
    },
    {
      "id": "q2",
      "type": "scale",
      "question": "问题文本",
      "scale_range": {"min": 1, "max": 5, "min_label": "完全不了解", "max_label": "非常熟悉"},
      "custom_enabled": true,
      "custom_placeholder": "可选：写下你针对这个问题最想补的重点"
    }
  ],
  "fixed_questions": [
    {
      "id": "pref1",
      "type": "single_choice",
      "question": "你更喜欢的学习方式?",
      "options": ["看视频讲解", "读文字教程", "动手实践", "听音频课"]
    },
    {
      "id": "pref2",
      "type": "single_choice",
      "question": "你的学习目标是?",
      "options": ["快速入门", "系统掌握", "应试考试", "兴趣爱好"]
    },
    {
      "id": "pref3",
      "type": "scale",
      "question": "你每天愿意投入的学习时间?",
      "scale_range": {"min": 1, "max": 5, "min_label": "30分钟", "max_label": "3小时以上"}
    }
  ]
}

AI 题要能测出学习者对上述知识单元的掌握程度(从入门到进阶),题目类型混合使用(选择/量表)。
AI 题都要设置 custom_enabled: true，允许学习者补充自己的具体重点。`,
    user: `课程主题：《${topic}》

从学习者上传材料中抽取的知识单元清单（共 ${units.length} 个）：
${roster}

请据此生成诊断问卷，AI 题紧扣上述真实知识点。`,
  };
}

/** 用户画像生成 */
export interface UserProfile {
  level: string; // 基础水平: beginner | intermediate | advanced
  learning_style: string; // 学习风格: visual | reading | hands-on | auditory
  goal: string; // 学习目标: quick_start | systematic | exam_prep | hobby
  daily_time: string; // 每日时长: 30min | 1h | 2h | 3h+
  strengths: string[]; // 优势领域
  weaknesses: string[]; // 薄弱环节
  preferences: string[]; // 学习偏好(如:喜欢实例/喜欢理论)
}

export function profilePrompt(topic: string, questionsJson: string, answersJson: string): { system: string; user: string } {
  return {
    system: `你是教育心理专家,根据诊断问卷的答案生成学习者画像。
输出严格 JSON,不要任何解释或代码块标记。结构如下:
{
  "level": "beginner",
  "learning_style": "visual",
  "goal": "systematic",
  "daily_time": "1h",
  "strengths": ["逻辑思维强", "有编程基础"],
  "weaknesses": ["数学基础薄弱", "缺乏实践经验"],
  "preferences": ["喜欢实例讲解", "需要循序渐进"]
}

level 只能是 beginner/intermediate/advanced 之一。
learning_style 只能是 visual/reading/hands-on/auditory 之一。
goal 只能是 quick_start/systematic/exam_prep/hobby 之一。
daily_time 只能是 30min/1h/2h/3h+ 之一。`,
    user: `主题:《${topic}》
问卷:
${questionsJson}

答案:
${answersJson}

请分析生成画像。`,
  };
}
