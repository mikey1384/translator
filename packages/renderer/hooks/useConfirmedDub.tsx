import { useState } from 'react';
import ConfirmDubCostDialog from '../components/ConfirmDubCostDialog';
import { useCreditCostEstimates } from './useCreditCostEstimates';
import { dubCostConfirmPrompt } from '../utils/creditEstimates';
import { runMountedDub } from '../utils/runDub';

type Prompt = {
  estimatedCredits: number;
  balance: number;
  resolve: (confirmed: boolean) => void;
};

/**
 * The one way a Dub button starts a dub: a dub that would use a large share
 * of the balance asks first ("Start dubbing?", with its cost), then runs the
 * shared mounted dub. Render `confirmDialog` once in the component.
 */
export function useConfirmedDub() {
  const { credits, dubbingEstimate } = useCreditCostEstimates();
  const [prompt, setPrompt] = useState<Prompt | null>(null);

  function confirmDubCost(): Promise<boolean> {
    const ask = dubCostConfirmPrompt(dubbingEstimate, credits);
    if (!ask) return Promise.resolve(true);
    return new Promise(resolve => setPrompt({ ...ask, resolve }));
  }

  function settle(confirmed: boolean) {
    prompt?.resolve(confirmed);
    setPrompt(null);
  }

  async function startDub(
    options: Parameters<typeof runMountedDub>[0]
  ): Promise<boolean> {
    if (!(await confirmDubCost())) return false;
    return runMountedDub(options);
  }

  const confirmDialog = (
    <ConfirmDubCostDialog
      open={Boolean(prompt)}
      estimatedCredits={prompt?.estimatedCredits ?? 0}
      balance={prompt?.balance ?? 0}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { startDub, confirmDialog };
}
