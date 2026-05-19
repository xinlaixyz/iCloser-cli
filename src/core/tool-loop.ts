// Tool Loop — AI-driven multi-round tool calling engine
// AI decides which tools to call, system executes, results feed back to AI,
// loop continues until AI produces a final text response without tool calls.

import type { ToolDefinition, AIProviderAdapter } from '../ai/provider.js';
import type { AIResponse } from '../types.js';
import { executeToolCall as executeTool } from './tool-executor.js';

export interface ToolLoopOptions {
  task: string;
  systemPrompt: string;
  provider: AIProviderAdapter;
  tools: ToolDefinition[];
  rootPath: string;
  taskId?: string;
  maxRounds?: number;
  tokenBudget?: number;
  onProgress?: (event: ToolLoopProgress) => void;
  /** Pre-loaded code snippets + memory injected before the first AI round */
  preloadContext?: { codeSnippets?: { file: string; content: string }[]; memory?: string };
}

export interface ToolLoopProgress {
  phase: 'thinking' | 'tool_call' | 'tool_result' | 'synthesizing' | 'done';
  round: number;
  message: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  resultLength?: number;
}

export interface ToolLoopResult {
  finalResponse: string;
  rounds: number;
  toolCalls: ToolLoopCallRecord[];
  tokensUsed: number;
  success: boolean;
}

export interface ToolLoopCallRecord {
  round: number;
  name: string;
  args: Record<string, unknown>;
  result: string;
  success: boolean;
}

const DEFAULT_MAX_ROUNDS = 8;
const DEFAULT_TOKEN_BUDGET = 80000; // 80K chars — roughly 20K tokens
const TOOL_RESULT_MAX_LENGTH = 15000; // truncate each tool result (was 6000, too small for web pages)

interface ToolMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  tool_call_id?: string;
  name?: string;
}

