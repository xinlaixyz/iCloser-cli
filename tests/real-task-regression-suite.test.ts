import { describe, expect, it } from 'vitest';
import {
  getDefaultRealTaskRegressionCases,
  runDefaultRealTaskRegressionSuite,
} from '../src/core/real-task-regression-suite.js';

describe('real task regression suite', () => {
  it('covers the required customer-facing task classes', () => {
    const cases = getDefaultRealTaskRegressionCases();
    expect(cases.map(item => item.id)).toEqual([
      'web-visit-icloser',
      'investment-report',
      'web-bugfix',
      'project-startup',
    ]);
  });

  it('keeps sample tasks above the quality floor', () => {
    const results = runDefaultRealTaskRegressionSuite();
    const failed = results.filter(result => !result.pass);
    expect(failed).toEqual([]);
    expect(results.every(result => result.typeOk)).toBe(true);
    expect(results.every(result => result.quality.score >= 80)).toBe(true);
  });
});
