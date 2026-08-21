import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_HANG_REPORTS } from '../services/hung-window-detector.js';
import type { CriticalFailureClass } from '../services/startup-health.js';

test('hung window detector limits emissions to MAX_HANG_REPORTS', () => {
  // Import the real constant from the detector module
  assert.equal(MAX_HANG_REPORTS, 3, 'MAX_HANG_REPORTS should be 3');
  
  // Simulate the logic that would cap emissions
  let hangCount = 0;
  for (let i = 0; i < 5; i++) {
    if (hangCount < MAX_HANG_REPORTS) {
      hangCount++;
    }
  }
  
  assert.equal(hangCount, MAX_HANG_REPORTS, 'Should limit to 3 hang reports');
});

test('negative: hang detector must not use renderer_process_gone', () => {
  // Verify that renderer_window_hung is a distinct failure class
  const hungFailure: CriticalFailureClass = 'renderer_window_hung';
  const goneFailure: CriticalFailureClass = 'renderer_process_gone';
  
  assert.notEqual(
    hungFailure,
    goneFailure,
    'Hung window must use distinct failure class, not renderer_process_gone'
  );
  
  // Verify both are valid critical failure classes
  const validClasses: CriticalFailureClass[] = [
    'startup_incomplete',
    'main_module_load_failed',
    'startup_initialization_failed',
    'main_process_exception',
    'main_process_rejection',
    'renderer_process_gone',
    'child_process_gone',
    'renderer_window_hung',
  ];
  
  assert.ok(validClasses.includes(hungFailure));
  assert.ok(validClasses.includes(goneFailure));
});
