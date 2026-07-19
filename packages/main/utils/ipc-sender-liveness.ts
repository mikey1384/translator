import type { IpcMainInvokeEvent } from 'electron';

type SenderLivenessEvent = Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>;

/**
 * An invoke sender cannot receive and act on a handoff after its originating
 * frame navigates or is destroyed. Electron exposes that state as either a
 * null senderFrame or a detached frame while the owning WebContents may remain
 * alive across a reload.
 */
export function isIpcInvokeSenderGone(event: SenderLivenessEvent): boolean {
  try {
    if (event.sender.isDestroyed()) return true;
    const frame = event.senderFrame;
    return !frame || frame.detached;
  } catch {
    return true;
  }
}