export async function runToolLoop(options: ToolLoopOptions): Promise<ToolLoopResult> {
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const tokenBudget = options.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const records: ToolLoopCallRecord[] = [];
  let totalTokensUsed = 0;
  let budgetWarningSent = false;
  // Track fetched URLs and read files to prevent repeats
  const fetchedUrls = new Map<string, string>(); // url → cached result
  const readFiles = new Map<string, string>();   // filePath → cached result
  let lastRoundTools = new Set<string>();       // detect no-progress stalls

  const toolSystemPrompt = buildToolSystemPrompt(options.systemPrompt, options.tools);
  const messages: ToolMessage[] = [];

  // Inject pre-loaded context BEFORE the user task so AI sees it on round 1
  if (options.preloadContext) {
    const { codeSnippets, memory } = options.preloadContext;
    if (codeSnippets && codeSnippets.length > 0) {
      const snippetsBlock = codeSnippets
        .slice(0, 30) // cap at 30 files to avoid blowing the context
        .map(s => `### ${s.file}\n\`\`\`\n${s.content.slice(0, 3000)}\n\`\`\``)
        .join('\n\n');
      messages.push({
        role: 'system',
        content: `[预加载项目代码 — 你已拥有以下关键文件的内容。优先使用这些信息，只在信息不足时才调用 read_file]\n\n${snippetsBlock}`,
      });
    }
    if (memory) {
      messages.push({
        role: 'system',
        content: `[预加载项目记忆]\n${memory.slice(0, 3000)}`,
      });
    }
  }

  messages.push({ role: 'user', content: options.task });

  let round = 0;
  for (; round < maxRounds; round++) {
    // P0-1: Real token budget check using AI response tokensUsed
    if (totalTokensUsed > tokenBudget && !budgetWarningSent) {
      budgetWarningSent = true;
      messages.push({
        role: 'user',
        content: '[系统] Token 预算接近上限。请在下一轮直接给出最终分析结果，不要再调用工具。',
      });
    }

    options.onProgress?.({ phase: 'thinking', round: round + 1, message: 'AI 正在分析...' });

    // Call AI — P0-2: tool results only in history, NOT duplicated in relevantMemory
    let response: AIResponse;
    try {
      response = await options.provider.chat(
        {
          systemPrompt: toolSystemPrompt,
          context: {
            projectMeta: '',
            relevantCode: [],
            relevantMemory: '',
            totalTokens: 0,
            budgetUsed: 0,
          },
          task: options.task,
          history: formatMessagesForProvider(messages),
        },
        options.tools.length > 0 ? options.tools : undefined,
      );
    } catch (err) {
      return { finalResponse: `AI 调用失败: ${(err as Error).message}`, rounds: round + 1, toolCalls: records, tokensUsed: totalTokensUsed, success: false };
    }

    totalTokensUsed += response.tokensUsed || Math.ceil(response.content.length / 4);

    // Check if AI returned tool calls
    if (response.toolCalls && response.toolCalls.length > 0) {
      // Record assistant message with tool calls
      // P1-8: normalize arguments — providers may return parsed objects or JSON strings
      messages.push({
        role: 'assistant',
        content: response.content || '',
        tool_calls: response.toolCalls.map(tc => ({
          name: tc.name,
          arguments: normalizeArgs(tc.arguments),
        })),
      });

      // Execute each tool call
      for (const tc of response.toolCalls) {
        const args = normalizeArgs(tc.arguments);
        options.onProgress?.({
          phase: 'tool_call',
          round: round + 1,
          message: `调用工具: ${tc.name}`,
          toolName: tc.name,
          toolArgs: args,
        });

        let toolResult: string;
        const filePath: string = normalizePath(args.path || args.file || args.filePath || '');
        const searchQuery: string = (args.query || args.pattern || '').toString().toLowerCase().trim();

        // Dedup: skip repeat tool calls for same args
        const isRepeatRead = (tc.name === 'read_file' || tc.name === 'read_pdf' || tc.name === 'list_dir') && readFiles.has(filePath);
        const isRepeatFetch = tc.name === 'web_fetch' && fetchedUrls.has(args.url as string);
        const isRepeatSearch = (tc.name === 'web_search' || tc.name === 'search_code')
          && fetchedUrls.has(`search:${searchQuery}`);

        if (isRepeatRead) {
          toolResult = `⚠️ 重复读取拦截：你已读取过 ${filePath}。直接使用之前内容，禁止重复读取。\n\n---\n${readFiles.get(filePath)}`;
          messages.push({
            role: 'user',
            content: `[系统] 你刚才重复读取了 ${filePath}。该文件内容已在对话中，请立即生成最终报告，不要再调用任何工具。已读取: ${[...readFiles.keys()].join(', ')}`,
          });
        } else if (isRepeatFetch) {
          toolResult = `⚠️ 重复请求拦截：你已抓取过 ${args.url}。直接使用之前获取的网页内容进行分析，禁止重复请求。\n\n---\n${fetchedUrls.get(args.url as string)}`;
          messages.push({
            role: 'user',
            content: `[系统] 你刚才重复请求了已抓取过的 URL。网页内容已在对话中，请立即基于已有内容生成最终回复。已抓取: ${[...fetchedUrls.keys()].filter(k => !k.startsWith('search:')).join(', ')}`,
          });
        } else if (isRepeatSearch) {
          toolResult = `⚠️ 重复搜索拦截：你已搜索过 "${searchQuery}"。使用之前的搜索结果。`;
        } else {
          try {
            toolResult = await executeTool(tc.name, args, options.rootPath, options.taskId);
          } catch (err) {
            toolResult = `工具执行错误: ${(err as Error).message}`;
          }
        }

        // Cache results
        if ((tc.name === 'read_file' || tc.name === 'read_pdf' || tc.name === 'list_dir') && !readFiles.has(filePath) && !toolResult.startsWith('错误') && toolResult.length > 50) {
          readFiles.set(filePath, toolResult);
          // After first successful read, inject gentle stop signal
          if (readFiles.size >= 2) {
            messages.push({
              role: 'user',
              content: `[系统] 已读取 ${readFiles.size} 个文件。信息充足，请立即生成最终报告，不要再调用工具。`,
            });
          }
        }
        if (tc.name === 'web_fetch' && !fetchedUrls.has(args.url as string) && !toolResult.startsWith('错误') && toolResult.length > 100) {
          fetchedUrls.set(args.url as string, toolResult);
          messages.push({
            role: 'user',
            content: `[系统] 网页已抓取 (${toolResult.length} 字符)。请立即基于此内容给出最终回复。`,
          });
        }
        if ((tc.name === 'web_search' || tc.name === 'search_code') && !fetchedUrls.has(`search:${searchQuery}`)) {
          fetchedUrls.set(`search:${searchQuery}`, toolResult);
        }

        // Truncate long results
        if (toolResult.length > TOOL_RESULT_MAX_LENGTH) {
          toolResult = toolResult.slice(0, TOOL_RESULT_MAX_LENGTH) +
            `\n...(结果过长，已截断。原始长度: ${toolResult.length} 字符)`;
        }

        totalTokensUsed += Math.ceil(toolResult.length / 4);

        records.push({
          round: round + 1,
          name: tc.name,
          args,
          result: toolResult.slice(0, 500), // keep record compact
          success: !toolResult.startsWith('错误') && !toolResult.startsWith('工具执行错误'),
        });

        options.onProgress?.({
          phase: 'tool_result',
          round: round + 1,
          message: `工具 ${tc.name} 完成 (${toolResult.length} 字符)`,
          toolName: tc.name,
          toolResult: toolResult.slice(0, 200),
          resultLength: toolResult.length,
        });

        // Feed result back to AI
        messages.push({
          role: 'tool',
          content: toolResult,
          name: tc.name,
        });
      }

      // No-progress detection: ANY repeat or stall → force synthesis immediately
      const thisRoundKeys = new Set(response.toolCalls.map(tc => `${tc.name}:${JSON.stringify(normalizeArgs(tc.arguments))}`));
      const hasRepeatInRound = thisRoundKeys.size < response.toolCalls.length; // same tool+args duplicated in one round
      const isStall = lastRoundTools.size > 0 && setsEqual(thisRoundKeys, lastRoundTools);

      if (hasRepeatInRound || isStall) {
        messages.push({
          role: 'user',
          content: '[系统] 检测到重复工具调用。你已拥有所有必要信息，请立即输出最终分析报告，不要再调用任何工具。直接写 Markdown 报告。',
        });
        // Force immediate synthesis on next round — skip remaining rounds
        if (isStall) {
          // Break out of loop and go straight to forced synthesis
          round = maxRounds;
          break;
        }
      }
      lastRoundTools = thisRoundKeys;
    } else {
      // No tool calls — AI gave final response
      // Strip XML tool simulation from text output
      const cleanContent = stripSimulatedToolCalls(response.content);
      options.onProgress?.({ phase: 'done', round: round + 1, message: '分析完成' });
      return {
        finalResponse: cleanContent,
        rounds: round + 1,
        toolCalls: records,
        tokensUsed: totalTokensUsed,
        success: true,
      };
    }
  }

  // Max rounds reached — force final synthesis
  // P2-12: preserve original system prompt role
  options.onProgress?.({ phase: 'synthesizing', round, message: '达到最大轮次，强制合成...' });

  messages.push({
    role: 'user',
    content: '[系统] 已达到最大工具调用轮次。请基于已有的所有信息，直接输出最终的分析结果。不要继续调用工具。',
  });

  try {
    const finalResp = await options.provider.chat(
      {
        systemPrompt: toolSystemPrompt + '\n\n【最终指令】已达到工具调用上限。你必须基于对话历史中已有的所有数据，输出一份完整的分析报告。禁止输出 JSON/XML 格式的工具调用。直接用 Markdown 写报告。',
        context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
        task: options.task,
        history: formatMessagesForProvider(messages),
      },
      undefined, // no tools this time
    );
    totalTokensUsed += finalResp.tokensUsed || Math.ceil(finalResp.content.length / 4);
    return {
      finalResponse: stripSimulatedToolCalls(finalResp.content),
      rounds: round + 1,
      toolCalls: records,
      tokensUsed: totalTokensUsed,
      success: true,
    };
  } catch (err) {
    return {
      finalResponse: `分析超时: ${(err as Error).message}`,
      rounds: round + 1,
      toolCalls: records,
      tokensUsed: totalTokensUsed,
      success: false,
    };
  }
}

