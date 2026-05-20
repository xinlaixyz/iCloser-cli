// Quick smoke test for the table renderer logic
// Simulates the buffered table rendering from renderMarkdownLine

const chalk = (await import('chalk')).default;

// Replicate the theme colors
const C = {
  dim: chalk.hex('#6B7280'),
  accent: chalk.hex('#A78BFA'),
  primary: chalk.hex('#6366F1'),
};

function stripAnsiLen(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '').length;
}

const CJK_RX = /[一-鿿㐀-䶿豈-﫿　-〿＀-￯぀-ヿ가-힯⺀-⿟]/g;
function displayWidth(str) {
  const clean = str.replace(/\x1b\[[0-9;]*m/g, '');
  const cjkCount = (clean.match(CJK_RX) || []).length;
  return clean.length + cjkCount;
}

function renderInlineFormatting(text) {
  let t = text;
  t = t.replace(/\*\*(.+?)\*\*/g, (_, m) => chalk.bold(m));
  t = t.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, m) => chalk.italic(m));
  t = t.replace(/`([^`]+)`/g, (_, m) => C.accent(m));
  return t;
}

// Simulate the table buffer + render logic from repl.ts
const tableBuffer = [];
let tableAligns = [];
let tableHasHeader = false;

function flushTableBuffer(maxW) {
  if (tableBuffer.length === 0) return;
  const rows = tableBuffer;
  const cols = rows[0].length;
  const aligns = tableAligns.length === cols ? tableAligns : Array(cols).fill('left');

  const colWidths = Array(cols).fill(4);
  for (const row of rows) {
    for (let i = 0; i < cols; i++) {
      colWidths[i] = Math.max(colWidths[i], displayWidth(row[i]) + 2);
    }
  }
  const borderOverhead = 4 + (cols - 1) * 3;
  let totalW = colWidths.reduce((a, b) => a + b, 0) + borderOverhead;
  if (totalW > maxW) {
    const excess = totalW - maxW;
    for (let i = cols - 1; i >= 0 && excess > 0; i--) {
      const cut = Math.min(excess, Math.max(0, colWidths[i] - 3));
      colWidths[i] -= cut;
      totalW -= cut;
    }
  }

  const padCell = (text, w, align) => {
    const len = displayWidth(text);
    if (len >= w) return w > 2 ? text.substring(0, w - 1) + '…' : '…';
    const pad = w - len;
    if (align === 'right') return ' '.repeat(pad) + text;
    if (align === 'center') {
      const left = Math.floor(pad / 2);
      return ' '.repeat(left) + text + ' '.repeat(pad - left);
    }
    return text + ' '.repeat(pad);
  };

  const borderTop = C.dim('╭' + colWidths.map(w => '─'.repeat(w)).join('┬') + '╮');
  const borderMid = C.dim('├' + colWidths.map(w => '─'.repeat(w)).join('┼') + '┤');
  const borderBot = C.dim('╰' + colWidths.map(w => '─'.repeat(w)).join('┴') + '╯');

  console.log('  ' + borderTop);
  const headerRow = rows[0];
  const dataStart = tableHasHeader ? 1 : 0;
  if (tableHasHeader && rows.length > 0) {
    const rendered = headerRow.map((c, i) => chalk.bold(padCell(c, colWidths[i], aligns[i]))).join(C.dim(' │ '));
    console.log('  ' + C.dim('│') + ' ' + rendered + ' ' + C.dim('│'));
    console.log('  ' + borderMid);
  }
  for (let r = dataStart; r < rows.length; r++) {
    const rendered = rows[r].map((c, i) => padCell(renderInlineFormatting(c), colWidths[i], aligns[i])).join(C.dim(' │ '));
    console.log('  ' + C.dim('│') + ' ' + rendered + ' ' + C.dim('│'));
  }
  console.log('  ' + borderBot);
  tableBuffer.length = 0;
  tableAligns = [];
  tableHasHeader = false;
}

function processLine(line, maxW) {
  if (line.trim() === '') { flushTableBuffer(maxW); console.log(); return; }
  if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
    const cells = line.trim().split('|').filter(c => c.trim()).map(c => c.trim());
    if (cells.length === 0) return;
    if (cells.every(c => /^:?-{3,}:?$/.test(c))) {
      tableAligns = cells.map(c => {
        if (c.startsWith(':') && c.endsWith(':')) return 'center';
        if (c.endsWith(':')) return 'right';
        return 'left';
      });
      tableHasHeader = true;
      return;
    }
    tableBuffer.push(cells);
    return;
  }
  flushTableBuffer(maxW);
  console.log('  ' + renderInlineFormatting(line));
}

// ============================================================
// Test cases
// ============================================================

console.log('\n=== Test 1: Simple table with left/center/right alignment ===\n');
processLine('| Name    | Version | Downloads |', 80);
processLine('|:--------|:-------:|----------:|', 80);
processLine('| react   | 18.2.0  | 2.5M     |', 80);
processLine('| vue     | 3.3.0   | 1.8M     |', 80);
processLine('| angular | 16.0.0  | 800K     |', 80);
processLine('', 80); // flush

console.log('\n=== Test 2: Table without separator (auto-header detection) ===\n');
processLine('| Column A | Column B | Column C |', 80);
processLine('| data 1   | data 2   | data 3   |', 80);
processLine('| more     | stuff    | here     |', 80);
processLine('', 80);

console.log('\n=== Test 3: Narrow terminal (40 chars) ===\n');
processLine('| Framework | Language | Stars | License |', 40);
processLine('|:----------|:---------|:------|:--------|', 40);
processLine('| React     | JavaScript | 200K | MIT |', 40);
processLine('| Django    | Python   | 70K  | BSD |', 40);
processLine('', 40);

console.log('\n=== Test 4: Single column ===\n');
processLine('| Result |', 80);
processLine('|--------|', 80);
processLine('| Pass   |', 80);
processLine('| Fail   |', 80);
processLine('', 80);

console.log('\n=== Test 5: Chinese content ===\n');
processLine('| 服务       | 状态   | 端口  |', 70);
processLine('|:-----------|:------:|------:|', 70);
processLine('| platform   | 运行中 | 8080  |', 70);
processLine('| ui         | 等待中 | 3000  |', 70);
processLine('| test       | 已停止 | -     |', 70);
processLine('', 70);

console.log('\n=== Test 6: Mixed CJK+ASCII — verify alignment ===\n');
processLine('| Framework | Version  | 中文名称     | Status  |', 80);
processLine('|:----------|:--------:|:------------|:--------|', 80);
processLine('| React     | 18.2.0   | 反应        | stable  |', 80);
processLine('| Vue       | 3.3.0    | 视图        | stable  |', 80);
processLine('| Angular   | 16.0.0   | 角框架      | LTS     |', 80);
processLine('| Svelte    | 4.0.0    | 斯维尔特    | active  |', 80);
processLine('', 80);

console.log('\n=== Test 7: Full Chinese table ===\n');
processLine('| 姓名   | 部门     | 职位         | 入职日期   |', 76);
processLine('|:-------|:---------|:-------------|:-----------|', 76);
processLine('| 张三   | 技术部   | 高级工程师   | 2023-03-15 |', 76);
processLine('| 李四   | 产品部   | 产品经理     | 2022-11-01 |', 76);
processLine('| 王五   | 设计部   | UI 设计师    | 2024-01-20 |', 76);
processLine('', 76);
