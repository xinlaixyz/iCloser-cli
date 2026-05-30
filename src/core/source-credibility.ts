export type SourceCredibilityKind = 'official' | 'database' | 'media' | 'local-file' | 'command' | 'search-query' | 'unknown';

export interface SourceCredibility {
  target: string;
  kind: SourceCredibilityKind;
  score: number;
  label: string;
}

export function classifySourceCredibility(target: string): SourceCredibility {
  const clean = String(target || '').trim();
  if (!clean) return { target: clean, kind: 'unknown', score: 0, label: '未知来源' };
  const normalized = clean.replace(/\\/g, '/');
  if (/^(npm|pnpm|yarn|gradle|adb|git|mvn|python|node)\b/i.test(clean)) {
    return { target: clean, kind: 'command', score: 80, label: '命令证据' };
  }
  if (/^[A-Za-z]:\/|^\.\.?\/|^[\w./-]+\.(ts|tsx|js|jsx|json|html|css|md|kt|java|gradle|toml)$/i.test(normalized)) {
    return { target: clean, kind: 'local-file', score: 82, label: '本地文件' };
  }
  try {
    const url = new URL(clean);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (/icloser\.(asia|xyz|com)|github\.com|docs\./.test(host)) return { target: clean, kind: 'official', score: 92, label: `官方/一手来源：${host}` };
    if (/pitchbook|crunchbase|36kr|pitchhub|itjuzi|qichacha|tianyancha/.test(host)) return { target: clean, kind: 'database', score: 86, label: `数据库/项目信息：${host}` };
    if (/sohu|medium|news|finance|forbes|techcrunch|theblock|coindesk|panews/.test(host)) return { target: clean, kind: 'media', score: 72, label: `媒体来源：${host}` };
    return { target: clean, kind: 'unknown', score: 60, label: `网页来源：${host}` };
  } catch {
    if (/[\u4e00-\u9fff]|".+"/.test(clean)) return { target: clean, kind: 'search-query', score: 45, label: '搜索查询/未抓取来源' };
    return { target: clean, kind: 'unknown', score: 40, label: '未分类来源' };
  }
}

export function summarizeSourceCredibility(targets: string[]): string {
  const items = targets.map(classifySourceCredibility).filter(item => item.score > 0);
  if (items.length === 0) return '暂无来源等级';
  const best = [...items].sort((a, b) => b.score - a.score)[0];
  const official = items.filter(item => item.kind === 'official').length;
  const database = items.filter(item => item.kind === 'database').length;
  const searchOnly = items.filter(item => item.kind === 'search-query').length;
  return `${best.label} · 最高 ${best.score}/100 · 官方 ${official} · 数据库 ${database} · 搜索 ${searchOnly}`;
}
