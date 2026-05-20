// T3-2a: Skill System — pluggable prompt templates triggered by intent/keywords
// Minimal but functional: define skills with triggers, get matching skills injected into system prompt
export interface Skill {
  name: string;
  description: string;
  triggers: string[];       // keywords that trigger this skill
  systemPrompt: string;    // injected into AI system prompt when triggered
  tools?: string[];        // recommended tools for this skill
  category: 'code' | 'review' | 'test' | 'docs' | 'security' | 'custom';
}

const BUILT_IN_SKILLS: Skill[] = [
  {
    name: 'code-review',
    description: '代码审查：检查代码质量、风格一致性和潜在bug',
    triggers: ['审查', 'review', '检查代码', 'code review'],
    systemPrompt: '你正在执行代码审查。重点关注: 1) 逻辑正确性 2) 命名一致性 3) 错误处理完整性 4) 安全性。输出审查报告而非直接修改代码。',
    tools: ['read_file', 'search_code'],
    category: 'review',
  },
  {
    name: 'test-gen',
    description: '测试生成：为指定代码生成单元测试',
    triggers: ['生成测试', '写测试', 'test gen', 'generate test', '补充测试'],
    systemPrompt: '你正在生成测试代码。必须: 1) 每个函数至少2个测试用例 2) 包含边界条件测试 3) 使用项目已有的测试框架 4) 测试文件命名遵循项目约定。',
    tools: ['read_file', 'search_code', 'code_intel'],
    category: 'test',
  },
  {
    name: 'api-doc',
    description: 'API文档生成：从代码生成接口文档',
    triggers: ['生成文档', '写文档', 'API文档', '接口文档', 'api doc'],
    systemPrompt: '你正在生成API文档。提取: 1) 路由路径和方法 2) 请求参数和类型 3) 响应结构 4) 错误码。按OpenAPI格式组织。',
    tools: ['read_file', 'search_code', 'code_intel'],
    category: 'docs',
  },
  {
    name: 'security-review',
    description: '安全检查：扫描代码中的安全漏洞',
    triggers: ['安全检查', '安全审查', '漏洞扫描', 'security scan'],
    systemPrompt: '你正在执行安全检查。扫描: 1) SQL注入 2) XSS 3) 硬编码密钥 4) 不安全依赖 5) 越权风险。输出安全报告含风险等级。',
    tools: ['read_file', 'search_code', 'web_search'],
    category: 'security',
  },
  {
    name: 'refactor-guide',
    description: '重构指导：安全重构代码，保持API兼容',
    triggers: ['重构', '拆分', '简化代码', 'refactor'],
    systemPrompt: '你正在执行代码重构。原则: 1) 保持公开API不变 2) 每次只改一个模块 3) 重构后运行全部测试 4) 分步提交便于审查。',
    tools: ['read_file', 'code_intel', 'search_code', 'run_command'],
    category: 'code',
  },
  {
    name: 'pypdf2',
    description: 'PyPDF2 PDF操作：合并、拆分、旋转、提取文本、添加水印、加密',
    triggers: ['pypdf2', 'PyPDF2', 'pdf操作', 'pdf合并', 'pdf拆分', 'pdf旋转', 'pdf加密', 'pdf解密', 'pdf水印', 'pdf提取'],
    systemPrompt: `你正在使用 PyPDF2 操作 PDF 文件。

## 可用的 PyPDF2 操作模板

### 1. 合并 PDF
\`\`\`python
from PyPDF2 import PdfMerger
merger = PdfMerger()
for pdf in ["file1.pdf", "file2.pdf"]:
    merger.append(pdf)
merger.write("merged.pdf")
merger.close()
\`\`\`

### 2. 拆分 PDF
\`\`\`python
from PyPDF2 import PdfReader, PdfWriter
reader = PdfReader("input.pdf")
for i, page in enumerate(reader.pages):
    writer = PdfWriter()
    writer.add_page(page)
    writer.write(f"page_{i+1}.pdf")
\`\`\`

### 3. 提取文本
\`\`\`python
from PyPDF2 import PdfReader
reader = PdfReader("input.pdf")
for page in reader.pages:
    print(page.extract_text())
\`\`\`

### 4. 旋转页面
\`\`\`python
from PyPDF2 import PdfReader, PdfWriter
reader = PdfReader("input.pdf")
writer = PdfWriter()
for page in reader.pages:
    page.rotate(90)  # 90, 180, 270
    writer.add_page(page)
writer.write("rotated.pdf")
\`\`\`

### 5. 添加水印
\`\`\`python
from PyPDF2 import PdfReader, PdfWriter
watermark = PdfReader("watermark.pdf").pages[0]
reader = PdfReader("input.pdf")
writer = PdfWriter()
for page in reader.pages:
    page.merge_page(watermark)
    writer.add_page(page)
writer.write("watermarked.pdf")
\`\`\`

### 6. 加密 PDF
\`\`\`python
from PyPDF2 import PdfReader, PdfWriter
reader = PdfReader("input.pdf")
writer = PdfWriter()
for page in reader.pages:
    writer.add_page(page)
writer.encrypt("user_password", "owner_password")
writer.write("encrypted.pdf")
\`\`\`

规则:
1. 先 read_file 查看目标 PDF 是否存在
2. 用 run_command 执行上述 Python 脚本
3. 操作前先说明将要执行的操作
4. 操作完成后验证输出文件是否生成`,
    tools: ['read_file', 'run_command'],
    category: 'custom',
  },
];