function normalizeArgs(args: unknown): Record<string, unknown> {
  if (!args) return {};
  if (typeof args === 'object' && !Array.isArray(args)) return args as Record<string, unknown>;
  if (typeof args === 'string') {
    try { return JSON.parse(args); } catch { return {}; }
  }
  return {};
}

/** Normalize file paths for dedup: strip ./ prefix, normalize slashes, trim */
function normalizePath(p: unknown): string {
  const s = String(p ?? '').trim().replace(/\\/g, '/');
  return s.replace(/^\.\//, '').replace(/\/$/, '') || s;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) { if (!b.has(item)) return false; }
  return true;
}

/** Strip XML/JSON-formatted tool call simulation from AI text output */
function stripSimulatedToolCalls(text: string): string {
  if (!text) return text;
  let cleaned = text;
  // Remove JSON tool call blocks: {"tool_name": {"arg": "val"}}
  cleaned = cleaned.replace(/\{\s*"(read_file|web_fetch|web_search|search_code|run_command|code_intel|git_status)"\s*:\s*\{[^}]*\}\s*\}/gi, '');
  // Remove ```json fences around tool calls
  cleaned = cleaned.replace(/```json\s*[\s\S]*?```/g, '');
  // Remove <function-calls>...</function-calls> blocks
  cleaned = cleaned.replace(/<function-calls>[\s\S]*?<\/function-calls>/gi, '');
  cleaned = cleaned.replace(/<function-call[^>]*\/>/gi, '');
  // Remove XML: <tool_name>...</tool_name>
  cleaned = cleaned.replace(/<(\w+)>[\s\S]*?<\/\1>/gi, '');
  cleaned = cleaned.replace(/<\w+\s+[^>]*\/>/gi, '');
  cleaned = cleaned.replace(/<\w+\s+[^>]*>/gi, '');
  // Collapse multiple blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  return cleaned.trim() || text;
}

