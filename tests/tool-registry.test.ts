import { describe, expect, it } from 'vitest';
import {
  buildToolCapabilitySnapshot,
  getStepToolCapabilities,
  getToolCapability,
  renderStepToolStatus,
  renderToolFallbackSummary,
} from '../src/core/tool-registry.js';

describe('tool capability registry', () => {
  it('exposes all five tool categories with runtime status', () => {
    const snapshot = buildToolCapabilitySnapshot();

    expect(snapshot.capabilities.map(item => item.id)).toEqual([
      'file-ops',
      'search',
      'command',
      'web-search',
      'code-intelligence',
    ]);
    expect(getToolCapability('file-ops').status).toBe('available');
    expect(getToolCapability('search').status).toBe('available');
    expect(getToolCapability('command').status).toBe('available');
  });

  it('marks web-search and code-intelligence as available by default (S10)', () => {
    const web = getToolCapability('web-search');
    const code = getToolCapability('code-intelligence');

    expect(web.status).toBe('available');
    expect(code.status).toBe('available');
    expect(code.availability).toBe('builtin');
  });

  it('queries required tools by loop step', () => {
    expect(getStepToolCapabilities('collect-context').map(item => item.id)).toEqual([
      'file-ops',
      'search',
      'web-search',
      'code-intelligence',
    ]);
    expect(getStepToolCapabilities('take-action').map(item => item.id)).toEqual([
      'file-ops',
      'search',
      'command',
    ]);
    expect(getStepToolCapabilities('verify-result').map(item => item.id)).toEqual([
      'file-ops',
      'search',
      'command',
      'code-intelligence',
    ]);
  });

  it('shows all tools available when everything is online', () => {
    const summary = renderToolFallbackSummary();
    const collect = renderStepToolStatus('collect-context');

    expect(summary).toBe('五大工具能力均可用。');
    expect(collect).toContain('收集上下文');
  });

  it('can mark web-search as available and code-intelligence as limited', () => {
    const snapshot = buildToolCapabilitySnapshot({ webSearchAvailable: true, codeIntelligenceAvailable: false });

    expect(snapshot.capabilities.find(item => item.id === 'web-search')?.status).toBe('available');
    expect(snapshot.capabilities.find(item => item.id === 'code-intelligence')?.status).toBe('limited');
    expect(renderToolFallbackSummary({ webSearchAvailable: true })).toBe('五大工具能力均可用。');
  });
});

