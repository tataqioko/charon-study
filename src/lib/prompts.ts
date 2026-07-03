// 课程生成 prompt
// 每个环节要求 LLM 输出严格 JSON，前端解析后落库。

export interface SchedulePayload {
  course_topic: string;
  total_days: number;
  daily_available_time: string;
  days: {
    day_index: number;
    day_title: string;
    learning_goal: string;
    topic_scope: string[];
    estimated_time: string;
    completion_standard: string;
  }[];
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
      "completion_standard": "完成标准(学完能做到什么)"
    }
  ]
}
days 数组长度必须等于 total_days。`,
    user: `请为主题《${topic}》制定一份 ${totalDays} 天的学习计划。
每日可用时间:${dailyTime}。
${modeDesc}。
从基础到进阶合理编排,每天聚焦 1-3 个知识点,循序渐进。${materialContext}${profileContext}`,
  };
}

/** 讲义环节:某个 step → Markdown 讲义 */
export function lecturePrompt(
  courseTopic: string,
  dayTitle: string,
  learningGoal: string,
  topicScope: string[],
  dailyTime: string
): { system: string; user: string } {
  return {
    system: `你是一位极其擅长"从零带初学者入门"的学科名师。你要为学生生成一节讲义,输出 Markdown 格式(可含 KaTeX 数学公式用 $...$ 或 $$...$$,可含 Mermaid 图表用 \`\`\`mermaid 代码块)。

严格按以下结构输出:
1. 以 "# 标题" 开头(标题=当天主题)
2. "## 划重点环节":先安抚初学者("如果你一点没学过,完全没关系,我们从零一步步走"),再列出 3-5 条必背结论,关键词加粗
3. 分讲正文(## 一、## 二...):每个概念讲清"是什么/为什么/怎么用",多用生活化提问和类比,适当用表格归纳
4. "## 课堂总结":回顾式收尾,鼓励学生
5. 末尾输出:--- 讲义结束 ---

语气口语化、第二人称"你"、鼓励式,把学生当第一次接触这门课。`,
    user: `课程:《${courseTopic}》
本节主题:${dayTitle}
学习目标:${learningGoal}
覆盖知识点:${topicScope.join("、")}
建议时长:${dailyTime}

请生成这一节的完整讲义。`,
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

/** 测验题型 */
export interface QuizQuestion {
  kind: "single_choice" | "multi_choice" | "judgment" | "fill_blanks" | "free_response";
  stem: string;
  choices?: { id: string; label: string }[]; // 选择题
  answer: string | string[]; // 单选=选项id;多选=id数组;判断="true"/"false";填空/主观=参考文本
  explanation: string;
}

export interface QuizPayload {
  questions: QuizQuestion[];
}

/** 出题环节:某节知识点 → 一套测验(JSON) */
export function quizPrompt(
  courseTopic: string,
  dayTitle: string,
  learningGoal: string,
  topicScope: string[]
): { system: string; user: string } {
  return {
    system: `你是命题专家。为学生刚学完的这一节出一套测验,只输出一个 JSON 对象,不要任何解释或代码块标记。
结构严格如下:
{
  "questions": [
    {
      "kind": "single_choice",        // single_choice|multi_choice|judgment|fill_blanks|free_response
      "stem": "题干",
      "choices": [{"id":"a","label":"选项内容"}],   // 选择题必填;判断/填空/主观省略
      "answer": "a",                   // 单选=选项id;多选=["a","c"];判断="true"或"false";填空/主观=参考答案文本
      "explanation": "答案解析"
    }
  ]
}
出 6 道题,按此顺序:1 单选、2 判断、3 多选、4 填空(fill_blanks,题干用 ___ 表示空)、5 单选、6 主观题(free_response)。
题目紧扣本节知识点,难度适中,解析清晰。`,
    user: `课程:《${courseTopic}》
本节:${dayTitle}
学习目标:${learningGoal}
知识点:${topicScope.join("、")}

请出这一节的测验。`,
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
      "options": ["选项A", "选项B", "选项C", "选项D"]
    },
    {
      "id": "q2",
      "type": "scale",
      "question": "问题文本",
      "scale_range": {"min": 1, "max": 5, "min_label": "完全不了解", "max_label": "非常熟悉"}
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

AI 题要能测出学习者的基础水平(从入门到进阶),题目类型混合使用(选择/量表)。`,
    user: `请为主题《${topic}》生成诊断问卷。`,
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