function buildToolSystemPrompt(basePrompt: string, tools: ToolDefinition[]): string {
  const toolList = tools.map((t, i) => {
    const params = t.parameters?.properties
      ? Object.entries(t.parameters.properties as Record<string, { type: string; description?: string }>)
          .map(([k, v]) => `    - ${k}: ${v.type} — ${v.description || ''}`)
          .join('\n')
      : '    无参数';
    return `${i + 1}. **${t.name}**: ${t.description}\n${params}`;
  }).join('\n\n');

  return `${basePrompt}

## 可用工具
你可以调用以下工具获取实时信息。每次回复可以调用一个或多个工具。

${toolList}

## 工具使用规则
1. 收到文件分析任务时：**先 list_dir → 看到文件列表 → 立即 read_file/read_pdf 读取关键文件 → 生成报告**
2. ⚠️ 不要在 list_dir 后就停下来说"我会探索"——list_dir 只是第一步，必须紧接着用 read_file 读取实际内容
3. 每个文件/目录只读取一次，读取后立即生成报告，不要重复
4. 禁止在文本中输出 XML/JSON 格式的工具调用
5. 最终报告用 Markdown，包含文件来源`;
}

function formatMessagesForProvider(messages: ToolMessage[]): string {
  return messages.map(m => {
    const prefix = m.role === 'system' ? '系统' :
      m.role === 'user' ? '用户' :
      m.role === 'assistant' ? 'AI' : `工具${m.name ? `(${m.name})` : ''}`;
    let text = `[${prefix}]`;

    if (m.role === 'assistant' && m.tool_calls) {
      text += ` 决定调用: ${m.tool_calls.map(tc => tc.name).join(', ')}`;
    }
    if (m.content) {
      // Tool results can be large (web pages); keep full content, cap at 20K
      const maxLen = m.role === 'tool' ? 20000 : 4000;
      text += ' ' + m.content.slice(0, maxLen);
    }
    return text;
  }).join('\n');
}