const userSkills: Skill[] = [];

/** Get skills matching the task description */
export function getMatchingSkills(taskDescription: string): Skill[] {
  const normalized = taskDescription.toLowerCase();
  return [...BUILT_IN_SKILLS, ...userSkills].filter(s =>
    s.triggers.some(t => normalized.includes(t.toLowerCase()))
  );
}

/** Build skill guidance text for system prompt injection */
export function buildSkillPrompt(taskDescription: string): string {
  const skills = getMatchingSkills(taskDescription);
  if (skills.length === 0) return '';

  return skills.map(s =>
    `## 技能: ${s.name}\n${s.systemPrompt}`
  ).join('\n\n');
}

/** Register a user-defined skill */
export function registerSkill(skill: Skill): void {
  if (userSkills.some(s => s.name === skill.name)) {
    const idx = userSkills.findIndex(s => s.name === skill.name);
    userSkills[idx] = skill;
  } else {
    userSkills.push(skill);
  }
}

/** List all available skills */
export function listSkills(): Skill[] {
  return [...BUILT_IN_SKILLS, ...userSkills];
}

/** Remove a user-defined skill */
export function removeSkill(name: string): boolean {
  const idx = userSkills.findIndex(s => s.name === name);
  if (idx >= 0) { userSkills.splice(idx, 1); return true; }
  return false;
}

/** T3-1: Persist skills to disk */
export async function saveSkillsToFile(rootPath: string): Promise<void> {
  try {
    const path = await import('path');
    const { ensureDir, writeJson } = await import('../utils/fs.js');
    const dir = path.join(rootPath, '.icloser');
    await ensureDir(dir);
    await writeJson(path.join(dir, 'skills.json'), userSkills);
  } catch { /* best-effort */ }
}

/** T3-1: Load persisted skills from disk */
export async function loadSkillsFromFile(rootPath: string): Promise<void> {
  try {
    const path = await import('path');
    const { readJson } = await import('../utils/fs.js');
    const data = await readJson(path.join(rootPath, '.icloser', 'skills.json')).catch(() => []);
    if (Array.isArray(data)) {
      for (const s of data as any[]) { if (s.name && s.triggers && s.systemPrompt) userSkills.push(s as Skill); }
    }
  } catch { /* best-effort */ }
}

/** Get recommended tools for a task based on matching skills */
export function getSkillTools(taskDescription: string): string[] {
  const skills = getMatchingSkills(taskDescription);
  const tools = new Set<string>();
  for (const s of skills) {
    for (const t of (s.tools || [])) tools.add(t);
  }
  return [...tools];
}
